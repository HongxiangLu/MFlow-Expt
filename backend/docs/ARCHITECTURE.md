# M-Flow RAG 后端系统架构设计文档 (MVP/Demo 阶段)

**文档版本**: v2.0
**更新日期**: 2026-05-07
**设计原则**: 最简可行产品 (MVP)，极简设计，高内聚低耦合

---

## 1. 架构概览与技术选型确认

在 Demo 验证阶段，系统架构以"最简、快速验证核心功能"为首要原则。经过确认，核心技术栈与实现策略如下：

*   **Web 框架**: FastAPI — 轻量、高性能、原生支持异步与流式响应。选择 FastAPI 而非 Flask/Django，核心原因是其对 SSE 流式推送的一等公民支持以及自动生成 OpenAPI 文档的能力，两者分别是 RAG 对话场景和 RESTful 开发的刚需。
*   **API 设计风格**: RESTful — 所有接口以资源为中心，通过标准 HTTP 动词映射操作语义。RESTful 是当前工业界最广泛采用的 API 范式，与 FastAPI 的路由系统、Pydantic 校验层及 Swagger 文档深度契合。
*   **大语言模型集成**: 直接使用官方 `openai` Python 包，通过修改 `base_url` 接入 MiniMax-M2.7，实现最简 API 调用。之所以复用 OpenAI SDK 而非 MiniMax 专属 SDK，是为了将模型供应商锁定风险降至最低——未来切换模型时只需修改 `base_url` 与 `api_key`，业务代码无需变动。
*   **RAG 引擎 (M-Flow)**: 作为本地 Python 库（Library）直接 `import` 并在当前进程中调用，不作为独立的微服务运行。此决策的理由是：MVP 阶段为单机部署，进程内调用可消除网络序列化与反序列化开销，同时避免引入服务编排（Docker Compose / K8s）的运维复杂度。
*   **数据库与 ORM**: SQLite + **SQLAlchemy (异步模式)** + **aiosqlite**。SQLite 作为嵌入式数据库可零配置启动，适合 MVP 阶段的快速验证；SQLAlchemy 作为业界标准的 ORM 框架，其数据库抽象层保障了未来向 MySQL/PostgreSQL 的平滑迁移，核心业务代码无需修改。采用 `aiosqlite` 异步驱动而非同步 `sqlite3`，原因见下方「异步策略」。数据库初始化时默认启用 **WAL 模式**（`PRAGMA journal_mode=WAL`），使得读写操作可以并发执行（读不阻塞写、写不阻塞读），避免前端并发调用 `/api/chat`（写入）和 `/api/graph/query`（读取）时触发 `database is locked` 错误。
*   **异步策略**: 全链路采用 **`async def` 路由 + `aiosqlite` 异步数据库驱动**。选择此组合的原因是：(1) Chat 接口的 SSE 流式推送（`EventSourceResponse` + 异步生成器）和 LLM 调用（`AsyncOpenAI` 的异步迭代器）都强依赖 `async def` 路由；(2) 一旦使用 `async def`，同步数据库调用会阻塞事件循环，冻结所有并发请求，因此必须配合异步数据库驱动；(3) `aiosqlite` 内部使用独立线程执行 SQLite 操作并通过 async/await 暴露给事件循环，在等待 SQLite 文件锁释放时不阻塞其他协程；(4) 未来迁移 PostgreSQL 时，只需更换 `create_async_engine` 的 URL 和驱动（如 `asyncpg`），`AsyncSession` 的业务代码无需改动。
*   **配置管理**: 采用**单个 `.env` 文件**统一存放所有配置（通过注释分区区分 M-Flow 配置与后端配置）。后端自身的配置通过 **`pydantic-settings`** 的 `BaseSettings` 类管理，M-Flow 继续通过 `python-dotenv` 的 `load_dotenv()` 读取同一文件。之所以后端使用 `pydantic-settings` 而非 `python-dotenv`，是因为：(1) 它提供强类型校验，字段声明为 `int`/`bool`/`str` 后自动转换，启动时即报错而非运行时崩溃；(2) 所有配置集中在一个 `Settings` 类中，具备完整的 IDE 类型提示与自动补全；(3) 这是 FastAPI 官方文档推荐的配置管理最佳实践。之所以不拆分为多个 `.env` 文件，是因为：`BaseSettings` 默认读取 `.env`，与 M-Flow 的 `load_dotenv()` 行为完全兼容，单文件更简单且避免了多文件间同步配置的风险。
*   **Query Rewrite 策略**: Query Rewrite **仅用于图谱查询接口** (`/api/graph/query`)。对话接口 (`/api/chat`) 不执行 Query Rewrite，因为对话接口会将完整的多轮历史连同当前提问一起发送给 LLM，模型本身具备从上下文中理解指代关系的能力。两个接口彻底解耦，互不干涉。
*   **CORS 策略（MVP）**: 当前阶段统一采用 `allow_origins=["*"]` 放开跨域，优先保证前后端联调效率；同时设置 `allow_credentials=False`，降低开放跨域下的凭据风险。生产阶段再收敛为白名单域名。
*   **Uvicorn 启动约定（开发环境）**: 固定使用 `uvicorn main:app --reload --host 0.0.0.0 --port 8000`，确保本机与局域网调试入口一致，并保留热重载能力。
*   **日志策略（MVP）**: 统一采用 Python 标准库 `logging`，当前不引入 `loguru` 等第三方日志框架，避免在验证期增加额外依赖与迁移成本。日志基础设施集中在 `core/logging.py` 模块中，提供：(1) 基于 ANSI 转义序列的彩色终端输出（时间戳灰色、INFO/模块名蓝色、WARNING 黄色、ERROR 红色）；(2) `preview_text()` 工具函数，用于在日志中安全输出长文本的截断预览（超出部分追加 `......` 省略标识）；(3) `setup_logging()` 一次性初始化函数，由 `main.py` 在模块顶层调用。

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
├── core/                    # 全局单例、配置与通用工具
│   ├── __init__.py
│   ├── config.py            # pydantic-settings BaseSettings 配置类（读取 .env 中的后端配置）
│   ├── llm.py               # 实例化基于 openai 包的 MiniMax 客户端单例
│   └── logging.py           # 日志基础设施（彩色 Formatter、preview_text、setup_logging）
├── db/                      # 数据库与持久化层
│   ├── __init__.py
│   ├── database.py          # SQLAlchemy 异步引擎 (AsyncEngine)、异步会话工厂 (async_session)、WAL 模式初始化
│   └── models.py            # 数据表结构 (ChatSession, Message 实体定义)
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
├── tests/                   # 测试目录
├── tools/                   # 开发辅助脚本（非运行时业务模块）
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
    4. 将模型返回的增量文本进一步按**单字符**拆分后逐帧下发，形成稳定的“逐字打字机”效果。
    5. 过滤 MiniMax 模型输出的 `<think>...</think>` 思维链标签（详见下方说明）。
    6. 异步将用户问题和完整回答（已清理思维链）持久化到数据库（通过 `AsyncSession`）。
    *   **System Prompt 模板**（固定角色前缀 + 动态上下文注入，最大化 KV Cache 命中率）：
        ```
        你是一位博物馆文物专家，擅长解答关于历史文物、古代工艺、文化遗产等领域的问题。
        请基于以下检索到的知识内容回答用户的问题。回答时应准确、专业，并以通俗易懂的方式表达。
        如果检索内容中没有直接相关的信息，请基于已有内容进行合理推断，但需注明推断部分。

        【检索到的知识内容】
        {context}
        ```
    *   **SSE yield 格式**：`stream_chat()` 是一个异步生成器，yield `{"event": "message"|"error", "data": "<JSON>"}` 格式的 dict，供路由层的 `EventSourceResponse` 直接消费；其中正常消息帧按**单字符粒度**发送。
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
        *   **`centerNodeId`**: 由后端优先选取首个 `artifact` 类型节点；若不存在 `artifact`，则降级选取结果中的首个节点。
        *   **`edges`**: 将 M-Flow 的关系转换为带唯一 ID（如 `f"{source}_{label}_{target}"`）的标准 `GraphEdge`。
    *   **图谱后处理过滤层** (`_filter_graph_nodes_and_edges`)：
        M-Flow 图数据库返回的原始图谱数据中存在两类前端展示问题：(1) 不同节点可能具有相同的显示名称 (label)，导致前端力导向图中出现重叠或语义混淆；(2) 部分节点的 label 为纯 ASCII 标识符（如 M-Flow 内部生成的 Episode ID、系统占位符），不适合直接展示给终端用户。因此在原始数据解析完成后、构建最终 `GraphResponse` 之前，插入一层后处理过滤，按以下顺序严格执行三阶段清洗：

        1.  **ASCII 过滤**（节点级）：移除 `label.isascii() == True` 的节点。判定标准为 Python 内置的 `str.isascii()` 方法，即字符串中所有字符的 Unicode 码点均在 U+0000~U+007F 范围内（涵盖英文字母、数字、ASCII 标点）。被过滤的典型示例：`"Episode_42"`、`"bronze_vessel"`、`"has_part"`；保留的典型示例：`"青铜器"`、`"商代(Shang)"`、`"鼎·簋组合"`。

        2.  **同名去重**（节点级，基于 label 聚合）：对具有相同 label 的节点，仅保留 M-Flow **原始类型** (`raw_type`) 优先级最高的一个。优先级映射表如下（数值越小优先级越高）：

            | M-Flow 原始类型 | 优先级 | 说明 |
            |:---|:---:|:---|
            | `Episode`   | 0 | 语义切分单元，信息密度最高 |
            | `Facet`     | 1 | Episode 下的主题切面 |
            | `FacetPoint`| 2 | Facet 的细粒度信息点 |
            | `Entity`    | 3 | 原子实体节点 |
            | 其他         | 99 | 默认最低优先级 |

            > **设计决策**：去重基于映射前的 M-Flow 原始类型而非映射后的业务类型 (`nodeType`)，因为 Episode/Facet/FacetPoint/Entity 在 `STANDARD_NODE_TYPES` 映射后均归为 `"other"`，无法区分优先级。为此在节点 dict 中注入 `_raw_type` 临时字段传递原始类型信息，过滤完成后通过 `dict.pop()` 自动清理，确保不泄露到最终的 API 响应中。

        3.  **悬挂边清理**（边级）：上述两步可能删除部分节点，导致某些边的 `source` 或 `target` 指向不存在的节点（即"悬挂边" / dangling edge）。此步骤利用过滤后的有效节点 ID 集合高效过滤掉所有悬挂边，保持图结构的引用完整性。

        > **数据流位置**：过滤层位于 `mflow_client.get_graph()` 内部，在 M-Flow 原始 `graphs` 数据解析完成（节点/边列表构建完毕）之后、`graphId` 生成与 `centerNodeId` 选举之前。过滤层仅在 Facade 层内部使用，不暴露给上层 `graph_service.py` 或 Controller 层。

