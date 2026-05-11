# Python 后台搭建与接口规范

本文档基于 `docs/book.md`、`docs/knowledge-graph-solutions.md` 和当前前端项目依赖整理，用于指导知识库 / 书本 / 章节 / Markdown 原文 / 知识图谱 / AI 对话后台的 Python 落地。

当前文件夹 `E:\熠朵科技\cultural-relics-museum-hm-backend` 已经作为后端项目根目录使用，后续命令默认都在该目录内执行，不再额外创建 `backend/` 子目录。

目标是先用 FastAPI 搭出可联调、可扩展的后台，再逐步接入正式数据库、向量检索、MinerU 文档解析和 AI 服务。

---

## 1. 后台目标

当前 book 项目的后台需要支撑以下能力：

1. 知识库列表、书本列表、章节目录。
2. Markdown 原文读取、定位、跳转。
3. 当前知识库的全局知识图谱数据。
4. 点击图谱节点后，返回可跳转的原文章节或片段列表。
5. AI 对话接口，支持引用原文作为上下文。
6. AI 回答中可携带原文引用，前端点击后返回原文位置。
7. 可选内置 MinerU，用于 PDF / 文档解析成 Markdown、图片、结构化片段。

---

## 2. 推荐技术栈

### 2.1 第一阶段：MVP / mock 联调

```txt
FastAPI + SQLite + SQLAlchemy + OpenAI / MiniMax SDK
```

适合目标：

- 快速跑通前后端接口。
- 先用真实格式的 mock 数据验证交互。
- 不提前引入过重的图数据库和检索系统。

### 2.2 第二阶段：正式开发

```txt
FastAPI + PostgreSQL + pgvector + Redis + SQLAlchemy + Alembic
```

适合目标：

- 持久化知识库、书本、章节、原文、实体、关系。
- 支持原文片段向量检索。
- 缓存图谱结果、AI 会话上下文、热点章节内容。

### 2.3 第三阶段：复杂图谱扩展

```txt
Neo4j / NebulaGraph
```

只有当图谱查询变复杂时再考虑，例如：

- 多跳关系查询。
- 路径推理。
- 按关系类型做复杂筛选。
- 图谱数据规模远超普通关系型数据库管理能力。

当前阶段不建议一开始就引入 Neo4j，PostgreSQL 足够支撑 MVP 和中期开发。

---

## 3. 安装步骤

### 3.1 进入后端项目目录

当前文件夹就是后端项目根目录。开始搭建前，先进入该目录：

```powershell
cd E:\熠朵科技\cultural-relics-museum-hm-backend
```

### 3.2 创建 Python 虚拟环境

