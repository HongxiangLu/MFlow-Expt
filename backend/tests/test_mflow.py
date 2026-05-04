"""
M-Flow Client Facade — Phase 3 验证测试脚本

本脚本对 `backend/services/mflow_client.py` 中的两个核心 Facade 方法
(`get_context` 和 `get_graph`) 进行端到端的集成测试与契约验证。

测试策略为「真实调用 + 结构断言」：
  - 真实调用底层 M-Flow SDK（需要 .env 配置完备、知识库已构建）
  - 对返回结果进行结构性断言，验证字段类型、数据完整性、业务映射规则等

测试覆盖的业务逻辑点：
  1. get_context — 片段记忆检索：返回类型、非空验证、元素类型
  2. get_graph — 图谱三元组检索：
     a. 返回字段完备性（graphId, centerNodeId, nodes, edges）
     b. graphId 的 SHA-256 幂等性验证
     c. nodeType 到 12 种标准类型 + "other" 的降级映射
     d. centerNodeId 存在于 nodes 列表中
     e. edges 的 source/target 引用完整性
     f. edge id 格式 "{source}_{label}_{target}"
     g. 空查询的防御性处理

使用方式:
    cd backend
    python -m pytest tests/test_mflow_client.py -v
    # 或直接运行
    python tests/test_mflow_client.py
"""

import asyncio
import hashlib
import sys
import os
import time

# =============================================================================
# 环境路径配置
# =============================================================================
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from dotenv import load_dotenv

load_dotenv(os.path.join(backend_dir, ".env"))

from services.mflow_client import get_context, get_graph, STANDARD_NODE_TYPES

# =============================================================================
# 测试辅助常量
# =============================================================================
# 使用一个在知识库中大概率有数据的测试查询词
TEST_QUERY = "杜工部草堂诗笺"
# 使用一个非常冷门、不太可能有数据的测试查询词，用于测试空结果场景
TEST_QUERY_EMPTY = "量子引力弦论的超对称性破缺机制"

# 预期的标准 nodeType 集合（含降级 "other"）
EXPECTED_NODE_TYPES = STANDARD_NODE_TYPES | {"other"}

# =============================================================================
# 测试用例
# =============================================================================


class TestGetContext:
    """get_context 接口测试集"""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def _assert(self, condition: bool, message: str):
        if condition:
            self.passed += 1
        else:
            self.failed += 1
            self.errors.append(message)

    async def test_returns_list(self):
        """验证返回值为 list 类型"""
        result = await get_context(TEST_QUERY)
        self._assert(isinstance(result, list), f"返回类型应为 list，实际为 {type(result)}")
        return result

    async def test_non_empty_result(self, result: list):
        """验证对已有知识的查询能返回非空结果"""
        self._assert(len(result) > 0, f"查询 '{TEST_QUERY}' 应返回非空列表，实际长度为 {len(result)}")

    async def test_elements_are_strings(self, result: list):
        """验证列表中每个元素均为 str 类型"""
        for i, item in enumerate(result):
            self._assert(
                isinstance(item, str),
                f"context[{i}] 应为 str，实际为 {type(item)}: {repr(item)[:80]}"
            )

    async def test_elements_non_empty(self, result: list):
        """验证列表中每个元素均为非空字符串"""
        for i, item in enumerate(result):
            if isinstance(item, str):
                self._assert(
                    len(item.strip()) > 0,
                    f"context[{i}] 为空字符串"
                )

    async def test_empty_query_safety(self):
        """验证空查询不会崩溃，至少返回空列表"""
        try:
            result = await get_context("")
            self._assert(isinstance(result, list), f"空查询应返回 list，实际为 {type(result)}")
        except Exception as e:
            self._assert(False, f"空查询不应抛出异常，但抛出了: {type(e).__name__}: {e}")

    async def run_all(self):
        print("\n" + "=" * 70)
        print("  测试集 1: get_context (片段记忆检索)")
        print("=" * 70)

        print(f"\n  查询词: \"{TEST_QUERY}\"")
        start = time.perf_counter()
        result = await self.test_returns_list()
        elapsed = time.perf_counter() - start
        print(f"  检索耗时: {elapsed:.2f}s | 召回片段数: {len(result)}")

        await self.test_non_empty_result(result)
        await self.test_elements_are_strings(result)
        await self.test_elements_non_empty(result)

        # 打印前 3 个片段的摘要
        for i, ctx in enumerate(result[:3], 1):
            preview = ctx.replace('\n', ' ').strip()[:120]
            print(f"  📄 片段 {i}: {preview}...")

        print(f"\n  [空查询防御测试]")
        await self.test_empty_query_safety()

        return result


