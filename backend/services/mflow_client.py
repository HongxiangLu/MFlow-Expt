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
import logging
import os
import time

from dotenv import load_dotenv
from core.logging import preview_text

# 在导入 M-Flow SDK 之前加载 .env 环境变量
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from m_flow import search as m_flow_search
from m_flow import RecallMode

logger = logging.getLogger(__name__)

# 检索性能参数（已按当前优化目标收敛）
TOP_K = 5
WIDE_SEARCH_TOP_K = 30
DISPLAY_MODE = "summary"

# 预定义的 12 种标准业务类型
# 依据 API.md 的规范，前端对这 12 种类型的节点会进行特定样式的渲染。
# 任何不属于这些标准类型的节点都会被强制降级为 "other"。
STANDARD_NODE_TYPES = {
    "artifact", "dynasty", "material", "category", "pattern", "site",
    "craft", "inscription", "usage", "concept", "person", "collection"
}


def _normalize_standard_node_type(value: str | None) -> str | None:
    """将候选类型归一化为标准业务类型，无法匹配时返回 None。"""
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized in STANDARD_NODE_TYPES else None


def _extract_type_from_node_attributes(attributes: dict) -> str | None:
    """从节点 attributes 中提取业务类型（若存在）。"""
    if not isinstance(attributes, dict):
        return None

    # 优先读取显式字段
    for key in ("entity_type", "entityType", "type_name", "typeName", "category"):
        mapped = _normalize_standard_node_type(attributes.get(key))
        if mapped:
            return mapped

    # 兼容 is_a 以属性形式挂在节点上的场景
    is_a = attributes.get("is_a")
    if isinstance(is_a, str):
        return _normalize_standard_node_type(is_a)
    if isinstance(is_a, dict):
        for key in ("name", "label", "type", "entity_type"):
            mapped = _normalize_standard_node_type(is_a.get(key))
            if mapped:
                return mapped

    return None


def _infer_types_from_is_a_edges(raw_nodes: list[dict], raw_edges: list[dict]) -> dict[str, str]:
    """通过 Entity --is_a--> EntityType 关系推断节点业务类型。"""
    entity_type_by_id: dict[str, str] = {}

    # 先识别 EntityType 节点自身对应的业务类型（通常来自 label/name）
    for node in raw_nodes:
        node_id = node.get("id")
        if not node_id:
            continue

        raw_type = str(node.get("type", "")).lower()
        if raw_type != "entitytype":
            continue

        attributes = node.get("attributes", {})
        candidates = (
            node.get("label"),
            attributes.get("name") if isinstance(attributes, dict) else None,
            attributes.get("entity_type") if isinstance(attributes, dict) else None,
        )
        for candidate in candidates:
            mapped = _normalize_standard_node_type(candidate)
            if mapped:
                entity_type_by_id[node_id] = mapped
                break

    inferred: dict[str, str] = {}

    # 再根据 is_a 边把类型投射回业务节点
    for edge in raw_edges:
        if not isinstance(edge, dict):
            continue

        label = str(edge.get("label", "")).strip().lower()
        if label not in {"is_a", "isa"}:
            continue

        source = edge.get("source")
        target = edge.get("target")
        if not source or not target:
            continue

        source_mapped = entity_type_by_id.get(source)
        target_mapped = entity_type_by_id.get(target)

        # 兼容边方向不一致：只要一端是 EntityType，另一端就是待赋类型节点
        if source_mapped and not target_mapped and target not in inferred:
            inferred[target] = source_mapped
        elif target_mapped and not source_mapped and source not in inferred:
            inferred[source] = target_mapped

    return inferred


# =============================================================================
# 图谱后处理过滤层 (Graph Post-Processing Filter)
# =============================================================================
#
# 背景与动机：
#   M-Flow 图数据库返回的原始图谱数据中存在两类前端展示问题：
#   (1) 不同节点可能具有相同的显示名称 (label)，导致前端力导向图中出现重叠或语义混淆；
#   (2) 部分节点的 label 为纯英文/ASCII 标识符（如 M-Flow 内部生成的 Episode ID、
#       系统占位符），不适合直接展示给终端用户。
#
#   因此在 M-Flow 原始数据解析完成后、构建最终 GraphResponse 之前，插入一层后处理过滤。
#   该过滤层仅在 Facade 层（本模块）内部使用，不暴露给上层 Service 或 Controller。
#
# 设计决策：
#   - 过滤基于 M-Flow 原始类型 (raw_type) 而非映射后的业务类型 (nodeType)，
#     因为 Episode/Facet/FacetPoint/Entity 在映射后均归为 "other"，无法区分优先级。
#   - 使用 _raw_type 临时字段在节点 dict 中传递原始类型信息，过滤完成后自动清理，
#     确保不泄露到最终的 API 响应中（GraphNode 模型不包含该字段）。
# =============================================================================