> **MiniMax 思维链标签处理**: MiniMax-M2.7 在推理时会输出 `<think>...</think>` 包裹的思维链内容。流式场景下思维链可能跨越多个 chunk，`chat_service.py` 使用布尔状态标记 `_in_think` 逐 chunk 追踪过滤；非流式场景（Query Rewrite）使用正则 `re.sub` 清理。消息落盘前也会做防御性正则清理。详见 `README.md` 中的兼容性问题说明。

### 3.3 数据模型设计 (`db/models.py`)
采用 SQLAlchemy 声明式映射（Declarative Mapping），其优势在于将数据表结构与 Python 类一一对应，代码即文档，同时获得 IDE 的类型提示与自动补全支持：
*   **`ChatSession` 表**:
    *   `id`: String (主键，前端生成的 session_id)
    *   `user_id`: String (Nullable, **预留多租户字段** — 当前赋默认值，未来接入用户体系时可直接关联，无需变更表结构)
    *   `created_at`: DateTime
*   **`Message` 表**:
    *   `id`: Integer (主键，自增)
    *   `session_id`: String (外键关联 ChatSession.id)
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
    base_url=settings.MINIMAX_BASE_URL  # 统一由配置中心管理
)
```

---

## 4. M-Flow 检索降时策略（性能优化专项）

为降低 `/api/chat` 与 `/api/graph/query` 的检索耗时，后端在不破坏接口契约的前提下，优先采用“先减无效计算、再缩搜索空间”的策略。

### 4.1 快速模式切换：`EPISODIC` → `CHUNKS_LEXICAL`（针对 Chat 上下文检索）

**结论**：代码改动量小，主要是 `query_type` 的切换与返回文本抽取逻辑的适配，不涉及路由层与 LLM 调用链重构。

*   **改动面评估（低）**：
    1. `mflow_client.get_context()` 中，将 `RecallMode.EPISODIC` 切换为 `RecallMode.CHUNKS_LEXICAL`（`m_flow/search/types/RecallMode.py`）。
    2. 由于 lexical 返回的上下文形态更偏向原始文本块/对象列表，建议在 Facade 层做统一文本抽取，确保传给 LLM 的仍是 `list[str]`。
    3. `chat_service.py` 无需改协议；其本质只消费 `list[str]` 并拼接为 Prompt。

*   **对“传给大模型的上下文”影响**：
    *   只要 Facade 继续输出纯文本列表，LLM 下游流程不变。
    *   变化在于上下文来源从“情境记忆图检索”转为“词法匹配文本块检索”。

*   **检索质量影响**：
    *   **优点**：关键词命中类问题速度更快、可解释性更直观（匹配到哪些文本块）。
    *   **代价**：跨句推理、隐式指代、图结构关联能力弱于 EPISODIC/TRIPLET，复杂问题召回质量可能下降。
    *   **工程建议**：优先用于首轮、短问句、强关键词查询；复杂查询可回退 EPISODIC（分层策略）。

*   **当前现状（已落地）**：后端 `services/mflow_client.py` 的 `get_context()` 已全量切换为 `RecallMode.CHUNKS_LEXICAL`，同时移除了仅对 EPISODIC 有意义的 `display_mode` 和 `wide_search_top_k` 传参。图谱检索 `get_graph()` 保持 `TRIPLET_COMPLETION` 不变。

### 4.2 缩小检索范围：可控参数清单（基于 m_flow 源码）

以下参数来自 `m_flow.api.v1.search.search()` 与 `m_flow.search.methods.get_recall_mode_tools()` / 各 retriever 实现，可直接用于降时：

1. **`top_k`**（通用）
   * 含义：最终返回结果数。
   * 建议：Chat 场景可从 10 下调到 3~5，显著减少上下文长度与后续 LLM 开销。
   * **当前现状（已落地）**：后端 `services/mflow_client.py` 已统一设置 `top_k=5`（`get_context` 与 `get_graph` 调用均显式传参）。

2. **`wide_search_top_k`**（EPISODIC/TRIPLET 核心）
   * 含义：向量召回阶段的候选池大小（粗召回）。
   * 位置：`search()` → `get_recall_mode_tools()` → `UnifiedTripletSearch` / `EpisodicConfig`。
   * 建议：从 100 下调到 30~60，通常能明显降低向量检索与图投影耗时。
   * **当前现状（已落地）**：后端 `services/mflow_client.py` 已设置 `wide_search_top_k=30`（仅 `get_graph` 生效；`get_context` 切换至 `CHUNKS_LEXICAL` 后不再需要此参数）。

3. **`collections`**（EPISODIC/TRIPLET）
   * 含义：限定要检索的向量集合字段。
   * 位置：`UnifiedTripletSearch.get_triplets()`、`fine_grained_triplet_search()`。
   * 建议：按业务收敛集合（例如仅保留 `Episode_summary`、`Entity_name` 等高价值字段），减少并行集合搜索数量。

4. **`only_context`**（通用，强建议开启）
   * 含义：只返回检索上下文，不做 completion 生成。
   * 作用：避免检索阶段触发不必要的生成链路，缩短端到端延迟。
   * **当前现状（已落地）**：后端 `services/mflow_client.py` 已在 `get_context` 与 `get_graph` 调用中开启 `only_context=True`。

5. **`display_mode` / `max_facets_per_episode` / `max_points_per_facet`**（EPISODIC）
   * 含义：控制 episodic 输出粒度与上下文体积。
   * 建议：优先 `display_mode="summary"`，并降低 facet/point 上限，减少序列化与 Prompt 膨胀。
   * **当前现状（已落地）**：后端 `services/mflow_client.py` 已设置 `display_mode="summary"`（仅 `get_graph` 图谱链路保持兼容传参；`get_context` 切换至 `CHUNKS_LEXICAL` 后不再需要此参数）。

6. **`enable_hybrid_search` / `enable_time_bonus` / `enable_adaptive_weights`**（EPISODIC）
   * 含义：启用额外检索与重排增强能力（质量优先，但计算更重）。
   * 建议：延迟敏感场景可按需关闭部分增强项。

7. **`triplet_distance_penalty`、`hop_cost`、`edge_miss_cost`**（图路径/重排相关）
   * 含义：控制图距离与路径代价。
   * 说明：主要影响排序与扩散行为；虽非直接“限流参数”，但会影响有效候选规模与重排计算量。

### 4.3 加结果缓存（后端）

**策略**：为 `mflow_client.get_context()` 与 `mflow_client.get_graph()` 增加短 TTL 缓存（内存缓存优先，后续可替换 Redis），缓存键建议至少包含 `query_text + recall_mode + top_k + collections` 等检索关键参数。

*   **可行性评估（高）**：
    1. 代码侵入低，主要集中在 Facade 层（`services/mflow_client.py`），不影响 API 协议。
    2. 可先采用进程内缓存（如 `cachetools.TTLCache`）快速落地，再按部署规模演进到集中缓存。
    3. 需定义失效策略：知识库更新（memorize/add）后主动失效，避免旧数据命中。

*   **降时效果评估**：
    *   **命中场景**（重复问句、会话内追问、并发相同查询）通常收益显著，检索耗时可降至毫秒级缓存读取。
    *   **未命中场景**无收益，但不会引入额外远程开销（本地缓存判定开销很低）。
    *   对长尾随机查询收益有限，主要改善热点与抖动。

### 4.4 减少日志体积（后端）

**策略**：对检索与流式链路日志做分级与采样，避免在 INFO 级别打印大对象全文（如完整 M-Flow 原始结果、完整 SSE 单字帧）。

*   **可行性评估（高）**：
    1. 仅涉及日志语句调整，不改变业务逻辑。
    2. 可采用“摘要日志”模式：记录 `count/latency/preview/hash`，将完整正文下沉到 DEBUG。
    3. 与现有标准 `logging` 完全兼容，无需新增依赖。

*   **降时效果评估**：
    *   当日志量大（尤其逐字 SSE + 大结果对象）时，I/O 与字符串序列化成本会显著拖慢请求；收敛日志可带来稳定降时。
    *   在低日志量场景收益中等，但可明显降低控制台噪声与磁盘写放大。
*   **当前现状（已落地）**：
    *   日志基础设施已从 `main.py` 抽离至独立模块 `core/logging.py`，包含彩色终端格式化器 (`_ColoredFormatter`)、截断预览工具 (`preview_text`) 及一次性初始化函数 (`setup_logging`)。
    *   `chat_service.py`、`graph_service.py`、`mflow_client.py` 已全面采用 `preview_text()` 对 query、LLM 输出、图谱节点/边映射等潜在长文本进行截断预览，超出部分追加 `......` 省略标识。
    *   终端输出按等级着色（INFO 蓝色、WARNING 黄色、ERROR 红色），时间戳精确到秒（灰色），每条日志末尾追加空行以提升可读性。

### 4.5 前端并发策略优化（调用编排）

**策略**：降低前端对 `/api/chat` 与 `/api/graph/query` 的“无条件并发”强度，采用分阶段触发：
1. 先发 `/api/chat`，待首批 token 到达后再触发图谱请求；
2. 对短输入/低置信度输入可延迟或跳过图谱请求；
3. 对相同 query 的并发请求做前端去重（in-flight dedup）。

*   **可行性评估（中高）**：
    1. 主要改前端调度逻辑，后端 API 无需改协议。
    2. 可逐步灰度：先加去重与延迟触发，再评估是否引入更复杂策略（如 query 分类）。
    3. 需要前端状态管理配合（请求生命周期、取消策略、重试策略）。

*   **降时效果评估**：
    *   单用户体感：可减少首屏卡顿与资源争抢，提升首 token 到达速度稳定性。
    *   系统层面：可降低 M-Flow 突发并发压力，减少高峰时长尾延迟。
    *   代价：图谱展示可能略晚于文本回答，需要产品侧确认体验优先级。

> 备注：源码显示 `fine_grained_triplet_search()` 中 `wide_search_top_k` 会直接影响各 collection 的向量检索 `limit`，是最直接的耗时杠杆之一。

### 4.6 统一耗时埋点（可观测性增强）

**策略**：在检索、重写、LLM 生成等关键链路节点通过 `time.perf_counter()` 打上精确计时，输出结构化的性能日志，为后续优化提供数据支撑。

*   **可行性评估（高）**：
    1. 仅新增计时逻辑，不改变业务流程与接口契约。
    2. `time.perf_counter()` 为 Python 标准库函数，无额外依赖。
    3. 日志格式统一为 `操作描述: {elapsed:.2f}s`，便于后续正则提取与聚合分析。

*   **覆盖范围**：
    *   `services/mflow_client.py`：`get_context()` 检索耗时、`get_graph()` 检索耗时。
    *   `services/graph_service.py`：Query Rewrite LLM 调用耗时、图谱查询全链路端到端耗时。
    *   `services/chat_service.py`：M-Flow 检索阶段耗时、LLM 首 token 到达耗时、LLM 全流程耗时。

*   **当前现状（已落地）**：上述所有埋点已在对应模块中实现，日志示例：
    ```
    M-Flow context 检索耗时: 0.35s | type=<class 'list'>, raw_count=5
    M-Flow graph 检索耗时: 2.18s | type=<class 'CombinedSearchResult'>
    Query Rewrite LLM 调用耗时: 1.05s
    LLM 首 token 耗时: 0.82s | session_id=sess-xxx
    MiniMax 流式输出结束: session_id=sess-xxx, answer_length=256, LLM总耗时=3.41s
    图谱查询全链路耗时: 3.58s | session_id=sess-xxx
    ```

---

## 5. 当前实施现状与后续建议 (Current State & Next Steps)

当前代码已完成 MVP 主链路落地（真实 M-Flow 接入、SSE 单字符流、图谱查询与 Query Rewrite 解耦、日志摘要化与检索参数收敛），并已完成首轮性能优化（Chat 检索模式切换至 CHUNKS_LEXICAL、统一耗时埋点）。

后续建议聚焦于性能与工程化增强：

1.  **缓存落地**：在 `services/mflow_client.py` 增加短 TTL 缓存（如 `cachetools.TTLCache`），优先覆盖热点重复查询。
2.  **检索策略分层**：基于耗时埋点数据，评估是否需要按查询复杂度在 `CHUNKS_LEXICAL` 与 `EPISODIC` 间动态切换，平衡速度与质量。
3.  **前端并发治理**：优化 `/api/chat` 与 `/api/graph/query` 的触发时机，减少资源争抢。