建议使用 Python 3.12.7。当前环境中 `python --version` 已显示 `Python 3.12.7`，可以直接使用当前 `python` 命令创建虚拟环境。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version
python -m pip install -U pip
```

如果激活虚拟环境后 `python --version` 显示的不是 `Python 3.12.7`，先退出虚拟环境并删除 `.venv`，确认系统 `python` 指向 3.12.7 后再重新创建。

如果需要使用虚拟环境里的完整解释器路径执行命令，写法如下：

```powershell
.\.venv\Scripts\python.exe -m pip install -U pip
```

不要写成 `python.exe -m python -m pip install -U pip`，`-m` 后面应该直接跟模块名 `pip`。

如果 PowerShell 阻止激活脚本，可以临时执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### 3.3 安装 MVP 必需依赖

```powershell
pip install fastapi "uvicorn[standard]" pydantic-settings python-dotenv httpx openai sqlalchemy alembic aiosqlite python-multipart
```

### 3.4 生成依赖文件

```powershell
pip freeze > requirements.txt
```

后续其他人安装：

```powershell
pip install -r requirements.txt
```

### 3.5 启动命令

建议入口文件为 `app/main.py`。

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

前端请求基础地址：

```txt
http://127.0.0.1:8000
```

FastAPI 自动生成接口文档：

```txt
http://127.0.0.1:8000/docs
```

---

## 4. 依赖包作用

### 4.1 后台框架

| 包名 | 作用 | 是否必需 |
|---|---|---|
| `fastapi` | Web 后台框架，定义 API 路由、请求体、响应体 | 必需 |
| `uvicorn[standard]` | ASGI 服务，用于启动 FastAPI | 必需 |
| `pydantic-settings` | 管理配置，例如数据库地址、AI Key | 必需 |
| `python-dotenv` | 读取 `.env` 环境变量 | 必需 |

### 4.2 数据库

| 包名 | 作用 | 是否必需 |
|---|---|---|
| `sqlalchemy` | ORM，管理表模型和查询 | 必需 |
| `alembic` | 数据库迁移工具 | 推荐 |
| `aiosqlite` | 开发阶段使用 SQLite 异步连接 | MVP 必需 |
| `asyncpg` | PostgreSQL 异步连接 | 正式环境推荐 |
| `psycopg[binary]` | PostgreSQL 同步 / 工具连接 | 正式环境推荐 |

正式数据库依赖安装：

```powershell
pip install asyncpg psycopg[binary]
```

### 4.3 AI 与外部请求

| 包名 | 作用 | 是否必需 |
|---|---|---|
| `openai` | 调用 OpenAI 接口 | 按需 |
| `httpx` | 调用 MiniMax、MinerU 服务或其他 HTTP 接口 | 必需 |
| `tiktoken` | 估算 token、切分文本 | 推荐 |

向量检索基础依赖：

```powershell
pip install numpy tiktoken
```

### 4.4 文件上传与文档解析

| 包名 | 作用 | 是否必需 |
|---|---|---|
| `python-multipart` | FastAPI 处理文件上传 | 推荐 |
| `magic-pdf` | MinerU 的 Python 包，用于 PDF / 文档解析 | 可选 |

MinerU 安装：

```powershell
pip install magic-pdf
```

MinerU 建议作为独立服务模块，不要直接写死在 AI 对话接口里。

### 4.5 缓存与任务队列

| 包名 | 作用 | 是否必需 |
|---|---|---|
| `redis` | 缓存图谱、章节、会话上下文 | 可选 |
| `celery` | 后台异步任务，例如文档解析、批量向量化 | 可选 |

安装：

```powershell
pip install redis celery
```

---

## 5. 推荐目录结构

```txt
cultural-relics-museum-hm-backend/
  app/
    main.py
    core/
      config.py
      cors.py
    api/
      health.py
      knowledge_bases.py
      books.py
      chapters.py
      graph.py
      chat.py
      documents.py
    schemas/
      common.py
      knowledge_base.py
      book.py
      chapter.py
      graph.py
      chat.py
      document.py
    models/
      knowledge_base.py
      book.py
      chapter.py
      graph.py
      chat.py
      document.py
    services/
      book_service.py
      graph_service.py
      chat_service.py
      document_service.py
      retrieval_service.py
    db/
      session.py
      base.py
    repositories/
      book_repository.py
      graph_repository.py
      chat_repository.py
    mock/
      books.py
      graph.py
      markdown.py
  alembic/
  .env
  requirements.txt
```

目录职责：

| 目录 | 作用 |
|---|---|
| `api/` | 定义接口路径，处理请求和响应 |
| `schemas/` | Pydantic 类型定义，约束接口格式 |
| `models/` | SQLAlchemy 数据库表模型 |
| `services/` | 业务逻辑，例如图谱整理、AI 对话、原文引用 |
| `repositories/` | 数据访问层，封装数据库查询 |
| `db/` | 数据库连接、Session、Base |
| `mock/` | MVP 阶段的模拟数据 |

---

## 6. 环境变量

建议在当前后端项目根目录创建 `.env`：

```env
APP_NAME=cultural-relics-museum-backend
APP_ENV=development

DATABASE_URL=sqlite+aiosqlite:///./museum.db

OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

MINIMAX_API_KEY=
MINIMAX_BASE_URL=
MINIMAX_MODEL=

