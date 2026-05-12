from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.schemas.common import SourceRef

ChatScope = Literal["chapter", "book"]


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
    scope: ChatScope = Field(
        default="chapter",
        validation_alias=AliasChoices("scope", "chatScope", "contextScope"),
    )
    question: str
    selectedText: SelectedTextRef | None = None

    @field_validator("scope", mode="before")
    @classmethod
    def normalize_scope(cls, value: str | None) -> str:
        if value is None:
            return "chapter"

        normalized = str(value).strip()
        scope_aliases = {
            "current": "chapter",
            "currentChapter": "chapter",
            "current_chapter": "chapter",
            "chapter": "chapter",
            "章节": "chapter",
            "当前章节": "chapter",
            "book": "book",
            "wholeBook": "book",
            "whole_book": "book",
            "entireBook": "book",
            "entire_book": "book",
            "整本书": "book",
            "全书": "book",
        }
        return scope_aliases.get(normalized, normalized)


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
