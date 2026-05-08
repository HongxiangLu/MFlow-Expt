# M-Flow RAG 后端 API 接口文档

**文档版本**: v1.3
**更新日期**: 2026-04-30
**项目阶段**: Demo / MVP

---

## 1. 全局说明

### 1.1 设计风格

本系统所有 API 均遵循 **RESTful** 风格设计。选择 RESTful 的原因如下：

*   **语义清晰**: RESTful 以资源为中心，通过 HTTP 动词（GET / POST / PUT / DELETE）映射 CRUD 操作，接口含义直观，降低前后端协作的理解成本。
*   **标准化程度高**: RESTful 是当前工业界最广泛采用的 API 范式，生态工具链（Swagger/OpenAPI、Postman、各语言 SDK 生成器）均以其为默认标准，便于自动化文档生成与接口测试。
*   **与 FastAPI 深度契合**: FastAPI 的路由系统、请求/响应模型（Pydantic）以及自动生成的 OpenAPI 文档天然为 RESTful 设计而生，采用此风格可最大化框架红利。

### 1.2 基础路径

当前 MVP 阶段未引入 `/v1/` 等多版本前缀路径控制，所有 API 的基础路径为：
`http://<host>:<port>`

> **为什么暂不引入 API 版本控制？** 在 Demo/MVP 阶段，接口形态仍处于快速迭代与验证期，过早固化版本号会增加前后端联调成本。待接口稳定后再引入 `/v1/` 前缀，符合"先验证、后规范"的敏捷实践。

### 1.3 跨域与请求头

*   所有接口默认支持 **CORS 跨域请求**。由于前端（通常运行于 `localhost:3000` 或移动端 WebView）与后端（`localhost:8000`）分属不同源，浏览器同源策略会拦截跨域请求，因此后端必须通过 FastAPI 的 `CORSMiddleware` 显式开放跨域访问。**当前 MVP 实现采用 `allow_origins=["*"]` + `allow_credentials=False`**，以优先满足联调效率；生产阶段再切换为白名单域名。
*   请求体默认为 `application/json`，编码格式必须为 `UTF-8`。JSON 作为请求/响应的标准序列化格式，具有最广泛的平台兼容性，且与 FastAPI 的 Pydantic 验证层无缝集成。

### 1.4 会话管理策略 (Session Lifecycle)

当前阶段采用**前端刷新即新建会话**的轻量级模型：

*   每当用户刷新页面或重新进入应用时，前端生成一个全新的 `session_id`（UUID），标志着一个新会话的开始。
*   后端依据 `session_id` 维护多轮对话的上下文历史，确保同一会话内的指代消解（Query Rewrite）能够正常运作。
*   **当前不提供对话历史查询接口**。即用户无法在前端回溯或恢复过往会话记录。

> **为什么不开发对话历史接口？** MVP 阶段的核心验证目标是 RAG 对话质量与图谱可视化效果，对话历史的持久化回显属于产品体验层需求。在用户体系（登录/注册）尚未引入之前，对话历史缺乏明确的归属主体，提供此接口反而会引入孤立数据与隐私合规风险。待用户体系就绪后，可基于已有的 Session/Message 数据模型平滑扩展此功能。

### 1.5 异常与错误处理

#### 1.5.1 HTTP 级错误（适用于所有接口）

统一采用基于 HTTP 状态码的 FastAPI 默认规范。通过标准状态码传达错误语义（如 `400` 请求格式错误、`422` 字段校验失败、`500` 服务端异常），避免自定义错误码体系带来的额外学习成本，同时与 RESTful 最佳实践保持一致。

非 2xx 响应时，响应体格式如下：
```json
{
  "detail": "具体的错误描述信息"
}
```
*注：若为 Pydantic 字段校验错误，`detail` 的值可能为包含错误字段详细路径的数组。*

#### 1.5.2 SSE 流内错误事件（仅适用于 `/api/chat`）

在 SSE 流式传输建立之后（HTTP 200 已返回），若后端在推流过程中遭遇异常，将通过**独立的 SSE named event** 向前端发送错误通知。采用 `event: error` 而非在 `data` 帧中扩展 `finish_reason`，是因为前者符合 SSE 规范中 named event 的设计意图，前端可通过 `addEventListener("error", ...)` 独立监听错误事件，不会干扰正常数据帧的解析逻辑。此模式也与 OpenAI Realtime API 等主流实现保持一致。

**错误事件帧格式**：

