from pydantic import BaseModel

from app.schemas.common import SourceRef


class SelectedTextRef(BaseModel):
    chapterId: str
    text: str
    startOffset: int | None = None
    endOffset: int | None = None


class ChatRequest(BaseModel):
    sessionId: str
    knowledgeBaseId: str
    bookId: str | None = None
    chapterId: str | None = None
    question: str
    selectedText: SelectedTextRef | None = None


class ChatMessage(BaseModel):
    id: str
    role: str
    content: str
    sourceRefs: list[SourceRef] | None = None
    createdAt: str


class ChatResponse(BaseModel):
    answer: str
    sourceRefs: list[SourceRef]
    relatedNodeIds: list[str]
