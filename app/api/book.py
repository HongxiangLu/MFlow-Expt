import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.repositories.book_repository import BookRepository
from app.schemas.chat import ChatRequest
from app.services.book_service import BookService

router = APIRouter(prefix="/api/book", tags=["book"])


def get_book_service(session: AsyncSession = Depends(get_session)) -> BookService:
    return BookService(BookRepository(session))


@router.get("/books")
async def list_books(service: BookService = Depends(get_book_service)):
    return {"data": await service.list_books()}


@router.get("/chapters/{chapter_id}/content")
async def get_chapter_content(
    chapter_id: str,
    service: BookService = Depends(get_book_service),
):
    content = await service.get_chapter_content(chapter_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Chapter content not found")

    return {"data": content}


@router.get("/books/{book_id}/content")
async def get_book_content(
    book_id: str,
    service: BookService = Depends(get_book_service),
):
    content = await service.get_book_content(book_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Book content not found")

    return {"data": content}


@router.get("/graph")
async def get_graph(
    book_id: str | None = Query(default=None, alias="bookId"),
    service: BookService = Depends(get_book_service),
):
    return {"data": await service.get_graph(book_id=book_id)}


@router.get("/graph/nodes/{node_id}/sources")
async def get_graph_node_sources(
    node_id: str,
    book_id: str | None = Query(default=None, alias="bookId"),
    service: BookService = Depends(get_book_service),
):
    return {"data": await service.get_node_sources(node_id=node_id, book_id=book_id)}


@router.post("/chat")
async def chat(
    request: ChatRequest,
    service: BookService = Depends(get_book_service),
):
    return build_chat_streaming_response(request, service)


def sse_data(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_error(code: str, message: str) -> str:
    payload = json.dumps({"code": code, "message": message}, ensure_ascii=False)
    return f"event: error\ndata: {payload}\n\n"


def sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def book_chat_stream(
    request: ChatRequest,
    service: BookService,
) -> AsyncGenerator[str, None]:
    try:
        async for chunk in service.stream_chat(request):
            yield sse_data({"chunk": chunk, "finish_reason": None})
        yield sse_event("meta", await service.get_chat_meta(request))
        yield sse_data({"chunk": "", "finish_reason": "stop"})
    except RuntimeError as exc:
        yield sse_error("internal_error", str(exc))
    except Exception as exc:
        yield sse_error("llm_error", f"MiniMax request failed: {exc}")


def build_chat_streaming_response(
    request: ChatRequest,
    service: BookService,
) -> StreamingResponse:
    return StreamingResponse(
        book_chat_stream(request, service),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    service: BookService = Depends(get_book_service),
):
    return build_chat_streaming_response(request, service)
