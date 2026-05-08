"""
FastAPI 应用入口 — Composition Root (main.py)。

本文件是整个后端服务的装配根 (Composition Root)，**不承载任何业务逻辑**。
其职责严格限定为以下四项：

1. **日志初始化**  — 调用 ``core.logging.setup_logging()``，确保后续所有
   模块的 ``logging.getLogger(__name__)`` 均继承统一的格式与等级。
2. **应用实例化**  — 创建 ``FastAPI`` 实例并注册生命周期管理器 (lifespan)。
3. **中间件注册**  — 挂载 CORS 等全局中间件。
4. **路由挂载**    — 将各业务路由器 (chat / graph) 注册到应用实例。

架构分层说明：
    - 路由层 (``api/``)     — HTTP 协议处理、请求/响应序列化
    - 服务层 (``services/``) — 业务编排与领域逻辑
    - 核心层 (``core/``)     — 配置、LLM 客户端、日志等基础设施
    - 数据层 (``db/``)       — ORM 模型与数据库会话管理

启动方式::

    # 开发环境（热重载）
    python main.py

    # 生产环境
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat import router as chat_router
from api.graph import router as graph_router
from core.config import settings
from core.logging import setup_logging
from db.database import engine
from db.models import Base

# =====================================================================
# 全局日志初始化
# =====================================================================
# 必须在所有业务代码 (路由注册、数据库初始化等) 之前执行，
# 否则这些模块在导入时产生的日志将无法被格式化。
setup_logging()
logger = logging.getLogger(__name__)


# =====================================================================
# 应用生命周期管理
# =====================================================================

@asynccontextmanager
async def lifespan(_: FastAPI):
    """应用生命周期管理器 (ASGI Lifespan Protocol)。

    启动阶段 (startup):
        - 以 DDL 方式自动创建尚未存在的数据库表 (开发友好)。

    关闭阶段 (shutdown):
        - 当前无显式清理逻辑；如需释放连接池等资源，在 yield 之后添加。
    """
    logger.info("Initializing database...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialization complete.")
    yield


# =====================================================================
# FastAPI 应用实例
# =====================================================================

app = FastAPI(title="M-Flow RAG Backend", lifespan=lifespan)
logger.info("FastAPI 应用初始化完成: title=%s", app.title)

# ---- CORS 中间件 ----------------------------------------------------
# 开发阶段允许所有来源；生产环境应收敛为具体前端域名列表。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info(
    "CORS 中间件已注册: allow_origins=%s, allow_credentials=%s, allow_methods=%s, allow_headers=%s",
    ["*"],
    False,
    ["*"],
    ["*"],
)

# ---- 业务路由挂载 ----------------------------------------------------
app.include_router(chat_router)
app.include_router(graph_router)
logger.info("业务路由挂载完成: routers=[chat, graph]")


# =====================================================================
# 开发环境启动入口
# =====================================================================

if __name__ == "__main__":
    # 通过 python main.py 直接启动，读取 .env 中的 APP_HOST / APP_PORT。
    # reload=True 开启热重载，仅适用于开发环境。
    logger.info(
        "通过 __main__ 启动 Uvicorn: host=%s, port=%s, reload=%s",
        settings.APP_HOST,
        settings.APP_PORT,
        True,
    )
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=True,
    )
