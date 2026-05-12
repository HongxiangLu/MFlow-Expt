from pydantic import BaseModel


class SourceRef(BaseModel):
    id: str
    knowledgeBaseId: str
    bookId: str
    chapterId: str
    anchorId: str | None = None
    title: str
    quote: str | None = None
    startOffset: int | None = None
    endOffset: int | None = None