```text
event: error
data: {"code": "llm_timeout", "message": "大模型响应超时，请稍后重试"}

```

**错误事件字段说明**：

| 字段名    | 类型   | 描述                               |
| :-------- | :----- | :--------------------------------- |
| `code`    | String | 机器可读的错误码，用于前端判断分支 |
| `message` | String | 人类可读的错误描述，可直接展示给用户 |

**`code` 枚举值**：

| code              | 含义                         | 触发场景                                       |
| :---------------- | :--------------------------- | :--------------------------------------------- |
| `llm_timeout`     | LLM API 调用超时             | MiniMax API 响应超过设定的超时阈值             |
| `llm_rate_limit`  | LLM API 限流                 | MiniMax API 返回 429 状态码                    |
| `llm_error`       | LLM API 返回其他错误         | MiniMax API 返回非预期的错误响应               |
| `retrieval_error` | M-Flow 文档检索失败          | M-Flow 向量检索过程中抛出异常                  |
| `internal_error`  | 后端内部未知错误             | 其他未捕获的异常                               |

> **前端处理建议**: 收到 `event: error` 后，应停止等待后续 `data` 帧，将已接收的部分内容保留展示，并向用户提示错误信息。

#### 1.5.3 检索降级策略

*   **对话接口 (`/api/chat`)**：若 M-Flow 文档检索返回**空结果**（未召回任何相关文档片段），后端**不会**调用 LLM 生成无上下文的裸回答，而是通过 SSE 流直接向前端推送一条提示信息：`"抱歉，未能检索到与您提问相关的知识内容。请尝试换一种方式提问，或提供更具体的关键词。"` 该消息通过正常的 `data` 帧发送（`finish_reason: "stop"`），以便前端无需额外的解析逻辑。
*   **图谱查询接口 (`/api/graph/query`)**：若 M-Flow 图谱检索返回**空结果**（未检索到任何相关实体或关系），后端返回 HTTP `404` 状态码，响应体如下：

```json
{
  "detail": "未检索到与当前提问相关的知识图谱数据，请尝试更换提问内容。"
}
```

> **为什么不返回空的 `{nodes: [], edges: []}`？** 空图谱对象在语义上不明确——前端无法区分"确实没有相关数据"与"后端出错了"。使用 404 明确表达"资源不存在"的语义，前端可据此展示友好的空状态提示。

---

## 2. 接口列表

### 2.1 AI 对话接口 (Chat)

*   **路径**: `/api/chat`
*   **方法**: `POST`
*   **功能描述**: 接收用户提问，执行 RAG 全链路逻辑（不含 Query Rewrite），并以 Server-Sent Events (SSE) 协议返回流式响应。
*   **Content-Type**: `application/json`

> **为什么使用 POST 而非 GET？** 虽然"获取回答"在语义上偏向读取操作，但 GET 请求无法携带 Request Body，查询参数长度也受浏览器限制。使用 POST 可以通过 JSON Body 传递结构化的请求参数（如 `query`、`session_id`），与 RESTful 中"创建一个新的对话交互"的语义也相吻合。
>
> **为什么采用 SSE 而非 WebSocket？** SSE 基于标准 HTTP 协议，是单向服务端推送的轻量方案，天然兼容代理、CDN 与负载均衡器。对于"模型逐字生成"这一只需要服务端向客户端单向推流的场景，SSE 比 WebSocket 的双向全双工能力更为匹配，且实现复杂度显著更低。这也是 OpenAI 等主流 LLM API 采用的流式方案。

**请求参数 (Request Body)**:

| 字段名       | 类型   | 必填 | 描述                                                                 |
| :----------- | :----- | :--- | :------------------------------------------------------------------- |
| `query`      | String | 是   | 用户当前输入的文本问题。                                             |
| `session_id` | String | 是   | 当前会话的唯一标识 (如 UUID)，用于上下文关联与多轮对话的历史持久化。 |

**请求示例**:
```json
{
  "query": "什么是 M-Flow？",
  "session_id": "sess-12345678"
}
```

**响应格式 (Response)**:
*   **Content-Type**: `text/event-stream`
*   **传输格式**: 每一帧数据皆为 JSON 序列化字符串。
*   **流内异常**: 若推流过程中发生错误，将发送 `event: error` 事件帧（详见 1.5.2 节）。

**数据帧结构 (SSE Data)**:

