import argparse
import asyncio
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.book import Book, Chapter, ChapterContent, GraphEdge, GraphNode, SourceRef

FRONTEND_BOOK_ROOT = Path(r"E:\熠朵科技\cultural-relics-museum\mock\BOOK")
KNOWLEDGE_BASE_ID = "kb-cultural-relics"
NODE_PATTERN = re.compile(
    r"\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*,\s*nodeType:\s*'([^']+)'",
    re.S,
)
EDGE_PATTERN = re.compile(
    r"\{\s*id:\s*'([^']+)'\s*,\s*source:\s*'([^']+)'\s*,\s*target:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*,\s*weight:\s*([\d.]+)",
    re.S,
)
HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.M)

AUTO_TERMS = {
    "jingdianchangtan": [
        ("person", "朱自清"),
        ("person", "许慎"),
        ("person", "孔子"),
        ("person", "周公"),
        ("person", "司马迁"),
        ("person", "班固"),
        ("person", "左丘明"),
        ("person", "孟子"),
        ("person", "荀子"),
        ("person", "老子"),
        ("person", "庄子"),
        ("person", "屈原"),
        ("person", "刘向"),
        ("concept", "经典"),
        ("concept", "说文解字"),
        ("concept", "周易"),
        ("concept", "尚书"),
        ("concept", "诗经"),
        ("concept", "三礼"),
        ("concept", "春秋"),
        ("concept", "四书"),
        ("concept", "战国策"),
        ("concept", "史记"),
        ("concept", "汉书"),
        ("concept", "诸子"),
        ("concept", "辞赋"),
    ],
    "laorenyuhai": [
        ("person", "海明威"),
        ("person", "圣地亚哥"),
        ("person", "马诺林"),
        ("person", "老人"),
        ("person", "男孩"),
        ("artifact", "马林鱼"),
        ("other", "鲨鱼"),
        ("site", "大海"),
        ("concept", "孤独"),
        ("concept", "失败"),
        ("concept", "硬汉"),
        ("concept", "狮子"),
        ("concept", "棒球"),
    ],
    "shanquguanggun": [
        ("concept", "山区"),
        ("person", "光棍"),
        ("person", "教士"),
        ("concept", "三人行"),
        ("concept", "圣母"),
        ("person", "教授"),
        ("concept", "电话"),
        ("concept", "低谷"),
        ("person", "旅人"),
        ("concept", "孤独"),
        ("concept", "信仰"),
        ("concept", "死亡"),
        ("concept", "暴力"),
    ],
}


@dataclass
class ChapterText:
    id: str
    book_id: str
    title: str
    order: int
    markdown: str


@dataclass
class NodeDraft:
    id: str
    label: str
    node_type: str
    description: str | None = None
    book_id: str | None = None


@dataclass
class EdgeDraft:
    id: str
    source: str
    target: str
    label: str
    weight: float = 1.0


