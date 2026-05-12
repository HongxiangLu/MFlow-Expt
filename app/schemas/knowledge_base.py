from pydantic import BaseModel


class KnowledgeBase(BaseModel):
    id: str
    name: str
    description: str | None = None
    coverUrl: str | None = None
    bookCount: int
    createdAt: str
    updatedAt: str
