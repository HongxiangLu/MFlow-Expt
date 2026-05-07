"""
对话接口路由模块（Controller 层）。

职责边界：
1. 接收并校验 `/api/chat` 的请求体。
2. 通过依赖注入获取数据库会话。
3. 将请求转发给 chat_service，并将异步生成器封装为 SSE 响应。

约束：
- 本层不处理 RAG 业务细节、不拼装 Prompt、不做持久化编排。
- 仅做协议层转换与参数传递，保持“薄路由”。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from db.database import get_db
from schemas.payloads import ChatRequest
from services import chat_service

router = APIRouter(tags=["chat"])


@router.post("/api/chat")
async def chat(req: ChatRequest, db: AsyncSession = Depends(get_db)) -> EventSourceResponse:
    """
    对话流式接口（SSE）。

    Args:
        req: 请求体，包含 `query`（用户问题）与 `session_id`（会话标识）。
        db: 当前请求的异步数据库会话，由 FastAPI Depends 注入。

    Returns:
        EventSourceResponse: 标准 SSE 响应对象，流内数据由
        `chat_service.stream_chat(...)` 按事件帧持续产出。

    设计说明：
    - 该接口返回后连接会保持打开，直到服务端发送结束帧或错误事件。
    - media_type 明确声明为 `text/event-stream`，确保客户端按 SSE 协议解析。
    """
    return EventSourceResponse(
        chat_service.stream_chat(req.query, req.session_id, db),
        media_type="text/event-stream",
    )
