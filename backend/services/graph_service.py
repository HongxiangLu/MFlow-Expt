"""
图谱查询服务模块 (Graph Service)

该模块实现了知识图谱查询的核心编排逻辑。
完整流程为：历史消息查询 → Query Rewrite（含跳过策略）→ M-Flow 图谱检索 → 格式化返回。

与 chat_service 彻底解耦：图谱查询独立执行 Query Rewrite，
因为图谱检索直接依赖查询语句的语义完备性，不像对话接口那样有完整历史传递给 LLM。
"""

import logging
import re
import time

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.llm import llm_client
from core.logging import preview_text
from db.models import Message
from schemas.payloads import GraphResponse, GraphNode, GraphEdge
from services import mflow_client

logger = logging.getLogger(__name__)

# =============================================================================
# Query Rewrite System Prompt
# =============================================================================
# 设计要点：
# 1. 明确角色定位：查询重写助手
# 2. 核心指令：消除代词和模糊指代，重写为语义完备的独立句子
# 3. 跳过机制内嵌：语义已充分独立时原样返回（由 LLM 自行判断）
# 4. 输出约束：只输出纯文本，不添加解释或格式

REWRITE_SYSTEM_PROMPT = (
    "你是一个查询重写助手。你的任务是将用户的提问重写为一个语义完备的独立句子，"
    "消除其中的代词和模糊指代。\n"
    "如果当前提问的语义已经充分独立，不存在需要消解的指代，则原样返回用户的提问。\n"
    "严禁回答问题、严禁补充事实、严禁输出解释。\n"
    "只输出重写后的句子，不要添加任何解释或格式。"
)

REWRITE_USER_PROMPT_TEMPLATE = (
    "请仅执行“查询重写”，不要回答问题。\n"
    "【规则】\n"
    "1) 若当前提问已可独立理解，则原样返回当前提问。\n"
    "2) 若存在代词、省略或模糊指代，结合历史做最小必要改写。\n"
    "3) 不得输出“答案是”“根据上述”等回答性语句。\n"
    "4) 仅输出一行纯文本，不要前缀、编号、引号或 Markdown。\n\n"
    "【会话历史】\n"
    "{history}\n\n"
    "【当前提问】\n"
    "{query}"
)

REWRITE_HISTORY_WINDOW = 10

async def query_graph(query: str, session_id: str, db: AsyncSession) -> GraphResponse:
    """
    图谱查询全链路：Query Rewrite → 图谱检索 → 格式化返回。

    Args:
        query: 用户输入的原始问题。
        session_id: 当前会话的唯一标识，用于提取历史对话进行 Query Rewrite。
        db: 异步数据库会话，由路由层通过依赖注入提供。

    Returns:
        GraphResponse: 包含 graphId、centerNodeId、nodes、edges 的结构化图谱数据。

    Raises:
        HTTPException(404): 当 M-Flow 图谱检索返回空结果时抛出。
    """
    logger.info("图谱查询开始: session_id=%s, query=%s", session_id, query)
    t_pipeline = time.perf_counter()

    # =================================================================
    # Step 1: 查询历史消息
    # =================================================================
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc())
    )
    history_messages = result.scalars().all()
    logger.info("图谱查询历史消息: session_id=%s, history_count=%d", session_id, len(history_messages))
    if history_messages:
        logger.info(
            "图谱查询历史预览: last_role=%s, last_len=%d, last_preview=%s",
            history_messages[-1].role,
            len(history_messages[-1].content or ""),
            preview_text(history_messages[-1].content or ""),
        )

    # =================================================================
    # Step 2: Query Rewrite 跳过策略
    # =================================================================
    # 分层判定机制：
    # - 无历史消息（首轮对话）→ 直接跳过重写，节省一次 LLM 调用的延迟与成本
    # - 有历史消息 → 调用 LLM 进行重写，由模型判断是否需要消解指代

    if not history_messages:
        # 首轮对话：无需 Query Rewrite，直接使用原始 query
        rewritten_query = query
        logger.info("图谱查询 - 首轮对话，跳过 Query Rewrite: %s", query)
    else:
        # 多轮对话：执行 Query Rewrite
        rewritten_query = await _rewrite_query(query, history_messages)
        logger.info("图谱查询 - Query Rewrite: '%s' → '%s'", preview_text(query), preview_text(rewritten_query))

    # =================================================================
    # Step 3: 图谱检索
    # =================================================================
    graph_data = await mflow_client.get_graph(rewritten_query)
    logger.info(
        "M-Flow 图谱检索摘要: graphId=%s, centerNodeId=%s, node_count=%d, edge_count=%d",
        graph_data.get("graphId"),
        graph_data.get("centerNodeId"),
        len(graph_data.get("nodes", [])),
        len(graph_data.get("edges", [])),
    )

    # =================================================================
    # Step 4: 空结果处理
    # =================================================================
    # 按 API.md §1.5.3：图谱检索空结果返回 HTTP 404
    if not graph_data.get("nodes"):
        logger.info("图谱检索为空，抛出 404: session_id=%s, rewritten_query=%s", session_id, rewritten_query)
        raise HTTPException(
            status_code=404,
            detail="未检索到与当前提问相关的知识图谱数据，请尝试更换提问内容。"
        )

    # =================================================================
    # Step 5: 构建并返回 GraphResponse
    # =================================================================
    response = GraphResponse(
        graphId=graph_data["graphId"],
        centerNodeId=graph_data["centerNodeId"],
        nodes=[GraphNode(**node) for node in graph_data["nodes"]],
        edges=[GraphEdge(**edge) for edge in graph_data["edges"]],
    )
    logger.info(
        "图谱查询返回: session_id=%s, graphId=%s, centerNodeId=%s, node_count=%d, edge_count=%d",
        session_id,
        response.graphId,
        response.centerNodeId,
        len(response.nodes),
        len(response.edges),
    )
    elapsed_pipeline = time.perf_counter() - t_pipeline
    logger.info("图谱查询全链路耗时: %.2fs | session_id=%s", elapsed_pipeline, session_id)
    return response


