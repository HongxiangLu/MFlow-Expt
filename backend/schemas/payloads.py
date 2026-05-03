"""
API 载荷模型定义 (Payload Schemas)

该模块基于 Pydantic 的 BaseModel 定义了所有的请求(Request)和响应(Response)数据传输对象(DTO)。
这有助于在 FastAPI 路由层自动进行请求参数校验，并自动生成标准的 OpenAPI(Swagger) 文档。
遵循 RESTful 规范以及前端交互的契约。
"""

from pydantic import BaseModel, Field
from typing import List, Optional

# ==========================================
# Chat Interface Models (对话流接口模型)
# ==========================================

class ChatRequest(BaseModel):
    """
    对话请求模型 (Chat Request)
    
    用于接收前端发起的单轮对话请求。
    该请求不会携带完整的对话历史，历史消息由后端依据 session_id 从持久化存储中提取。
    """
    query: str = Field(
        ..., 
        description="用户当前输入的文本问题", 
        examples=["什么是 M-Flow？"]
    )
    session_id: str = Field(
        ..., 
        description="当前会话的唯一标识 (如 UUID)，用于上下文关联与多轮对话的历史持久化",
        examples=["sess-12345678"]
    )

class ChatChunk(BaseModel):
    """
    对话流式响应片段 (Chat Stream Chunk)
    
    采用 SSE (Server-Sent Events) 协议下发的增量数据结构。
    """
    chunk: str = Field(
        ..., 
        description="增量生成的模型文本片段"
    )
    finish_reason: Optional[str] = Field(
        default=None, 
        description="生成结束标志。流进行中为 null，正常结束为 'stop'"
    )

class SSEError(BaseModel):
    """
    SSE 错误事件响应 (SSE Error Event)
    
    用于在流式传输建立后，推送后端发生的异常信息。
    """
    code: str = Field(
        ..., 
        description="机器可读的错误码，用于前端判断分支",
        examples=["llm_timeout", "llm_rate_limit", "llm_error", "retrieval_error", "internal_error"]
    )
    message: str = Field(
        ..., 
        description="人类可读的错误描述，可直接展示给用户"
    )

# ==========================================
# Graph Interface Models (图谱查询接口模型)
# ==========================================

class GraphRequest(BaseModel):
    """
    图谱查询请求模型 (Graph Request)
    
    用于接收前端发起的图谱数据查询请求。
    内部逻辑会执行 Query Rewrite 以消解指代问题。
    """
    query: str = Field(
        ..., 
        description="用户输入的原始问题",
        examples=["那它的首都呢？"]
    )
    session_id: str = Field(
        ..., 
        description="当前会话的唯一标识，用于提取历史对话进行 Query Rewrite，确保指代消解的准确性"
    )

class GraphNode(BaseModel):
    """
    知识图谱节点实体 (Graph Node)
    
    描述了知识图谱中的单个实体信息。
    """
    id: str = Field(
        ..., 
        description="节点唯一 ID，关系线通过该 ID 连接节点"
    )
    label: str = Field(
        ..., 
        description="节点展示名称，前端图上直接显示的文字（通常为中文）"
    )
    nodeType: str = Field(
        ..., 
        description="节点业务类型，由后端从 M-Flow 原始类型映射而来。如果无法匹配标准类型，则返回 'other'"
    )

class GraphEdge(BaseModel):
    """
    知识图谱边实体 (Graph Edge)
    
    描述了知识图谱中连接两个节点的关联关系。
    """
    id: str = Field(
        ..., 
        description="关系唯一 ID，不可重复"
    )
    source: str = Field(
        ..., 
        description="起点节点 ID，必须对应 nodes 中存在的某个 id"
    )
    target: str = Field(
        ..., 
        description="终点节点 ID，必须对应 nodes 中存在的某个 id"
    )
    label: str = Field(
        ..., 
        description="关系名称，前端直接显示在线上的文字"
    )
    weight: float = Field(
        default=1.0, 
        description="关系权重 (0.1 ~ 2)，表示关系强弱；前端可用于控制线条粗细或布局影响"
    )

class GraphResponse(BaseModel):
    """
    图谱查询完整响应模型 (Graph Response)
    
    包含了图谱的元数据、所有相关联的节点列表及边列表。
    """
    graphId: str = Field(
        ..., 
        description="当前图谱的唯一 ID，通常由后端基于查询字符串的 Hash 生成，确保同一查询标识稳定"
    )
    centerNodeId: str = Field(
        ..., 
        description="中心节点 ID，前端据此进行高亮与居中展示"
    )
    nodes: List[GraphNode] = Field(
        ..., 
        description="图谱中的所有节点列表"
    )
    edges: List[GraphEdge] = Field(
        ..., 
        description="图谱中的所有关系线列表"
    )
