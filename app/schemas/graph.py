from typing import Literal

from pydantic import BaseModel

from app.schemas.common import SourceRef

GraphNodeType = Literal[
    "knowledge_base",
    "book",
    "chapter",
    "section",
    "markdown_note",
    "artifact",
    "person",
    "dynasty",
    "site",
    "concept",
    "material",
    "pattern",
    "craft",
    "category",
    "inscription",
    "usage",
    "other",
]


class GraphNode(BaseModel):
    id: str
    label: str
    nodeType: GraphNodeType
    description: str | None = None
    sourceRefs: list[SourceRef] | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    weight: float | None = None
    sourceRefs: list[SourceRef] | None = None


class GraphResponse(BaseModel):
    graphId: str
    centerNodeId: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