class TestGetGraph:
    """get_graph 接口测试集"""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def _assert(self, condition: bool, message: str):
        if condition:
            self.passed += 1
        else:
            self.failed += 1
            self.errors.append(message)

    async def test_returns_dict(self):
        """验证返回值为 dict 类型"""
        result = await get_graph(TEST_QUERY)
        self._assert(isinstance(result, dict), f"返回类型应为 dict，实际为 {type(result)}")
        return result

    async def test_required_keys(self, result: dict):
        """验证返回字典包含 API 契约要求的全部顶层字段"""
        required_keys = {"graphId", "centerNodeId", "nodes", "edges"}
        for key in required_keys:
            self._assert(key in result, f"缺失必要字段: '{key}'")

    async def test_graph_id_deterministic(self, result: dict):
        """验证 graphId 是基于 query 的 SHA-256 前 16 位（幂等性）"""
        expected_id = hashlib.sha256(TEST_QUERY.encode("utf-8")).hexdigest()[:16]
        actual_id = result.get("graphId", "")
        self._assert(
            actual_id == expected_id,
            f"graphId 应为 '{expected_id}'，实际为 '{actual_id}'"
        )

    async def test_nodes_structure(self, result: dict):
        """验证 nodes 列表结构与字段完整性"""
        nodes = result.get("nodes", [])
        self._assert(isinstance(nodes, list), f"nodes 应为 list，实际为 {type(nodes)}")

        if not nodes:
            print("  ⚠️  nodes 列表为空，跳过节点结构测试")
            return

        for i, node in enumerate(nodes):
            self._assert(isinstance(node, dict), f"nodes[{i}] 应为 dict")
            self._assert("id" in node, f"nodes[{i}] 缺失 'id' 字段")
            self._assert("label" in node, f"nodes[{i}] 缺失 'label' 字段")
            self._assert("nodeType" in node, f"nodes[{i}] 缺失 'nodeType' 字段")

    async def test_node_types_mapping(self, result: dict):
        """验证所有 nodeType 均在标准类型集合 + 'other' 范围内（降级映射逻辑）"""
        nodes = result.get("nodes", [])
        if not nodes:
            return

        encountered_types = set()
        for node in nodes:
            node_type = node.get("nodeType", "")
            encountered_types.add(node_type)
            self._assert(
                node_type in EXPECTED_NODE_TYPES,
                f"节点 '{node.get('id')}' 的 nodeType '{node_type}' 不在标准类型集合中"
            )

        print(f"  📊 nodeType 分布: {encountered_types}")

    async def test_no_system_nodes(self, result: dict):
        """验证不包含以 __ 开头的内部系统节点"""
        nodes = result.get("nodes", [])
        for node in nodes:
            raw_type = node.get("nodeType", "")
            self._assert(
                not raw_type.startswith("__"),
                f"系统节点未被过滤: id={node.get('id')}, type={raw_type}"
            )

    async def test_center_node_exists(self, result: dict):
        """验证 centerNodeId 在 nodes 列表中可被找到"""
        center_id = result.get("centerNodeId", "")
        nodes = result.get("nodes", [])

        if not nodes:
            # 空结果时 centerNodeId 应为空字符串
            self._assert(center_id == "", f"空结果时 centerNodeId 应为空串，实际为 '{center_id}'")
            return

        node_ids = {n.get("id") for n in nodes}
        self._assert(
            center_id in node_ids,
            f"centerNodeId '{center_id}' 不在 nodes 列表中（共 {len(node_ids)} 个节点）"
        )

    async def test_center_node_prefers_artifact(self, result: dict):
        """验证若存在 artifact 类型节点，centerNodeId 应首选 artifact"""
        nodes = result.get("nodes", [])
        center_id = result.get("centerNodeId", "")
        if not nodes:
            return

        artifact_nodes = [n for n in nodes if n.get("nodeType") == "artifact"]
        if artifact_nodes:
            first_artifact_id = artifact_nodes[0]["id"]
            self._assert(
                center_id == first_artifact_id,
                f"存在 artifact 节点时，centerNodeId 应为 '{first_artifact_id}'，实际为 '{center_id}'"
            )

    async def test_edges_structure(self, result: dict):
        """验证 edges 列表结构与字段完整性"""
        edges = result.get("edges", [])
        self._assert(isinstance(edges, list), f"edges 应为 list，实际为 {type(edges)}")

        if not edges:
            print("  ⚠️  edges 列表为空，跳过边结构测试")
            return

        for i, edge in enumerate(edges):
            self._assert(isinstance(edge, dict), f"edges[{i}] 应为 dict")
            self._assert("id" in edge, f"edges[{i}] 缺失 'id' 字段")
            self._assert("source" in edge, f"edges[{i}] 缺失 'source' 字段")
            self._assert("target" in edge, f"edges[{i}] 缺失 'target' 字段")
            self._assert("label" in edge, f"edges[{i}] 缺失 'label' 字段")
            self._assert("weight" in edge, f"edges[{i}] 缺失 'weight' 字段")

    async def test_edge_id_format(self, result: dict):
        """验证 edge.id 符合 '{source}_{label}_{target}' 格式"""
        edges = result.get("edges", [])
        for i, edge in enumerate(edges):
            expected_id = f"{edge.get('source')}_{edge.get('label')}_{edge.get('target')}"
            actual_id = edge.get("id", "")
            self._assert(
                actual_id == expected_id,
                f"edges[{i}].id 应为 '{expected_id}'，实际为 '{actual_id}'"
            )

    async def test_edge_references_valid(self, result: dict):
        """验证所有 edge 的 source/target 均指向 nodes 中存在的节点"""
        nodes = result.get("nodes", [])
        edges = result.get("edges", [])
        node_ids = {n.get("id") for n in nodes}

        for i, edge in enumerate(edges):
            src = edge.get("source")
            tgt = edge.get("target")
            self._assert(
                src in node_ids,
                f"edges[{i}].source '{src}' 不在 nodes 中"
            )
            self._assert(
                tgt in node_ids,
                f"edges[{i}].target '{tgt}' 不在 nodes 中"
            )

    async def test_edge_weight_type(self, result: dict):
        """验证 edge.weight 为数值类型"""
        edges = result.get("edges", [])
        for i, edge in enumerate(edges):
            weight = edge.get("weight")
            if weight is not None:
                self._assert(
                    isinstance(weight, (int, float)),
                    f"edges[{i}].weight 应为数值类型，实际为 {type(weight)}"
                )

    async def test_node_ids_unique(self, result: dict):
        """验证节点 ID 唯一性"""
        nodes = result.get("nodes", [])
        ids = [n.get("id") for n in nodes]
        self._assert(
            len(ids) == len(set(ids)),
            f"节点 ID 存在重复: 总数 {len(ids)}, 去重后 {len(set(ids))}"
        )

    async def test_edge_ids_unique(self, result: dict):
        """验证边 ID 唯一性"""
        edges = result.get("edges", [])
        ids = [e.get("id") for e in edges]
        self._assert(
            len(ids) == len(set(ids)),
            f"边 ID 存在重复: 总数 {len(ids)}, 去重后 {len(set(ids))}"
        )

    async def test_idempotency(self):
        """验证同一查询两次调用产生相同的 graphId"""
        r1 = await get_graph(TEST_QUERY)
        r2 = await get_graph(TEST_QUERY)
        self._assert(
            r1.get("graphId") == r2.get("graphId"),
            f"同一查询的 graphId 不一致: '{r1.get('graphId')}' vs '{r2.get('graphId')}'"
        )

    async def test_empty_query_safety(self):
        """验证空查询不会崩溃"""
        try:
            result = await get_graph("")
            self._assert(isinstance(result, dict), f"空查询应返回 dict，实际为 {type(result)}")
            self._assert("graphId" in result, "空查询结果缺失 graphId")
            self._assert("nodes" in result, "空查询结果缺失 nodes")
            self._assert("edges" in result, "空查询结果缺失 edges")
        except Exception as e:
            self._assert(False, f"空查询不应抛出异常，但抛出了: {type(e).__name__}: {e}")

    async def run_all(self):
        print("\n" + "=" * 70)
        print("  测试集 2: get_graph (知识图谱检索)")
        print("=" * 70)

        # --- 主查询测试 ---
        print(f"\n  查询词: \"{TEST_QUERY}\"")
        start = time.perf_counter()
        result = await self.test_returns_dict()
        elapsed = time.perf_counter() - start
        nodes_count = len(result.get("nodes", []))
        edges_count = len(result.get("edges", []))
        print(f"  检索耗时: {elapsed:.2f}s | 节点数: {nodes_count} | 边数: {edges_count}")
        print(f"  graphId: {result.get('graphId')}")
        print(f"  centerNodeId: {result.get('centerNodeId')}")

        await self.test_required_keys(result)
        await self.test_graph_id_deterministic(result)
        await self.test_nodes_structure(result)
        await self.test_node_types_mapping(result)
        await self.test_no_system_nodes(result)
        await self.test_center_node_exists(result)
        await self.test_center_node_prefers_artifact(result)
        await self.test_edges_structure(result)
        await self.test_edge_id_format(result)
        await self.test_edge_references_valid(result)
        await self.test_edge_weight_type(result)
        await self.test_node_ids_unique(result)
        await self.test_edge_ids_unique(result)

        # 打印部分节点和边的抽样信息
        if result.get("nodes"):
            print(f"\n  📌 节点抽样 (前 5 个):")
            for node in result["nodes"][:5]:
                print(f"     id={node.get('id')}, label={node.get('label')}, "
                      f"nodeType={node.get('nodeType')}")

        if result.get("edges"):
            print(f"\n  🔗 边抽样 (前 5 个):")
            for edge in result["edges"][:5]:
                print(f"     {edge.get('source')} --[{edge.get('label')}]--> "
                      f"{edge.get('target')} (w={edge.get('weight')})")

        # --- 幂等性测试 ---
        print(f"\n  [幂等性验证] 二次查询 graphId 一致性...")
        start = time.perf_counter()
        await self.test_idempotency()
        elapsed = time.perf_counter() - start
        print(f"  二次检索耗时: {elapsed:.2f}s")

        # --- 空查询防御测试 ---
        print(f"\n  [空查询防御测试]")
        await self.test_empty_query_safety()

        return result


