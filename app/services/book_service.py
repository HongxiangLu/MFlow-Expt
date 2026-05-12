from app.repositories.book_repository import BookRepository
from app.schemas.chat import ChatRequest
from app.services.minimax_service import MiniMaxService


class BookService:
    def __init__(
        self,
        repository: BookRepository,
        minimax_service: MiniMaxService | None = None,
    ) -> None:
        self.repository = repository
        self.minimax_service = minimax_service or MiniMaxService()

    async def list_books(self) -> list[dict]:
        return await self.repository.list_books_with_chapters()

    async def get_chapter_content(self, chapter_id: str) -> dict | None:
        return await self.repository.get_chapter_content(chapter_id)

    async def get_book_content(self, book_id: str) -> dict | None:
        return await self.repository.get_book_content(book_id)

    async def get_graph(self, book_id: str | None = None) -> dict:
        return await self.repository.get_graph(book_id=book_id)

    async def get_node_sources(
        self,
        node_id: str,
        book_id: str | None = None,
    ) -> list[dict]:
        return await self.repository.get_node_source_refs(
            node_id=node_id,
            book_id=book_id,
        )

    async def chat(self, request: ChatRequest) -> dict:
        context_markdown, source_refs = await self.get_chat_context(request)
        answer = await self.minimax_service.generate_answer(
            request=request,
            context_markdown=context_markdown,
            source_refs=source_refs,
        )
        return {
            "answer": answer,
            "sourceRefs": source_refs,
            "relatedNodeIds": self.get_related_node_ids(request),
        }

    async def stream_chat(self, request: ChatRequest):
        context_markdown, source_refs = await self.get_chat_context(request)
        async for chunk in self.minimax_service.stream_book_answer(
            request=request,
            context_markdown=context_markdown,
            source_refs=source_refs,
        ):
            yield chunk

    async def get_chat_meta(self, request: ChatRequest) -> dict:
        _, source_refs = await self.get_chat_context(request)
        return {
            "sourceRefs": source_refs,
            "relatedNodeIds": self.get_related_node_ids(request),
        }

    async def get_chat_context(self, request: ChatRequest) -> tuple[str, list[dict]]:
        source_refs = await self.repository.get_source_refs(
            book_id=request.bookId,
            chapter_id=request.chapterId,
        )
        context_markdown = ""
        if request.selectedText:
            context_markdown = request.selectedText.text
        elif request.chapterId:
            chapter = await self.repository.get_raw_chapter_content(request.chapterId)
            if chapter:
                context_markdown = chapter["markdown"]
        elif request.bookId:
            book = await self.repository.get_book_content(request.bookId)
            if book:
                context_markdown = book["markdown"]

        return context_markdown, source_refs

    def get_related_node_ids(self, request: ChatRequest) -> list[str]:
        related_node_ids = []
        if request.bookId:
            related_node_ids.append(request.bookId)
        if request.chapterId:
            related_node_ids.append(request.chapterId)
        return related_node_ids
