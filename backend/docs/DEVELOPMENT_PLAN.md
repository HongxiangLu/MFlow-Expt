# M-Flow RAG 后端 — 分阶段开发计划

**文档版本**: v1.0
**编制日期**: 2026-04-30
**参考文档**: [REQUIREMENTS.md](./REQUIREMENTS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [API.md](./API.md)

---

## 开发方法论

对于这种 **Controller → Service → Data Access** 三层架构，业界推荐的开发顺序是 **自底向上（Bottom-Up）**：

```
Phase 1        Phase 2        Phase 3        Phase 4        Phase 5        Phase 6        Phase 7
基础设施层  →  数据访问层  →  外部集成层  →  业务逻辑层  →  路由控制层  →  应用入口    →  集成测试
```

> **为什么自底向上？** 上层模块（Service、Router）依赖下层模块（Config、DB、LLM Client）。先完成底层可以让上层开发时直接调用真实依赖，而非依赖大量 Mock，减少后期返工。每完成一层都可以独立验证，形成可靠的"积木"。

---

## Phase 1 — 项目骨架与配置系统

**目标**: 创建目录结构，让 `from core.config import settings` 可用。

### 产出文件

| 文件 | 职责 |
|:---|:---|
| `main.py` | 空壳入口，仅 `print("app created")` |
| `api/__init__.py` | 空 |
| `core/__init__.py` | 空 |
| `core/config.py` | `pydantic-settings` BaseSettings 类 |
| `db/__init__.py` | 空 |
| `schemas/__init__.py` | 空 |
| `services/__init__.py` | 空 |

### `core/config.py` 关键设计

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # --- 后端 LLM ---
    MINIMAX_API_KEY: str
    MINIMAX_BASE_URL: str = "https://api.minimax.chat/v1"
    MINIMAX_MODEL: str = "MiniMax-M2.7"

    # --- 后端 DB ---
    BACKEND_DB_PATH: str = "./.runtime/backend.db"

    # --- Uvicorn ---
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
```

> `extra = "ignore"` 是关键：`.env` 中包含大量 M-Flow 配置项（如 `EMBEDDING_API_KEY`），若不忽略将导致 `ValidationError`。

### 验证方式

```bash
python -c "from core.config import settings; print(settings.MINIMAX_MODEL)"
```

---

## Phase 2 — 数据访问层

**目标**: 数据库引擎初始化、ORM 模型定义，让 `Session` 和 `Message` 表可以被创建和查询。

**依赖**: Phase 1 (`settings.BACKEND_DB_PATH`)

### 产出文件

| 文件 | 职责 |
|:---|:---|
| `db/database.py` | `AsyncEngine` + `async_sessionmaker` + WAL 初始化 |
| `db/models.py` | `ChatSession` 和 `Message` ORM 模型 |

### `db/database.py` 关键设计

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import event

engine = create_async_engine(f"sqlite+aiosqlite:///{settings.BACKEND_DB_PATH}")

# WAL 模式：在每个底层 DBAPI 连接建立时设置
@event.listens_for(engine.sync_engine, "connect")
def _set_wal(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()

async_session = async_sessionmaker(engine, expire_on_commit=False)
```

### `db/models.py` 关键设计

按 ARCHITECTURE.md §3.3 定义：

| 表 | 字段 | 类型 | 说明 |
|:---|:---|:---|:---|
| `ChatSession` | `id` | String PK | 前端生成的 UUID |
| | `user_id` | String, Nullable | 预留多租户 |
| | `created_at` | DateTime | 自动生成 |
| `Message` | `id` | Integer PK | 自增 |
| | `session_id` | String FK | → ChatSession.id |
| | `role` | String | `"user"` / `"assistant"` |
| | `content` | Text | 消息内容 |
| | `created_at` | DateTime | 自动生成 |

### 验证方式

编写一个临时脚本，调用 `create_all()` 后插入一条消息并查询，确认 WAL 模式生效：

```python
# scratch/test_db.py
import asyncio
from db.database import engine, async_session
from db.models import Base, ChatSession, Message

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as s:
        s.add(ChatSession(id="test-001"))
        await s.commit()
    print("✅ DB works")

asyncio.run(main())
```

---

## Phase 3 — 外部集成层

**目标**: LLM 客户端单例 + M-Flow Facade 封装，让 Service 层可以直接调用 `llm_client` 和 `mflow_client`。

**依赖**: Phase 1 (`settings`)

### 产出文件

| 文件 | 职责 |
|:---|:---|
| `core/llm.py` | `AsyncOpenAI` 全局单例 |
| `services/mflow_client.py` | M-Flow SDK 的 Facade 封装 |
| `schemas/payloads.py` | 所有 Request/Response Pydantic 模型 |

### `core/llm.py`

按 ARCHITECTURE.md §3.4 实现：

```python
from openai import AsyncOpenAI
from core.config import settings

llm_client = AsyncOpenAI(
    api_key=settings.MINIMAX_API_KEY,
    base_url=settings.MINIMAX_BASE_URL,
)
```

### `services/mflow_client.py`

封装两个核心方法，按 ARCHITECTURE.md §3.2：

```python
async def get_context(query: str) -> list[str]:
    """调用 m_flow.query(query, mode="episodic") 获取文档上下文"""

async def get_graph(query: str) -> dict:
    """调用 m_flow.search(..., TRIPLET_COMPLETION, verbose=True)
       返回 {graphId, centerNodeId, nodes, edges}"""
```

`get_graph` 内部包含：
1. 调用 `m_flow.search()`
2. **nodeType 映射**：过滤内置类型 → 映射到 12 种标准类型 → fallback `"other"`
3. **graphId 生成**：`hashlib.sha256(query.encode()).hexdigest()[:16]`
4. **centerNodeId 选取**：首个 `artifact` 类型节点，或第一个节点
5. **edge ID 生成**：`f"{source}_{label}_{target}"`

### `schemas/payloads.py`

按 API.md §2.1-2.2 定义所有 DTO：

```python
class ChatRequest(BaseModel):
    query: str
    session_id: str

class ChatChunk(BaseModel):
    chunk: str
    finish_reason: str | None = None

class SSEError(BaseModel):
    code: str   # llm_timeout | llm_rate_limit | llm_error | retrieval_error | internal_error
    message: str

class GraphRequest(BaseModel):
    query: str
    session_id: str

class GraphNode(BaseModel):
    id: str
    label: str
    nodeType: str

class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    weight: float = 1.0

class GraphResponse(BaseModel):
    graphId: str
    centerNodeId: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
```

### 验证方式

- `core/llm.py`: 发送一个简单的 `chat.completions.create()` 调用验证连通性
- `mflow_client.py`: 调用 `get_context("司母戊鼎")` 检查返回结构

---

## Phase 4 — 业务逻辑层

**目标**: 实现 RAG 的核心编排逻辑。这是整个系统最复杂的阶段。

**依赖**: Phase 2 (DB) + Phase 3 (LLM + M-Flow + Schemas)

### 产出文件

| 文件 | 职责 |
|:---|:---|
| `services/chat_service.py` | 对话全链路：历史查询 → 检索 → Prompt 组装 → SSE 流式生成 → 落盘 |
| `services/graph_service.py` | 图谱全链路：历史查询 → Query Rewrite → 图谱检索 → 格式化 |

### `chat_service.py` 核心流程

按 REQUIREMENTS.md §2 接口A 和 ARCHITECTURE.md §3.2：

```python
async def stream_chat(query: str, session_id: str, db: AsyncSession):
    # 1. 获取/创建 Session + 查询历史消息
    # 2. 调用 mflow_client.get_context(query) 获取 RAG 上下文
    # 3. 若上下文为空 → yield 降级提示信息（API.md §1.5.3）→ return
    # 4. 组装 messages = [system_prompt] + history + [context + query]
    # 5. 调用 llm_client.chat.completions.create(stream=True)
    # 6. 逐 chunk yield SSE 数据帧
    # 7. 拼接完整回答，异步写入 user + assistant 两条 Message
```

**异常处理**（按 API.md §1.5.2）：
- `openai.APITimeoutError` → yield `SSEError(code="llm_timeout", ...)`
- `openai.RateLimitError` → yield `SSEError(code="llm_rate_limit", ...)`
- `openai.APIError` → yield `SSEError(code="llm_error", ...)`
- M-Flow 异常 → yield `SSEError(code="retrieval_error", ...)`
- 其他 → yield `SSEError(code="internal_error", ...)`

### `graph_service.py` 核心流程

按 REQUIREMENTS.md §2 接口B 和 ARCHITECTURE.md §3.2：

```python
async def query_graph(query: str, session_id: str, db: AsyncSession) -> GraphResponse:
    # 1. 查询 session 历史消息
    # 2. Query Rewrite 跳过策略：
    #    - 无历史 → 直接用原始 query
    #    - 有历史 → 调用 LLM 重写（Prompt 含"若语义独立则原样返回"）
    # 3. 调用 mflow_client.get_graph(rewritten_query)
    # 4. 若结果为空 → raise HTTPException(404)（API.md §1.5.3）
    # 5. 返回 GraphResponse
```

### 验证方式

- 编写脚本直接调用 `stream_chat()` 和 `query_graph()`，绕过 HTTP 层验证业务逻辑
- 确认：SSE 数据帧格式、异常处理路径、空结果降级

---

## Phase 5 — 路由控制层

**目标**: 将 Service 层暴露为 HTTP 接口。此层保持轻薄。

**依赖**: Phase 4 (Services)

### 产出文件

| 文件 | 职责 |
|:---|:---|
| `api/chat.py` | `POST /api/chat` → SSE EventSourceResponse |
| `api/graph.py` | `POST /api/graph/query` → JSON Response |

### `api/chat.py`

```python
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

router = APIRouter()

@router.post("/api/chat")
async def chat(req: ChatRequest, db: AsyncSession = Depends(get_db)):
    return EventSourceResponse(
        chat_service.stream_chat(req.query, req.session_id, db)
    )
```

### `api/graph.py`

```python
@router.post("/api/graph/query")
async def graph_query(req: GraphRequest, db: AsyncSession = Depends(get_db)):
    return await graph_service.query_graph(req.query, req.session_id, db)
```

### 验证方式

`curl` 或 Postman 测试两个接口的请求/响应格式是否符合 API.md。

---

## Phase 6 — 应用入口与中间件

**目标**: 完成 `main.py`，挂载路由、CORS、启动事件。

**依赖**: Phase 5 (Routers)

### `main.py` 关键结构

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from db.database import engine
from db.models import Base

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时建表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(title="M-Flow RAG Backend", lifespan=lifespan)

# CORS
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)

