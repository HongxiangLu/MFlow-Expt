# Git 规范

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 规范进行提交。

## 提交格式

```
<type>(<scope>): <description>
```

## 提交类型 (Type)

- **feat**: 新功能 (Feature)
- **fix**: 修复 Bug (Bug Fix)
- **docs**: 文档修改 (Documentation)
- **style**: 代码格式修改（不影响代码运行的变动，如空格、格式化、缺失的分号等）
- **refactor**: 代码重构（既不是新增功能，也不是修改 Bug 的代码变动）
- **perf**: 性能优化 (Performance)
- **test**: 增加或修改测试用例 (Test)
- **build**: 影响构建系统或外部依赖的更改（如 pip, poetry）
- **ci**: 对 CI/CD 配置文件和脚本的更改（如 GitHub Actions）
- **chore**: 其他不修改源代码或测试文件的更改（如构建过程或辅助工具的变动）
- **revert**: 撤销之前的提交 (Revert)

## 提交示例

- `feat(api): 添加用户注册接口`
- `fix(auth): 修复登录时密码验证失败的问题`
- `docs(readme): 更新提交规范说明`

## 分支命名规范

分支命名应遵循以下格式：

```
<type>/<description>
```

## 分支类型 (Type)

- **feat**: 用于开发新功能（例如：`feat/user-login`）
- **fix**: 用于修复常规 Bug（例如：`fix/api-timeout`）
- **hotfix**: 用于修复生产环境紧急 Bug（例如：`hotfix/payment-crash`）
- **docs**: 用于编写或更新文档（例如：`docs/api-guide`）
- **refactor**: 用于代码重构（例如：`refactor/auth-module`）
- **release**: 用于准备发布新版本（例如：`release/v1.2.0`）

## 分支命名规则

1. 推荐使用全小写字母。
2. 单词之间使用短横线 `-` 连接。
3. 描述（description）应简明扼要，能够清晰表达该分支的目的。

## 分支命名示例

- `feat/add-payment-gateway`
- `fix/login-page-layout`
- `hotfix/security-vulnerability-patch`

# M-Flow 使用说明

在本项目后端与底层 M-Flow 知识引擎集成的过程中，我们对 M-Flow 的节点与关系构建机制进行了深入溯源，特此记录核心原理解析，以供后续开发与环境部署参考。

## 节点 (Node) 的定义与类型修改

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

## 关系 (Edge) 的构建逻辑

M-Flow 中的关系不仅仅有结构化类型（如 `relationship_name`），还会被赋予详尽的自然语言描述（`edge_text`）和数值权重（`weight`）。这些描述构成了图谱能直接回答复杂语义关联的基础。

在 M-Flow 默认的 `memorize()` 知识入库流中，构建的是**片段式记忆网络 (Cone Graph/Episodic Memory)**，而非传统意义上点对点的语义三元组知识图谱。

这意味着，当您将知识送入 M-Flow 数据库时：
1. 框架**不会**在两个实体（如「妇好」和「司母戊鼎」）之间直接建立诸如「拥有」或「创作」的语义连线。
2. 框架会建立**结构化关联**：即实体 A 链接到某个信息片段（Facet），实体 B 也链接到这个信息片段。它们之间通过片段产生了逻辑上的关联。

*   **对于入库**：因为真实入库（写入数据库）的边（Edge）的 label 是 M-Flow 框架代码中写死的结构化名称（如 `involves_entity`、`has_facet` 等）。大模型在入库的这一环节，只负责抽取节点实体，而**不负责**推断实体与实体之间的直接动作关系（Prompt 中明确限定了 `Edge/relationship inference is handled downstream`）。因此，开发者不需要去预定义一套动作关系白名单。
*   **对于查询 (TRIPLET_COMPLETION)**：所谓的「三元组补全」，是在检索（Search）阶段发生的。系统通过图游走算法，沿着 `[实体] <- [involves_entity] - [片段] - [involves_entity] -> [实体]` 的路径进行补全。前端所拿到的图谱连线，实质上是这些结构化边的投射，我们在 API 封装层（`mflow_client.py`）统一将其 `label` 兜底降级为 `"related"` 以作展示。

## 节点与关系的直接检索方式
如果需要跳过大模型生成环节，直接获取底层的原生节点和边数据：
1. **原生图查询 (CYPHER 模式)**：推荐做法。通过调用 `m_flow.search(..., query_type=RecallMode.CYPHER)` 并传入相应的 Cypher 查询语句（需注意 M-Flow 底层为了兼顾严格类型的图数据库，统一将实体存放在 `Node` 表中，边存放在 `EDGE` 表中，并通过提取 JSON 的 `properties` 字段来读取动态属性如 `edge_text`）。
2. **三元组模式关联查询**：使用 `TRIPLET_COMPLETION` 模式，并结合参数 `only_context=True` 与 `use_combined_context=True`，可以在不触发 LLM 生成的前提下，让 M-Flow 后端拼装并返回包含节点和边的可视化结构数据（位于返回对象的 `graphs` 字段中）。

