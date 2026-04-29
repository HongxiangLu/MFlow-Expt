# RAG 后端系统需求与架构说明书 (SRS/PRD)

**文档版本**: v1.0  
**更新日期**: 2026-04-29  
**项目状态**: Demo / MVP 阶段

---

## 1. 引言 (Introduction)

### 1.1 背景与目的
本项目旨在设计并开发一个基于 FastAPI 的轻量级 Python 后端系统。系统的核心目标是为前端应用提供高效、具备深度上下文感知能力的 AI 对话接口。为实现此目标，系统将深度集成 **M-Flow** 作为检索增强生成（RAG）的基础设施，并接入 **MiniMax (MiniMax-M2.7)** 作为底层的核心大语言模型（LLM）。

### 1.2 核心技术栈
*   **Web 框架**: FastAPI (支持异步 IO，提供高性能 HTTP 接口)
*   **RAG 引擎**: M-Flow (负责本地知识库的向量/图检索)
*   **大语言模型**: MiniMax-M2.7 (采用兼容 OpenAI 规范的 API 格式接入)
*   **持久化存储**: SQLite (轻量级关系型数据库，用于会话与消息级状态存储)

---

## 2. 系统架构与核心业务流 (System Architecture & Workflow)

本系统的核心为 RAG 增强的多轮对话流。为彻底解决多轮交互中的**指代消解（Coreference Resolution）**与上下文丢失问题，系统引入了**独立问题重写 (Standalone Query Generation)** 机制。整体数据流转链路如下：

1. **请求接收 (前端并发触发)**: 前端在用户发送提问时，会**并发调用两个接口**：
    *   **接口 A (对话生成)**：获取大模型的流式回答。
    *   **接口 B (图谱查询)**：获取与该问题相关的知识图谱节点和关系（用于前端可视化渲染）。
2. **状态提取**: 后端依据 `session_id` 从 SQLite 数据库中提取该用户近期的多轮对话历史。
3. **查询重写 (Query Rewrite)**:
    * 触发首次 LLM 异步调用。输入参数包含“近期历史对话”与“当前用户提问”。
    * 模型提取上下文逻辑，消除代词与模糊指代，将用户提问重写为语义完备的**独立句子**（如将“它的首都”重构为“法国的首都”）。
    * *注：若判定为首轮对话或提问语义已充分独立，则原样穿透。为优化性能，图谱查询接口（接口 B）可选择复用或独立执行此重写逻辑。*
4. **知识检索 (Context & Graph Retrieval)**: 
    *   对于**接口 A**：将重写后的查询语句输入 M-Flow，召回文档片段（Context）。
    *   对于**接口 B**：将查询语句输入 M-Flow 的图数据库模块，精准检索并提取相关的实体节点（Nodes）与关系边（Edges）。
5. **提示词工程与模型推理 (Prompting & Generation - 仅限接口 A)**: 将召回的 Context、历史对话记录（History）以及用户的原始提问（Query）按预设模板组装为最终 Prompt，下发至 MiniMax-M2.7 进行推理生成。
6. **响应推送**:
    *   **接口 A (SSE Streaming)**: 采用 **Server-Sent Events (SSE)** 协议，将模型生成的 Token 序列逐字流式推至前端。流式传输完毕后，在内存中拼接完整回答。
    *   **接口 B (JSON Response)**: 将检索到的图谱节点与关系格式化为标准 JSON 结构一次性返回前端。
7. **数据持久化 (仅限接口 A)**: 将本轮次的用户原始问题与模型的最终完整回答作为新的上下文轮次追加落盘至 SQLite。

---

## 3. 接口规范 (API Specifications)

系统目前规划核心业务接口与扩展管理接口两类。

### 3.1 核心业务接口一：AI 对话 (Chat Endpoint)
*   **接口路径**: `/api/chat`
*   **请求方法**: `POST`
*   **业务功能**: 接收实时输入，执行 RAG 全链路逻辑，并以 SSE 协议返回流式响应。
*   **请求体 (Request Payload, JSON)**:
    *   `query` (String, 必填): 用户当前输入的文本问题。
    *   `session_id` (String, 必填): 当前会话的唯一标识，用于状态穿透与持久化关联。
