import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base
from app.db.session import AsyncSessionLocal, engine
from app.mock.data import (
    BOOKS,
    CHAPTERS,
    CHAPTER_CONTENTS,
    DEFAULT_SOURCE_REF,
    GRAPH_EDGES,
    GRAPH_NODES,
)
from app.models.book import (
    Book,
    Chapter,
    ChapterContent,
    GraphEdge,
    GraphNode,
    SourceRef,
)


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_books(session: AsyncSession) -> None:
    for item in BOOKS:
        await session.merge(
            Book(
                id=item["id"],
                knowledge_base_id=item["knowledgeBaseId"],
                title=item["title"],
                author=item.get("author"),
                dynasty=item.get("dynasty"),
                description=item.get("description"),
                cover_url=item.get("coverUrl"),
                chapter_count=item.get("chapterCount", 0),
                created_at=item["createdAt"],
                updated_at=item["updatedAt"],
            )
        )

    for item in CHAPTERS:
        await session.merge(
            Chapter(
                id=item["id"],
                book_id=item["bookId"],
                parent_id=item.get("parentId"),
                title=item["title"],
                sort_order=item["order"],
                level=item["level"],
                summary=item.get("summary"),
                markdown_path=item.get("markdownPath"),
                created_at=item["createdAt"],
                updated_at=item["updatedAt"],
            )
        )

    for item in CHAPTER_CONTENTS.values():
        await session.merge(
            ChapterContent(
                chapter_id=item["chapterId"],
                book_id=item["bookId"],
                title=item["title"],
                markdown=item["markdown"],
                anchors=item.get("anchors", []),
                entities=item.get("entities", []),
            )
        )


async def seed_graph(session: AsyncSession) -> None:
    for item in GRAPH_NODES:
        await session.merge(
            GraphNode(
                id=item["id"],
                label=item["label"],
                node_type=item["nodeType"],
                description=item.get("description"),
            )
        )

    for item in GRAPH_EDGES:
        await session.merge(
            GraphEdge(
                id=item["id"],
                source=item["source"],
                target=item["target"],
                label=item["label"],
                weight=item.get("weight"),
            )
        )


async def seed_source_refs(session: AsyncSession) -> None:
    item = DEFAULT_SOURCE_REF
    await session.merge(
        SourceRef(
            id=item["id"],
            knowledge_base_id=item["knowledgeBaseId"],
            book_id=item["bookId"],
            chapter_id=item["chapterId"],
            anchor_id=item.get("anchorId"),
            node_id="artifact-simuwu-ding",
            title=item["title"],
            quote=item.get("quote"),
            start_offset=item.get("startOffset"),
            end_offset=item.get("endOffset"),
        )
    )


async def init_db() -> None:
    await create_tables()
    async with AsyncSessionLocal() as session:
        await seed_books(session)
        await seed_graph(session)
        await seed_source_refs(session)
        await session.commit()


def main() -> None:
    asyncio.run(init_db())


if __name__ == "__main__":
    main()