REDIS_URL=redis://127.0.0.1:6379/0
```

开发阶段可以只配置：

```env
DATABASE_URL=sqlite+aiosqlite:///./museum.db
```

---

## 7. 接口通用规范

### 7.1 基础路径

```txt
http://127.0.0.1:8000
```

### 7.2 请求格式

默认请求体：

```txt
Content-Type: application/json
```

文件上传接口使用：

```txt
multipart/form-data
```

### 7.3 通用响应格式

普通接口建议返回：

```ts
type ApiResponse<T> = {
  data: T
  message?: string
}
```

分页接口建议返回：

```ts
type PageResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
```

错误响应沿用 FastAPI 默认格式：

```json
{
  "detail": "错误说明"
}
```

---

## 8. 类型定义

以下类型用于前后端协作。前端可按这些结构定义 TypeScript 类型，后端用 Pydantic 定义对应 Schema。

### 8.1 知识库

```ts
type KnowledgeBase = {
  id: string
  name: string
  description?: string
  coverUrl?: string
  bookCount: number
  createdAt: string
  updatedAt: string
}
```

### 8.2 书本

```ts
type Book = {
  id: string
  knowledgeBaseId: string
  title: string
  author?: string
  dynasty?: string
  description?: string
  coverUrl?: string
  chapterCount: number
  createdAt: string
  updatedAt: string
}
```

### 8.3 章节

```ts
type Chapter = {
  id: string
  bookId: string
  parentId?: string
  title: string
  order: number
  level: number
  summary?: string
  markdownPath?: string
  createdAt: string
  updatedAt: string
}
```

### 8.4 章节树

```ts
type ChapterTreeNode = Chapter & {
  children: ChapterTreeNode[]
}
```

### 8.5 Markdown 原文

```ts
type ChapterContent = {
  chapterId: string
  bookId: string
  title: string
  markdown: string
  anchors: ContentAnchor[]
  entities: EntityMention[]
}
```

### 8.6 原文锚点

```ts
type ContentAnchor = {
  id: string
  chapterId: string
  title?: string
  startOffset?: number
  endOffset?: number
  markdownHeading?: string
}
```

### 8.7 实体提及

```ts
type EntityMention = {
  id: string
  entityId: string
  label: string
  nodeType: GraphNodeType
  chapterId: string
  anchorId?: string
  startOffset?: number
  endOffset?: number
}
```

### 8.8 图谱

```ts
type GraphResponse = {
  graphId: string
  centerNodeId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

type GraphNode = {
  id: string
  label: string
  nodeType: GraphNodeType
  description?: string
  sourceRefs?: SourceRef[]
}

type GraphEdge = {
  id: string
  source: string
  target: string
  label: string
  weight?: number
  sourceRefs?: SourceRef[]
}

type GraphNodeType =
  | 'knowledge_base'
  | 'book'
  | 'chapter'
  | 'section'
  | 'markdown_note'
  | 'artifact'
  | 'person'
  | 'dynasty'
  | 'site'
  | 'concept'
  | 'material'
  | 'pattern'
  | 'craft'
  | 'category'
  | 'inscription'
  | 'usage'
  | 'other'
```

### 8.9 原文引用

```ts
type SourceRef = {
  id: string
  knowledgeBaseId: string
  bookId: string
  chapterId: string
  anchorId?: string
  title: string
  quote?: string
  startOffset?: number
  endOffset?: number
}
```

### 8.10 AI 对话

```ts
type ChatRequest = {
  sessionId: string
  knowledgeBaseId: string
  bookId?: string
  chapterId?: string
  question: string
  selectedText?: SelectedTextRef
}

type SelectedTextRef = {
  chapterId: string
  text: string
  startOffset?: number
  endOffset?: number
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sourceRefs?: SourceRef[]
  createdAt: string
}

type ChatResponse = {
  answer: string
  sourceRefs: SourceRef[]
  relatedNodeIds: string[]
}
```

---

## 9. 接口格式

### 9.1 健康检查

```txt
GET /api/health
```

响应：

```json
{
  "data": {
    "status": "ok"
  }
}
```

### 9.2 获取知识库列表

```txt
GET /api/knowledge-bases
```

响应：

```json
{
  "data": [
    {
      "id": "kb-cultural-relics",
      "name": "文物知识库",
      "description": "文物、朝代、材质、工艺和遗址关系知识库",
      "coverUrl": "/covers/kb-cultural-relics.png",
      "bookCount": 3,
      "createdAt": "2026-05-11T00:00:00Z",
      "updatedAt": "2026-05-11T00:00:00Z"
    }
  ]
}
```

### 9.3 获取书本列表

```txt
GET /api/knowledge-bases/{knowledgeBaseId}/books
```

响应：

```json
{
  "data": [
    {
      "id": "book-bronze",
      "knowledgeBaseId": "kb-cultural-relics",
      "title": "中国青铜器",
      "author": "示例作者",
      "dynasty": null,
      "description": "青铜器基础知识与典型器物说明",
      "coverUrl": "/covers/book-bronze.png",
      "chapterCount": 12,
      "createdAt": "2026-05-11T00:00:00Z",
      "updatedAt": "2026-05-11T00:00:00Z"
    }
  ]
}
```

### 9.4 获取章节树

```txt
GET /api/books/{bookId}/chapters
```

响应：

```json
{
  "data": [
    {
      "id": "chapter-bronze-01",
      "bookId": "book-bronze",
      "parentId": null,
      "title": "第一章 青铜器概述",
      "order": 1,
      "level": 1,
      "summary": "介绍青铜器的定义、用途和历史背景",
      "markdownPath": "books/book-bronze/chapter-01.md",
      "createdAt": "2026-05-11T00:00:00Z",
      "updatedAt": "2026-05-11T00:00:00Z",
      "children": []
    }
  ]
}
```

### 9.5 获取章节 Markdown 原文

```txt
GET /api/chapters/{chapterId}/content
```

响应：

```json
{
  "data": {
    "chapterId": "chapter-bronze-01",
    "bookId": "book-bronze",
    "title": "第一章 青铜器概述",
    "markdown": "# 第一章 青铜器概述\n\n青铜器是...",
    "anchors": [
      {
        "id": "anchor-bronze-usage",
        "chapterId": "chapter-bronze-01",
        "title": "青铜器用途",
        "markdownHeading": "青铜器用途"
      }
    ],
    "entities": [
      {
        "id": "mention-simuwu-01",
        "entityId": "artifact-simuwu-ding",
        "label": "司母戊鼎",
        "nodeType": "artifact",
        "chapterId": "chapter-bronze-01",
        "anchorId": "anchor-bronze-usage"
      }
    ]
  }
}
```

### 9.6 获取知识库全局图谱

```txt
GET /api/knowledge-bases/{knowledgeBaseId}/graph
```

查询参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `centerNodeId` | `string` | 否 | 指定中心节点 |
| `depth` | `number` | 否 | 关系深度，默认 `1` |
| `nodeTypes` | `string` | 否 | 节点类型过滤，逗号分隔 |

响应：

```json
{
  "data": {
    "graphId": "graph-kb-cultural-relics",
    "centerNodeId": "kb-cultural-relics",
    "nodes": [
      {
        "id": "kb-cultural-relics",
        "label": "文物知识库",
        "nodeType": "knowledge_base"
      },
      {
        "id": "artifact-simuwu-ding",
        "label": "司母戊鼎",
        "nodeType": "artifact"
      }
    ],
    "edges": [
      {
        "id": "edge-kb-simuwu",
        "source": "kb-cultural-relics",
        "target": "artifact-simuwu-ding",
        "label": "包含文物",
        "weight": 1
      }
    ]
  }
}
```

### 9.7 获取章节相关子图

```txt
GET /api/chapters/{chapterId}/graph
```

用途：

- 用户点击左侧章节后，右侧图谱聚焦章节相关子图。
- 中间 Markdown 切换到该章节。

响应同 `GraphResponse`。

### 9.8 图谱节点跳转原文

```txt
GET /api/graph/nodes/{nodeId}/sources
```

查询参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `knowledgeBaseId` | `string` | 是 | 当前知识库 ID |
| `bookId` | `string` | 否 | 限定当前书本 |

响应：

```json
{
  "data": [
    {
      "id": "source-simuwu-01",
      "knowledgeBaseId": "kb-cultural-relics",
      "bookId": "book-bronze",
      "chapterId": "chapter-bronze-01",
      "anchorId": "anchor-bronze-usage",
      "title": "第一章 青铜器概述",
      "quote": "司母戊鼎是商代晚期青铜礼器...",
      "startOffset": 120,
      "endOffset": 158
    }
  ]
}
```

前端规则：

- 如果只返回 1 条，直接跳转。
- 如果返回多条，展示列表，让用户选择跳转到哪一章或哪一段。

### 9.9 AI 对话

非流式 MVP 接口：

```txt
POST /api/chat
```

请求：

```json
{
  "sessionId": "session-001",
  "knowledgeBaseId": "kb-cultural-relics",
  "bookId": "book-bronze",
  "chapterId": "chapter-bronze-01",
  "question": "司母戊鼎和商代礼制有什么关系？",
  "selectedText": {
    "chapterId": "chapter-bronze-01",
    "text": "司母戊鼎是商代晚期青铜礼器...",
    "startOffset": 120,
    "endOffset": 158
  }
}
```

响应：

```json
{
  "data": {
    "answer": "司母戊鼎与商代礼制的关系主要体现在祭祀、权力象征和青铜礼器制度上...",
    "sourceRefs": [
      {
        "id": "source-simuwu-01",
        "knowledgeBaseId": "kb-cultural-relics",
        "bookId": "book-bronze",
        "chapterId": "chapter-bronze-01",
        "anchorId": "anchor-bronze-usage",
        "title": "第一章 青铜器概述",
        "quote": "司母戊鼎是商代晚期青铜礼器...",
        "startOffset": 120,
        "endOffset": 158
      }
    ],
    "relatedNodeIds": [
      "artifact-simuwu-ding",
      "dynasty-shang",
      "concept-ritual-system"
    ]
  }
}
```

流式接口后续可升级为 SSE：

```txt
POST /api/chat/stream
Content-Type: application/json
Accept: text/event-stream
```

SSE 数据帧：

```txt
data: {"chunk":"司母戊鼎","finishReason":null,"sourceRefs":[]}

data: {"chunk":"","finishReason":"stop","sourceRefs":[{"id":"source-simuwu-01","knowledgeBaseId":"kb-cultural-relics","bookId":"book-bronze","chapterId":"chapter-bronze-01","title":"第一章 青铜器概述"}]}
```

### 9.10 上传文档

```txt
POST /api/documents/upload
Content-Type: multipart/form-data
```

表单字段：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `file` | `File` | 是 | PDF / Markdown / Word 文件 |
| `knowledgeBaseId` | `string` | 是 | 归属知识库 |
| `bookId` | `string` | 否 | 归属书本 |

响应：

```json
{
  "data": {
    "documentId": "doc-001",
    "status": "uploaded"
  }
}
```

### 9.11 文档解析状态

```txt
GET /api/documents/{documentId}/parse-status
```

响应：

```json
{
  "data": {
    "documentId": "doc-001",
    "status": "completed",
    "progress": 100,
    "message": "解析完成"
  }
}
```

---

## 10. book 项目内容需求规范

### 10.1 页面结构需求

book 页面采用三栏结构：

| 区域 | 内容 | 后台支撑 |
|---|---|---|
| 左侧 | 知识库、书本、章节树 | 知识库接口、书本接口、章节树接口 |
| 中间 | AI 对话 / Markdown 原文 | 章节原文接口、AI 对话接口 |
| 右侧 | 当前知识库全局图谱 | 图谱接口、节点原文来源接口 |

### 10.2 左侧知识库 / 章节规范

后台必须提供：

- 当前用户可访问的知识库列表。
- 每个知识库下的书本列表。
- 每本书的章节树。
- 章节必须有稳定的 `id`，不能用标题当 ID。
- 章节顺序由 `order` 控制。
- 多级目录由 `parentId` 和 `level` 控制。

章节树排序规则：

```txt
先按 level / parentId 建树，再按 order 升序排列。
```

### 10.3 中间 Markdown 原文规范

后台返回 Markdown 时需要保留：

- 标题层级。
- 段落。
- 列表。
- 表格。
- 图片链接。
- 内部实体或关键词引用。

建议 Markdown 内部链接格式：

```md
[[司母戊鼎]]
[[商代]]
[[青铜]]
```

如果需要直接关联节点 ID，可扩展为：

```md
[司母戊鼎](graph://artifact-simuwu-ding)
```

前端点击后：

1. 中间原文保持当前位置。
2. 右侧图谱聚焦对应节点。
3. 如果节点命中多个原文位置，则弹出来源列表。

### 10.4 AI 对话与原文联动规范

AI 对话必须支持两种上下文来源：

1. 当前章节上下文。
2. 用户选中的原文片段。

用户选取原文发起提问时，前端应传：

```json
{
  "selectedText": {
    "chapterId": "chapter-bronze-01",
    "text": "司母戊鼎是商代晚期青铜礼器...",
    "startOffset": 120,
    "endOffset": 158
  }
}
```

后台回答时应返回：

- `answer`：回答正文。
- `sourceRefs`：引用原文列表。
- `relatedNodeIds`：相关图谱节点 ID。

前端点击引用时：

1. 切换到对应 `chapterId`。
2. 滚动到 `anchorId` 或 `startOffset`。
3. 高亮引用片段。
4. 右侧图谱高亮 `relatedNodeIds`。

### 10.5 图谱规范

后台返回图谱时必须保证：

- `nodes[].id` 唯一。
- `edges[].id` 唯一。
- `centerNodeId` 必须存在于 `nodes` 中。
- `edges[].source` 必须存在于 `nodes` 中。
- `edges[].target` 必须存在于 `nodes` 中。
- `nodeType` 使用业务类型，不要使用前端渲染库的 `type` 字段。
- 后台不返回 `x` / `y` 坐标，布局由前端 `graphology-layout-forceatlas2` 计算。

推荐图谱策略：

```txt
总览 + 聚焦子图 + 按需展开
```

具体规则：

1. 默认展示当前知识库总览。
2. 点击左侧章节时，图谱聚焦章节相关子图。
3. 点击 Markdown 链接时，图谱聚焦对应节点。
4. 点击图谱节点时，中间跳转到相关原文。
5. 大规模图谱不一次性展开所有低权重关系。
6. 频繁请求的图谱结果可以缓存。

### 10.6 图谱节点多来源跳转规范

同一个节点可能出现在多个章节中，例如“商代”可能出现在多本书、多章内容中。

后台接口 `/api/graph/nodes/{nodeId}/sources` 应返回所有匹配位置。

前端处理：

```txt
0 条：显示未找到原文位置
1 条：直接跳转
多条：展示来源列表，用户点击后跳转
```

来源列表每一项至少展示：

- 书名。
- 章节名。
- 命中的原文片段。

### 10.7 MinerU 规范

MinerU 用于文档解析，不直接负责知识图谱渲染。

推荐流程：

```txt
1. 用户上传 PDF / Word / 图片型文档
2. 后台保存原始文件
3. MinerU 解析出 Markdown、图片、版面结构
4. 后台按标题切分章节
5. 后台抽取实体、关键词和引用关系
6. 生成章节原文、实体提及、图谱节点和边
7. 前端通过标准接口读取结果
```

MinerU 解析任务建议异步执行，因为 PDF 解析可能较慢。

---

## 11. 数据库表建议

### 11.1 MVP 表

```txt
knowledge_bases
books
chapters
chapter_contents
graph_nodes
graph_edges
entity_mentions
chat_sessions
chat_messages
documents
```

### 11.2 表职责

| 表名 | 作用 |
|---|---|
| `knowledge_bases` | 知识库 |
| `books` | 书本 |
| `chapters` | 章节目录 |
| `chapter_contents` | Markdown 原文 |
| `graph_nodes` | 图谱节点 |
| `graph_edges` | 图谱关系 |
| `entity_mentions` | 实体在原文中的出现位置 |
| `chat_sessions` | AI 对话会话 |
| `chat_messages` | AI 对话消息 |
| `documents` | 上传文档和解析状态 |

### 11.3 向量检索扩展表

```txt
content_chunks
```

字段建议：

```txt
id
knowledge_base_id
book_id
chapter_id
anchor_id
content
embedding
start_offset
end_offset
created_at
updated_at
```

---

## 12. 开发顺序建议

### 12.1 第一步：纯 mock 接口

优先实现：

```txt
GET /api/knowledge-bases
GET /api/knowledge-bases/{knowledgeBaseId}/books
GET /api/books/{bookId}/chapters
GET /api/chapters/{chapterId}/content
GET /api/knowledge-bases/{knowledgeBaseId}/graph
GET /api/graph/nodes/{nodeId}/sources
POST /api/chat
```

目标：

- 前端三栏页面可以完整跑通。
- 图谱点击、章节切换、Markdown 展示、AI 回答引用可以联动。

### 12.2 第二步：接入 SQLite

把 mock 数据迁移到 SQLite：

- 知识库。
- 书本。
- 章节。
- Markdown 原文。
- 图谱节点和边。
- 实体出现位置。

目标：

- 数据可维护。
- 接口不依赖硬编码 mock。

### 12.3 第三步：接入 AI

建议新建后端分支：

```txt
openai-minimax
```

实现：

- OpenAI / MiniMax 配置。
- 非流式 `/api/chat`。
- 后续升级 SSE `/api/chat/stream`。
- 引用原文 `sourceRefs`。

### 12.4 第四步：接入文档解析

实现：

- 文档上传。
- MinerU 解析。
- Markdown 入库。
- 章节切分。
- 实体抽取。
- 图谱节点和关系生成。

### 12.5 第五步：性能优化

实现：

- 图谱接口缓存。
- 章节内容缓存。
- 大图分页 / 按需展开。
- pgvector 检索。
- Redis 缓存。

---

## 13. 前后端联调重点

### 13.1 前端已有依赖

当前前端已具备：

```txt
axios
react-markdown
sigma
graphology
graphology-layout-forceatlas2
zustand
```

因此后台只需要提供稳定 JSON 数据，不需要返回图谱布局坐标。

### 13.2 图谱接口重点

前端需要：

- `GraphResponse`。
- 稳定节点 ID。
- 稳定边 ID。
- 明确 `nodeType`。
- 点击节点后可查询来源。

### 13.3 AI 对话接口重点

前端需要：

- 回答文本。
- 引用原文。
- 相关图谱节点。
- 可选流式输出。

### 13.4 Markdown 接口重点

前端需要：

- 原始 Markdown。
- 锚点。
- 实体提及。
- 可定位的 `chapterId`、`anchorId`、`startOffset`、`endOffset`。

---

## 14. 最小可运行后端清单

如果只做第一版后台，必须完成：

```txt
1. 确认当前目录为后端项目根目录 `E:\熠朵科技\cultural-relics-museum-hm-backend`
2. 安装 FastAPI 相关依赖
3. 创建 app/main.py
4. 配置 CORS
5. 提供 mock 数据
6. 实现知识库、书本、章节、原文、图谱、节点来源、AI 对话接口
7. 启动 uvicorn
8. 前端 axios 指向 http://127.0.0.1:8000
```

第一版不必立刻完成：

```txt
PostgreSQL
Redis
Neo4j
MinerU
SSE 流式输出
用户登录
权限系统
```

这些适合在接口稳定后逐步接入。