## 上下文检索策略 (Recall Modes)
M-Flow 支持直接跳过生成步骤获取上下文，其底层提供了以下三种代表性的知识检索策略：
*   **EPISODIC (情境记忆检索)**：核心检索方式。基于事件树状结构进行检索，支持混合检索与时间加权打分，并依靠图谱游走自适应计算相关性。适用于询问过去发生的事件、复杂情境或会话记录。
*   **TRIPLET_COMPLETION (三元组关联检索)**：精细粒度。基于图谱中的实体关系边进行扩散检索，具有基于跳数和图距离的衰减惩罚机制，主要用于传统图谱事实型回答的数据源。
*   **CHUNKS_LEXICAL (文本块词法检索)**：回退到传统 RAG 模式。仅对文本块执行基于倒排索引的精确 Token/关键字匹配（Lexical matching），不涉及复杂的图结构扩散推断。

## 流式输出 (Streaming) 的支持

1. **M-Flow Python 库不支持原生流式返回**：项目顶层暴露的 Python SDK（如 `query`、`search`）均为等待全部检索与生成完毕后，一次性返回 `QueryResult` 等数据结构的阻塞式调用。
2. **业务系统的流式 RAG 实现**：在开发过程中，如果需要实现打字机效果的响应，推荐采用 **“解耦调用”** 的工程策略：
   * **第一步：检索**。调用 `m_flow.search()` 获取单纯的图谱/文本上下文。
   * **第二步：生成**。将获取的上下文直接组装至业务后端的 Prompt 中，交由标准的 LLM 客户端库（如 `AsyncOpenAI`）开启 `stream=True` 进行流式推理，最后经由 SSE 协议推送给前端。

# M-Flow 的兼容性问题

## MiniMax 的 System 角色限制

在使用 MiniMax 模型接入 M-Flow 进行图谱构建（如调用 `memorize()`）时，可能会遇到如下异常导致流程阻断：
`litellm.BadRequestError: OpenAIException - invalid params, chat content has invalid message role: system (2013)`

### 报错原因

这源于底层的格式严格校验：

1. **M-Flow 硬编码 System**：M-Flow 内部核心层在发送提取指令时，在代码中硬编码了包含 `system` 角色的 `messages` 数组。
2. **Litellm 路由**：作为中间件的 `litellm`，即使在 `.env` 中配置了原生的 `LLM_MODEL=minimax/MiniMax-M2.7`，其负责处理的 `MinimaxChatConfig`（继承自 `OpenAIGPTConfig`）也未对 `system` 角色做降级或合并处理。
3. **MiniMax 严格校验**：MiniMax 平台接口对于传入的 Role 字段有着极其严格的物理校验，直接拒绝并抛弃带有 `system` 标识的任何请求结构体。

### 解决方案

修改环境内的 M-Flow 源代码，人为将 `system` 指令前置拼接并降级合并为 `user` 角色。需要修改以下三个底层文件：

**文件 1：`项目环境路径\Lib\site-packages\m_flow\llm\LLMGateway.py`**

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

**文件 2：`项目环境路径\Lib\site-packages\m_flow\llm\backends\litellm_instructor\llm\openai\adapter.py`**

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

## M-Flow 版本标识修正

若需要执行 `mflow -ui` 启动内置可视化界面，由于底层包名变更及 GitHub 仓库所有者迁移，需要手动对环境中的 M-Flow 源代码进行以下两处修正：

**1. 修正版本获取包名**

*   **文件路径**：`项目环境路径\Lib\site-packages\m_flow\version.py`

*   **修改点**：定位到第 30 行，将 `importlib.metadata.version` 的参数由旧包名改为新包名。

```python
# 修改前
_CACHED = importlib.metadata.version("m_flow")

# 修改后 (修正为正确的 pip 包名)
_CACHED = importlib.metadata.version("mflow-ai")
```

**2. 修正 UI 静态资源下载地址**

*   **文件路径**：`项目环境路径\Lib\site-packages\m_flow\api\v1\ui\ui.py`

*   **修改点**：定位到第 110 行，更新 GitHub 仓库的所有者名称。

```python
# 修改前
url = f"https://github.com/m-flow-project/m_flow/archive/refs/tags/v{clean}.zip"

# 修改后 (更新仓库所有者为 FlowElement-ai)
url = f"https://github.com/FlowElement-ai/m_flow/archive/refs/tags/v{clean}.zip"
```

## Windows 环境下的历史日期

在 Windows 环境下入库包含 1970 年以前日期（如古籍年代）的数据时，可能会触发 `OSError: [Errno 22] Invalid argument`。这是因为 Windows 底层 C 库不支持负数时间戳（即 1970 年以前的 Unix 时间戳），导致 Python 的 `datetime.fromtimestamp()` 调用失败。

若遇到此类报错，需要对环境中的两个核心文件进行手动修正：

**1. 修改时间解析器**

*   **文件路径**：`项目环境路径\Lib\site-packages\m_flow\retrieval\time\query_time_parser.py`
*   **修改点**：定位到约第 992 行，改用 `timedelta` 计算偏移量以兼容负数时间戳。

```python
# 修改前
now_dt = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)

# 修改后 (兼容 Windows 负数时间戳)
from datetime import timedelta
now_dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=now_ms / 1000)
```

**2. 修改时间提取器（防御性修正）**

*   **文件路径**：`项目环境路径\Lib\site-packages\m_flow\retrieval\time\mentioned_time_extractor.py`
*   **修改点**：定位到约第 127 行，避免直接调用 `.timestamp()`。

```python
# 修改前
ts_ms = int(dt.timestamp() * 1000)

# 修改后 (兼容 Windows 负数时间戳)
ts_ms = int((dt - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds() * 1000)
```
