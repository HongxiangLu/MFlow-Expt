"""
图谱查询接口路由模块（Controller 层）。

职责边界：
1. 接收并校验 `/api/graph/query` 的请求体。
2. 通过依赖注入获取数据库会话。
3. 调用 graph_service 执行业务流程，并返回结构化 JSON。

约束：
- 本层不负责 Query Rewrite、图谱检索映射与错误策略决策。
- 所有业务规则统一沉淀在 service 层，便于测试和复用。
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from schemas.payloads import GraphRequest, GraphResponse
from services import graph_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["graph"])


@router.post("/api/graph/query", response_model=GraphResponse)
async def graph_query(req: GraphRequest, db: AsyncSession = Depends(get_db)) -> GraphResponse:
    """
    图谱查询接口。

    Args:
        req: 请求体，包含原始查询语句 `query` 与会话标识 `session_id`。
        db: 当前请求的异步数据库会话，由依赖注入提供。

    Returns:
        GraphResponse: 图谱查询结果，包含 graphId、centerNodeId、nodes、edges。

    设计说明：
    - `response_model=GraphResponse` 用于响应结构约束与 OpenAPI 文档生成。
    - 异常（如检索空结果的 404）由 service 层抛出并交给 FastAPI 统一处理。
    """
    logger.info("收到 /api/graph/query 请求: %s", req.model_dump_json())
    response = await graph_service.query_graph(req.query, req.session_id, db)
    logger.info(
        "图谱查询完成: session_id=%s, graphId=%s, nodes=%d, edges=%d",
        req.session_id,
        response.graphId,
        len(response.nodes),
        len(response.edges),
    )
    return response
