# M-Flow RAG 后端系统架构设计文档 (MVP/Demo 阶段)

**文档版本**: v1.5
**更新日期**: 2026-04-30
**设计原则**: 最简可行产品 (MVP)，极简设计，高内聚低耦合

---

## 1. 架构概览与技术选型确认

在 Demo 验证阶段，系统架构以"最简、快速验证核心功能"为首要原则。经过确认，核心技术栈与实现策略如下：

*   **Web 框架**: FastAPI — 轻量、高性能、原生支持异步与流式响应。选择 FastAPI 而非 Flask/Django，核心原因是其对 SSE 流式推送的一等公民支持以及自动生成 OpenAPI 文档的能力，两者分别是 RAG 对话场景和 RESTful 开发的刚需。
*   **API 设计风格**: RESTful — 所有接口以资源为中心，通过标准 HTTP 动词映射操作语义。RESTful 是当前工业界最广泛采用的 API 范式，与 FastAPI 的路由系统、Pydantic 校验层及 Swagger 文档深度契合。
*   **大语言模型集成**: 直接使用官方 `openai` Python 包，通过修改 `base_url` 接入 MiniMax-M2.7，实现最简 API 调用。之所以复用 OpenAI SDK 而非 MiniMax 专属 SDK，是为了将模型供应商锁定风险降至最低——未来切换模型时只需修改 `base_url` 与 `api_key`，业务代码无需变动。
*   **RAG 引擎 (M-Flow)**: 作为本地 Python 库（Library）直接 `import` 并在当前进程中调用，不作为独立的微服务运行。此决策的理由是：MVP 阶段为单机部署，进程内调用可消除网络序列化与反序列化开销，同时避免引入服务编排（Docker Compose / K8s）的运维复杂度。
*   **数据库与 ORM**: SQLite + **SQLAlchemy (异步模式)** + **aiosqlite**。SQLite 作为嵌入式数据库可零配置启动，适合 MVP 阶段的快速验证；SQLAlchemy 作为业界标准的 ORM 框架，其数据库抽象层保障了未来向 MySQL/PostgreSQL 的平滑迁移，核心业务代码无需修改。采用 `aiosqlite` 异步驱动而非同步 `sqlite3`，原因见下方「异步策略」。数据库初始化时默认启用 **WAL 模式**（`PRAGMA journal_mode=WAL`），使得读写操作可以并发执行（读不阻塞写、写不阻塞读），避免前端并发调用 `/api/chat`（写入）和 `/api/graph/query`（读取）时触发 `database is locked` 错误。
*   **异步策略**: 全链路采用 **`async def` 路由 + `aiosqlite` 异步数据库驱动**。选择此组合的原因是：(1) Chat 接口的 SSE 流式推送（`StreamingResponse` + 异步生成器）和 LLM 调用（`AsyncOpenAI` 的异步迭代器）都强依赖 `async def` 路由；(2) 一旦使用 `async def`，同步数据库调用会阻塞事件循环，冻结所有并发请求，因此必须配合异步数据库驱动；(3) `aiosqlite` 内部使用独立线程执行 SQLite 操作并通过 async/await 暴露给事件循环，在等待 SQLite 文件锁释放时不阻塞其他协程；(4) 未来迁移 PostgreSQL 时，只需更换 `create_async_engine` 的 URL 和驱动（如 `asyncpg`），`AsyncSession` 的业务代码无需改动。
*   **配置管理**: 采用**单个 `.env` 文件**统一存放所有配置（通过注释分区区分 M-Flow 配置与后端配置）。后端自身的配置通过 **`pydantic-settings`** 的 `BaseSettings` 类管理，M-Flow 继续通过 `python-dotenv` 的 `load_dotenv()` 读取同一文件。之所以后端使用 `pydantic-settings` 而非 `python-dotenv`，是因为：(1) 它提供强类型校验，字段声明为 `int`/`bool`/`str` 后自动转换，启动时即报错而非运行时崩溃；(2) 所有配置集中在一个 `Settings` 类中，具备完整的 IDE 类型提示与自动补全；(3) 这是 FastAPI 官方文档推荐的配置管理最佳实践。之所以不拆分为多个 `.env` 文件，是因为：`BaseSettings` 默认读取 `.env`，与 M-Flow 的 `load_dotenv()` 行为完全兼容，单文件更简单且避免了多文件间同步配置的风险。
*   **Query Rewrite 策略**: Query Rewrite **仅用于图谱查询接口** (`/api/graph/query`)。对话接口 (`/api/chat`) 不执行 Query Rewrite，因为对话接口会将完整的多轮历史连同当前提问一起发送给 LLM，模型本身具备从上下文中理解指代关系的能力。两个接口彻底解耦，互不干涉。

---

## 2. 极简项目结构设计 (Directory Structure)

为了避免过度设计，项目按逻辑职责划分目录，保持结构扁平明了。采用 **Controller - Service - Data Access** 经典三层架构的原因是：路由层（api/）与业务逻辑层（services/）的分离使得接口协议变更不会侵入业务代码，同时便于为 Service 层编写独立的单元测试。

