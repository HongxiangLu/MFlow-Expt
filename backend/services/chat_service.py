"""
对话服务模块 (Chat Service)

该模块实现了 RAG 对话的核心编排逻辑，是整个系统中最复杂的业务链路。
完整流程为：历史查询 → M-Flow 检索 → Prompt 组装 → LLM 流式生成 → SSE 推送 → 消息落盘。

此模块不包含任何 HTTP 协议细节，仅作为纯业务逻辑层存在。
路由层 (api/chat.py) 负责将本模块的异步生成器包装为 EventSourceResponse。
"""

import logging
import re

import openai
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.llm import llm_client
from core.utils import preview_text
from db.models import ChatSession, Message
from schemas.payloads import ChatChunk, SSEError
from services import mflow_client

logger = logging.getLogger(__name__)

# =============================================================================
# System Prompt 模板
# =============================================================================
# 设计原则：
# 1. 固定的角色设定前缀，最大化 LLM 的 KV Cache 命中率（前缀相同时可复用缓存）
# 2. 检索到的上下文作为变量注入，置于 System Prompt 末尾
# 3. 明确约束模型行为：基于检索内容回答、标注推断部分

SYSTEM_PROMPT_TEMPLATE = (
    "你是一位博物馆文物专家，擅长解答关于历史文物、古代工艺、文化遗产等领域的问题。\n"
    "请基于以下检索到的知识内容回答用户的问题。回答时应准确、专业，并以通俗易懂的方式表达。\n"
    "如果检索内容中没有直接相关的信息，请基于已有内容进行合理推断，但需注明推断部分。\n"
    "\n"
    "【检索到的知识内容】\n"
    "{context}"
)

# 检索空结果时的降级提示信息（取自 API.md §1.5.3）
FALLBACK_MESSAGE = "抱歉，未能检索到与您提问相关的知识内容。请尝试换一种方式提问，或提供更具体的关键词。"

