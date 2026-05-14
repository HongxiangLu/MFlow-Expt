"""
M-Flow 框架评估脚本 (M-Flow Evaluation Script)

本脚本用于通过 Ragas (Retrieval Augmented Generation Assessment) 框架
对 M-Flow 系统的 RAG 回答能力进行自动化评估。

主要流程包括：
1. 循环读取并消耗 `raw_M-Flow.json` 中的未处理测试用例。
2. 通过调用 `m_flow.query` 接口获取模型回答，并将结果实时追加至 `res_M-Flow.json`（支持断点续传）。
3. 当所有用例处理完毕后，提取测试集的 Question、Answer 和 Ground Truth 数据。
4. 使用 MiniMax 作为裁判大模型 (Judge LLM)，使用 Jina 作为向量模型 (Embedding Model)。
5. 运行 Ragas 评估（包括：答案相关性、答案相似度、答案正确性）。
6. 将评估指标与明细结果导出为 CSV 文件。
"""
import os
import json
import asyncio
import pandas as pd
from dotenv import load_dotenv

# 预先加载环境配置变量，包含大模型 API Key 和接口地址等信息
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

import m_flow

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
# 1. 初始化裁判大模型 (Judge LLM) 相关配置
# ==========================================
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY")
MINIMAX_BASE_URL = os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
MINIMAX_MODEL = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7")

# 实例化裁判大模型，用于为 Ragas 评估指标进行打分
judge_llm = SafeChatOpenAI(
    api_key=MINIMAX_API_KEY,
    base_url=MINIMAX_BASE_URL,
    model=MINIMAX_MODEL, 
)

# ==========================================
# 2. 初始化向量模型 (Embedding Model) 相关配置
# ==========================================
JINA_API_KEY = os.getenv("EMBEDDING_API_KEY")
JINA_BASE_URL = os.getenv("EMBEDDING_ENDPOINT", "https://api.jina.ai/v1")
# 切除可能影响 API 读取的错误前缀，仅暴露纯模型代号 (如 'jina-embeddings-v4')
JINA_MODEL = os.getenv("EMBEDDING_MODEL", "jina-embeddings-v4").replace("jina_ai/", "")

# 实例化裁判向量模型，用于计算答案相似度等依赖向量化的指标
judge_embeddings = JinaEmbeddings(
    jina_api_key=JINA_API_KEY,
    model_name=JINA_MODEL
)

async def run_evaluation() -> None:
    """
    主评估协程函数，包含答案生成循环与指标评估逻辑。
    """
    print("开始通过 m_flow 获取 RAG 预测结果...")
    
    # 定义测试用例的数据文件路径
    unprocessed_file = "raw_M-Flow.json"  # 包含待回答问题的原始数据集
    processed_file = "res_M-Flow.json"    # 用于存储已获取回答的数据集 (用作断点续存)

    # 检查原始数据文件是否存在
    if not os.path.exists(unprocessed_file):
        print(f"错误: 找不到 {unprocessed_file}，请确保测试集文件已就绪。")
        return

    # 若记录处理结果的文件不存在，则初始化为空的 JSON 数组
    if not os.path.exists(processed_file):
        with open(processed_file, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=4)
            
    # ==========================================
    # 步骤 A: 循环获取所有待测问题的回答（支持断点续传）
    # ==========================================
    while True:
        # 每次循环重新读取未处理队列，保证对外部修改的敏感度和内存安全
        with open(unprocessed_file, "r", encoding="utf-8") as f:
            unprocessed_data = json.load(f)
            
        # 队列清空，表示所有问题均已得到回答
        if not unprocessed_data:
            print("\n所有问题都已回答完毕，未处理队列已经清空！\n即将开始 Ragas 指标评估...")
            break
            
        item = unprocessed_data[0]
        question = item["question"]
        gt = item.get("ground_truth", "")

        try:
            # 调用 m_flow 进行查询，默认模式下大模型将基于检索到的上下文生成回答
            res_main = await m_flow.query(question)
            
            prediction = "未能获取回答"
            # 解析回答：目前系统的主要自然语言回答存储在 context 的第一个元素中
            if hasattr(res_main, 'context') and isinstance(res_main.context, list) and len(res_main.context) > 0:
                raw_pred = str(res_main.context[0])
                # 去除可能的列表、字符串包裹符号
                prediction = raw_pred.strip("[]'\"")
                
            print(f"问题 '{question}' -> 获取回答完成")
            
            # 读出已处理的列表，将本次结果追加，再覆写保存
            with open(processed_file, "r", encoding="utf-8") as f:
                processed_data = json.load(f)
                
            processed_data.append({
                "question": question,
                "answer": prediction,
                "ground_truth": gt
            })
            
            with open(processed_file, "w", encoding="utf-8") as f:
                json.dump(processed_data, f, ensure_ascii=False, indent=4)
                
            # 从未处理队列中弹出当前问题，更新队列文件
            unprocessed_data.pop(0)
            with open(unprocessed_file, "w", encoding="utf-8") as f:
                json.dump(unprocessed_data, f, ensure_ascii=False, indent=4)
                
        except Exception as e:
            # 遇到网络或 API 错误时捕获异常并退出，下次运行脚本可从断点继续
            print(f"问题 '{question}' 查询失败抛出异常: {e}")
            print("请检查你的 Token、网络或服务后，再次运行该脚本从断点继续...")
            return

    # ==========================================
    # 步骤 B: 数据组装并开始 Ragas 评估
    # ==========================================
    with open(processed_file, "r", encoding="utf-8") as f:
        processed_data = json.load(f)
        
    if not processed_data:
        print("没有可用于评估的数据，结束程序。")
        return
        
    questions = [x["question"] for x in processed_data]
    answers = [x["answer"] for x in processed_data]
    ground_truths = [x["ground_truth"] for x in processed_data]

    # 构造符合 Ragas 标准评估集格式的数据字典
    data = {
        "question": questions,
        "answer": answers,
        "ground_truth": ground_truths
    }
    dataset = Dataset.from_dict(data)

    print("\n获取结果完毕，开始执行 Ragas 指标评估，这将会调用 LLM 打分器...")
    
    # 调起 Ragas 评估框架
    # Ragas 会利用内部封装的 Prompt 调用配置的 `judge_llm` 对结果进行多维度打分
    result = evaluate(
        dataset = dataset,
        metrics=[
            AnswerRelevancy(),   # 回答相关性：衡量回答针对问题的相关程度
            AnswerSimilarity(),  # 回答相似度：衡量回答与基准答案(Ground Truth)的语义相似度
            AnswerCorrectness(), # 回答正确性：衡量回答的事实准确性和完整度
        ],
        llm=judge_llm,
        embeddings=judge_embeddings,
        run_config=RunConfig(max_workers=4, max_wait=90, max_retries=15),
    )
    
    # ==========================================
    # 步骤 C: 输出评估报告并导出
    # ==========================================
    print("\n评估综合得分:")
    print(result)

    # 将详细的评估指标导出为 CSV 格式，方便后续复盘与分析
    print("\n评估详情导出为 CSV 文件 (res_M-Flow.csv)")
    df = result.to_pandas()
    df.to_csv("res_M-Flow.csv", index=False)

if __name__ == "__main__":
    # 启动异步评估任务
    asyncio.run(run_evaluation())
