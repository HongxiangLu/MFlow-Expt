"""
AnythingLLM 框架评估脚本 (AnythingLLM Evaluation Script)

本脚本用于通过 Ragas 框架对 AnythingLLM (ALLM) 的回答能力进行自动化评估。
主要用于将 AnythingLLM 的效果与 M-Flow 等其他 RAG 系统进行对比测试。

核心流程：
1. 配置 AnythingLLM 工作区的 API 接口参数。
2. 循环读取 `raw_ALLM.json` 中的测试问题，向 AnythingLLM 发送 HTTP POST 请求。
3. 实时存储预测结果至 `res_ALLM.json`，实现网络异常中断后的断点续传机制。
4. 清洗获取的回答（如过滤可能存在的 `<think>` 推理过程标签，避免干扰评价）。
5. 组装评估数据集，使用预先配置的 MiniMax (LLM) 和 Jina (Embeddings) 作为裁判。
6. 调用 Ragas 进行多维度指标打分，并输出综合与明细 CSV 结果。
"""

import os
import json
import re
import asyncio
import aiohttp
import pandas as pd
from dotenv import load_dotenv

# 加载环境变量配置，优先读取 backend 目录下的 .env
load_dotenv("backend/.env")

from datasets import Dataset
from ragas import evaluate
from ragas.run_config import RunConfig
from ragas.metrics import (
    AnswerRelevancy,
    AnswerSimilarity,
    AnswerCorrectness,
)
from langchain_openai import ChatOpenAI
from langchain_community.embeddings import JinaEmbeddings


class SafeChatOpenAI(ChatOpenAI):
    """
    基于 LangChain 的 ChatOpenAI 类的安全封装。
    
    目的：
    强制将生成参数 `n` 锁定为 1，以解决部分大模型 API（如阿里云百炼、MiniMax 等）
    在批量生成或特定参数组合下返回 HTTP 400 错误的问题。
    """
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        kwargs['n'] = 1 
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
        
    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        kwargs['n'] = 1
        return await super()._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)

# ==========================================
# 1. 初始化裁判模型 (Judge Models)
# ==========================================
# 提取 MiniMax LLM API 配置
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY")
MINIMAX_BASE_URL = os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
MINIMAX_MODEL = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7")

# 实例化评委大模型
judge_llm = SafeChatOpenAI(
    api_key=MINIMAX_API_KEY,
    base_url=MINIMAX_BASE_URL,
    model=MINIMAX_MODEL, 
)

# 提取 Jina Embeddings API 配置
JINA_API_KEY = os.getenv("EMBEDDING_API_KEY")
JINA_BASE_URL = os.getenv("EMBEDDING_ENDPOINT", "https://api.jina.ai/v1")
# 切除可能影响 API 读取的错误前缀，仅暴露纯模型代号
JINA_MODEL = os.getenv("EMBEDDING_MODEL", "jina-embeddings-v4").replace("jina_ai/", "")

# 实例化向量模型
judge_embeddings = JinaEmbeddings(
    jina_api_key=JINA_API_KEY,
    model_name=JINA_MODEL
)

# ==========================================
# 2. 配置 AnythingLLM 接口环境
# ==========================================
# 可以在 .env 中进行定义，若未定义则使用默认值
ANYTHING_LLM_URL = os.getenv("ANYTHING_LLM_URL", "http://localhost:3001")
WORKSPACE_SLUG = os.getenv("ANYTHING_LLM_WORKSPACE") # 工作区唯一标识符
API_KEY = os.getenv("ANYTHING_LLM_API_KEY")                 # 开发者 API Key

async def chat_with_anythingllm(session: aiohttp.ClientSession, question: str) -> str:
    """
    通过 HTTP POST 请求调用 AnythingLLM 工作区的 Chat 接口。
    
    前置条件：
    需要确保目标 AnythingLLM 工作区已经提前灌入了评测相关文档，并生成了向量索引。
    
    Args:
        session: aiohttp 的异步客户端会话对象。
        question: 用户提问文本。
        
    Returns:
        AnythingLLM 生成的回答文本。
    """
    url = f"{ANYTHING_LLM_URL}/api/v1/workspace/{WORKSPACE_SLUG}/chat"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "message": question,
        # 'chat' 模式会附加工作区的历史上下文，'query' 则是不保留聊天历史的一次性检索
        "mode": "chat"  
    }
    
    async with session.post(url, json=payload, headers=headers) as resp:
        if resp.status != 200:
            error_text = await resp.text()
            raise Exception(f"AnythingLLM API Error {resp.status}: {error_text}")
        
        data = await resp.json()
        
        # 尝试从响应的不同字段提取回答内容
        answer = data.get("textResponse", "")
        if not answer and "text" in data:
             answer = data.get("text", "")
             
        return answer

