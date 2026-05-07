# RAG 后端系统需求与架构说明书 (SRS/PRD)

**文档版本**: v1.2  
**更新日期**: 2026-04-30  
**项目状态**: Demo / MVP 阶段

---

## 1. 引言 (Introduction)

### 1.1 背景与目的
本项目旨在设计并开发一个基于 FastAPI 的轻量级 Python 后端系统。系统的核心目标是为前端应用提供高效、具备深度上下文感知能力的 AI 对话接口。为实现此目标，系统将深度集成 **M-Flow** 作为检索增强生成（RAG）的基础设施，并接入 **MiniMax (MiniMax-M2.7)** 作为底层的核心大语言模型（LLM）。

### 1.2 核心技术栈
*   **Web 框架**: FastAPI — 原生支持异步 IO 与流式响应（SSE），提供高性能 HTTP 接口；内置 Pydantic 数据校验与 OpenAPI 文档自动生成，天然适配 RESTful 风格开发。选择 FastAPI 而非 Flask/Django 的核心原因是其对异步流式推送（SSE）的一等公民支持，这是 RAG 对话场景的刚需。
*   **API 设计风格**: RESTful — 以资源为中心，通过标准 HTTP 动词映射操作语义，便于前后端协作与工具链集成（Swagger/Postman）。
*   **RAG 引擎**: M-Flow — 作为本地 Python 库直接 `import` 调用，负责知识库的向量检索与图谱查询。选择进程内集成而非微服务部署，是为了在 MVP 阶段消除网络通信开销与运维复杂度。
*   **大语言模型**: MiniMax-M2.7 — 采用兼容 OpenAI SDK 规范的 API 格式接入（通过修改 `base_url` 实现），避免引入额外的供应商专属 SDK，降低切换模型的成本。
*   **持久化存储**: SQLite — 轻量级嵌入式关系型数据库，零配置即可启动，用于会话与消息级状态存储。选择 SQLite 而非 MySQL/PostgreSQL 是因为 MVP 阶段为单机单用户场景，无需网络数据库的连接管理开销，同时通过 SQLAlchemy ORM 保障未来向生产级数据库的平滑迁移。

---

## 2. 系统架构与核心业务流 (System Architecture & Workflow)

本系统的核心为 RAG 增强的多轮对话流。前端在用户发送提问时，**并发调用两个独立接口**，各自执行完整的处理链路。

### 接口 A：对话生成 (`/api/chat`) 数据流

对话接口**不执行 Query Rewrite**。原因是：对话接口会将完整的多轮历史（History）连同用户当前提问一起发送给 LLM，模型本身具备从上下文中理解指代关系的能力，无需额外的重写步骤。

1. **状态提取**: 后端依据 `session_id` 从 SQLite 数据库中提取该用户的全部对话历史（不设轮数与 Token 上限）。
2. **知识检索 (Context Retrieval)**: 将用户的原始提问输入 M-Flow，召回相关文档片段（Context）。
3. **提示词工程与模型推理 (Prompting & Generation)**: 将召回的 Context、历史对话记录（History）以及用户的原始提问（Query）按预设模板组装为最终 Prompt，下发至 MiniMax-M2.7 进行推理生成。System Prompt 中需限定模型的回答风格（如"你是一个博物馆文物专家"），具体模板在代码实现阶段给出，总体原则是让大模型尽可能命中缓存。
4. **响应推送 (SSE Streaming)**: 采用 **Server-Sent Events (SSE)** 协议，将模型生成的 Token 序列逐字流式推至前端。流式传输完毕后，在内存中拼接完整回答。
5. **数据持久化**: 将本轮次的用户原始问题与模型的最终完整回答作为新的上下文轮次追加落盘至 SQLite。

### 接口 B：图谱查询 (`/api/graph/query`) 数据流

图谱查询接口**需要执行 Query Rewrite**。原因是：图谱检索直接依赖查询语句的语义完备性，不像对话接口那样有完整的历史上下文传递给 LLM，因此必须先将用户的模糊指代消解为独立语义的查询。

1. **状态提取**: 后端依据 `session_id` 从 SQLite 数据库中提取该用户的全部对话历史（不设轮数与 Token 上限）。
2. **查询重写 (Query Rewrite)**:
    * 触发 LLM 调用。输入参数包含"对话历史"与"当前用户提问"。
    * 模型提取上下文逻辑，消除代词与模糊指代，将用户提问重写为语义完备的**独立句子**（如将"它的首都"重构为"法国的首都"），以**纯文本**格式输出。
    * **跳过策略**：采用分层判定机制——首先由后端代码检测 session 内是否存在历史消息，若无历史消息（首轮对话）则直接跳过重写；若有历史消息，则将判定权交给 LLM，在 Prompt 中指示"如果当前提问语义已充分独立，则原样返回"。此策略在首轮场景下节省一次 LLM 调用的延迟与成本，同时在多轮场景下借助 LLM 的语义理解能力确保判断准确性。
3. **知识检索 (Graph Retrieval)**: 将重写后的查询语句输入 M-Flow 的图数据库模块，精准检索并提取相关的实体节点（Nodes）与关系边（Edges）。
4. **响应推送 (JSON Response)**: 将检索到的图谱节点与关系格式化为标准 JSON 结构一次性返回前端。

---

## 3. 接口规范 (API Specifications)

系统目前规划核心业务接口与扩展管理接口两类。所有接口均遵循 **RESTful** 风格设计，详细字段定义与示例请参阅 `API.md`。

