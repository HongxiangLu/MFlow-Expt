from pydantic import BaseModel


class Chapter(BaseModel):
    id: str
    bookId: str
    parentId: str | None = None
    title: str
    order: int
    level: int
    summary: str | None = None
    markdownPath: str | None = None
    createdAt: str
    updatedAt: str


class ChapterTreeNode(Chapter):
    children: list["ChapterTreeNode"] = []


class ContentAnchor(BaseModel):
    id: str
    chapterId: str
    title: str | None = None
    startOffset: int | None = None
    endOffset: int | None = None
    markdownHeading: str | None = None


class EntityMention(BaseModel):
    id: str
    entityId: str
    label: str
    nodeType: str
    chapterId: str
    anchorId: str | None = None
    startOffset: int | None = None
    endOffset: int | None = None


class ChapterContent(BaseModel):
    chapterId: str
    bookId: str
    title: str
    markdown: str
    anchors: list[ContentAnchor]
    entities: list[EntityMention]
