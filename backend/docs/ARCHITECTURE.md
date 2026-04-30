# M-Flow RAG 后端系统架构设计文档 (MVP/Demo 阶段)

**文档版本**: v1.1
**更新日期**: 2026-04-30
**设计原则**: 最简可行产品 (MVP)，极简设计，高内聚低耦合

---

## 1. 架构概览与技术选型确认

在 Demo 验证阶段，系统架构以"最简、快速验证核心功能"为首要原则。经过确认，核心技术栈与实现策略如下：

*   **Web 框架**: FastAPI — 轻量、高性能、原生支持异步与流式响应。选择 FastAPI 而非 Flask/Django，核心原因是其对 SSE 流式推送的一等公民支持以及自动生成 OpenAPI 文档的能力，两者分别是 RAG 对话场景和 RESTful 开发的刚需。
*   **API 设计风格**: RESTful — 所有接口以资源为中心，通过标准 HTTP 动词映射操作语义。RESTful 是当前工业界最广泛采用的 API 范式，与 FastAPI 的路由系统、Pydantic 校验层及 Swagger 文档深度契合。
*   **大语言模型集成**: 直接使用官方 `openai` Python 包，通过修改 `base_url` 接入 MiniMax-M2.7，实现最简 API 调用。之所以复用 OpenAI SDK 而非 MiniMax 专属 SDK，是为了将模型供应商锁定风险降至最低——未来切换模型时只需修改 `base_url` 与 `api_key`，业务代码无需变动。
*   **RAG 引擎 (M-Flow)**: 作为本地 Python 库（Library）直接 `import` 并在当前进程中调用，不作为独立的微服务运行。此决策的理由是：MVP 阶段为单机部署，进程内调用可消除网络序列化与反序列化开销，同时避免引入服务编排（Docker Compose / K8s）的运维复杂度。
*   **数据库与 ORM**: SQLite + **SQLAlchemy**。SQLite 作为嵌入式数据库可零配置启动，适合 MVP 阶段的快速验证；SQLAlchemy 作为业界标准的 ORM 框架，其数据库抽象层保障了未来向 MySQL/PostgreSQL 的平滑迁移，核心业务代码无需修改。
*   **接口并发与解耦策略**: 针对前端并发请求的 `/api/chat` 和 `/api/graph/query`，后端采用**彻底解耦 (方案 A)**。两个接口各自独立维护完整的处理链路（包括各自独立的 Query Rewrite 步骤），互不干涉。此举牺牲了少量的 Token 成本，但最大化了代码的稳定性和简单性，避免了复杂的并发状态锁问题，符合 MVP 阶段"稳定性优先于成本优化"的工程策略。

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
│   ├── config.py            # 读取 .env 环境变量
│   └── llm.py               # 实例化基于 openai 包的 MiniMax 客户端单例
├── db/                      # 数据库与持久化层
│   ├── __init__.py
│   ├── database.py          # SQLAlchemy 引擎 (Engine) 与会话工厂 (SessionLocal)
│   └── models.py            # 数据表结构 (Session, Message 实体定义)
├── schemas/                 # Pydantic 数据校验模型 (DTO)
│   ├── __init__.py
│   └── payloads.py          # 存放所有的 Request/Response 模型定义 (极简合并为一)
├── services/                # 业务逻辑服务
│   ├── __init__.py
│   ├── chat_service.py      # 对话全链路逻辑 (重写 -> 检索 -> 组装 -> 推流 -> 落盘)
│   ├── graph_service.py     # 图谱全链路逻辑 (重写 -> 检索 -> 格式化)
│   └── mflow_client.py      # M-Flow 本地库的调用封装门面 (Facade)
├── requirements.txt         # 核心依赖清单 (fastapi, uvicorn, sqlalchemy, openai 等)
├── .env.example             # 环境变量模板
└── README.md                # 项目简介
```

---

## 3. 核心模块详细说明

### 3.1 路由层 (`api/`)
*   本层仅做"请求接收"与"响应打包"，**禁止**在此编写复杂的业务逻辑。这样做的原因是：将 HTTP 协议细节（参数校验、状态码、SSE 封装）与业务规则（Query Rewrite、RAG 检索、Prompt 组装）解耦，使业务逻辑可在脱离 HTTP 上下文的情况下独立测试和复用。
*   依赖注入：通过 FastAPI 的 `Depends` 机制，在此处注入数据库 Session，然后将其传递给 Service 层。使用依赖注入而非全局变量的原因是：确保每个请求持有独立的数据库连接生命周期，避免并发请求间的连接泄漏或状态污染。

### 3.2 业务逻辑层 (`services/`)
这是系统的核心，所有 RAG 链路的编排逻辑集中于此。
*   **`chat_service.py`**: 负责处理流式对话接口。它依次执行：
    1. 通过 SQLAlchemy 查询对应 `session_id` 的近期历史消息。
    2. 调用 LLM 进行 Query Rewrite (使其成为独立语义)。
    3. 将独立 Query 传给 `mflow_client` 获取文档上下文 (Context)。
    4. 组装 Prompt，调用 LLM 获取 SSE 流式响应。
    5. 异步/同步将用户问题和完整回答持久化到数据库。
*   **`graph_service.py`**: 负责处理知识图谱渲染接口。链路与 Chat 类似但**互相独立**（各自执行 Query Rewrite），两者解耦的原因详见第 1 节的"接口并发与解耦策略"。
    1. 查询近期历史（用于重写）。
    2. 调用 LLM 进行 Query Rewrite。
    3. 将独立 Query 传给 `mflow_client`，专门请求图谱节点与边。
    4. 返回包含 `graphId`、`centerNodeId`、`nodes`、`edges` 的完整 Graph JSON。
*   **`mflow_client.py`**: 适配器 / 门面（Facade）。将 M-Flow 本地库的具体 API 调用封装为语义清晰的函数（如 `get_context(query)`, `get_graph(query)`）。引入 Facade 层的原因是：隔离底层 SDK 的实现细节与版本变更风险，使上层 Service 代码不直接耦合于 M-Flow 的内部 API 签名。

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
5.  **图谱接口闭环**: 完成独立、解耦的 `/api/graph/query` 接口。
6.  **替换 M-Flow Mock**: 最终接入真实的 M-Flow 本地 SDK 逻辑。
