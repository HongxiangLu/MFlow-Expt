# M-Flow 源码修改日志

> 本文档记录对项目内 `m_flow/` 源码的开发和修改。

---

## 1. MiniMax System 角色兼容

**问题**：MiniMax 模型严格拒绝 `role: "system"` 的消息体，导致 `memorize()` 入库流程抛出 `litellm.BadRequestError`。

**修改**：将 `system` 消息合并至 `user` 消息中（指令前置拼接）。

| 文件 | 修改点 |
|------|--------|
| `m_flow/llm/LLMGateway.py` | `complete_text` 方法中的 `messages` 构建 |
| `m_flow/llm/backends/litellm_instructor/llm/openai/adapter.py` | `_build_messages` 方法 |

---

## 2. 实体名称提取格式修正

**问题**：提示词要求 LLM 输出裸 JSON 数组，但接收端的 Pydantic 模型 `ConceptNamesResult` 期望 `{"names": [...]}` 对象结构。MiniMax 严格遵循提示词指示，导致 Pydantic 校验失败。

**修改**：`m_flow/llm/prompts/extract_entity_names.txt` 末行改为要求输出带 `"names"` 字段的 JSON 对象。

---

## 3. 版本标识修正

**问题**：包名从 `m_flow` 更名为 `mflow-ai`，GitHub 仓库所有者从 `m-flow-project` 迁移至 `FlowElement-ai`。

**修改**：

| 文件 | 修改点 |
|------|--------|
| `m_flow/version.py` | `importlib.metadata.version("m_flow")` → `"mflow-ai"` |
| `m_flow/api/v1/ui/ui.py` | GitHub 下载地址中的仓库所有者更新 |

---

## 4. Windows 负数时间戳兼容

**问题**：Windows 底层 C 库不支持负数 Unix 时间戳（1970 年以前），`datetime.fromtimestamp()` 和 `dt.timestamp()` 在处理古代日期时抛出 `OSError`。

**修改**：改用 `datetime(1970,1,1) + timedelta(seconds=...)` 和 `(dt - epoch).total_seconds()` 绕过平台限制。

| 文件 | 修改点 |
|------|--------|
| `m_flow/retrieval/time/query_time_parser.py` | `parse_query_time` 中的 `now_dt` 计算 |
| `m_flow/retrieval/time/mentioned_time_extractor.py` | `_extract_anchor_from_explicit_dates` 中的 `ts_ms` 计算 |

---

## 5. `only_context` 参数在组合上下文模式下被忽略

**问题**：`search()` 的 `use_combined_context=True` 分支无条件调用 `completion_fn` 进行 LLM 生成，完全忽略 `only_context=True`，导致不必要的 LLM 调用并在 MiniMax 模型上触发 `InstructorRetryException`。

**修改**：`m_flow/search/methods/search.py` 的 `_authorized_search_impl` 函数中，在调用 `completion_fn` 之前增加 `if only_context: return None, combined_ctx, all_datasets` 短路返回。