### 3.1 核心业务接口一：AI 对话 (Chat Endpoint)
*   **接口路径**: `/api/chat`
*   **请求方法**: `POST`
*   **业务功能**: 接收实时输入，执行 RAG 全链路逻辑（不含 Query Rewrite），并以 SSE 协议返回流式响应。采用 SSE 而非 WebSocket，是因为该场景仅需服务端向客户端单向推流，SSE 实现更轻量且与 HTTP 基础设施天然兼容。
*   **请求体 (Request Payload, JSON)**:
    *   `query` (String, 必填): 用户当前输入的文本问题。
    *   `session_id` (String, 必填): 当前会话的唯一标识，用于状态穿透与持久化关联。
*   **响应体 (Response Format, `text/event-stream`)**:
    *   `chunk` (String): 流式返回的文本字符（后端按单字符粒度推送）。
    *   `finish_reason` (String): 结束标志。流进行中为 `null`，正常结束为 `"stop"`。

### 3.2 核心业务接口二：图谱查询 (Graph Query Endpoint)
*   **接口路径**: `/api/graph/query`
*   **请求方法**: `POST`
*   **业务功能**: 接收用户的提问，独立执行 Query Rewrite 后，通过 M-Flow 从图数据库中检索相关的知识图谱实体及关联关系，供前端进行可视化网络图渲染。前端通常与 `/api/chat` 接口并发调用此接口。
*   **请求体 (Request Payload, JSON)**:
    *   `query` (String, 必填): 用户输入的原始问题。
    *   `session_id` (String, 必填): 用于获取历史上下文进行 Query Rewrite，确保多轮检索的指代消解准确性。
*   **响应体 (Response Format, `application/json`)**: 返回完整的 Graph 对象，包含以下顶层字段：
    *   `graphId` (String): 当前图谱的唯一 ID。
    *   `centerNodeId` (String): 中心节点 ID，前端据此高亮展示。
    *   `nodes` (List\<GraphNode\>): 节点列表，每个节点含 `id`、`label`（展示名称）、`nodeType`（业务类型）。
    *   `edges` (List\<GraphEdge\>): 关系列表，每条边含 `id`、`source`、`target`、`label`（关系名称）及可选 `weight`（权重）。

### 3.3 预留扩展接口 (Reserved Endpoints - TBD)
*(注：后续视业务需求演进，可按需实现以下预留接口)*
*   **知识库管理接口**: 支持知识文档（PDF/TXT 等）的上传、解析、向量化及 M-Flow 索引构建。
*   **服务探针接口 (Health Check)**: 监测 FastAPI 服务、M-Flow 引擎及外部 LLM API 的可用性与网络延迟。

---

## 4. 数据模型与状态管理 (Data Model & State Management)

由于 LLM API 的无状态（Stateless）本质，后端必须显式管理多轮对话的上下文窗口。对话历史在本系统中有两个用途：一是作为对话接口的 History 输入，使 LLM 能够直接理解上下文中的指代关系；二是作为图谱查询接口中 Query Rewrite（指代消解）的输入依据。

### 4.1 存储选型与策略
*   **持久化介质**: **SQLite**（通过 `.env` 配置 `DB_PROVIDER=sqlite` 挂载）。SQLite 为嵌入式数据库，零配置、零部署依赖，适合 MVP 阶段单机验证；同时通过 SQLAlchemy 的抽象层可平滑迁移至 MySQL / PostgreSQL。
*   **维护策略**: 采用**后端集中维护**模式。前端仅需持有 `session_id`（每次刷新时生成新的 UUID），所有具体的消息轮次（Messages）由后端统一在数据库中落盘和读取。此设计将状态管理职责集中于后端，避免前端缓存与后端存储不一致的双写问题。

### 4.2 会话生命周期
当前采用**前端刷新即新建会话**的策略：每次用户刷新页面或重新进入应用，前端生成全新 `session_id`，后端据此创建新的会话上下文。**暂不提供对话历史查询接口**，原因详见 `API.md` 1.4 节。

### 4.3 模型设计指导
至少需规划两大核心实体结构：
1.  **Session (会话表)**: 存储 `session_id`、创建时间、更新时间及预留的关联键（如 `user_id`）。
2.  **Message (消息表)**: 存储所属 `session_id`、角色（`user`/`assistant`）、文本内容及时间戳。

---

## 5. 非功能性需求与架构约束 (Non-Functional Requirements & Constraints)

在当前的 Demo / MVP 迭代阶段，系统需严格遵循以下开发约束，以确保架构高内聚、低耦合且避免过度设计：

### 5.1 用户管理限制 (Single-User Mode)
*   **无用户系统**: 暂不引入任何真实的用户体系（包括但不限于注册、登录、密码散列、JWT 签发及 RBAC 鉴权机制）。原因是：MVP 阶段的核心目标是验证 RAG 对话与图谱可视化的技术可行性，用户体系属于产品运营层需求，过早引入会分散有限的开发资源并增加系统复杂度。
*   **代码精简**: 严禁在当前目录结构中预先创建无业务实体的用户管理文件（如 `user_service.py`, `auth_middleware.py` 等）。空文件不仅浪费维护成本，还会给新接手的开发者传递错误的架构信号。

### 5.2 架构扩展性留白 (Extensibility)
*   **解耦设计**: 尽管当前运行于单用户模式，但底层的数据模型（ORM 实体）和业务服务层（Service Layer）必须具备横向扩展至多租户/多用户的潜力。这是一种"低成本预埋"策略——在设计阶段预留扩展点的成本远低于事后重构。
*   **表结构前瞻**: 在设计诸如 `sessions` 数据表时，强制预留 `user_id` 等租户隔离字段（当前阶段可赋默认值或空值），保证未来接入真实 IAM 系统时，核心 RAG 业务流与数据库 Schema 能够实现平滑过渡，无需产生破坏性重构。
