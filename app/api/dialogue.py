import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.dialogue import DashboardChatRequest
from app.services.minimax_service import MiniMaxService

router = APIRouter(prefix="/api", tags=["chat"])


def sse_data(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_error(code: str, message: str) -> str:
    payload = json.dumps({"code": code, "message": message}, ensure_ascii=False)
    return f"event: error\ndata: {payload}\n\n"


async def dashboard_chat_stream(request: DashboardChatRequest) -> AsyncGenerator[str, None]:
    try:
        service = MiniMaxService()
        async for chunk in service.stream_dashboard_answer(request.query):
            yield sse_data({"chunk": chunk, "finish_reason": None})
        yield sse_data({"chunk": "", "finish_reason": "stop"})
    except RuntimeError as exc:
        yield sse_error("internal_error", str(exc))
    except Exception as exc:
        yield sse_error("llm_error", f"MiniMax request failed: {exc}")


@router.post("/chat")
async def chat(request: DashboardChatRequest):
    return StreamingResponse(
        dashboard_chat_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