class SourceMatcher:
    def __init__(self, chapters_by_book: dict[str, list[ChapterText]]) -> None:
        self.chapters_by_book = chapters_by_book
        self.used_positions: set[tuple[str, int]] = set()
        self.fallback_index: dict[str, int] = {}

    def find(self, book_id: str, label: str) -> tuple[ChapterText, str, int, int]:
        chapters = self.chapters_by_book.get(book_id, [])
        if not chapters:
            raise ValueError(f"No chapters for book {book_id}")

        label = label.strip()
        for chapter in chapters:
            for match in re.finditer(re.escape(label), chapter.markdown):
                key = (chapter.id, match.start())
                if key in self.used_positions:
                    continue
                self.used_positions.add(key)
                return self._quote(chapter, match.start(), match.end())

        tokens = [item for item in re.split(r"[\s·、，。：“”《》（）()\-]+", label) if len(item) >= 2]
        for token in tokens:
            for chapter in chapters:
                index = chapter.markdown.find(token)
                if index >= 0 and (chapter.id, index) not in self.used_positions:
                    self.used_positions.add((chapter.id, index))
                    return self._quote(chapter, index, index + len(token))

        fallback = self.fallback_index.get(book_id, 0)
        self.fallback_index[book_id] = fallback + 1
        chapter = chapters[fallback % len(chapters)]
        start = min(len(chapter.markdown), max(0, (fallback // len(chapters)) * 180))
        end = min(len(chapter.markdown), start + 80)
        self.used_positions.add((chapter.id, start))
        return self._quote(chapter, start, end)

    def _quote(self, chapter: ChapterText, start: int, end: int) -> tuple[ChapterText, str, int, int]:
        quote_start = max(0, start - 60)
        quote_end = min(len(chapter.markdown), end + 120)
        quote = re.sub(r"\s+", " ", chapter.markdown[quote_start:quote_end]).strip()
        return chapter, quote, start, end


def stable_id(prefix: str, value: str, max_length: int = 80) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip().lower()).strip("-")
    normalized = normalized or "node"
    raw = f"{prefix}-{normalized}"
    if len(raw) <= max_length:
        return raw
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"{raw[: max_length - 11]}-{digest}"


def normalize_front_id(book_id: str, node_id: str) -> str:
    return book_id if node_id == f"book-{book_id}" else node_id


def make_source_id(node_id: str) -> str:
    digest = hashlib.sha1(node_id.encode("utf-8")).hexdigest()[:12]
    return f"source-{digest}"


def make_summary(markdown: str, max_length: int = 120) -> str:
    text = re.sub(r"^#{1,6}\s+.*$", "", markdown, flags=re.M)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_length]


async def load_book_data(session: AsyncSession) -> tuple[list[Book], dict[str, list[ChapterText]]]:
    books = (await session.execute(select(Book).order_by(Book.id))).scalars().all()
    rows = (
        await session.execute(
            select(Chapter, ChapterContent)
            .join(ChapterContent, ChapterContent.chapter_id == Chapter.id)
            .order_by(Chapter.book_id, Chapter.sort_order)
        )
    ).all()

    chapters_by_book: dict[str, list[ChapterText]] = {}
    for chapter, content in rows:
        chapters_by_book.setdefault(chapter.book_id, []).append(
            ChapterText(
                id=chapter.id,
                book_id=chapter.book_id,
                title=chapter.title,
                order=chapter.sort_order,
                markdown=content.markdown or "",
            )
        )
    return list(books), chapters_by_book


def parse_front_graph(book_id: str, path: Path) -> tuple[list[NodeDraft], list[EdgeDraft]]:
    if not path.exists():
        return [], []

    source = path.read_text(encoding="utf-8")
    nodes = [
        NodeDraft(
            id=normalize_front_id(book_id, match.group(1)),
            label=match.group(2),
            node_type=match.group(3),
            book_id=book_id,
        )
        for match in NODE_PATTERN.finditer(source)
    ]
    edges = [
        EdgeDraft(
            id=stable_id("edge", f"{book_id}-{match.group(1)}"),
            source=normalize_front_id(book_id, match.group(2)),
            target=normalize_front_id(book_id, match.group(3)),
            label=match.group(4),
            weight=float(match.group(5)),
        )
        for match in EDGE_PATTERN.finditer(source)
    ]
    return nodes, edges


def build_graph_drafts(
    books: list[Book],
    chapters_by_book: dict[str, list[ChapterText]],
    frontend_root: Path,
) -> tuple[dict[str, NodeDraft], dict[str, EdgeDraft]]:
    nodes: dict[str, NodeDraft] = {
        KNOWLEDGE_BASE_ID: NodeDraft(
            id=KNOWLEDGE_BASE_ID,
            label="文物知识库",
            node_type="knowledge_base",
            description="书籍、章节、人物与概念关系知识库",
        )
    }
    edges: dict[str, EdgeDraft] = {}

    for book in books:
        nodes[book.id] = NodeDraft(
            id=book.id,
            label=book.title,
            node_type="book",
            description=book.description,
            book_id=book.id,
        )
        edges[f"edge-{KNOWLEDGE_BASE_ID}-{book.id}"] = EdgeDraft(
            id=f"edge-{KNOWLEDGE_BASE_ID}-{book.id}",
            source=KNOWLEDGE_BASE_ID,
            target=book.id,
            label="包含图书",
            weight=1.0,
        )

        for chapter in chapters_by_book.get(book.id, []):
            nodes[chapter.id] = NodeDraft(
                id=chapter.id,
                label=chapter.title,
                node_type="chapter",
                description=make_summary(chapter.markdown),
                book_id=book.id,
            )
            edge_id = f"edge-{book.id}-{chapter.id}"
            edges[edge_id] = EdgeDraft(
                id=edge_id,
                source=book.id,
                target=chapter.id,
                label="包含章节",
                weight=1.0,
            )

        front_nodes, front_edges = parse_front_graph(book.id, frontend_root / "book-graph" / f"{book.id}.ts")
        for node in front_nodes:
            existing = nodes.get(node.id)
            if existing is None or existing.node_type in {"book", "chapter"}:
                nodes[node.id] = node
        for edge in front_edges:
            edges[edge.id] = edge

        for node_type, label in AUTO_TERMS.get(book.id, []):
            node_id = stable_id(f"{book.id}-{node_type}", label)
            nodes[node_id] = NodeDraft(
                id=node_id,
                label=label,
                node_type=node_type,
                book_id=book.id,
            )
            edge_id = stable_id("edge", f"{book.id}-{node_id}")
            edges[edge_id] = EdgeDraft(
                id=edge_id,
                source=book.id,
                target=node_id,
                label="涉及" if node_type == "person" else "核心概念",
                weight=1.1,
            )

    return nodes, edges


async def save_graph(
    session: AsyncSession,
    nodes: dict[str, NodeDraft],
    edges: dict[str, EdgeDraft],
    matcher: SourceMatcher,
) -> None:
    await session.execute(delete(SourceRef))
    await session.execute(delete(GraphEdge))
    await session.execute(delete(GraphNode))

    source_bridge_edges: dict[str, EdgeDraft] = {}

    for node in nodes.values():
        await session.merge(
            GraphNode(
                id=node.id,
                label=node.label,
                node_type=node.node_type,
                description=node.description,
            )
        )

        if node.node_type == "knowledge_base" or not node.book_id:
            continue
        try:
            chapter, quote, start, end = matcher.find(node.book_id, node.label)
        except ValueError:
            continue

        await session.merge(
            SourceRef(
                id=make_source_id(node.id),
                knowledge_base_id=KNOWLEDGE_BASE_ID,
                book_id=node.book_id,
                chapter_id=chapter.id,
                anchor_id=f"{chapter.id}-anchor-001",
                node_id=node.id,
                title=chapter.title,
                quote=quote,
                start_offset=start,
                end_offset=end,
            )
        )

        if node.id != chapter.id and node.node_type not in {"knowledge_base", "book"}:
            edge_id = stable_id("edge-source", f"{chapter.id}-{node.id}")
            source_bridge_edges[edge_id] = EdgeDraft(
                id=edge_id,
                source=chapter.id,
                target=node.id,
                label="原文出处",
                weight=1.0,
            )

    valid_node_ids = set(nodes)
    for edge in source_bridge_edges.values():
        if edge.source not in valid_node_ids or edge.target not in valid_node_ids:
            continue
        await session.merge(
            GraphEdge(
                id=edge.id,
                source=edge.source,
                target=edge.target,
                label=edge.label,
                weight=edge.weight,
            )
        )

    for edge in edges.values():
        if edge.source not in valid_node_ids or edge.target not in valid_node_ids:
            continue
        await session.merge(
            GraphEdge(
                id=edge.id,
                source=edge.source,
                target=edge.target,
                label=edge.label,
                weight=edge.weight,
            )
        )

    await session.commit()


async def generate(frontend_root: Path) -> None:
    async with AsyncSessionLocal() as session:
        books, chapters_by_book = await load_book_data(session)
        nodes, edges = build_graph_drafts(books, chapters_by_book, frontend_root)
        await save_graph(session, nodes, edges, SourceMatcher(chapters_by_book))
        source_count = (await session.execute(select(SourceRef.id))).scalars().all()

    print(f"Generated {len(nodes)} graph nodes, {len(edges)} graph edges, {len(source_count)} source refs.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate detailed book graph data with source refs.")
    parser.add_argument(
        "--frontend-root",
        default=str(FRONTEND_BOOK_ROOT),
        help="Path to frontend mock/BOOK directory",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(generate(Path(args.frontend_root)))


if __name__ == "__main__":
    main()