*   **响应体 (Response Format, `text/event-stream`)**:
    *   `chunk` (String): 流式返回的文本片段。
    *   `references` (List, 可选): 随流返回的 M-Flow 召回来源（引文信息），供前端渲染参考溯源模块（通常在流式开始或结束时统一下发）。

### 3.2 核心业务接口二：图谱查询 (Graph Query Endpoint)
*   **接口路径**: `/api/graph/query` (暂定)
*   **请求方法**: `POST`
*   **业务功能**: 接收用户的提问，通过 M-Flow 从图数据库中检索相关的知识图谱实体及关联关系，供前端进行可视化网络图渲染。前端通常与 `/api/chat` 接口并发调用此接口。
*   **请求体 (Request Payload, JSON)**:
    *   `query` (String, 必填): 用户输入的原始问题。
    *   `session_id` (String, 可选/必填): 用于获取历史上下文进行 Query Rewrite（视具体性能与准确率权衡，此接口是否强依赖历史重写待定，建议必填以保证多轮检索的准确性）。
*   **响应体 (Response Format, `application/json`)**:
    *   `nodes` (List): 检索到的节点列表。例如 `[{ "id": "N1", "label": "Person", "properties": {"name": "张三"} }, ...]`。
    *   `edges` (List): 检索到的关系边列表。例如 `[{ "id": "E1", "source": "N1", "target": "N2", "type": "WORKS_AT", "properties": {} }, ...]`。

### 3.3 预留扩展接口 (Reserved Endpoints - TBD)
*(注：后续视业务需求演进，可按需实现以下预留接口)*
*   **知识库管理接口**: 支持知识文档（PDF/TXT 等）的上传、解析、向量化及 M-Flow 索引构建。
*   **会话追溯接口**: 允许前端依据 `session_id` 显式拉取历史完整对话时间线。
*   **服务探针接口 (Health Check)**: 监测 FastAPI 服务、M-Flow 引擎及外部 LLM API 的可用性与网络延迟。

---

## 4. 数据模型与状态管理 (Data Model & State Management)

由于 LLM API 的无状态（Stateless）本质，后端必须显式管理多轮对话的上下文窗口。

### 4.1 存储选型与策略
*   **持久化介质**: **SQLite**（通过 `.env` 配置 `DB_PROVIDER=sqlite` 挂载）。
*   **维护策略**: 采用**后端集中维护**模式。前端仅需在鉴权/会话层面持有 `session_id`，所有具体的消息轮次（Messages）由后端统一在数据库中落盘和读取。

### 4.2 模型设计指导
至少需规划两大核心实体结构：
1.  **Session (会话表)**: 存储 `session_id`、创建时间、更新时间及预留的关联键。
2.  **Message (消息表)**: 存储所属 `session_id`、角色（`user`/`assistant`）、文本内容及时间戳。

---

## 5. 非功能性需求与架构约束 (Non-Functional Requirements & Constraints)

在当前的 Demo / MVP 迭代阶段，系统需严格遵循以下开发约束，以确保架构高内聚、低耦合且避免过度设计：

### 5.1 用户管理限制 (Single-User Mode)
*   **无用户系统**: 暂不引入任何真实的用户体系（包括但不限于注册、登录、密码散列、JWT 签发及 RBAC 鉴权机制）。
*   **代码精简**: 严禁在当前目录结构中预先创建无业务实体的用户管理文件（如 `user_service.py`, `auth_middleware.py` 等）。

### 5.2 架构扩展性留白 (Extensibility)
*   **解耦设计**: 尽管当前运行于单用户模式，但底层的数据模型（ORM 实体）和业务服务层（Service Layer）必须具备横向扩展至多租户/多用户的潜力。
*   **表结构前瞻**: 在设计诸如 `sessions` 数据表时，强制预留 `user_id` 等租户隔离字段（当前阶段可赋默认值或空值），保证未来接入真实 IAM 系统时，核心 RAG 业务流与数据库 Schema 能够实现平滑过渡，无需产生破坏性重构。