# 挂载路由
app.include_router(chat_router)
app.include_router(graph_router)
```

### 验证方式

```bash
# 方法 1：直接运行 Python 脚本 (推荐)
python main.py

# 方法 2：使用 uvicorn 命令行
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 访问 http://localhost:8000/docs 查看 Swagger 文档
```

---

## Phase 7 — 端到端集成测试

**目标**: 模拟前端的真实使用场景，验证完整链路。

### 测试清单

| # | 场景 | 预期 | 对应文档 |
|:---:|:---|:---|:---:|
| 1 | 首轮对话 `/api/chat` | SSE 流式返回，消息落盘 | REQUIREMENTS §2 接口A |
| 2 | 多轮对话 `/api/chat` | 历史上下文正确关联 | REQUIREMENTS §4 |
| 3 | 检索空结果 `/api/chat` | 推送降级提示，不调 LLM | API §1.5.3 |
| 4 | 首轮图谱 `/api/graph/query` | 跳过 Rewrite，返回 JSON | REQUIREMENTS §2 接口B |
| 5 | 多轮图谱 `/api/graph/query` | 执行 Rewrite，消解指代 | REQUIREMENTS §2 接口B |
| 6 | 图谱空结果 | HTTP 404 | API §1.5.3 |
| 7 | 并发调用 Chat + Graph | 两接口互不阻塞 | REQUIREMENTS §2 |
| 8 | LLM 超时模拟 | `event: error` 帧 | API §1.5.2 |

---

## 开发顺序总结

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
config    database   llm/mflow   services   routers    main.py   e2e test
 (0.5h)   (0.5h)     (1.5h)      (3h)       (0.5h)    (0.5h)    (1h)
```

> **每个 Phase 完成后都应独立验证**，确认该层的输入输出契约正确后再进入下一层。这样做的好处是：当上层出现 Bug 时，可以确信问题出在当前层而非底层依赖。

