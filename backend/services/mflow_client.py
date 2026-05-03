"""
M-Flow RAG 引擎客户端适配器 (M-Flow Client Facade)

此模块作为底层 M-Flow SDK 与上层业务逻辑层 (Services) 之间的外观层 (Facade)。
其核心作用在于：
1. 封装底层复杂的 M-Flow SDK 调用及配置细节，对外暴露简单的业务级方法。
2. 将 M-Flow 返回的原始数据结构（如 CombinedSearchResult, QueryResult）
   转换为 API 接口契约中要求的数据格式 (如 Dict)。
3. 在节点图谱解析中进行业务类型的强制映射与容错处理。
"""

import hashlib
from m_flow import query as m_flow_query
from m_flow import search as m_flow_search
from m_flow import RecallMode

# 预定义的 12 种标准业务类型
# 依据 API.md 的规范，前端对这 12 种类型的节点会进行特定样式的渲染。
# 任何不属于这些标准类型的节点都会被强制降级为 "other"。
STANDARD_NODE_TYPES = {
    "artifact", "dynasty", "material", "category", "pattern", "site",
    "craft", "inscription", "usage", "concept", "person", "collection"
}

async def get_context(query: str) -> list[str]:
    """
    获取针对用户提问的文档上下文片段 (Document Context)
    
    调用 M-Flow 的查询接口获取相关的知识片段。此处使用 "episodic" (片段记忆) 模式。
    
    Args:
        query (str): 用户的输入问题（可能经过了前置的 Query Rewrite 重写）。
        
    Returns:
        list[str]: 相关的纯文本上下文片段列表。如果未匹配到内容，返回空列表。
    """
    # 以 episodic 模式异步调用引擎，专注检索纯粹的段落上下文
    result = await m_flow_query(query, mode="episodic")
    
    # 将返回的上下文对象强制转为字符串列表
    if isinstance(result.context, list):
        return [str(ctx) for ctx in result.context]
    return []

async def get_graph(query: str) -> dict:
    """
    获取与用户提问相关的知识图谱数据 (Knowledge Graph Data)
    
    调用 M-Flow 引擎进行 TRIPLET_COMPLETION 模式检索，
    该模式不仅检索文本，还会召回构建知识关联的三元组 (节点和边)。
    
    此函数会提取检索结果中的图形(graphs)属性，并进行：
    - 实体类型映射 (NodeType Mapping)
    - 图谱摘要哈希生成 (Graph ID Generation)
    - 中心节点选取 (Center Node Selection)
    
    Args:
        query (str): 用户的输入问题（通常是消解过指代的独立语义句子）。
        
    Returns:
        dict: 符合 GraphResponse 契约的字典，包含：
            - graphId (str): 基于 query 计算出的哈希值
            - centerNodeId (str): 推荐作为前端中心点的节点 ID
            - nodes (list[dict]): 格式化后的图谱节点列表
            - edges (list[dict]): 格式化后的图谱边列表
    """
    # 1. 调用 m_flow.search 获取带图形结构的聚合结果
    search_result = await m_flow_search(
        query_text=query,
        query_type=RecallMode.TRIPLET_COMPLETION,
        verbose=True  # 必须开启 verbose 才能带回 graphs 对象
    )

    nodes = []
    edges = []
    
    # 解析并提取 graphs 属性
    # search_result.graphs 是一个字典，格式如: {"all available datasets": {"nodes": [...], "edges": [...]}}
    if search_result.graphs:
        for dataset_name, graph_data in search_result.graphs.items():
            if not isinstance(graph_data, dict):
                continue
                
            # 处理并转化节点 (Nodes)
            for node in graph_data.get("nodes", []):
                # 获取引擎返回的原始实体类型，转小写以统一匹配格式
                raw_type = node.get("type", "").lower()
                
                # 过滤掉内部系统级实体 (如 __SYSTEM__ 类型的内部节点)
                if raw_type.startswith("__"):
                    continue
                    
                # NodeType 映射：如果不属于 12 种标准类型，则归档为 "other"
                node_type = raw_type if raw_type in STANDARD_NODE_TYPES else "other"
                
                nodes.append({
                    "id": node.get("id"),
                    "label": node.get("label") or node.get("id"),
                    "nodeType": node_type
                })
            
            # 处理并转化边 (Edges)
            for edge in graph_data.get("edges", []):
                source = edge.get("source")
                target = edge.get("target")
                label = edge.get("label", "related")
                
                # 生成业务层所需的全局唯一边 ID
                # 采用 "{source}_{label}_{target}" 的三元组唯一组合方式
                edge_id = f"{source}_{label}_{target}"
                
                edges.append({
                    "id": edge_id,
                    "source": source,
                    "target": target,
                    "label": label,
                    "weight": 1.0  # 默认权重
                })

    # 生成当前知识检索网络视图的全局唯一 ID
    # 相同 Query 将产生稳定的 graphId，有利于前端缓存或状态保持
    graph_id = hashlib.sha256(query.encode("utf-8")).hexdigest()[:16]
    
    # 中心节点选举逻辑
    # 1. 首选 `nodeType == 'artifact'` (文物) 类型的节点作为中心（业务规定文物为主要焦点）
    # 2. 如果不存在文物节点，则降级选取结果集中的第一个节点作为中心
    center_node_id = ""
    if nodes:
        artifact_nodes = [n for n in nodes if n.get("nodeType") == "artifact"]
        if artifact_nodes:
            center_node_id = artifact_nodes[0]["id"]
        else:
            center_node_id = nodes[0]["id"]

    return {
        "graphId": graph_id,
        "centerNodeId": center_node_id,
        "nodes": nodes,
        "edges": edges
    }
