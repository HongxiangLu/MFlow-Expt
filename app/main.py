from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import book, dialogue

app = FastAPI(title="cultural-relics-museum-backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(book.router)
app.include_router(dialogue.router)