| 字段名          | 类型   | 描述                                                         |
| :-------------- | :----- | :----------------------------------------------------------- |
| `chunk`         | String | 增量生成的模型文本字符（后端按单字符粒度逐帧推送）。         |
| `finish_reason` | String | 结束标志。流进行中为 `null`，正常结束为 `"stop"`。           |

**响应流示例（正常）**:
```text
data: {"chunk": "M", "finish_reason": null}

data: {"chunk": "-", "finish_reason": null}

data: {"chunk": "F", "finish_reason": null}

data: {"chunk": "l", "finish_reason": null}

data: {"chunk": "o", "finish_reason": null}

data: {"chunk": "w", "finish_reason": null}

data: {"chunk": "", "finish_reason": "stop"}

```

**响应流示例（检索无结果降级）**:
```text
data: {"chunk": "抱歉，未能检索到与您提问相关的知识内容。请尝试换一种方式提问，或提供更具体的关键词。", "finish_reason": "stop"}

```

**响应流示例（推流中途异常）**:
```text
data: {"chunk": "M", "finish_reason": null}

event: error
data: {"code": "llm_timeout", "message": "大模型响应超时，请稍后重试"}

```

---

### 2.2 图谱查询接口 (Graph Query)

*   **路径**: `/api/graph/query`
*   **方法**: `POST`
*   **功能描述**: 接收用户提问，利用后端数据库中 `session_id` 对应的历史对话独立进行 Query Rewrite (提问重写以消除指代)，随后从 M-Flow 图数据库中精准检索相关的实体与关系。
*   **Content-Type**: `application/json`

> **为什么使用 POST？** 与 Chat 接口同理，图谱查询需要携带 `query` 和 `session_id` 等结构化参数，POST + JSON Body 是最自然的选择。此外，图谱查询涉及后端内部的 Query Rewrite（即对查询语句进行改写），这一过程实质上产生了副作用，因此 POST 语义更为准确。
>
> **为什么 Query Rewrite 仅在图谱接口执行？** Chat 接口会将完整的多轮对话历史连同当前提问一起发送给 LLM，模型本身具备从上下文中理解指代关系的能力，因此不需要额外的 Query Rewrite。而图谱检索直接依赖查询语句的语义完备性（M-Flow 图数据库不接收对话历史），因此必须先将模糊指代消解为独立语义的查询。
>
> **Rewrite 输出约束是什么？** Rewrite 子链路只负责“最小必要改写”（代词消解/省略补全），不负责回答问题。后端会对输出进行纯文本化与防御性校验；若结果表现为回答性文本或异常扩写，会回退原始 query 后再执行图谱检索。

**请求参数 (Request Body)**:

| 字段名       | 类型   | 必填 | 描述                                                                   |
| :----------- | :----- | :--- | :--------------------------------------------------------------------- |
| `query`      | String | 是   | 用户输入的原始问题。                                                   |
| `session_id` | String | 是   | 当前会话的唯一标识，用于提取历史对话进行 Query Rewrite，确保指代消解。 |

**请求示例**:
```json
{
  "query": "那它的首都呢？",
  "session_id": "sess-12345678"
}
```

**响应格式 (Response)**:
*   **Content-Type**: `application/json`
*   **检索无结果**: 返回 HTTP `404`，详见 1.5.3 节。

**响应参数 (Response Body)**:

后端返回一个完整的 Graph 对象，其 TypeScript 类型定义如下：

```ts
type GraphResponse = {
  graphId: string
  centerNodeId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}
```

**顶层字段说明**:

| 字段名         | 类型          | 必填 | 描述                                                               |
| :------------- | :------------ | :--- | :----------------------------------------------------------------- |
| `graphId`      | String        | 是   | 当前图谱的唯一 ID，由后端基于查询字符串的 Hash 生成，确保同一查询标识稳定。|
| `centerNodeId` | String        | 是   | 中心节点 ID，通常是用户搜索的文物节点，前端据此高亮与居中展示。    |
| `nodes`        | GraphNode[]   | 是   | 图谱中的所有节点。                                                 |
| `edges`        | GraphEdge[]   | 是   | 图谱中的所有关系线。                                               |

---

**`nodes` 节点结构 (`GraphNode`)**:

```ts
type GraphNode = {
  id: string
  label: string
  nodeType: string
}
```

