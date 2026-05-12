from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import (
    Book,
    Chapter,
    ChapterContent,
    GraphEdge,
    GraphNode,
    SourceRef,
)


def serialize_book(book: Book) -> dict:
    return {
        "id": book.id,
        "knowledgeBaseId": book.knowledge_base_id,
        "title": book.title,
        "author": book.author,
        "dynasty": book.dynasty,
        "description": book.description,
        "coverUrl": book.cover_url,
        "chapterCount": book.chapter_count,
        "createdAt": book.created_at,
        "updatedAt": book.updated_at,
    }


def serialize_chapter(chapter: Chapter) -> dict:
    return {
        "id": chapter.id,
        "bookId": chapter.book_id,
        "parentId": chapter.parent_id,
        "title": chapter.title,
        "order": chapter.sort_order,
        "level": chapter.level,
        "summary": chapter.summary,
        "markdownPath": chapter.markdown_path,
        "createdAt": chapter.created_at,
        "updatedAt": chapter.updated_at,
        "children": [],
    }


def serialize_source_ref(
    source_ref: SourceRef,
    book: Book | None = None,
    chapter: Chapter | None = None,
) -> dict:
    data = {
        "id": source_ref.id,
        "knowledgeBaseId": source_ref.knowledge_base_id,
        "bookId": source_ref.book_id,
        "bookTitle": book.title if book else None,
        "chapterId": source_ref.chapter_id,
        "chapterTitle": chapter.title if chapter else source_ref.title,
        "nodeId": source_ref.node_id,
        "anchorId": source_ref.anchor_id,
        "title": source_ref.title,
        "quote": source_ref.quote,
        "startOffset": source_ref.start_offset,
        "endOffset": source_ref.end_offset,
    }
    return data


class BookRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_books_with_chapters(self) -> list[dict]:
        books_result = await self.session.execute(select(Book).order_by(Book.title))
        books = books_result.scalars().all()

        chapters_result = await self.session.execute(
            select(Chapter).order_by(Chapter.book_id, Chapter.sort_order)
        )
        chapters = chapters_result.scalars().all()

        chapters_by_book: dict[str, list[dict]] = {}
        for chapter in chapters:
            chapters_by_book.setdefault(chapter.book_id, []).append(
                serialize_chapter(chapter)
            )

        return [
            {
                **serialize_book(book),
                "chapters": chapters_by_book.get(book.id, []),
            }
            for book in books
        ]

    async def get_chapter_content(self, chapter_id: str) -> dict | None:
        content = await self.session.get(ChapterContent, chapter_id)
        if content is None:
            return None

        return await self.get_book_content(content.book_id, current_chapter_id=chapter_id)

    async def get_raw_chapter_content(self, chapter_id: str) -> dict | None:
        content = await self.session.get(ChapterContent, chapter_id)
        if content is None:
            return None

        return {
            "chapterId": content.chapter_id,
            "bookId": content.book_id,
            "title": content.title,
            "markdown": content.markdown,
            "anchors": content.anchors or [],
            "entities": content.entities or [],
        }

    async def get_book_content(
        self,
        book_id: str,
        current_chapter_id: str | None = None,
    ) -> dict | None:
        book = await self.session.get(Book, book_id)
        if book is None:
            return None

        result = await self.session.execute(
            select(Chapter, ChapterContent)
            .join(ChapterContent, ChapterContent.chapter_id == Chapter.id)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.sort_order)
        )
        rows = result.all()
        if not rows:
            return None

        markdown_parts: list[str] = []
        anchors: list[dict] = []
        entities: list[dict] = []
        offset = 0

        for chapter, content in rows:
            if markdown_parts:
                markdown_parts.append("\n\n")
                offset += 2

            chapter_markdown = content.markdown or ""
            markdown_parts.append(chapter_markdown)

            for anchor in content.anchors or []:
                copied = dict(anchor)
                if copied.get("startOffset") is not None:
                    copied["startOffset"] += offset
                if copied.get("endOffset") is not None:
                    copied["endOffset"] += offset
                anchors.append(copied)

            for entity in content.entities or []:
                copied = dict(entity)
                if copied.get("startOffset") is not None:
                    copied["startOffset"] += offset
                if copied.get("endOffset") is not None:
                    copied["endOffset"] += offset
                entities.append(copied)

            offset += len(chapter_markdown)

        return {
            "chapterId": current_chapter_id or rows[0][0].id,
            "bookId": book.id,
            "title": book.title,
            "markdown": "".join(markdown_parts),
            "anchors": anchors,
            "entities": entities,
        }

    async def get_graph(self, book_id: str | None = None) -> dict:
        nodes_result = await self.session.execute(select(GraphNode).order_by(GraphNode.id))
        nodes = nodes_result.scalars().all()

        edges_result = await self.session.execute(select(GraphEdge).order_by(GraphEdge.id))
        edges = edges_result.scalars().all()

        source_refs_result = await self.session.execute(select(SourceRef))
        source_refs = source_refs_result.scalars().all()

        center_node_id = "kb-cultural-relics"
        graph_id = "graph-kb-cultural-relics"

        if book_id:
            center_node_id = book_id
            graph_id = f"graph-{book_id}"
            selected_node_ids = {book_id, "kb-cultural-relics"}
            selected_edge_ids: set[str] = set()
            frontier = {book_id}

            for _ in range(2):
                next_frontier: set[str] = set()
                for edge in edges:
                    if edge.source in frontier or edge.target in frontier:
                        selected_edge_ids.add(edge.id)
                        if edge.source not in selected_node_ids:
                            next_frontier.add(edge.source)
                        if edge.target not in selected_node_ids:
                            next_frontier.add(edge.target)
                        selected_node_ids.add(edge.source)
                        selected_node_ids.add(edge.target)
                frontier = next_frontier
                if not frontier:
                    break

            for source_ref in source_refs:
                if source_ref.book_id != book_id:
                    continue
                if source_ref.node_id:
                    selected_node_ids.add(source_ref.node_id)
                selected_node_ids.add(source_ref.chapter_id)

            selected_edge_ids.update(
                edge.id
                for edge in edges
                if edge.source in selected_node_ids and edge.target in selected_node_ids
            )

            nodes = [node for node in nodes if node.id in selected_node_ids]
            edges = [edge for edge in edges if edge.id in selected_edge_ids]

        edges = self._dedupe_undirected_edges(edges)

        serialized_source_refs = await self._serialize_source_refs_with_titles(source_refs)
        source_refs_by_node: dict[str, list[dict]] = {}
        for source_ref, serialized_source_ref in zip(source_refs, serialized_source_refs):
            if not source_ref.node_id:
                continue
            source_refs_by_node.setdefault(source_ref.node_id, []).append(serialized_source_ref)

        return {
            "graphId": graph_id,
            "centerNodeId": center_node_id,
            "nodes": [
                {
                    "id": node.id,
                    "label": node.label,
                    "nodeType": node.node_type,
                    "description": node.description,
                    "sourceRefs": source_refs_by_node.get(node.id, []),
                }
                for node in nodes
            ],
            "edges": [
                {
                    "id": edge.id,
                    "source": edge.source,
                    "target": edge.target,
                    "label": edge.label,
                    "weight": edge.weight,
                }
                for edge in edges
            ],
        }

    def _dedupe_undirected_edges(self, edges: list[GraphEdge]) -> list[GraphEdge]:
        edge_by_pair: dict[tuple[str, str], GraphEdge] = {}

        def edge_priority(edge: GraphEdge) -> tuple[int, float, str]:
            is_source_bridge = edge.id.startswith("edge-source-") or edge.label == "原文出处"
            return (0 if is_source_bridge else 1, edge.weight or 0, edge.id)

        for edge in edges:
            pair = tuple(sorted((edge.source, edge.target)))
            existing = edge_by_pair.get(pair)
            if existing is None or edge_priority(edge) > edge_priority(existing):
                edge_by_pair[pair] = edge

        return sorted(edge_by_pair.values(), key=lambda edge: edge.id)

    async def get_source_refs(
        self,
        book_id: str | None = None,
        chapter_id: str | None = None,
        node_id: str | None = None,
        limit: int = 3,
    ) -> list[dict]:
        statement = select(SourceRef)
        if book_id:
            statement = statement.where(SourceRef.book_id == book_id)
        if chapter_id:
            statement = statement.where(SourceRef.chapter_id == chapter_id)
        if node_id:
            statement = statement.where(SourceRef.node_id == node_id)

        result = await self.session.execute(statement.limit(limit))
        source_refs = result.scalars().all()
        return await self._serialize_source_refs_with_titles(source_refs)

    async def get_node_source_refs(
        self,
        node_id: str,
        book_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        return await self.get_source_refs(
            book_id=book_id,
            node_id=node_id,
            limit=limit,
        )

    async def _serialize_source_refs_with_titles(self, source_refs: list[SourceRef]) -> list[dict]:
        if not source_refs:
            return []

        book_ids = {item.book_id for item in source_refs}
        chapter_ids = {item.chapter_id for item in source_refs}

        books = (
            await self.session.execute(select(Book).where(Book.id.in_(book_ids)))
        ).scalars().all()
        chapters = (
            await self.session.execute(select(Chapter).where(Chapter.id.in_(chapter_ids)))
        ).scalars().all()

        books_by_id = {item.id: item for item in books}
        chapters_by_id = {item.id: item for item in chapters}

        return [
            serialize_source_ref(
                item,
                book=books_by_id.get(item.book_id),
                chapter=chapters_by_id.get(item.chapter_id),
            )
            for item in source_refs
        ]
