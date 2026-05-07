"""
FastAPI 应用入口模块。

职责边界：
1. 创建 FastAPI 应用实例。
2. 注册全局中间件（如 CORS）。
3. 挂载路由（chat / graph）。
4. 管理应用生命周期事件（启动时初始化数据库表）。

说明：
- 本文件仅负责“应用装配”（composition root），不承载业务逻辑。
- 业务编排统一下沉到 services 层，路由协议处理在 api 层。
"""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat import router as chat_router
from api.graph import router as graph_router
from core.config import settings
from db.database import engine
from db.models import Base

# =================================================================
# 全局日志配置 (MVP)
# =================================================================
# 采用标准库 logging，设置 INFO 级别，确保核心链路可追溯。
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    应用生命周期管理器。
    """
    logger.info("Initializing database...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialization complete.")
    yield


app = FastAPI(title="M-Flow RAG Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(graph_router)


if __name__ == "__main__":
    # 标准启动入口，读取配置中心的 Host 与 Port
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=True,  # 开发环境下开启热重载
    )