| 字段名     | 类型   | 必填 | 描述                                                                       |
| :--------- | :----- | :--- | :------------------------------------------------------------------------- |
| `id`       | String | 是   | 节点唯一 ID，不能重复；关系线通过该 ID 连接节点。                          |
| `label`    | String | 是   | 节点展示名称，前端图上直接显示的文字（建议返回中文）。                     |
| `nodeType` | String | 是   | 节点业务类型，由后端从 M-Flow 原始类型映射而来。若无法匹配标准类型，则返回 `other`。 |

> **注意**: `nodeType` 是业务字段，不要使用 `type`。前端图渲染库 (Sigma) 中 `type` 为渲染类型字段，节点渲染类型由前端内部固定为 `circle`。

**`nodeType` 推荐取值**:

| 值           | 含义                           | 示例         |
| :----------- | :----------------------------- | :----------- |
| `artifact`   | 具体文物                       | 司母戊鼎     |
| `dynasty`    | 朝代 / 年代 / 历史时期         | 商代         |
| `material`   | 材质                           | 青铜         |
| `category`   | 文物类别 / 器物类型            | 鼎           |
| `pattern`    | 纹饰 / 图案                    | 兽面纹       |
| `site`       | 遗址 / 出土地 / 地域           | 殷墟         |
| `craft`      | 工艺 / 制作技术                | 范铸法       |
| `inscription`| 铭文 / 题记 / 文字证据         | 铭文         |
| `usage`      | 用途 / 功能 / 使用场景         | 祭祀         |
| `concept`    | 文化概念 / 制度 / 象征含义     | 礼制         |
| `person`     | 人物 / 墓主 / 作者 / 族属      | 妇好         |
| `collection` | 馆藏 / 展厅 / 机构 / 来源集合  | 青铜器展厅   |
| `other`      | 其他无法归类的业务节点         | 自定义节点   |

---

**`edges` 关系结构 (`GraphEdge`)**:

```ts
type GraphEdge = {
  id: string
  source: string
  target: string
  label: string
  weight?: number
}
```

| 字段名   | 类型   | 必填 | 描述                                                                                 |
| :------- | :----- | :--- | :----------------------------------------------------------------------------------- |
| `id`     | String | 是   | 关系唯一 ID，不能重复。                                                              |
| `source` | String | 是   | 起点节点 ID，必须对应 `nodes` 中存在的某个 `id`。                                    |
| `target` | String | 是   | 终点节点 ID，必须对应 `nodes` 中存在的某个 `id`。                                    |
| `label`  | String | 是   | 关系名称，前端直接显示在线上的文字（建议返回中文，如「所属年代」「主要材质」）。      |
| `weight` | Number | 否   | 关系权重 (`0.1` ~ `2`)，表示关系强弱；前端可用于控制线条粗细或布局影响。默认值为 `1`。|

关系方向含义示例：`source: '司母戊鼎' → label: '所属年代' → target: '商代'`。

---

**后端校验规则**:

*   `nodes[].id` 必须唯一。
*   `edges[].id` 必须唯一。
*   `centerNodeId` 必须能在 `nodes[].id` 中找到。
*   `edges[].source` 和 `edges[].target` 必须能在 `nodes[].id` 中找到。
*   `label` 建议直接返回中文展示文案，前端会直接渲染。
*   后端**不需要**返回 `x` / `y` 坐标，前端会自动布局。

---

**响应示例**:
```json
{
  "graphId": "simuwu-ding",
  "centerNodeId": "simuwu-ding",
  "nodes": [
    { "id": "simuwu-ding", "label": "司母戊鼎", "nodeType": "artifact" },
    { "id": "shang", "label": "商代", "nodeType": "dynasty" },
    { "id": "bronze", "label": "青铜", "nodeType": "material" },
    { "id": "ding", "label": "鼎", "nodeType": "category" },
    { "id": "taotie-pattern", "label": "兽面纹", "nodeType": "pattern" },
    { "id": "yinxu", "label": "殷墟", "nodeType": "site" }
  ],
  "edges": [
    { "id": "e1", "source": "simuwu-ding", "target": "shang", "label": "所属年代", "weight": 1.2 },
    { "id": "e2", "source": "simuwu-ding", "target": "bronze", "label": "主要材质", "weight": 1.3 },
    { "id": "e3", "source": "simuwu-ding", "target": "ding", "label": "器物类型", "weight": 1.4 },
    { "id": "e4", "source": "simuwu-ding", "target": "taotie-pattern", "label": "包含纹饰", "weight": 1.0 },
    { "id": "e5", "source": "simuwu-ding", "target": "yinxu", "label": "出土地点", "weight": 0.9 }
  ]
}
```
