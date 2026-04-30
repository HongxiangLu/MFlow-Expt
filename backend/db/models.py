"""
数据模型定义模块
使用 SQLAlchemy ORM 定义系统的数据表结构。
符合 ARCHITECTURE.md 中关于“极简设计、高内聚低耦合”的架构约束。
"""

from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

# 所有 ORM 模型的基类
Base = declarative_base()

class ChatSession(Base):
    """
    会话表模型
    管理多轮对话的逻辑分组。
    """
    __tablename__ = "chat_sessions"

    # 主键 ID，对应前端生成的 session_id (UUID)
    id = Column(String, primary_key=True, index=True)
    
    # 预留多租户字段：当前阶段设为 nullable，为未来接入用户体系做“低成本预埋”
    user_id = Column(String, nullable=True)
    
    # 创建时间，使用 UTC 时间以规避时区问题
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系映射：一个 Session 拥有多个 Message
    # cascade="all, delete-orphan" 确保删除 Session 时自动清理其下的所有 Message
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")

class Message(Base):
    """
    消息表模型
    存储具体的对话内容，包括用户提问与 AI 回答。
    """
    __tablename__ = "messages"

    # 自增主键
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # 外键关联：指向 chat_sessions 表
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    
    # 角色定义：例如 "user" 或 "assistant"
    role = Column(String)
    
    # 消息文本内容
    content = Column(Text)
    
    # 创建时间
    created_at = Column(DateTime, default=datetime.utcnow)

    # 反向关系映射
    session = relationship("ChatSession", back_populates="messages")
