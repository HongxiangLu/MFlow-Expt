import re
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import get_settings
from app.schemas.chat import ChatRequest

MAX_CHAPTER_CONTEXT_CHARS = 12000
MAX_BOOK_CONTEXT_CHARS = 60000
THINK_START = "<think>"
THINK_END = "</think>"


def longest_suffix_prefix(value: str, marker: str) -> int:
    max_length = min(len(value), len(marker) - 1)
    for length in range(max_length, 0, -1):
        if marker.startswith(value[-length:]):
            return length
    return 0


class MiniMaxService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _client(self) -> AsyncOpenAI:
        if not self.settings.minimax_api_key:
            raise RuntimeError("MINIMAX_API_KEY is not set.")

        return AsyncOpenAI(
            base_url=self.settings.minimax_base_url,
            api_key=self.settings.minimax_api_key,
        )

    def _book_messages(
        self,
        request: ChatRequest,
        context_markdown: str,
        source_refs: list[dict],
    ) -> list[dict[str, str]]:
        selected_text = request.selectedText.text if request.selectedText else ""
        scope_label = "用户选中的原文片段" if request.selectedText else (
            "整本书" if request.scope == "book" else "当前章节"
        )
        context_limit = (
            MAX_BOOK_CONTEXT_CHARS if request.scope == "book" and not request.selectedText
            else MAX_CHAPTER_CONTEXT_CHARS
        )
        context = context_markdown[:context_limit]
        truncated_note = (
            f"\n注意：原文上下文超过 {context_limit} 字，已截取前 {context_limit} 字。"
            if len(context_markdown) > context_limit
            else ""
        )

        return [
            {
                "role": "system",
                "content": (
                    "你是一个书籍阅读助手。请只根据用户提供的原文上下文回答。"
                    "如果上下文不足，请明确说明。回答要简洁、准确，并尽量指出依据。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"对话范围：{scope_label}\n"
                    f"书籍ID：{request.bookId or ''}\n"
                    f"章节ID：{request.chapterId or ''}\n"
                    f"用户选中文本：{selected_text}\n\n"
                    f"原文上下文：\n{context}{truncated_note}\n\n"
                    f"可用引用：{source_refs}\n\n"
                    f"问题：{request.question}"
                ),
            },
        ]

    def _dashboard_messages(self, query: str) -> list[dict[str, str]]:
        artifact_context = (
            "当前 dashboard 展示对象为《杜工部草堂诗笺》，中国古代典籍，宋代刻本。"
            "页面说明中提到：该书为杜诗学研究的重要典籍，由鲁訔编定、蔡梦弼会笺，"
            "四十卷，系统整理“千家注杜”的宋代学术成果，并在版本史、注释、编排方式上具有价值。"
        )

        return [
            {
                "role": "system",
                "content": (
                    "你是博物馆 AI 讲解员。请围绕当前文物、典籍、历史背景、工艺和文化价值回答。"
                    "回答使用中文，结构清晰，适合展厅导览场景。"
                ),
            },
            {
                "role": "user",
                "content": f"展品上下文：{artifact_context}\n\n用户问题：{query}",
            },
        ]

    async def generate_answer(
        self,
        request: ChatRequest,
        context_markdown: str,
        source_refs: list[dict],
    ) -> str:
        response = await self._client().chat.completions.create(
            model=self.settings.minimax_model,
            messages=self._book_messages(request, context_markdown, source_refs),
            temperature=0.3,
        )

        content = response.choices[0].message.content or ""
        return re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()

    async def stream_dashboard_answer(self, query: str) -> AsyncGenerator[str, None]:
        async for chunk in self._stream_messages(self._dashboard_messages(query)):
            yield chunk

    async def stream_book_answer(
        self,
        request: ChatRequest,
        context_markdown: str,
        source_refs: list[dict],
    ) -> AsyncGenerator[str, None]:
        async for chunk in self._stream_messages(
            self._book_messages(request, context_markdown, source_refs)
        ):
            yield chunk

    async def _stream_messages(
        self,
        messages: list[dict[str, str]],
    ) -> AsyncGenerator[str, None]:
        stream = await self._client().chat.completions.create(
            model=self.settings.minimax_model,
            messages=messages,
            temperature=0.3,
            stream=True,
        )

        in_think = False
        pending = ""

        async for event in stream:
            delta = event.choices[0].delta
            content = delta.content or ""
            if content:
                pending += content

            while pending:
                if in_think:
                    end_index = pending.find(THINK_END)
                    if end_index == -1:
                        keep = longest_suffix_prefix(pending, THINK_END)
                        pending = pending[-keep:] if keep else ""
                        break

                    pending = pending[end_index + len(THINK_END):]
                    in_think = False
                    continue

                start_index = pending.find(THINK_START)
                if start_index == -1:
                    keep = longest_suffix_prefix(pending, THINK_START)
                    emit = pending[:-keep] if keep else pending
                    pending = pending[-keep:] if keep else ""
                    if emit:
                        yield emit
                    break

                emit = pending[:start_index]
                pending = pending[start_index + len(THINK_START):]
                in_think = True
                if emit:
                    yield emit

        if pending and not in_think and THINK_START not in pending:
            yield pending
