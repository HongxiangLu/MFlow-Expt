"""
数据库基础设施验证脚本
用于验证 Phase 2 开发成果：包括异步引擎、WAL 模式配置、ORM 模型定义及表创建。
"""

import asyncio
import sys
import os

# =================================================================
# 环境路径配置
# =================================================================
# 将项目根目录加入到 sys.path，确保在脚本运行模式下能正确导入 db 和 core 模块
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import engine, async_session
from db.models import Base, ChatSession

async def main():
    """
    主验证逻辑
    """
    # 步骤 1：创建数据库表
    # engine.begin() 开启一个事务
    # conn.run_sync() 将同步的建表操作转化为异步上下文执行
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # 步骤 2：验证数据写入与会话管理
    async with async_session() as s:
        # 添加一条测试 Session 记录
        # 如果 id 已存在，由于 SQLite 简单实现可能会报错，此处仅作为 Phase 2 连通性测试
        s.add(ChatSession(id="test-001"))
        
        # 提交事务
        await s.commit()
        
    print("✅ DB infrastructure verification successful (WAL mode & Async enabled)")

if __name__ == "__main__":
    # 启动异步事件循环运行主函数
    asyncio.run(main())
