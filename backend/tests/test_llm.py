import asyncio
import sys
import os

# 将当前目录加入 sys.path 以便能够正确导入 core 模块
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from core.llm import llm_client
from core.config import settings

async def main():
    print("开始测试 LLM 连通性...")
    print(f"请求 Base URL: {settings.MINIMAX_BASE_URL}")
    
    try:
        # 发起一个简单的非流式对话请求以验证
        response = await llm_client.chat.completions.create(
            model="M2-her",  # 可根据实际配置或 settings.MINIMAX_MODEL 调整
            messages=[
                {"role": "user", "content": "你好，这是一个测试消息。如果你收到了，请只回答“测试成功”。"}
            ],
            max_tokens=20,
            temperature=0.1
        )
        
        reply = response.choices[0].message.content
        print("✅ 请求成功！模型返回内容：")
        print(f"> {reply}")
        
    except Exception as e:
        print("❌ 请求失败，遇到异常：")
        print(e)

if __name__ == "__main__":
    asyncio.run(main())
