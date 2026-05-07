"""
图谱查询服务模块 (Graph Service)

该模块实现了知识图谱查询的核心编排逻辑。
完整流程为：历史消息查询 → Query Rewrite（含跳过策略）→ M-Flow 图谱检索 → 格式化返回。

与 chat_service 彻底解耦：图谱查询独立执行 Query Rewrite，
因为图谱检索直接依赖查询语句的语义完备性，不像对话接口那样有完整历史传递给 LLM。
"""

import logging
import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.llm import llm_client
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
    "只输出重写后的句子，不要添加任何解释或格式。"
)


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

    # =================================================================
    # Step 1: 查询历史消息
    # =================================================================
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc())
    )
    history_messages = result.scalars().all()

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
        logger.info("图谱查询 - Query Rewrite: '%s' → '%s'", query, rewritten_query)

    # =================================================================
    # Step 3: 图谱检索
    # =================================================================
    graph_data = await mflow_client.get_graph(rewritten_query)

    # =================================================================
    # Step 4: 空结果处理
    # =================================================================
    # 按 API.md §1.5.3：图谱检索空结果返回 HTTP 404
    if not graph_data.get("nodes"):
        raise HTTPException(
            status_code=404,
            detail="未检索到与当前提问相关的知识图谱数据，请尝试更换提问内容。"
        )

    # =================================================================
    # Step 5: 构建并返回 GraphResponse
    # =================================================================
    return GraphResponse(
        graphId=graph_data["graphId"],
        centerNodeId=graph_data["centerNodeId"],
        nodes=[GraphNode(**node) for node in graph_data["nodes"]],
        edges=[GraphEdge(**edge) for edge in graph_data["edges"]],
    )


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
    # 组装消息列表：System Prompt → 历史消息 → 当前用户提问
    messages = [{"role": "system", "content": REWRITE_SYSTEM_PROMPT}]

    for msg in history_messages:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": query})

    try:
        response = await llm_client.chat.completions.create(
            model=settings.MINIMAX_MODEL,
            messages=messages,
            stream=False,
        )

        rewritten = response.choices[0].message.content.strip()

        # 清理 MiniMax 模型可能输出的 <think>...</think> 思维链标签
        rewritten = re.sub(r"<think>.*?</think>", "", rewritten, flags=re.DOTALL).strip()

        # 防御空返回：如果 LLM 返回空字符串，降级使用原始 query
        return rewritten if rewritten else query

    except Exception as e:
        # Query Rewrite 失败不应阻断主流程，降级使用原始 query
        logger.warning("Query Rewrite 失败，降级使用原始 query: %s", e, exc_info=True)
        return query
