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

BOOK_PATTERN = re.compile(
    r"\{\s*id:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*,\s*chapters:\s*\[(.*?)\]\s*,?\s*\}",
    re.S,
)
CHAPTER_PATTERN = re.compile(r"\{\s*id:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*\}")
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
AUTO_TITLE_OVERRIDES = {
    "jingdianchangtan": "经典常谈",
    "laorenyuhai": "老人与海",
    "shanquguanggun": "山区光棍",
}


@dataclass
class ChapterMeta:
    id: str
    title: str


@dataclass
class BookMeta:
    id: str
    title: str
    chapters: list[ChapterMeta]


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def normalize_title(value: str) -> str:
    return re.sub(r"\s+", "", value).strip().lower()


def slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip().lower())
    slug = slug.strip("-")
    return slug or fallback


def heading_matches(chapter_title: str, heading_title: str, *, fuzzy: bool) -> bool:
    target = normalize_title(chapter_title)
    candidate = normalize_title(heading_title)
    if target == candidate:
        return True
    if not fuzzy:
        return False
    if len(candidate) < 2:
        return False
    return target.endswith(candidate) or candidate.endswith(target)


def make_summary(markdown: str, max_length: int = 120) -> str:
    text = re.sub(r"```.*?```", "", markdown, flags=re.S)
    text = re.sub(r"^#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_length]


def parse_book_title(path: Path) -> list[BookMeta]:
    source = read_text(path)
    books = []
    for book_match in BOOK_PATTERN.finditer(source):
        chapters = [
            ChapterMeta(id=item.group(1), title=item.group(2))
            for item in CHAPTER_PATTERN.finditer(book_match.group(3))
        ]
        books.append(
            BookMeta(
                id=book_match.group(1),
                title=book_match.group(2),
                chapters=chapters,
            )
        )
    return books


def make_book_meta_from_markdown(path: Path) -> BookMeta:
    book_id = path.stem
    markdown = read_text(path)
    headings = [match.group(2).strip() for match in HEADING_PATTERN.finditer(markdown)]
    title = AUTO_TITLE_OVERRIDES.get(book_id, headings[0] if headings else path.stem)

    chapters = []
    for index, heading in enumerate(headings, start=1):
        chapter_id = f"{book_id}-chapter-{index:03d}"
        chapters.append(ChapterMeta(id=chapter_id, title=heading))

    if not chapters:
        chapters.append(ChapterMeta(id=f"{book_id}-chapter-001", title=title))

    return BookMeta(id=book_id, title=title, chapters=chapters)


def split_markdown_by_chapters(markdown: str, chapters: list[ChapterMeta]) -> list[tuple[ChapterMeta, str]]:
    headings = list(HEADING_PATTERN.finditer(markdown))
    if not headings:
        return [(chapters[0], markdown.strip())] if chapters else []

    ranges: list[tuple[ChapterMeta, int, int]] = []
    search_from = 0

    for chapter in chapters:
        found_index = None
        for fuzzy in (False, True):
            for index in range(search_from, len(headings)):
                if heading_matches(chapter.title, headings[index].group(2), fuzzy=fuzzy):
                    found_index = index
                    break
            if found_index is not None:
                break
        if found_index is None:
            continue

        start = headings[found_index].start()
        ranges.append((chapter, found_index, start))
        search_from = found_index + 1

    if not ranges and chapters:
        return [(chapters[0], markdown.strip())]

    chunks_by_chapter_id = {}
    for index, (chapter, heading_index, start) in enumerate(ranges):
        if index + 1 < len(ranges):
            end = ranges[index + 1][2]
        elif heading_index + 1 < len(headings):
            end = len(markdown)
        else:
            end = len(markdown)
        chunks_by_chapter_id[chapter.id] = markdown[start:end].strip()

    return [
        (chapter, chunks_by_chapter_id.get(chapter.id, f"# {chapter.title}").strip())
        for chapter in chapters
    ]


def make_anchors(chapter_id: str, markdown: str) -> list[dict]:
    anchors = []
    for index, match in enumerate(HEADING_PATTERN.finditer(markdown), start=1):
        title = match.group(2).strip()
        anchors.append(
            {
                "id": f"{chapter_id}-anchor-{index:03d}",
                "chapterId": chapter_id,
                "title": title,
                "startOffset": match.start(),
                "endOffset": match.end(),
                "markdownHeading": title,
            }
        )
    return anchors


async def clear_existing_books(session: AsyncSession, book_ids: list[str]) -> None:
    chapter_ids = (
        await session.execute(select(Chapter.id).where(Chapter.book_id.in_(book_ids)))
    ).scalars().all()
    node_ids = [*book_ids, *chapter_ids]

    await session.execute(delete(SourceRef).where(SourceRef.book_id.in_(book_ids)))
    await session.execute(delete(ChapterContent).where(ChapterContent.book_id.in_(book_ids)))
    await session.execute(delete(Chapter).where(Chapter.book_id.in_(book_ids)))
    await session.execute(delete(Book).where(Book.id.in_(book_ids)))

    if node_ids:
        await session.execute(
            delete(GraphEdge).where(
                or_(GraphEdge.source.in_(node_ids), GraphEdge.target.in_(node_ids))
            )
        )
        await session.execute(delete(GraphNode).where(GraphNode.id.in_(node_ids)))


async def clear_all_book_data(session: AsyncSession) -> None:
    await session.execute(delete(SourceRef))
    await session.execute(delete(ChapterContent))
    await session.execute(delete(Chapter))
    await session.execute(delete(Book))
    await session.execute(delete(GraphEdge))
    await session.execute(delete(GraphNode))


async def import_book(
    session: AsyncSession,
    book: BookMeta,
    markdown_path: Path,
    knowledge_base_id: str,
    timestamp: str,
) -> int:
    markdown = read_text(markdown_path)
    chunks = split_markdown_by_chapters(markdown, book.chapters)

    await session.merge(
        Book(
            id=book.id,
            knowledge_base_id=knowledge_base_id,
            title=book.title,
            author=None,
            dynasty=None,
            description=make_summary(markdown),
            cover_url=None,
            chapter_count=len(chunks),
            created_at=timestamp,
            updated_at=timestamp,
        )
    )
    await session.merge(
        GraphNode(
            id=book.id,
            label=book.title,
            node_type="book",
            description=make_summary(markdown),
        )
    )
    await session.merge(
        GraphEdge(
            id=f"edge-{knowledge_base_id}-{book.id}",
            source=knowledge_base_id,
            target=book.id,
            label="包含图书",
            weight=1,
        )
    )

    for order, (chapter, chapter_markdown) in enumerate(chunks, start=1):
        anchors = make_anchors(chapter.id, chapter_markdown)
        quote = make_summary(chapter_markdown, max_length=160)

        await session.merge(
            Chapter(
                id=chapter.id,
                book_id=book.id,
                parent_id=None,
                title=chapter.title,
                sort_order=order,
                level=1,
                summary=quote,
                markdown_path=str(markdown_path),
                created_at=timestamp,
                updated_at=timestamp,
            )
        )
        await session.merge(
            ChapterContent(
                chapter_id=chapter.id,
                book_id=book.id,
                title=chapter.title,
                markdown=chapter_markdown,
                anchors=anchors,
                entities=[],
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
                id=f"edge-{book.id}-{chapter.id}",
                source=book.id,
                target=chapter.id,
                label="包含章节",
                weight=1,
            )
        )
        await session.merge(
            SourceRef(
                id=f"source-{chapter.id}",
                knowledge_base_id=knowledge_base_id,
                book_id=book.id,
                chapter_id=chapter.id,
                anchor_id=anchors[0]["id"] if anchors else None,
                node_id=chapter.id,
                title=chapter.title,
                quote=quote,
                start_offset=0,
                end_offset=min(len(chapter_markdown), len(quote)),
            )
        )

    return len(chunks)


async def import_book_mock(root: Path, reset: bool, knowledge_base_id: str) -> None:
    title_path = root / "book-title.ts"
    text_root = root / "book-text"
    books = parse_book_title(title_path)
    known_book_ids = {book.id for book in books}
    for markdown_path in sorted(text_root.glob("*.md")):
        if markdown_path.stem not in known_book_ids:
            books.append(make_book_meta_from_markdown(markdown_path))

    timestamp = now_iso()

    await create_tables()
    async with AsyncSessionLocal() as session:
        if reset:
            await clear_all_book_data(session)
        else:
            await clear_existing_books(session, [book.id for book in books])

        await session.merge(
            GraphNode(
                id=knowledge_base_id,
                label="文物知识库",
                node_type="knowledge_base",
                description="文物主题知识库",
            )
        )

        imported = []
        for book in books:
            markdown_path = text_root / f"{book.id}.md"
            if not markdown_path.exists():
                print(f"Skipped {book.id}: missing {markdown_path}")
                continue
            chapter_count = await import_book(
                session=session,
                book=book,
                markdown_path=markdown_path,
                knowledge_base_id=knowledge_base_id,
                timestamp=timestamp,
            )
            imported.append((book.id, book.title, chapter_count))

        await session.commit()

    for book_id, title, chapter_count in imported:
        print(f"Imported {book_id}: {title} ({chapter_count} chapters)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import frontend mock BOOK data into SQLite.")
    parser.add_argument(
        "--root",
        default=r"E:\熠朵科技\cultural-relics-museum\mock\BOOK",
        help="Path to frontend mock/BOOK directory",
    )
    parser.add_argument(
        "--knowledge-base-id",
        default="kb-cultural-relics",
        help="Knowledge base ID",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear existing book and graph data before importing",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(
        import_book_mock(
            root=Path(args.root),
            reset=args.reset,
            knowledge_base_id=args.knowledge_base_id,
        )
    )


if __name__ == "__main__":
    main()
