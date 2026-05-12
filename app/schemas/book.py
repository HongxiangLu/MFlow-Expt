from pydantic import BaseModel


class Book(BaseModel):
    id: str
    knowledgeBaseId: str
    title: str
    author: str | None = None
    dynasty: str | None = None
    description: str | None = None
    coverUrl: str | None = None
    chapterCount: int
    createdAt: str
    updatedAt: str
