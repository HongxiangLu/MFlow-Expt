"""
大模型客户端单例模块 (LLM Client Singletons)

该模块负责初始化并对外暴露大语言模型(LLM)的调用客户端。
采用单例模式的设计，以复用底层的 HTTP 连接池，降低 TCP 握手开销。

目前集成了基于 OpenAI SDK 规范封装的 MiniMax-M2.7 接口。
"""

import logging

from openai import AsyncOpenAI
from core.config import settings

logger = logging.getLogger(__name__)

# 全局异步 LLM 客户端单例
# 通过 AsyncOpenAI 提供原生的异步支持（async/await），不会阻塞 FastAPI 的事件循环。
llm_client = AsyncOpenAI(
    # API 密钥，从配置文件的环境变量中读取
    api_key=settings.MINIMAX_API_KEY,
    # 基础 URL，用于兼容 OpenAI SDK 调用不同供应商的服务（如 MiniMax）
    base_url=settings.MINIMAX_BASE_URL,
)

logger.info(
    "LLM 客户端初始化完成: provider=MiniMax(OpenAI-compatible), base_url=%s, model=%s",
    settings.MINIMAX_BASE_URL,
    settings.MINIMAX_MODEL,
)