async def _rewrite_query(query: str, history_messages: list[Message]) -> str:
    """
    调用 LLM 执行 Query Rewrite，将用户提问重写为语义完备的独立句子。

    通过在 Prompt 中注入对话历史，让模型理解上下文后消除代词和模糊指代。
    如果模型判断当前提问语义已充分独立，会原样返回。

    Args:
        query: 用户当前的原始提问。
        history_messages: 该 session 下的所有历史消息（按时间升序）。

    Returns:
        str: 重写后的查询语句（纯文本）。如果 LLM 调用失败，降级返回原始 query。
    """
    # 组装消息列表：System Prompt → 单条 User 指令（内含结构化历史与当前提问）
    # 避免直接把完整对话作为多条 chat message 传入，降低模型“继续对话并直接回答”倾向。
    recent_history = history_messages[-REWRITE_HISTORY_WINDOW:]
    history_text = "\n".join(
        f"{msg.role}: {(msg.content or '').strip()}"
        for msg in recent_history
        if (msg.content or "").strip()
    ) or "(无)"

    rewrite_user_prompt = REWRITE_USER_PROMPT_TEMPLATE.format(history=history_text, query=query)
    messages = [
        {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
        {"role": "user", "content": rewrite_user_prompt},
    ]
    logger.info("即将请求 MiniMax 执行 Query Rewrite: model=%s", settings.MINIMAX_MODEL)
    logger.info(
        "Query Rewrite 请求摘要: message_count=%d, last_role=%s, last_len=%d, last_preview=%s",
        len(messages),
        messages[-1]["role"],
        len(messages[-1]["content"]),
        preview_text(messages[-1]["content"]),
    )

    try:
        t0 = time.perf_counter()
        response = await llm_client.chat.completions.create(
            model=settings.MINIMAX_MODEL,
            messages=messages,
            stream=False,
            temperature=0.0,
        )
        elapsed = time.perf_counter() - t0
        logger.info("Query Rewrite LLM 调用耗时: %.2fs", elapsed)

        rewritten = response.choices[0].message.content.strip()
        logger.info("Query Rewrite 原始文本: len=%d, preview=%s", len(rewritten), preview_text(rewritten))

        # 清理 MiniMax 模型可能输出的 <think>...</think> 思维链标签
        rewritten = re.sub(r"<think>.*?</think>", "", rewritten, flags=re.DOTALL).strip()
        # 规整为单行文本，避免多行解释污染检索查询
        rewritten = re.sub(r"\s+", " ", rewritten).strip()

        # 防御性兜底：若输出明显偏向“回答”而非“重写”，回退到原始 query
        looks_like_answer = bool(re.match(r"^(答案|答：|根据|通常|可以|首先|这个问题)", rewritten))
        too_long_for_rewrite = len(rewritten) > max(120, len(query) * 4)
        final_query = query if (not rewritten or looks_like_answer or too_long_for_rewrite) else rewritten
        logger.info("Query Rewrite 最终结果: len=%d, preview=%s", len(final_query), preview_text(final_query))
        return final_query

    except Exception as e:
        # Query Rewrite 失败不应阻断主流程，降级使用原始 query
        logger.warning("Query Rewrite 失败，降级使用原始 query: %s", e, exc_info=True)
        logger.info("Query Rewrite 降级结果: len=%d, preview=%s", len(query), preview_text(query))
        return query
