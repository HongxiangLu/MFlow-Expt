# M-Flow 说明

> [!NOTE]
> 本文档中提及的源码修改已直接应用到项目内的 `m_flow/` 源码中，修改记录见 [MFLOW_DEV.md](./MFLOW_DEV.md)。

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