```text
backend/
├── main.py                  # 应用程序唯一入口，挂载路由与应用级中间件
├── api/                     # 路由控制器 (Controllers)
│   ├── __init__.py
│   ├── chat.py              # POST /api/chat 对话流式接口
│   └── graph.py             # POST /api/graph/query 图谱数据接口
├── core/                    # 全局单例与外部客户端初始化
│   ├── __init__.py
│   ├── config.py            # pydantic-settings BaseSettings 配置类（读取 .env 中的后端配置）
│   └── llm.py               # 实例化基于 openai 包的 MiniMax 客户端单例
├── db/                      # 数据库与持久化层
│   ├── __init__.py
│   ├── database.py          # SQLAlchemy 异步引擎 (AsyncEngine)、异步会话工厂 (async_session)、WAL 模式初始化
│   └── models.py            # 数据表结构 (Session, Message 实体定义)
├── schemas/                 # Pydantic 数据校验模型 (DTO)
│   ├── __init__.py
│   └── payloads.py          # 存放所有的 Request/Response 模型定义 (极简合并为一)
├── services/                # 业务逻辑服务
│   ├── __init__.py
│   ├── chat_service.py      # 对话全链路逻辑 (检索 -> 组装 -> 推流 -> 落盘)
│   ├── graph_service.py     # 图谱全链路逻辑 (重写 -> 检索 -> 格式化)
│   └── mflow_client.py      # M-Flow 本地库的调用封装门面 (Facade)
├── requirements.txt         # 核心依赖清单 (fastapi, uvicorn, sqlalchemy, openai 等)
├── .env.example             # 环境变量模板
└── README.md                # 项目简介
```

---

## 3. 核心模块详细说明

### 3.1 路由层 (`api/`)
*   所有路由函数统一使用 **`async def`** 声明。本层仅做"请求接收"与"响应打包"，**禁止**在此编写复杂的业务逻辑。这样做的原因是：将 HTTP 协议细节（参数校验、状态码、SSE 封装）与业务规则（RAG 检索、Prompt 组装）解耦，使业务逻辑可在脱离 HTTP 上下文的情况下独立测试和复用。
*   依赖注入：通过 FastAPI 的 `Depends` 机制，在此处注入异步数据库 Session（`AsyncSession`），然后将其传递给 Service 层。使用依赖注入而非全局变量的原因是：确保每个请求持有独立的数据库连接生命周期，避免并发请求间的连接泄漏或状态污染。

### 3.2 业务逻辑层 (`services/`)
这是系统的核心，所有 RAG 链路的编排逻辑集中于此。
*   **`chat_service.py`**: 负责处理流式对话接口。**不执行 Query Rewrite**，因为完整的对话历史会随 Prompt 一起发送给 LLM。它依次执行：
    1. 通过 SQLAlchemy 查询对应 `session_id` 的全部历史消息（不设轮数与 Token 上限）。
    2. 将用户原始 Query 传给 `mflow_client` 获取文档上下文 (Context)。
    3. 组装 Prompt（System Prompt + History + Query），调用 LLM 获取 SSE 流式响应。
    4. 过滤 MiniMax 模型输出的 `<think>...</think>` 思维链标签（详见下方说明）。
    5. 异步将用户问题和完整回答（已清理思维链）持久化到数据库（通过 `AsyncSession`）。
    *   **System Prompt 模板**（固定角色前缀 + 动态上下文注入，最大化 KV Cache 命中率）：
        ```
        你是一位博物馆文物专家，擅长解答关于历史文物、古代工艺、文化遗产等领域的问题。
        请基于以下检索到的知识内容回答用户的问题。回答时应准确、专业，并以通俗易懂的方式表达。
        如果检索内容中没有直接相关的信息，请基于已有内容进行合理推断，但需注明推断部分。

        【检索到的知识内容】
        {context}
        ```
    *   **SSE yield 格式**：`stream_chat()` 是一个异步生成器，yield `{"event": "message"|"error", "data": "<JSON>"}` 格式的 dict，供路由层的 `EventSourceResponse` 直接消费。
*   **`graph_service.py`**: 负责处理知识图谱渲染接口。**独立执行 Query Rewrite**，与 Chat 接口彻底解耦。
    1. 查询全部历史（用于重写）。
    2. **跳过策略**：首先由后端代码判定 session 内是否有历史消息——若无历史（首轮对话）则跳过重写，直接使用原始 query；若有历史，则调用 LLM 进行 Query Rewrite（Prompt 中指示"如果当前提问语义已充分独立，则原样返回"），输出为**纯文本**。
    3. 清理 LLM 返回结果中的 `<think>...</think>` 思维链标签。
    4. 将独立 Query 传给 `mflow_client`，专门请求图谱节点与边。
    5. 返回包含 `graphId`、`centerNodeId`、`nodes`、`edges` 的完整 Graph JSON。
    *   **Query Rewrite System Prompt**：
        ```
        你是一个查询重写助手。你的任务是将用户的提问重写为一个语义完备的独立句子，
        消除其中的代词和模糊指代。
        如果当前提问的语义已经充分独立，不存在需要消解的指代，则原样返回用户的提问。
        只输出重写后的句子，不要添加任何解释或格式。
        ```