# =============================================================================
# 主入口
# =============================================================================

async def main():
    print("🚀 M-Flow Client Facade — Phase 3 集成测试")
    print(f"   测试目标: backend/services/mflow_client.py")
    print(f"   标准类型集: {sorted(STANDARD_NODE_TYPES)}")

    total_start = time.perf_counter()

    # --- 运行 get_context 测试 ---
    ctx_suite = TestGetContext()
    await ctx_suite.run_all()

    # --- 运行 get_graph 测试 ---
    graph_suite = TestGetGraph()
    await graph_suite.run_all()

    total_elapsed = time.perf_counter() - total_start

    # --- 汇总报告 ---
    total_passed = ctx_suite.passed + graph_suite.passed
    total_failed = ctx_suite.failed + graph_suite.failed
    all_errors = ctx_suite.errors + graph_suite.errors

    print("\n" + "=" * 70)
    print("  测试结果汇总")
    print("=" * 70)
    print(f"  get_context: ✅ {ctx_suite.passed} 通过  ❌ {ctx_suite.failed} 失败")
    print(f"  get_graph:   ✅ {graph_suite.passed} 通过  ❌ {graph_suite.failed} 失败")
    print(f"  总计:        ✅ {total_passed} 通过  ❌ {total_failed} 失败")
    print(f"  总耗时:      {total_elapsed:.2f}s")

    if all_errors:
        print(f"\n  ❌ 失败详情:")
        for i, err in enumerate(all_errors, 1):
            print(f"     {i}. {err}")
        print()

    status = "🎉 ALL TESTS PASSED" if total_failed == 0 else "💥 SOME TESTS FAILED"
    print(f"\n  {status}")
    print("=" * 70)

    return total_failed == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
