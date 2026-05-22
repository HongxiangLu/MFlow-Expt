# M-Flow 说明

> [!IMPORTANT]
> **自动化补丁提示**：只要执行 [patch_mflow.py](file:///d:/Files/Codes/M-flow/backend/tools/patch_mflow.py) 这个脚本就可以将本章节中提及的所有需要修改的 M-Flow 源码内容自动修改完毕，无需手动逐一调整。

## M-Flow 部分关键机制

在本项目后端与底层 M-Flow 知识引擎集成的过程中，我们对 M-Flow 的节点与关系构建机制进行了深入溯源，特此记录核心原理解析，以供后续开发与环境部署参考。

### 节点 (Node) 的定义与类型修改

除系统节点外，业务实体节点（Entity）默认会有一条指向其分类（EntityType）的边，通过自然语言提示词驱动自动完成分类分配。M-Flow 在知识提取（Ingestion/Memorize）阶段的实体节点类型并非在数据库 Schema 中做强类型约束，而是**直接硬编码在底层大语言模型（LLM）的 Prompt 模板文件中**的。

为了让 M-Flow 在入库时自动将节点分类为我们在 `schemas/payloads.py` 中定义的标准业务类型（如 `artifact`, `dynasty` 等），必须直接修改环境中的底层提示词模板。

*   **修改目标文件一（主要）**：`项目环境路径\Lib\site-packages\m_flow\llm\prompts\write_entity_descriptions.txt`

找到定义 `ENTITY TYPES` 的段落，并使用以下内容将其覆盖：

```text
ENTITY TYPES (choose one):
- artifact: historical relics, antiques, vessels, bronze wares (e.g., Houmuwu Ding)
- dynasty: historical periods, eras, dynasties (e.g., Shang Dynasty)
- material: physical substances, raw materials (e.g., bronze, jade, gold)
- category: artifact classifications, object types (e.g., Ding, Zun, Gui)
- pattern: decorative designs, motifs (e.g., animal mask motif/Taotie)
- site: archaeological sites, excavation locations, ancient ruins (e.g., Yinxu)
- craft: manufacturing techniques, production methods (e.g., piece-mold casting)
- inscription: carved texts, epigraphy, oracle bone script
- usage: functions, use cases, ceremonial purposes (e.g., ritual offering)
- concept: cultural symbols, social systems, religious beliefs (e.g., ritual system)
- person: historical figures, individuals, archaeologists
- collection: museums, exhibitions, current holding institutions
- other: default for anything else that does not fit the above
```

*   **修改目标文件二（防范备用）**：`项目环境路径\Lib\site-packages\m_flow\llm\prompts\knowledge_graph_extractor.txt`

找到定义 `NODE GUIDELINES` 的段落，并使用以下内容将其覆盖：

```text
1. Types — assign each node a broad category label:
   artifact, dynasty, material, category, pattern, site, craft, inscription, usage, concept, person, collection, other.
```

#### 修复节点分类全部变为 `other` 的问题

在某些大语言模型（如 MiniMax）处理中文文本时，可能会出现所有提取的节点类型都被判定为 `other` 的问题。这主要是由于底层的两处指令冲突导致大模型产生困惑：

1. **Pydantic Schema 与系统提示词冲突**：M-Flow 底层用于约束大语言模型 JSON 输出的 Schema 模型（位于 `models.py` 的 `ConceptDescription.entity_type` 字段）中，自带的注释包含了诸如 `'Person', 'Organization', 'Location'` 等预设示例，这与我们在提示词中重写的业务分类（`artifact`, `dynasty` 等）发生了直接冲突。
2. **中英文翻译导致的回退**：提示词底层强制要求输出语言与源文本保持一致（`Output language MUST match SOURCE_TEXT`）。当处理中文输入时，模型试图将分类名称也翻译为中文（如把“artifact”翻译成“文物”），由于不匹配系统规定的英文分类，或者干脆不知道选哪个，模型最终选择了默认的保底选项 `other`。

为了彻底解决这一问题，还需要对 M-Flow 的 Schema 和提示词补充以下约束规则：

*   **修改目标文件三**：`项目环境路径\Lib\site-packages\m_flow\memory\episodic\models.py`

定位到 `ConceptDescription` 类的 `entity_type` 字段定义的位置（第 385 行）：

```python
# 修改前
    entity_type: str = Field(
        default="Thing",
        description="Entity type category, e.g., 'Person', 'Organization', 'Location', 'Event', 'Product', 'Entity', 'Thing'.",
    )

# 修改后 (消除示例干扰并强制匹配提示词)
    entity_type: str = Field(
        default="other",
        description="Entity type category. Must exactly match one of the English keys provided in the ENTITY TYPES section of the prompt.",
    )
```

*   **完善目标文件一**：`项目环境路径\Lib\site-packages\m_flow\llm\prompts\write_entity_descriptions.txt`

定位到提示词底部的 `RULES` 和 `LANGUAGE` 部分（第 34 行）：

```text
# 修改前
RULES:
1. Use EXACT entity names from ENTITY_NAMES (do not modify or translate)
2. Description must be grounded in SOURCE_TEXT facts
3. If entity cannot be described from SOURCE_TEXT, provide brief generic definition
4. Each entity must have exactly one entity_type

LANGUAGE: Output language MUST match SOURCE_TEXT. If Chinese input, output Chinese descriptions.

# 修改后 (增加对 entity_type 必须输出英文的强制指令)
RULES:
1. Use EXACT entity names from ENTITY_NAMES (do not modify or translate)
2. Description must be grounded in SOURCE_TEXT facts
3. If entity cannot be described from SOURCE_TEXT, provide brief generic definition
4. Each entity must have exactly one entity_type. The entity_type MUST be one of the exact English keys listed above (e.g., "artifact", "dynasty"), even if the description is in Chinese.

LANGUAGE: Output language MUST match SOURCE_TEXT. If Chinese input, output Chinese descriptions (but keep entity_type in English).
```


### 关系 (Edge) 的构建逻辑

M-Flow 中的关系不仅仅有结构化类型（如 `relationship_name`），还会被赋予详尽的自然语言描述（`edge_text`）和数值权重（`weight`）。这些描述构成了图谱能直接回答复杂语义关联的基础。

在 M-Flow 默认的 `memorize()` 知识入库流中，构建的是**片段式记忆网络 (Cone Graph/Episodic Memory)**，而非传统意义上点对点的语义三元组知识图谱。

这意味着，当您将知识送入 M-Flow 数据库时：
1. 框架**不会**在两个实体（如「妇好」和「司母戊鼎」）之间直接建立诸如「拥有」或「创作」的语义连线。
2. 框架会建立**结构化关联**：即实体 A 链接到某个信息片段（Facet），实体 B 也链接到这个信息片段。它们之间通过片段产生了逻辑上的关联。

*   **对于入库**：因为真实入库（写入数据库）的边（Edge）的 label 是 M-Flow 框架代码中写死的结构化名称（如 `involves_entity`、`has_facet` 等）。大模型在入库的这一环节，只负责抽取节点实体，而**不负责**推断实体与实体之间的直接动作关系（Prompt 中明确限定了 `Edge/relationship inference is handled downstream`）。因此，开发者不需要去预定义一套动作关系白名单。
*   **对于查询 (TRIPLET_COMPLETION)**：所谓的「三元组补全」，是在检索（Search）阶段发生的。系统通过图游走算法，沿着 `[实体] <- [involves_entity] - [片段] - [involves_entity] -> [实体]` 的路径进行补全。前端所拿到的图谱连线，实质上是这些结构化边的投射，我们在 API 封装层（`mflow_client.py`）统一将其 `label` 兜底降级为 `"related"` 以作展示。

### 节点与关系的直接检索方式
如果需要跳过大模型生成环节，直接获取底层的原生节点和边数据：
1. **原生图查询 (CYPHER 模式)**：推荐做法。通过调用 `m_flow.search(..., query_type=RecallMode.CYPHER)` 并传入相应的 Cypher 查询语句（需注意 M-Flow 底层为了兼顾严格类型的图数据库，统一将实体存放在 `Node` 表中，边存放在 `EDGE` 表中，并通过提取 JSON 的 `properties` 字段来读取动态属性如 `edge_text`）。
2. **三元组模式关联查询**：使用 `TRIPLET_COMPLETION` 模式，并结合参数 `only_context=True` 与 `use_combined_context=True`，可以在不触发 LLM 生成的前提下，让 M-Flow 后端拼装并返回包含节点和边的可视化结构数据（位于返回对象的 `graphs` 字段中）。

### 上下文检索策略 (Recall Modes)
M-Flow 支持直接跳过生成步骤获取上下文，其底层提供了以下三种代表性的知识检索策略：
*   **EPISODIC (情境记忆检索)**：核心检索方式。基于事件树状结构进行检索，支持混合检索与时间加权打分，并依靠图谱游走自适应计算相关性。适用于询问过去发生的事件、复杂情境或会话记录。
*   **TRIPLET_COMPLETION (三元组关联检索)**：精细粒度。基于图谱中的实体关系边进行扩散检索，具有基于跳数和图距离的衰减惩罚机制，主要用于传统图谱事实型回答的数据源。
*   **CHUNKS_LEXICAL (文本块词法检索)**：回退到传统 RAG 模式。仅对文本块执行基于倒排索引的精确 Token/关键字匹配（Lexical matching），不涉及复杂的图结构扩散推断。

### 流式输出 (Streaming) 的支持

1. **M-Flow Python 库不支持原生流式返回**：项目顶层暴露的 Python SDK（如 `query`、`search`）均为等待全部检索与生成完毕后，一次性返回 `QueryResult` 等数据结构的阻塞式调用。
2. **业务系统的流式 RAG 实现**：在开发过程中，如果需要实现打字机效果的响应，推荐采用 **“解耦调用”** 的工程策略：
   * **第一步：检索**。调用 `m_flow.search()` 获取单纯的图谱/文本上下文。
   * **第二步：生成**。将获取的上下文直接组装至业务后端的 Prompt 中，交由标准的 LLM 客户端库（如 `AsyncOpenAI`）开启 `stream=True` 进行流式推理，最后经由 SSE 协议推送给前端。

## M-Flow 的兼容性问题

### MiniMax 的 System 角色限制

在使用 MiniMax 模型接入 M-Flow 进行图谱构建（如调用 `memorize()`）时，可能会遇到如下异常导致流程阻断：
`litellm.BadRequestError: OpenAIException - invalid params, chat content has invalid message role: system (2013)`

#### 报错原因

这源于底层的格式严格校验：

1. **M-Flow 硬编码 System**：M-Flow 内部核心层在发送提取指令时，在代码中硬编码了包含 `system` 角色的 `messages` 数组。
2. **Litellm 路由**：作为中间件的 `litellm`，即使在 `.env` 中配置了原生的 `LLM_MODEL=minimax/MiniMax-M2.7`，其负责处理的 `MinimaxChatConfig`（继承自 `OpenAIGPTConfig`）也未对 `system` 角色做降级或合并处理。
3. **MiniMax 严格校验**：MiniMax 平台接口对于传入的 Role 字段有着极其严格的物理校验，直接拒绝并抛弃带有 `system` 标识的任何请求结构体。

#### 解决方案

修改环境内的 M-Flow 源代码，人为将 `system` 指令前置拼接并降级合并为 `user` 角色。需要修改以下三个底层文件：

**修改目标文件四：`项目环境路径\Lib\site-packages\m_flow\llm\LLMGateway.py`**

定位到 `complete_text` 方法中构建 `messages` 的位置（第 144 行）：

```python
# 修改前
messages = [
    {"role": "system", "content": instructions},
    {"role": "user", "content": source_text},
]

# 修改后 (将 system 内容合并至 user 顶部)
messages = [
    {"role": "user", "content": instructions + "\n\n" + source_text},
]
```

**修改目标文件五：`项目环境路径\Lib\site-packages\m_flow\llm\backends\litellm_instructor\llm\openai\adapter.py`**

定位到 `_build_messages` 方法（第 211 行）：

```python
# 修改前
def _build_messages(self, user_input: str, system_prompt: str) -> list:
    return [
        {"role": "user", "content": user_input},
        {"role": "system", "content": system_prompt},
    ]

# 修改后 (同样进行指令前置合并)
def _build_messages(self, user_input: str, system_prompt: str) -> list:
    return [
        {"role": "user", "content": system_prompt + "\n\n" + user_input},
    ]
```

> **注意配置细节**：在 `backend/.env` 中**无需**配置 `LLM_ENDPOINT` 以及 `LLM_PROVIDER=custom` 属性，否则会导致 litellm 路由退化为兼容模式，掩盖了原生路由（报 `MinimaxException`）触发的问题。配置前缀 `minimax/` 即足以让它自动定位官方地址（国际版：https://api.minimax.io/v1）。

### 实体名称提取的 Prompt 与 Pydantic Schema 不匹配

在使用 MiniMax 模型执行 `memorize()` 入库流程的实体名称提取（Entity Name Extraction）阶段时，可能会遇到如下 Pydantic 校验异常：

```
1 validation error for ConceptNamesResult
Input should be an object [type=model_type, input_value=['同治通宝（雕母...字款', '海棠式碟'], input_type=list]
```

#### 报错原因

这是底层提示词模板（Prompt）的输出格式指示与 Pydantic 模型定义之间的不一致导致的。

1. **Prompt 指示 LLM 输出裸数组**：`extract_entity_names.txt` 模板的最后一行为 `Output JSON array of entity names only.`，这直接指导 LLM 输出一个裸 JSON 数组，例如 `["同治通宝", "清", ...]`。
2. **Pydantic 模型期望对象包裹**：代码中接收结果的 `ConceptNamesResult` 模型（位于 `models.py`）定义了一个 `names` 字段，期望接收的是 JSON 对象格式：`{"names": ["同治通宝", "清", ...]}`。
3. **MiniMax 严格遵循 Prompt 字面指示**：与 OpenAI GPT 系列模型不同，MiniMax-M2.7 更倾向于严格按照 Prompt 的文字要求输出裸数组，而忽略 `instructor` 库注入的 JSON Schema 约束。`instructor` 拿到一个 `list` 而非 `dict`，Pydantic 校验自然失败并抛出 `model_type` 错误。

#### 解决方案

修改提示词模板，使其输出格式指示与 Pydantic 模型结构保持一致：

*   **修改目标文件六**：`项目环境路径\Lib\site-packages\m_flow\llm\prompts\extract_entity_names.txt`

定位到文件末尾（第 20 行），将输出格式指令修改为要求输出 JSON 对象：

```text
# 修改前
Output JSON array of entity names only.

# 修改后 (要求输出带 "names" 字段的 JSON 对象，与 Pydantic Schema 匹配)
Output a JSON object with a "names" field containing the array of entity names.
```

### M-Flow 版本标识修正

若需要执行 `mflow -ui` 启动内置可视化界面，由于底层包名变更及 GitHub 仓库所有者迁移，需要手动对环境中的 M-Flow 源代码进行以下两处修正：

**修正版本获取包名**

*   **修改目标文件七**：`项目环境路径\Lib\site-packages\m_flow\version.py`

*   **修改点**：定位到第 30 行，将 `importlib.metadata.version` 的参数由旧包名改为新包名。

```python
# 修改前
_CACHED = importlib.metadata.version("m_flow")

# 修改后 (修正为正确的 pip 包名)
_CACHED = importlib.metadata.version("mflow-ai")
```

**修正 UI 静态资源下载地址**

*   **修改目标文件八**：`项目环境路径\Lib\site-packages\m_flow\api\v1\ui\ui.py`

*   **修改点**：定位到第 110 行，更新 GitHub 仓库的所有者名称。

```python
# 修改前
url = f"https://github.com/m-flow-project/m_flow/archive/refs/tags/v{clean}.zip"

# 修改后 (更新仓库所有者为 FlowElement-ai)
url = f"https://github.com/FlowElement-ai/m_flow/archive/refs/tags/v{clean}.zip"
```

### Windows 环境下的历史日期

在 Windows 环境下入库包含 1970 年以前日期（如古籍年代）的数据时，可能会触发 `OSError: [Errno 22] Invalid argument`。这是因为 Windows 底层 C 库不支持负数时间戳（即 1970 年以前的 Unix 时间戳），导致 Python 的 `datetime.fromtimestamp()` 调用失败。

若遇到此类报错，需要对环境中的两个核心文件进行手动修正：

**修改时间解析器**

*   **修改目标文件九**：`项目环境路径\Lib\site-packages\m_flow\retrieval\time\query_time_parser.py`
*   **修改点**：定位到第 992 行，改用 `timedelta` 计算偏移量以兼容负数时间戳。

```python
# 修改前
now_dt = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)

# 修改后 (兼容 Windows 负数时间戳)
from datetime import timedelta
now_dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=now_ms / 1000)
```

**修改时间提取器（防御性修正）**

*   **修改目标文件十**：`项目环境路径\Lib\site-packages\m_flow\retrieval\time\mentioned_time_extractor.py`
*   **修改点**：定位到第 127 行，避免直接调用 `.timestamp()`。

```python
# 修改前
ts_ms = int(dt.timestamp() * 1000)

# 修改后 (兼容 Windows 负数时间戳)
ts_ms = int((dt - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds() * 1000)
```

### 图谱检索的 `only_context` 逻辑缺陷

在使用 `TRIPLET_COMPLETION` 模式并同时开启 `only_context=True` 与 `use_combined_context=True` 时，首次对话会触发 `500 Internal Server Error`，后端日志中出现 `instructor.core.InstructorRetryException` 及 Pydantic `ValidationError`。

#### 报错原因

这是 M-Flow SDK 内部 `search()` 函数的一个逻辑 Bug。三层原因构成了一条**链式触发**关系：第 1 点是根因——它导致了一次本不该发生的 LLM 调用；第 2 点解释了这次 LLM 调用为什么会以一种对模型苛刻的方式进行；第 3 点说明了我们使用的 MiniMax 模型为什么无法满足这种苛刻要求，最终导致报错。如果第 1 点的 Bug 不存在（即 `only_context=True` 被正确尊重），后面两点根本不会被触发。

**1. `only_context` 参数在组合上下文模式下被忽略**

首先解释两个关键参数的含义：

- **`only_context`**：一个布尔开关。设为 `True` 时，表示调用方只需要从知识图谱中检索出原始的三元组/文本上下文数据，**不需要** M-Flow 再将这些上下文喂给 LLM 去生成一段自然语言回答。我们的后端在 `mflow_client.py` 中调用 `m_flow.search()` 时就是这样设置的——因为我们的业务架构是「检索归 M-Flow，生成归后端自己的 LLM 客户端」，两步解耦。
- **`use_combined_context`**：另一个布尔开关。设为 `True` 时，表示如果用户拥有多个数据集（Dataset），M-Flow 会先分别从每个数据集中检索上下文，然后将所有结果**合并**为一份统一的上下文，再进行后续处理。设为 `False` 时，则各数据集的结果独立返回。

问题出在 M-Flow 源码 `m_flow/search/methods/search.py` 的 `_authorized_search_impl` 函数中。这个函数内部有两条分支：

```
if use_combined_context:     ← 组合上下文分支（有 Bug）
    ...收集各数据集上下文 → 合并 → 直接调用 completion_fn 生成回答（未检查 only_context）
else:                        ← 标准分支（正常）
    ...调用 _search_single_dataset → 内部正确检查了 only_context
```

当 `use_combined_context=True` 时，代码在合并完上下文后，**无条件**地调用了 `completion_fn(query_text, combined_ctx, ...)` 来让 LLM 生成回答。它完全没有检查 `only_context` 的值。这意味着即便调用方明确说「我只要上下文，别生成回答」，这条分支依然会强行启动 LLM 生成流程。

**2. `instructor` 对 `str` 类型响应的 JSON Schema 包装机制**

上一步中被错误触发的 `completion_fn`，其内部调用链路如下：

```
completion_fn (即 UnifiedTripletSearch.get_completion)
  → generate_completion()          [completion.py]
    → LLMService.extract_structured()  [LLMGateway.py]
      → instructor 客户端.chat.completions.create(response_model=str)
```

这里的关键在于 `instructor` 库的工作原理。`instructor` 是一个用于约束 LLM 输出格式的中间件——它接收一个 Pydantic 模型（`response_model`）作为期望的输出结构，然后：

1. 将该模型的字段定义转换为一段 JSON Schema，注入到发给 LLM 的提示词中；
2. 要求 LLM 严格按照该 Schema 返回 JSON；
3. 拿到 LLM 返回的 JSON 后，用 Pydantic 对其进行反序列化校验。

当 `response_model=str`（即期望输出就是一个普通字符串）时，`instructor` 并不会简单地让 LLM 返回纯文本。它会将 `str` 包装为一个临时的 Pydantic 模型，该模型只有一个必填字段 `content`，对应的 JSON Schema 形如：

```json
{
  "properties": {
    "content": { "type": "string", "title": "Content" }
  },
  "required": ["content"]
}
```

也就是说，`instructor` 实际上要求 LLM 返回 `{"content": "这里是回答内容"}` 这样的 JSON 结构，然后它再从中提取 `content` 字段的值作为最终的字符串返回。

**3. MiniMax 模型无法稳定生成符合 `instructor` 要求的 JSON 结构**

MiniMax-M2.7 模型在接收到上述 JSON Schema 约束后，并不能可靠地按照要求输出 `{"content": "..."}` 格式。它的实际输出可能是以下几种情况之一：

- 直接输出纯文本回答（没有 JSON 包装）
- 输出了 JSON，但字段名不对，例如 `{"question": "...", "answer": "..."}`
- 输出了不完整或格式错误的 JSON

无论是哪种情况，`instructor` 拿到 LLM 的原始输出后尝试用 Pydantic 解析时都会失败，抛出类似以下的校验错误：

```
ValidationError: 1 validation error for Response
content
  Field required [type=missing, loc=('content',), ...]
```

`instructor` 内置了重试机制（默认最多 5 次），每次失败后会将校验错误信息追加到提示词中，期望 LLM 在下一次尝试中修正输出格式。但 MiniMax 模型在多次重试后仍然无法产出合规的 JSON，最终 `instructor` 耗尽重试次数，抛出 `InstructorRetryException`，该异常一路上抛至 FastAPI 路由层，导致接口返回 `500 Internal Server Error`。

#### 解决方案

需要修改环境中的 M-Flow 源代码文件：

**修改目标文件十一：`项目环境路径\Lib\site-packages\m_flow\search\methods\search.py`**

定位到 `_authorized_search_impl` 函数中 `use_combined_context` 分支的末尾（第 398 行），在调用 `completion_fn` 之前增加 `only_context` 判断：

```python
# 修改前
completion_fn = tools[0]
combined_ctx = _merge_context_values(merged_context)
answer = await completion_fn(query_text, combined_ctx, session_id=session_id)

return answer, combined_ctx, all_datasets

# 修改后 (尊重 only_context 参数，跳过不必要的 LLM 生成)
completion_fn = tools[0]
combined_ctx = _merge_context_values(merged_context)

if only_context:
    return None, combined_ctx, all_datasets

answer = await completion_fn(query_text, combined_ctx, session_id=session_id)

return answer, combined_ctx, all_datasets
```

# 项目数据迁移的注意事项

将项目目录迁移至其他盘符（如从 `C:\` 移动到 `D:\`）后，调用 `m_flow.search()` 进行向量检索时可能出现以下现象：

- 检索日志显示 `total_hits=0, unique_ids=0`，或直接报告 `Searching an empty knowledge graph`
- 知识库中已有导入数据，但 LLM 回复类似「The provided context does not contain any information about ...」
- 向量数据库文件（`.lance.db` 目录）实际存在且包含完整的嵌入集合

## 报错原因

M-Flow 在首次 `memorize()` 入库时，会将数据集对应的向量数据库路径以**绝对路径**写入关系型数据库（SQLite）中的 `dataset_database` 表的 `vector_database_url` 字段。

```
# 示例：写入时项目在 C: 盘
C:\Files\Codes\M-Flow\backend\.runtime\system\databases\{user_id}\{dataset_id}.lance.db
```

当项目目录被移动到另一个盘符后，该绝对路径变为过期路径。M-Flow 的 `set_db_context()` 方法在检索时会直接使用该路径打开 LanceDB 连接。如果旧盘符路径仍然可达但已不包含实际数据，LanceDB 会静默地打开一个空目录并返回 0 条结果，而不会报错。

> **注意**：检索日志中的 `Multi-user access control is enabled...` 警告是 M-Flow 无条件输出的，**不代表**多用户隔离实际生效，也不是此问题的直接原因。请勿通过设置 `ENABLE_BACKEND_ACCESS_CONTROL=false` 来尝试解决此问题——如果数据是在 ACL 模式下导入的，关闭 ACL 反而会导致搜索指向空的根级数据库。

## 诊断方法

检查 `dataset_database` 表中存储的路径是否与当前项目实际路径一致：

```bash
cd backend
python -c "import sqlite3; conn = sqlite3.connect(r'.runtime\system\databases\experiment_mflow'); print(conn.cursor().execute('SELECT vector_database_url FROM dataset_database').fetchall()); conn.close()"
```

如果输出的盘符或目录路径与实际不符，即可确认此问题。

## 解决方案

执行以下命令，将 `vector_database_url` 中的旧盘符替换为当前盘符（以 `C:\` → `D:\` 为例）：

```bash
cd backend
python -c "
import sqlite3
conn = sqlite3.connect(r'.runtime\system\databases\experiment_mflow')
cur = conn.cursor()
cur.execute(\"UPDATE dataset_database SET vector_database_url = REPLACE(vector_database_url, 'C:\\\\', 'D:\\\\')\")
conn.commit()
print('Updated', cur.rowcount, 'row(s)')
conn.close()
"
```

修改完成后重新运行检索测试，向量搜索应能正常命中知识库中的数据。
