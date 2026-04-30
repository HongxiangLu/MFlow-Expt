"""
数据库基础设施模块
该模块负责初始化 SQLAlchemy 异步引擎、配置 SQLite 运行参数以及创建异步会话工厂。
"""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import event
from core.config import settings
import os

# 确保数据库所在的目录存在，避免 SQLite 报 unable to open database file 错误
db_dir = os.path.dirname(settings.BACKEND_DB_PATH)
if db_dir and not os.path.exists(db_dir):
    os.makedirs(db_dir, exist_ok=True)

# 创建异步数据库引擎
# 采用 sqlite+aiosqlite 驱动以支持全链路异步操作，避免同步 IO 阻塞事件循环
# settings.BACKEND_DB_PATH 从环境变量或默认配置中读取
engine = create_async_engine(f"sqlite+aiosqlite:///{settings.BACKEND_DB_PATH}")

# =================================================================
# SQLite 性能与并发配置 (WAL 模式)
# =================================================================
# 背景：SQLite 默认的日志模式在并发读写时容易产生 'database is locked' 错误。
# 技术细节：
# 1. 监听 engine.sync_engine 的 "connect" 事件。
# 2. 在每个底层 DBAPI 连接建立时，执行 PRAGMA journal_mode=WAL。
# 3. WAL (Write-Ahead Logging) 模式允许读取操作不阻塞写入操作，显著提升并发性能。
@event.listens_for(engine.sync_engine, "connect")
def _set_wal(dbapi_conn, _):
    """
    为新建立的连接启用 WAL 模式。
    """
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()

# 创建异步会话工厂 (Session Factory)
# expire_on_commit=False 确保在 commit 后对象不会立即失效，方便在异步环境中使用
async_session = async_sessionmaker(engine, expire_on_commit=False)
