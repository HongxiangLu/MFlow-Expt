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
import os
from dotenv import load_dotenv

# 在导入 M-Flow SDK 之前加载 .env 环境变量
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

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
    获取针对用户提问的文档上下文片段 (Document Context)。
    
    调用底层的 M-Flow 检索引擎，获取相关的知识片段。
    由于只需求纯文本，因此限定使用 "episodic" (片段记忆) 模式，以此降低检索延迟并节约资源。
    
    Args:
        query (str): 用户的输入问题（通常建议在传入前进行指代消解或 Query Rewrite 重写）。
        
    Returns:
        list[str]: 包含相关知识点的纯文本片段列表。若无匹配内容，将安全地返回空列表。
        
    Raises:
        Exception: 捕获到底层 M-Flow 或 LLM 抛出的网络与权限异常，需由上层路由统一处理。
    """
    # 防御空查询：M-Flow SDK 对空白字符串会抛出 ValueError，
    # 在 Facade 层提前拦截，返回安全的空结果。
    if not query or not query.strip():
        return []

    # 不再使用有 Bug 的 m_flow_query，改用底层 m_flow_search 直接获取
    search_results = await m_flow_search(
        query_text=query,
        query_type=RecallMode.EPISODIC,
        use_combined_context=False
    )
    
    context_list = []
    if isinstance(search_results, list):
        for r in search_results:
            # 兼容 M-Flow 返回对象或字典的不同情况
            if hasattr(r, "search_result"):
                context_list.append(str(r.search_result))
            elif isinstance(r, dict):
                content = r.get("search_result") or r.get("context") or str(r)
                context_list.append(str(content))
            else:
                context_list.append(str(r))
    elif hasattr(search_results, "context"):
        # 兼容返回 CombinedSearchResult 的情况
        if isinstance(search_results.context, list):
            context_list = [str(ctx) for ctx in search_results.context]
        else:
            context_list = [str(search_results.context)]
            
    return context_list
async def get_graph(query: str) -> dict:
    """
    获取与用户提问相关的结构化知识图谱数据 (Knowledge Graph Data)。
    
    调用 M-Flow 引擎进行 TRIPLET_COMPLETION (三元组补全) 模式检索。
    该模式除了传统的向量召回，还会触发基于图数据库（如 Kùzù）的连通子图提取。
    
    本函数作为适配层，执行以下核心业务逻辑转化：
    1. 实体类型降级 (NodeType Mapping)：过滤无关数据，保障前端渲染安全。
    2. 图谱哈希生成 (Graph ID Generation)：实现相同查询幂等性，便于前端缓存。
    3. 中心节点选举 (Center Node Selection)：提供前端力导向图 (Force Graph) 的初始视点。
    
    Args:
        query (str): 用户输入的检索词（如实体名称或消解过指代的独立语义句子）。
        
    Returns:
        dict: 符合前端 `GraphResponse` 契约的标准字典结构，包含：
            - graphId (str): 基于 query 计算出的 SHA-256 前缀，用于唯一标识当前图谱视图。
            - centerNodeId (str): 推荐作为前端视图聚焦点/高亮点的节点 ID。
            - nodes (list[dict]): 经过样式安全过滤后的图谱节点列表。
            - edges (list[dict]): 生成了全局唯一 ID 的图谱边列表。
            
    Raises:
        Exception: 底层图谱查询失败时可能抛出的异常。
    """
    # 防御空查询：M-Flow SDK 对空白字符串会抛出 ValueError，
    # 在 Facade 层提前拦截，返回符合契约的空图谱结构。
    if not query or not query.strip():
        return {
            "graphId": hashlib.sha256(b"").hexdigest()[:16],
            "centerNodeId": "",
            "nodes": [],
            "edges": []
        }

    # 1. 调用 m_flow.search 获取带图形结构的聚合结果
    search_result = await m_flow_search(
        query_text=query,
        query_type=RecallMode.TRIPLET_COMPLETION,
        verbose=True,  # 必须开启 verbose 才能带回 graphs 对象
        use_combined_context=True  # 必须开启组合上下文才能返回带有 graphs 的 CombinedSearchResult
    )

    nodes = []
    edges = []
    
    # 解析并提取 graphs 属性（需兼容防御：确保 search_result 有 graphs 属性）
    graphs_data = getattr(search_result, "graphs", None)
    if graphs_data:
        for dataset_name, graph_data in graphs_data.items():
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
