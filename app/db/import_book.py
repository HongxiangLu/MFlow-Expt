import argparse
import asyncio
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.init_db import create_tables
from app.db.session import AsyncSessionLocal
from app.models.book import (
    Book,
    Chapter,
    ChapterContent,
    GraphEdge,
    GraphNode,
    SourceRef,
)

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
WIKILINK_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")
GRAPH_LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(graph://([^)]+)\)")


@dataclass
class ParsedChapter:
    id: str
    title: str
    level: int
    order: int
    markdown: str
    parent_id: str | None


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip().lower())
    slug = slug.strip("-")
    return slug or fallback


def read_markdown(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def parse_markdown(markdown: str, book_id: str) -> list[ParsedChapter]:
    matches = list(HEADING_PATTERN.finditer(markdown))
    if not matches:
        return [
            ParsedChapter(
                id=f"{book_id}-chapter-001",
                title="全文",
                level=1,
                order=1,
                markdown=markdown.strip(),
                parent_id=None,
            )
        ]

    chapters: list[ParsedChapter] = []
    latest_by_level: dict[int, str] = {}

    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        level = len(match.group(1))
        title = match.group(2).strip()
        order = index + 1
        chapter_id = f"{book_id}-chapter-{order:03d}"

        parent_id = None
        for parent_level in range(level - 1, 0, -1):
            if parent_level in latest_by_level:
                parent_id = latest_by_level[parent_level]
                break

        latest_by_level[level] = chapter_id
        for child_level in range(level + 1, 7):
            latest_by_level.pop(child_level, None)

        chapters.append(
            ParsedChapter(
                id=chapter_id,
                title=title,
                level=level,
                order=order,
                markdown=markdown[start:end].strip(),
                parent_id=parent_id,
            )
        )

    return chapters


def make_summary(markdown: str, max_length: int = 120) -> str:
    text = re.sub(r"```.*?```", "", markdown, flags=re.S)
    text = re.sub(r"^#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_length]


def make_anchors(chapter: ParsedChapter) -> list[dict]:
    anchors = []
    for index, match in enumerate(HEADING_PATTERN.finditer(chapter.markdown), start=1):
        title = match.group(2).strip()
        anchors.append(
            {
                "id": f"{chapter.id}-anchor-{index:03d}",
                "chapterId": chapter.id,
                "title": title,
                "startOffset": match.start(),
                "endOffset": match.end(),
                "markdownHeading": title,
            }
        )
    return anchors


def make_entities(chapter: ParsedChapter) -> list[dict]:
    entities = []
    seen: set[tuple[str, str]] = set()

    for pattern, node_type in (
        (WIKILINK_PATTERN, "concept"),
        (GRAPH_LINK_PATTERN, "other"),
    ):
        for match in pattern.finditer(chapter.markdown):
            label = match.group(1).strip()
            entity_id = (
                match.group(2).strip()
                if pattern is GRAPH_LINK_PATTERN
                else f"concept-{slugify(label, 'entity')}"
            )
            key = (chapter.id, entity_id)
            if key in seen:
                continue
            seen.add(key)
            entities.append(
                {
                    "id": f"mention-{chapter.id}-{len(entities) + 1:03d}",
                    "entityId": entity_id,
                    "label": label,
                    "nodeType": node_type,
                    "chapterId": chapter.id,
                    "anchorId": None,
                    "startOffset": match.start(),
                    "endOffset": match.end(),
                }
            )

    return entities


async def delete_existing_book(session: AsyncSession, book_id: str) -> None:
    chapter_ids = (
        await session.execute(select(Chapter.id).where(Chapter.book_id == book_id))
    ).scalars().all()

    await session.execute(delete(SourceRef).where(SourceRef.book_id == book_id))
    await session.execute(delete(ChapterContent).where(ChapterContent.book_id == book_id))
    await session.execute(delete(Chapter).where(Chapter.book_id == book_id))
    await session.execute(delete(Book).where(Book.id == book_id))

    node_ids = [book_id, *chapter_ids]
    if node_ids:
        await session.execute(
            delete(GraphEdge).where(
                or_(GraphEdge.source.in_(node_ids), GraphEdge.target.in_(node_ids))
            )
        )
        await session.execute(delete(GraphNode).where(GraphNode.id.in_(node_ids)))


async def import_markdown_book(
    path: Path,
    book_id: str,
    title: str,
    knowledge_base_id: str,
    author: str | None,
    description: str | None,
) -> None:
    markdown = read_markdown(path)
    chapters = parse_markdown(markdown, book_id)
    timestamp = now_iso()

    await create_tables()
    async with AsyncSessionLocal() as session:
        await delete_existing_book(session, book_id)

        await session.merge(
            Book(
                id=book_id,
                knowledge_base_id=knowledge_base_id,
                title=title,
                author=author,
                dynasty=None,
                description=description or make_summary(markdown),
                cover_url=None,
                chapter_count=len(chapters),
                created_at=timestamp,
                updated_at=timestamp,
            )
        )
        await session.merge(
            GraphNode(
                id=knowledge_base_id,
                label="文物知识库",
                node_type="knowledge_base",
                description="文物主题知识库",
            )
        )
        await session.merge(
            GraphNode(
                id=book_id,
                label=title,
                node_type="book",
                description=description or make_summary(markdown),
            )
        )
        await session.merge(
            GraphEdge(
                id=f"edge-{knowledge_base_id}-{book_id}",
                source=knowledge_base_id,
                target=book_id,
                label="包含图书",
                weight=1,
            )
        )

        for chapter in chapters:
            anchors = make_anchors(chapter)
            entities = make_entities(chapter)
            quote = make_summary(chapter.markdown, max_length=160)

            await session.merge(
                Chapter(
                    id=chapter.id,
                    book_id=book_id,
                    parent_id=chapter.parent_id,
                    title=chapter.title,
                    sort_order=chapter.order,
                    level=chapter.level,
                    summary=quote,
                    markdown_path=str(path),
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
            await session.merge(
                ChapterContent(
                    chapter_id=chapter.id,
                    book_id=book_id,
                    title=chapter.title,
                    markdown=chapter.markdown,
                    anchors=anchors,
                    entities=entities,
                )
            )
            await session.merge(
                GraphNode(
                    id=chapter.id,
                    label=chapter.title,
                    node_type="chapter",
                    description=quote,
                )
            )
            await session.merge(
                GraphEdge(
                    id=f"edge-{book_id}-{chapter.id}",
                    source=book_id,
                    target=chapter.id,
                    label="包含章节",
                    weight=1,
                )
            )
            await session.merge(
                SourceRef(
                    id=f"source-{chapter.id}",
                    knowledge_base_id=knowledge_base_id,
                    book_id=book_id,
                    chapter_id=chapter.id,
                    anchor_id=anchors[0]["id"] if anchors else None,
                    node_id=chapter.id,
                    title=chapter.title,
                    quote=quote,
                    start_offset=0,
                    end_offset=min(len(chapter.markdown), len(quote)),
                )
            )

        await session.commit()

    print(f"Imported {len(chapters)} chapters from {path} into book {book_id}.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import a Markdown book into SQLite.")
    parser.add_argument("path", help="Markdown file path")
    parser.add_argument("--book-id", default=None, help="Stable book ID")
    parser.add_argument("--title", default=None, help="Book title")
    parser.add_argument(
        "--knowledge-base-id",
        default="kb-cultural-relics",
        help="Knowledge base ID",
    )
    parser.add_argument("--author", default=None, help="Book author")
    parser.add_argument("--description", default=None, help="Book description")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    path = Path(args.path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(path)

    markdown = read_markdown(path)
    first_heading = HEADING_PATTERN.search(markdown)
    title = args.title or (first_heading.group(2).strip() if first_heading else path.stem)
    book_id = args.book_id or f"book-{slugify(path.stem, 'markdown')}"

    asyncio.run(
        import_markdown_book(
            path=path,
            book_id=book_id,
            title=title,
            knowledge_base_id=args.knowledge_base_id,
            author=args.author,
            description=args.description,
        )
    )


if __name__ == "__main__":
    main()
