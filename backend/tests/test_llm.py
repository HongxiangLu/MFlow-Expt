"""
LLM 服务连通性单元测试模块

该脚本用于验证 Phase 3 开发成果：后端系统与大语言模型（LLM）API 服务提供商（如 MiniMax、OpenAI 等）的连接状态。
它会调用系统全局的异步 LLM 客户端单例，发送轻量级的测试请求，以检查网络、环境变量及鉴权配置是否正常工作。
"""

import asyncio
import sys
import os

# 获取 backend 目录并加入 sys.path，以便正确导入项目内部的配置模块
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from core.llm import llm_client
from core.config import settings

async def main() -> None:
    """
    执行 LLM 连通性测试。
    
    测试流程：
    1. 打印当前配置的 API Base URL，供开发者核对环境。
    2. 使用全局 `llm_client` 发起一个非流式（Non-streaming）的 ChatCompletion 请求。
    3. 校验并输出模型的实际回复文本。
    """
    print("开始测试 LLM 连通性...")
    print(f"请求 Base URL: {settings.MINIMAX_BASE_URL}")
    
    try:
        # 发起轻量级的非流式对话请求
        # 指示模型尽返回极短内容以节约 Token 消耗和网络等待时间
        response = await llm_client.chat.completions.create(
            model="M2-her",  # 此处填入实际部署或测试所使用的模型版本标识（如 settings.MINIMAX_MODEL）
            messages=[
                {"role": "user", "content": "你好，这是一个测试消息。如果你收到了，请只回答“测试成功”。"}
            ],
            max_tokens=20,    # 限制最大返回长度，防止测试超时
            temperature=0.1   # 设置极低的随机性，保证测试结果的稳定性
        )
        
        # 提取并打印大模型的回复内容
        reply = response.choices[0].message.content
        print("✅ 请求成功！模型返回内容：")
        print(f"> {reply}")
        
    except Exception as e:
        # 捕获异常，便于排查诸如鉴权失败、网络代理错误等问题
        print("❌ 请求失败，遇到异常：")
        print(e)

if __name__ == "__main__":
    # 执行异步主入口
    asyncio.run(main())
