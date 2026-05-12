from pydantic import BaseModel, Field


class DashboardChatRequest(BaseModel):
    query: str
    session_id: str = Field(alias="session_id")