# M-Flow 原始节点类型的去重优先级映射表。
# 数值越小优先级越高。当多个节点具有相同 label 时，保留优先级最高的节点。
#
# 优先级排序依据（从高到低）：
#   - Episode（情境片段）：M-Flow 对原始文档的语义切分单元，信息密度最高
#   - Facet（切面）      ：Episode 下的主题切面，承载结构化的属性描述
#   - FacetPoint（切面点）：Facet 的细粒度信息点，通常为单条事实陈述
#   - Entity（实体）      ：知识图谱中的原子实体节点，信息粒度最细
#
# 不在此映射表中的类型将获得默认优先级 99（最低），在去重时最先被淘汰。
_RAW_TYPE_PRIORITY: dict[str, int] = {
    "episode": 0,
    "facet": 1,
    "facetpoint": 2,
    "entity": 3,
}


def _filter_graph_nodes_and_edges(
    nodes: list[dict], edges: list[dict]
) -> tuple[list[dict], list[dict]]:
    """对图谱节点和边执行后处理过滤，返回清洗后的节点与边列表。

    该函数是图谱数据返回前端之前的最后一道数据清洗关卡，
    负责解决 M-Flow 原始图谱数据中的展示质量问题。

    过滤规则按以下顺序严格执行（顺序不可调换）：

    1. **ASCII 过滤**（节点级）
       移除 ``label.isascii() == True`` 的节点。这些节点的名称全部由 ASCII 字符
       组成（包括英文字母、数字、标点），通常是 M-Flow 内部生成的标识符或英文占位名称
       （如 ``"Episode_42"``、``"bronze_vessel_01"``），不具备面向用户的展示价值。

    2. **同名去重**（节点级，基于 label 聚合）
       对具有相同 label 的节点，仅保留 M-Flow 原始类型 (``_raw_type``) 优先级最高的
       一个。优先级由 ``_RAW_TYPE_PRIORITY`` 映射表定义：
       ``Episode > Facet > FacetPoint > Entity > 其他``。
       这确保了前端力导向图中不会出现多个同名节点导致的视觉重叠与语义混淆。

    3. **悬挂边清理**（边级）
       上述两步可能删除部分节点，导致某些边的 source 或 target 指向不存在的节点
       （即"悬挂边"）。此步骤移除所有悬挂边，保持图结构的引用完整性。

    Args:
        nodes: 节点字典列表。每个字典必须包含 ``id``、``label``、``nodeType`` 字段，
            以及用于优先级判定的临时字段 ``_raw_type``（过滤完成后会被清理）。
        edges: 边字典列表。每个字典必须包含 ``source`` 和 ``target`` 字段，
            其值为对应节点的 ``id``。

    Returns:
        tuple[list[dict], list[dict]]: 过滤后的 ``(nodes, edges)`` 二元组。
            - ``nodes``: 已清理 ``_raw_type`` 和 ``_priority`` 临时字段的节点列表。
            - ``edges``: 仅包含 source 和 target 均存在于过滤后节点集中的边。

    Note:
        - 本函数为纯函数风格（不修改外部状态），但会就地修改传入的节点字典以清理临时字段。
        - 时间复杂度：O(N + E)，其中 N 为节点数、E 为边数。
        - 空间复杂度：O(N)，用于 label_best 字典和 valid_node_ids 集合。
    """
    pre_filter_count = len(nodes)

    # ── Step 1: ASCII 过滤 ──────────────────────────────────────────────
    # 判定标准：str.isascii() 返回 True 表示字符串中所有字符的码点均在 U+0000~U+007F
    # 范围内，涵盖英文字母、数字、ASCII 标点与控制字符。
    # 典型被过滤的 label 示例："Episode_42"、"bronze_vessel"、"has_part"
    # 典型保留的 label 示例："青铜器"、"商代(Shang)"、"鼎·簋组合"
    non_ascii_nodes = [n for n in nodes if not n["label"].isascii()]
    ascii_removed = pre_filter_count - len(non_ascii_nodes)
    if ascii_removed:
        logger.info("图谱过滤 - ASCII 过滤: 移除 %d 个全 ASCII label 节点", ascii_removed)

    # ── Step 2: 同名去重（按原始类型优先级保留最佳节点）────────────────
    # 策略：遍历所有非 ASCII 节点，以 label 为 key 构建"最佳节点"字典。
    # 对于每个 label，仅保留 _RAW_TYPE_PRIORITY 中优先级数值最小的节点。
    # 若同名节点的原始类型均不在优先级映射表中，则保留首次遇到的节点（先到先得）。
    label_best: dict[str, dict] = {}
    for node in non_ascii_nodes:
        label = node["label"]
        raw_type = node.get("_raw_type", "").lower()
        # 未在映射表中注册的类型获得默认优先级 99（最低），去重时最先被淘汰
        priority = _RAW_TYPE_PRIORITY.get(raw_type, 99)

        if label not in label_best or priority < label_best[label]["_priority"]:
            # 使用浅拷贝避免修改原始节点数据，同时注入 _priority 临时字段用于比较
            label_best[label] = {**node, "_priority": priority}

    # 构建最终节点列表，同时清理 _priority 和 _raw_type 两个临时字段。
    # 这两个字段仅服务于过滤层内部逻辑，不属于 GraphNode 模型的 API 契约，
    # 必须在返回给上层之前移除，以避免 Pydantic 模型校验失败或响应数据泄露。
    valid_node_ids: set[str] = set()
    filtered_nodes: list[dict] = []
    for node in label_best.values():
        node.pop("_priority", None)
        node.pop("_raw_type", None)
        valid_node_ids.add(node["id"])
        filtered_nodes.append(node)

    dedup_removed = len(non_ascii_nodes) - len(filtered_nodes)
    if dedup_removed:
        logger.info("图谱过滤 - 同名去重: 移除 %d 个重复 label 节点", dedup_removed)

    # ── Step 3: 悬挂边清理 ──────────────────────────────────────────────
    # Step 1 和 Step 2 可能删除了部分节点，导致某些边的 source 或 target
    # 指向了不存在的节点（"悬挂边" / dangling edge）。
    # 此步骤使用 valid_node_ids 集合（O(1) 查找）高效过滤掉所有悬挂边，
    # 确保返回的图结构满足"边的两端节点必须存在"的引用完整性约束。
    pre_edge_count = len(edges)
    filtered_edges = [
        e for e in edges
        if e["source"] in valid_node_ids and e["target"] in valid_node_ids
    ]
    edge_removed = pre_edge_count - len(filtered_edges)
    if edge_removed:
        logger.info("图谱过滤 - 悬挂边清理: 移除 %d 条关联边", edge_removed)

    logger.info(
        "图谱过滤完成: 节点 %d → %d, 边 %d → %d",
        pre_filter_count, len(filtered_nodes),
        pre_edge_count, len(filtered_edges),
    )
    return filtered_nodes, filtered_edges

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
        logger.info("M-Flow context 检索跳过：收到空查询。")
        return []

    logger.info("M-Flow context 检索开始: query=%s", query)

    t0 = time.perf_counter()
    search_results = await m_flow_search(
        query_text=query,
        query_type=RecallMode.EPISODIC,
        top_k=TOP_K,
        use_combined_context=False,
        only_context=True,
        wide_search_top_k=WIDE_SEARCH_TOP_K,
        display_mode=DISPLAY_MODE,
    )
    elapsed = time.perf_counter() - t0
    raw_count = len(search_results) if isinstance(search_results, list) else 1
    logger.info("M-Flow context 检索耗时: %.2fs | type=%s, raw_count=%d", elapsed, type(search_results), raw_count)
    
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
    
    logger.info("M-Flow context 解析完成: query=%s, context_count=%d", query, len(context_list))
    if context_list:
        logger.info(
            "M-Flow context 预览: first_len=%d, first_preview=%s",
            len(context_list[0]),
            preview_text(context_list[0]),
        )
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
        logger.info("M-Flow graph 检索跳过：收到空查询。")
        return {
            "graphId": hashlib.sha256(b"").hexdigest()[:16],
            "centerNodeId": "",
            "nodes": [],
            "edges": []
        }

    logger.info("M-Flow graph 检索开始: query=%s", preview_text(query))

    # 1. 调用 m_flow.search 获取带图形结构的聚合结果
    t0 = time.perf_counter()
    search_result = await m_flow_search(
        query_text=query,
        query_type=RecallMode.TRIPLET_COMPLETION,
        top_k=TOP_K,
        verbose=True,  # 必须开启 verbose 才能带回 graphs 对象
        use_combined_context=True,  # 必须开启组合上下文才能返回带有 graphs 的 CombinedSearchResult
        only_context=True,
        wide_search_top_k=WIDE_SEARCH_TOP_K,
        display_mode=DISPLAY_MODE,
    )
    elapsed = time.perf_counter() - t0
    logger.info("M-Flow graph 检索耗时: %.2fs | type=%s", elapsed, type(search_result))

    nodes = []
    edges = []
    
    # 解析并提取 graphs 属性（需兼容防御：确保 search_result 有 graphs 属性）
    graphs_data = getattr(search_result, "graphs", None)
    if graphs_data:
        logger.info("M-Flow graph 数据集 keys: %s", list(graphs_data.keys()))
        for dataset_name, graph_data in graphs_data.items():
            if not isinstance(graph_data, dict):
                logger.warning("跳过非 dict 图谱数据: dataset=%s, value=%s", dataset_name, graph_data)
                continue
            logger.info(
                "处理图谱数据集: dataset=%s, raw_nodes=%d, raw_edges=%d",
                dataset_name,
                len(graph_data.get("nodes", [])),
                len(graph_data.get("edges", [])),
            )
                
            raw_nodes = graph_data.get("nodes", [])
            raw_edges = graph_data.get("edges", [])
            inferred_types = _infer_types_from_is_a_edges(raw_nodes, raw_edges)

            # 处理并转化节点 (Nodes)
            for node in raw_nodes:
                # 获取引擎返回的原始实体类型，转小写以统一匹配格式
                raw_type = node.get("type", "").lower()
                node_id = node.get("id")
                attributes = node.get("attributes", {})
                 
                # 过滤掉内部系统级实体 (如 __SYSTEM__ 类型的内部节点)
                if raw_type.startswith("__"):
                    continue

                # NodeType 映射优先级：
                # 1) is_a -> EntityType 推断
                # 2) 节点 attributes 内显式 entity_type
                # 3) 原始 type（仅在其本身就是标准业务类型时）
                # 4) 兜底 other
                node_type = (
                    inferred_types.get(node_id)
                    or _extract_type_from_node_attributes(attributes)
                    or _normalize_standard_node_type(raw_type)
                    or "other"
                )
                 
                # 构建节点字典，附带 _raw_type 临时字段。
                # _raw_type 字段生命周期：
                #   创建 → 节点构建时注入（此处）
                #   消费 → _filter_graph_nodes_and_edges() 中用于去重优先级判定
                #   销毁 → _filter_graph_nodes_and_edges() 返回前通过 dict.pop() 清理
                # 该字段不属于 GraphNode Pydantic 模型的 API 契约，
                # 若未正确清理将导致 Pydantic 校验告警（model_config 未设置 extra="allow"）。
                nodes.append({
                    "id": node_id,
                    "label": node.get("label") or node_id,
                    "nodeType": node_type,
                    "_raw_type": raw_type,
                })
                logger.info("图谱节点映射: mapped=%s", preview_text(str(nodes[-1])))
             
            # 处理并转化边 (Edges)
            for edge in raw_edges:
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
                logger.info("图谱边映射: mapped=%s", preview_text(str(edges[-1])))

    # =================================================================
    # Step: 节点与边的后处理过滤
    # =================================================================
    # 在构建最终 GraphResponse 之前，对原始图谱数据执行三阶段清洗：
    #   1. ASCII 过滤：移除纯英文/ASCII 标识符节点
    #   2. 同名去重：按 M-Flow 原始类型优先级合并同名节点
    #   3. 悬挂边清理：移除因节点删除而产生的无效边
    #
    # 此调用会就地清理节点中的 _raw_type 临时字段，返回的节点可安全传入
    # GraphNode(**node) 构造器。详见 _filter_graph_nodes_and_edges() 文档。
    nodes, edges = _filter_graph_nodes_and_edges(nodes, edges)

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

    result = {
        "graphId": graph_id,
        "centerNodeId": center_node_id,
        "nodes": nodes,
        "edges": edges
    }
    logger.info(
        "M-Flow graph 解析完成: query=%s, graphId=%s, centerNodeId=%s, node_count=%d, edge_count=%d",
        preview_text(query),
        graph_id,
        center_node_id,
        len(nodes),
        len(edges),
    )
    logger.info(
        "M-Flow graph 结果摘要: graphId=%s, centerNodeId=%s, node_count=%d, edge_count=%d",
        result["graphId"],
        result["centerNodeId"],
        len(result["nodes"]),
        len(result["edges"]),
    )
    return result