async def stream_chat(query: str, session_id: str, db: AsyncSession):
    """
    对话全链路异步生成器。

    逐步 yield SSE 数据帧（dict 格式），供路由层的 EventSourceResponse 消费。
    yield 的 dict 包含两个键：
    - "event": 事件类型，"message" 表示正常数据帧，"error" 表示错误事件帧
    - "data": JSON 字符串，分别对应 ChatChunk 或 SSEError 的序列化结果

    Args:
        query: 用户当前输入的文本问题。
        session_id: 当前会话的唯一标识（前端生成的 UUID）。
        db: 异步数据库会话，由路由层通过依赖注入提供。

    Yields:
        dict: 包含 "event" 和 "data" 键的字典，符合 sse-starlette 的消费格式。
    """
    logger.info("对话流开始: session_id=%s, query=%s", session_id, query)

    # =================================================================
    # Step 1: 获取/创建 Session + 查询历史消息
    # =================================================================
    session = await db.get(ChatSession, session_id)
    if not session:
        session = ChatSession(id=session_id)
        db.add(session)
        await db.commit()
        logger.info("已创建新会话: session_id=%s", session_id)
    else:
        logger.info("复用已有会话: session_id=%s", session_id)

    # 查询该 session 下所有历史消息，按创建时间升序排列
    # 不设轮数与 Token 上限（遵循 REQUIREMENTS.md §2 接口A 的设计决策）
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc())
    )
    history_messages = result.scalars().all()
    logger.info("历史消息查询完成: session_id=%s, history_count=%d", session_id, len(history_messages))
    if history_messages:
        logger.info(
            "历史消息预览: last_role=%s, last_len=%d, last_preview=%s",
            history_messages[-1].role,
            len(history_messages[-1].content or ""),
            preview_text(history_messages[-1].content or ""),
        )

    # =================================================================
    # Step 2: RAG 知识检索
    # =================================================================
    try:
        context_list = await mflow_client.get_context(query)
        logger.info("M-Flow context 获取成功: session_id=%s, context_count=%d", session_id, len(context_list))
        if context_list:
            logger.info(
                "M-Flow context 预览: first_len=%d, first_preview=%s",
                len(context_list[0]),
                preview_text(context_list[0]),
            )
    except Exception as e:
        logger.error("M-Flow 检索异常: %s", e, exc_info=True)
        error_payload = SSEError(
            code="retrieval_error",
            message="知识检索服务异常，请稍后重试"
        ).model_dump_json()
        logger.info("发送 SSE 错误帧: event=error, data=%s", error_payload)
        yield {
            "event": "error",
            "data": error_payload,
        }
        return

    # =================================================================
    # Step 3: 空结果降级
    # =================================================================
    # 若上下文为空，不调用 LLM，直接推送降级提示信息
    # 通过正常的 data 帧发送（finish_reason="stop"），前端无需额外解析逻辑
    if not context_list:
        fallback_payload = ChatChunk(
            chunk=FALLBACK_MESSAGE,
            finish_reason="stop"
        ).model_dump_json()
        logger.info("检索为空，发送降级帧: event=message, data=%s", fallback_payload)
        yield {
            "event": "message",
            "data": fallback_payload,
        }
        return

    # =================================================================
    # Step 4: Prompt 组装
    # =================================================================
    # 将检索到的多个知识片段用换行符连接
    context_text = "\n".join(context_list)

    # 组装 messages 列表：System Prompt → 历史消息 → 当前用户提问
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_TEMPLATE.format(context=context_text)}
    ]

    # 追加历史消息（直接从 DB 读取的 role/content 对）
    for msg in history_messages:
        messages.append({"role": msg.role, "content": msg.content})

    # 追加当前用户提问
    messages.append({"role": "user", "content": query})
    logger.info("即将请求 MiniMax（stream=True）: model=%s", settings.MINIMAX_MODEL)
    logger.info(
        "MiniMax 请求摘要: message_count=%d, last_role=%s, last_len=%d, last_preview=%s",
        len(messages),
        messages[-1]["role"],
        len(messages[-1]["content"]),
        preview_text(messages[-1]["content"]),
    )

    # =================================================================
    # Step 5: LLM 流式调用 + SSE 推送
    # =================================================================
    full_answer = ""  # 在内存中拼接完整回答，用于后续持久化
    _in_think = False  # 状态标记：是否正处于 <think> 标签内部

    try:
        stream = await llm_client.chat.completions.create(
            model=settings.MINIMAX_MODEL,
            messages=messages,
            stream=True,
        )
        logger.info("MiniMax 流式连接建立成功: session_id=%s", session_id)

        async for chunk in stream:
            # 提取增量文本内容
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                text = delta.content
                logger.info("收到 MiniMax 原始增量: char_count=%d, preview=%s", len(text), text[:80])

                # 过滤 MiniMax 模型的 <think>...</think> 思维链输出
                # 思维链可能跨多个 chunk，需要用状态标记追踪
                if "<think>" in text:
                    _in_think = True
                    logger.info("检测到 <think> 起始标签，进入过滤模式")
                if _in_think:
                    if "</think>" in text:
                        _in_think = False
                        # 提取 </think> 之后的有效内容
                        text = text.split("</think>", 1)[1]
                        logger.info(
                            "检测到 </think> 结束标签，恢复输出模式。标签后长度=%d，预览=%s",
                            len(text),
                            preview_text(text),
                        )
                    else:
                        logger.info("当前增量位于 <think> 区间内，跳过输出")
                        continue  # 仍在 think 标签内，跳过此 chunk

                if text:  # 过滤后仍有有效内容
                    # 为实现“打字机”效果，将有效增量按单字符拆分后逐帧推送。
                    # 日志在增量级别记录一次，避免逐字日志导致噪声过大。
                    logger.info("发送 SSE 单字流帧: frame_count=%d", len(text))
                    for ch in text:
                        full_answer += ch
                        message_payload = ChatChunk(
                            chunk=ch,
                            finish_reason=None
                        ).model_dump_json()
                        yield {
                            "event": "message",
                            "data": message_payload,
                        }

        # 流结束：发送终止帧
        stop_payload = ChatChunk(
            chunk="",
            finish_reason="stop"
        ).model_dump_json()
        logger.info("发送 SSE 结束帧: event=message, data=%s", stop_payload)
        yield {
            "event": "message",
            "data": stop_payload,
        }
        logger.info("MiniMax 流式输出结束: session_id=%s, answer_length=%d", session_id, len(full_answer))

    except openai.APITimeoutError:
        logger.error("LLM 调用超时")
        timeout_payload = SSEError(
            code="llm_timeout",
            message="大模型响应超时，请稍后重试"
        ).model_dump_json()
        logger.info("发送 SSE 错误帧: event=error, data=%s", timeout_payload)
        yield {
            "event": "error",
            "data": timeout_payload,
        }
        return

    except openai.RateLimitError:
        logger.error("LLM 调用限流")
        rate_limit_payload = SSEError(
            code="llm_rate_limit",
            message="大模型调用频率受限，请稍后重试"
        ).model_dump_json()
        logger.info("发送 SSE 错误帧: event=error, data=%s", rate_limit_payload)
        yield {
            "event": "error",
            "data": rate_limit_payload,
        }
        return

    except openai.APIError as e:
        logger.error("LLM API 错误: %s", e, exc_info=True)
        llm_error_payload = SSEError(
            code="llm_error",
            message="大模型服务异常，请稍后重试"
        ).model_dump_json()
        logger.info("发送 SSE 错误帧: event=error, data=%s", llm_error_payload)
        yield {
            "event": "error",
            "data": llm_error_payload,
        }
        return

    except Exception as e:
        logger.error("对话服务未知错误: %s", e, exc_info=True)
        internal_error_payload = SSEError(
            code="internal_error",
            message="后端内部错误，请稍后重试"
        ).model_dump_json()
        logger.info("发送 SSE 错误帧: event=error, data=%s", internal_error_payload)
        yield {
            "event": "error",
            "data": internal_error_payload,
        }
        return

    # =================================================================
    # Step 6: 数据持久化
    # =================================================================
    # 将本轮用户提问和 AI 完整回答各写入一条 Message
    # 即使 full_answer 为空（极端情况），也照常落盘以保持历史完整性
    # 清理落盘内容中可能残留的 <think> 标签（防御性处理）
    clean_answer = re.sub(r"<think>.*?</think>", "", full_answer, flags=re.DOTALL).strip()
    logger.info(
        "准备落盘用户消息: session_id=%s, role=user, len=%d, preview=%s",
        session_id,
        len(query),
        preview_text(query),
    )
    logger.info(
        "准备落盘助手消息: session_id=%s, role=assistant, len=%d, preview=%s",
        session_id,
        len(clean_answer),
        preview_text(clean_answer),
    )
    db.add(Message(session_id=session_id, role="user", content=query))
    db.add(Message(session_id=session_id, role="assistant", content=clean_answer))
    await db.commit()
    logger.info("对话消息落盘完成: session_id=%s", session_id)