*   **`mflow_client.py`**: 适配器 / 门面（Facade）。将 M-Flow 本地库的具体 API 调用封装为语义清晰的函数。引入 Facade 层的原因是：隔离底层 SDK 的实现细节与版本变更风险，使上层 Service 代码不直接耦合于 M-Flow 的内部 API 签名。
    *   **上下文检索**: 使用 `m_flow.search(query, query_type=RecallMode.EPISODIC)` 获取相关的片段内容。
    *   **图谱检索**: 使用 `m_flow.search(query, query_type=RecallMode.TRIPLET_COMPLETION, verbose=True)` 获取包含节点与边的 `CombinedSearchResult` 对象。
    *   **数据映射逻辑**:
        *   **`graphId`**: 由后端基于查询字符串的 Hash (如 SHA-256) 生成，确保同一查询在前端具有稳定的图谱标识。
        *   **`nodeType` 过滤与映射**: M-Flow 返回的 `type` 字段可能包含内置类型或原始数据类型。后端需执行：(1) 过滤掉 M-Flow 的内置系统节点类型；(2) 将剩余类型映射至 `API.md` 定义的 12 种标准业务类型（如 `artifact`, `dynasty`）；(3) 对于无法匹配的类型，统一降级为 `other` 标识。
        *   **`centerNodeId`**: 由后端选取检索结果中权重最高或首个 `artifact` 类型节点的 ID 作为中心。
        *   **`edges`**: 将 M-Flow 的关系转换为带唯一 ID（如 `f"{source}_{label}_{target}"`）的标准 `GraphEdge`。

> **MiniMax 思维链标签处理**: MiniMax-M2.7 在推理时会输出 `<think>...</think>` 包裹的思维链内容。流式场景下思维链可能跨越多个 chunk，`chat_service.py` 使用布尔状态标记 `_in_think` 逐 chunk 追踪过滤；非流式场景（Query Rewrite）使用正则 `re.sub` 清理。消息落盘前也会做防御性正则清理。详见 `README.md` 中的兼容性问题说明。

### 3.3 数据模型设计 (`db/models.py`)
采用 SQLAlchemy 声明式映射（Declarative Mapping），其优势在于将数据表结构与 Python 类一一对应，代码即文档，同时获得 IDE 的类型提示与自动补全支持：
*   **`Session` 表**:
    *   `id`: String (主键，前端生成的 session_id)
    *   `user_id`: String (Nullable, **预留多租户字段** — 当前赋默认值，未来接入用户体系时可直接关联，无需变更表结构)
    *   `created_at`: DateTime
*   **`Message` 表**:
    *   `id`: Integer (主键，自增)
    *   `session_id`: String (外键关联 Session.id)
    *   `role`: String (枚举: "user" | "assistant")
    *   `content`: Text
    *   `created_at`: DateTime

> **会话生命周期说明**: 当前采用"前端刷新即新建会话"策略，暂不提供对话历史查询接口。详见 `API.md` 1.4 节。

### 3.4 大模型集成 (`core/llm.py`)
采用全局异步客户端单例模式。使用单例而非每次请求实例化的原因是：`AsyncOpenAI` 内部维护了 HTTP 连接池，单例可复用连接，减少 TCP 握手开销。
```python
from openai import AsyncOpenAI
from core.config import settings

# 全局异步客户端单例
client = AsyncOpenAI(
    api_key=settings.MINIMAX_API_KEY,
    base_url="https://api.minimax.chat/v1" # 依据实际开放平台地址配置
)
```

---

## 4. 后续开发路径 (Next Steps)

按照 MVP 原则，接下来的开发分为以下步骤执行：

1.  **基础设施搭建**: 生成 `requirements.txt` 并创建项目基础目录骨架。编写 `db/database.py` 和 `core/config.py`，打通 SQLite 与环境变量。
2.  **数据模型确立**: 完成 `db/models.py` 与 `schemas/payloads.py`，确保请求参数能被校验，聊天记录能被存储。
3.  **核心 Service 联调**: 编写 `mflow_client.py` (使用 Mock 数据模拟 M-Flow) 与 `core/llm.py` (连通真实的 MiniMax 接口测试 Query Rewrite)。
4.  **接口与流式组装**: 完成 `chat_service.py` 和 `api/chat.py` 的 SSE 协议支持，实现完整的问答闭环。
5.  **图谱接口闭环**: 完成独立、解耦的 `/api/graph/query` 接口（含 Query Rewrite 逻辑）。
6.  **替换 M-Flow Mock**: 最终接入真实的 M-Flow 本地 SDK 逻辑。