async def run_evaluation() -> None:
    """
    主评估协程函数，包含答案生成循环与 Ragas 指标评估逻辑。
    """
    print(f"开始通过 AnythingLLM ({ANYTHING_LLM_URL}/{WORKSPACE_SLUG}) 获取预测结果...")

    # 文件路径定义
    unprocessed_file = "raw_ALLM.json"  # 待处理问题集
    processed_file = "res_ALLM.json"    # 已处理并获取回答的数据集

    # 文件存在性检测与初始化
    if not os.path.exists(unprocessed_file):
        print(f"错误: 找不到 {unprocessed_file}，请确保在根目录初始化了该文件！")
        return

    # 若记录处理结果的文件不存在，则创建一个空的 JSON 数组文件
    if not os.path.exists(processed_file):
        with open(processed_file, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=4)
    
    # ==========================================
    # 步骤 A: 异步请求调用 AnythingLLM 获取回答 (支持断点续传)
    # ==========================================
    async with aiohttp.ClientSession() as session:
        while True:
            # 每次循环重新加载未处理文件，保障读写安全与状态一致性
            with open(unprocessed_file, "r", encoding="utf-8") as f:
                unprocessed_data = json.load(f)
            
            # 若队列为空，说明本轮(或之前的执行)已将全部题目答完
            if not unprocessed_data:
                print("\n所有问题都已回答完毕，未处理队列(unprocessed_cases.json)已经清空！\n即将开始 Ragas 指标评估...")
                break
                
            item = unprocessed_data[0]
            question = item["question"]
            gt = item.get("ground_truth", "")

            try:
                answer = await chat_with_anythingllm(session, question)
                print(f"问题 '{question}' -> 获取回答完成")
                
                # 读取已处理列表，追加新结果
                with open(processed_file, "r", encoding="utf-8") as f:
                    processed_data = json.load(f)
                    
                processed_data.append({
                    "question": question,
                    "answer": answer,
                    "ground_truth": gt
                })
                
                # 覆写保存结果到已处理文件
                with open(processed_file, "w", encoding="utf-8") as f:
                    json.dump(processed_data, f, ensure_ascii=False, indent=4)
                    
                # 从未处理队列出队首项，覆写保存未处理文件
                unprocessed_data.pop(0)
                with open(unprocessed_file, "w", encoding="utf-8") as f:
                    json.dump(unprocessed_data, f, ensure_ascii=False, indent=4)
                    
            except Exception as e:
                # 拦截请求异常并优雅中断，保护已有进度
                print(f"问题 '{question}' 查询失败抛出异常: {e}")
                print("请检查你的 Token、网络或服务后，再次运行该脚本从断点继续...")
                return

    # ==========================================
    # 步骤 B: 提取数据、清洗结果并运行 Ragas 评估
    # ==========================================
    with open(processed_file, "r", encoding="utf-8") as f:
        processed_data = json.load(f)
        
    if not processed_data:
        print("没有可用于评估的数据（processed_cases.json为空），结束程序。")
        return
        
    for item in processed_data:
        if "answer" in item and item["answer"]:
            # 数据清洗：利用正则去除大模型可能返回的 <think>...</think> 推理过程
            # 原因：推理过程内容较多，可能严重干扰 Ragas 计算语义相似度和相关性打分
            item["answer"] = re.sub(r'<think>.*?</think>', '', str(item["answer"]), flags=re.DOTALL).strip()
            
        # 安全防范：JINA 向量模型强制要求参与特征提取的信息绝不可为空值或 None
        if not item.get("answer"):
            item["answer"] = "未获取到有效回答"
            
    questions = [x.get("question", "未知问题") for x in processed_data]
    answers = [x.get("answer", "未获取到有效回答") for x in processed_data]
    ground_truths = [x.get("ground_truth", "无标准答案") for x in processed_data]

    # 3. 构造 Ragas 所需的 Dataset 格式
    data = {
        "question": questions,
        "answer": answers,
        "ground_truth": ground_truths
    }
    dataset = Dataset.from_dict(data)

    print("\n获取结果完毕，开始执行 Ragas 指标评估，这将会调用 LLM 打分器...")
    
    # 4. 执行多指标评估
    result = evaluate(
        dataset = dataset,
        metrics=[
            AnswerRelevancy(),   # 答案与问题的相关性
            AnswerSimilarity(),  # 答案与标准答案的语义相似度
            AnswerCorrectness(), # 答案内容正确性与完整性
        ],
        llm=judge_llm,
        embeddings=judge_embeddings,
        run_config=RunConfig(max_workers=4, max_wait=90, max_retries=15),
    )
    
    # ==========================================
    # 步骤 C: 输出评估结果并导出明细文件
    # ==========================================
    print("\nAnythingLLM 评估综合得分:")
    print(result)

    print("\n评估详情导出为 CSV 文件")
    df = result.to_pandas()
    df.to_csv("res_ALLM.csv", index=False)

if __name__ == "__main__":
    # 执行异步评估任务
    asyncio.run(run_evaluation())
