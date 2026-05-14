# M-Flow 引擎核心机制指南

> 本文档系统性地介绍 M-Flow 知识引擎的底层架构、知识图谱组织方式、检索模式与企业级能力，
> 旨在帮助开发者从原理层面理解 M-Flow 的设计哲学与工作机制。

---

## 一、数据摄入：从原文到知识图谱

当一篇文档被提交给 M-Flow 进行摄入（Ingestion / Memorize）时，系统并非简单地「切片存储」，
而是会经历一条**多阶段的信息提炼流水线**，将非结构化文本逐步转化为高度结构化的知识图谱。

### 1.1 文本切分（Chunking）

系统首先将长文档按字数或段落边界切分为若干 **`ContentFragment`（内容片段）** 节点。
每个 `ContentFragment` 保留了完整的原始文本（`text` 字段），并附带切分元数据：

| 字段 | 说明 |
|------|------|
| `text` | 原封不动的原始文本内容 |
| `chunk_size` | 该片段的字符数 |
| `chunk_index` | 在整篇文档中的分块序号 |
| `cut_type` | 切分策略（如 `paragraph_end`） |

此外，系统还会在 `metadata.sentence_classifications` 中将每段文字进一步拆分为**单独的句子**，
并为每句话标注 `event_topic`（事件主题）和 `event_focus`（事件焦点），为后续的路由和聚合提供依据。

### 1.2 知识抽取（Information Extraction）

在切分完成后，M-Flow 调用大语言模型（LLM）对每一段原文执行**信息抽取**，生成以下结构化产物：

- **Episode（情景锚点）**：对一个或多个相关 `ContentFragment` 的内容进行聚合提炼，
  生成一段精炼的 `summary`（摘要），作为该事件/主题的高密度索引载体。
- **Entity（实体）**：从文本中抽取的原子级概念（人名、书名、日期、地点等），
  每个实体带有 `name`（名称）和 `description`（语境描述）。
- **Facet（切面）**：Episode 的细节锚点，代表事件中的某个具体维度（如原因、风险、约束条件等），
  附带 `search_text`（检索锚点）和 `description`（扩展描述）。
- **Procedure（过程记忆）**：如果文本描述的是「方法论、SOP、操作步骤」等可复用的知识，
  系统会生成 `Procedure` 节点，并将具体步骤拆分为 `ProcedureStepPoint` 和 `ProcedureContextPoint`。

### 1.3 图谱构建（Graph Construction）

上述产物之间通过语义边互相连接，最终形成结构化的知识图谱，写入图数据库。

---

## 二、知识图谱的组织结构

M-Flow 的知识图谱采用**「森林（Forest）」拓扑**——整个图谱由大量独立的「树」组成，
每棵树以 `Episode` 或 `Procedure` 作为树干，向下扩展出层次分明的枝叶节点。

### 2.1 节点层级总览

```
MemorySpace (记忆空间 — 最高级逻辑隔离边界)
├── Episode (情景记忆锚点 — 陈述性事实/事件)
│   ├── has_facet ──→ Facet (切面/特征维度)
│   │                  └── has_point ──→ FacetPoint (细粒度信息点)
│   │                                         └── involves_entity ──→ Entity
│   ├── involves_entity ──→ Entity (实体：人名/书名/地点等)
│   └── includes_chunk ──→ ContentFragment (原始文本切片)
│
└── Procedure (过程记忆锚点 — 方法论/操作步骤)
    ├── has_context_point ──→ ProcedureContextPoint (前置条件/适用场景)
    └── has_key_point ──→ ProcedureStepPoint (关键步骤)
```

### 2.2 节点角色详解

| 节点类型 | 角色 | 核心字段 | 是否参与向量化 |
|---------|------|---------|:---:|
| `MemorySpace` | 最高层逻辑分区，用于多租户隔离 | `name` | ✗ |
| `Episode` | 情景记忆锚点，聚合多个原文片段 | `summary` | ✓（`summary`） |
| `Facet` | Episode 的细节维度 | `search_text`, `anchor_text` | ✓（`search_text`, `anchor_text`） |
| `FacetPoint` | Facet 下的细粒度信息点 | `search_text` | ✓（`search_text`） |
| `Entity` | 原子级实体（人、物、概念） | `name`, `description` | ✓（`name`, `canonical_name`） |
| `ContentFragment` | 原始文本切片（保留原文） | `text` | ✓（`text`） |
| `Procedure` | 过程记忆锚点（方法/SOP） | `summary` | ✓（`summary`） |
| `ProcedureContextPoint` | 操作步骤的前置条件 | — | — |
| `ProcedureStepPoint` | 具体操作步骤 | — | — |

### 2.3 树间连接机制

每棵树（以 `Episode` 或 `Procedure` 为根）的枝干节点（`Facet`、`FacetPoint`）是**严格私有的**，
绝不会被其他树引用。跨树连接仅通过以下三种受控机制发生：

#### A. 实体桥梁（`same_entity_as` 边）

这是最重要的跨树连接方式。M-Flow 采用了精巧的**「实体克隆 + 归一化连线」**策略来避免超级节点问题：

- 当树 A 和树 B 都提到「李白」时，它们各自生成一个**独立的** `Entity` 节点（携带各自语境下的描述）。
- 系统通过统一的 `canonical_name`（规范名）识别出它们指代同一实体，
  并在两个节点之间建立 `same_entity_as` 边。
- **效果**：既实现了跨树的逻辑贯通（可沿 `same_entity_as` 跳转），
  又避免了让一个节点变成拥有几万条边的「超级节点」（Dense Sub-graph 问题）。

#### B. 证据共享（`ContentFragment` 共享）

如果一段高密度原文同时涉及多个独立事件，多棵树的 `Episode` 会通过 `includes_chunk` 边
指向同一个 `ContentFragment` 节点，形成底层的证据共享。

#### C. 演化边

- **`derived_procedure`**：当某个 `Episode`（具体事实）中总结出了一条通用的 `Procedure`（规律/方法），
  两者之间会建立溯源边。
- **`supersedes`**：当 `Procedure` 更新迭代时，新版本节点会通过此边指向旧版本。

---

## 三、三层存储架构

M-Flow 采用**三种异构数据库协同工作（Polyglot Persistence）**的架构，
每种数据库各司其职，通过统一的全局 UUID 锁定在一起。

### 3.1 图数据库（Graph DB）—— 数据底座

**承载所有业务知识内容。** 所有节点（`ContentFragment`、`Episode`、`Entity`、`Facet`、`Procedure` 等）
及其之间的拓扑关系，均存储在图数据库（Neo4j / Kùzù）中。

长文本内容（如原文切片、摘要）直接保存在节点的 Properties 字段中，使得大模型在遍历图谱时直接获取文本，无需额外的跨库查表。

### 3.2 向量数据库（Vector DB）—— 快速入口

存放图节点核心文本字段的**高维向量数组（Embeddings）**，充当图谱的「语义搜索入口」。

向量化的内容包括：
- `ContentFragment.text` 的向量（支持原文块的语义匹配）
- `Episode.summary` 的向量（支持情景级别的语义匹配）
- `Entity.name` / `Entity.canonical_name` 的向量（支持实体级别的匹配）
- `Facet.search_text` / `Facet.anchor_text` 的向量（支持切面级别的匹配）

M-Flow 支持多种向量数据库适配器：ChromaDB、Milvus、LanceDB、PGVector、Pinecone。

### 3.3 关系型数据库（Relational DB）—— 元数据管家

**不存储任何业务知识内容**（不存储原文、摘要、实体等），仅负责宏观管理：

| 管理对象 | 说明 |
|---------|------|
| 用户与权限 | `User`, `Role`, `Tenant`, `ACL`, `Permission` |
| 数据集与原始文件 | `Dataset`, `Data`, `DatasetEntry` |
| 任务流与查询日志 | `Pipeline`, `Task`, `Query`, `Result` |

### 3.4 协作流程示意

以一次 `TRIPLET_COMPLETION` 检索为例，三层数据库的协作过程如下：

```
用户提问: "宋刻草堂诗笺是什么？"
         │
         ▼
┌─────────────────────────────┐
│   ① 向量数据库 (找线索)        │  将问题转为向量 → 余弦相似度匹配
│   命中 Episode / Entity UUID │  → 输出若干 UUID
└────────────┬────────────────┘
             │ UUID
             ▼
┌─────────────────────────────┐
│   ② 图数据库 (找关系)         │  以 UUID 为起点遍历图谱
│   扩展邻居节点和边            │  → 输出完整子图拓扑 + 节点属性文本
└────────────┬────────────────┘
             │ 子图 + 文本
             ▼
┌─────────────────────────────┐
│   ③ LLM 生成最终回答          │  将子图文本组装为 context
│   result = LLM(context)     │  → 输出自然语言回答
└─────────────────────────────┘
```

---

## 四、五种检索模式（RecallMode）

M-Flow 通过 `RecallMode` 枚举定义了五种检索策略，适用于不同的业务场景。

### 4.1 CHUNKS_LEXICAL（词法匹配）

**特性**：最底层、最原始的文本块召回，等同于**传统 RAG（检索增强生成）** 的工作方式。

该模式完全绕过知识图谱层，直接在向量数据库中对 `ContentFragment` 的文本向量进行相似度匹配，
按相关度排序后返回 `top_k` 条结果。这与 Elasticsearch 或纯向量数据库的限量检索（Limited Retrieval）
行为一致——通过 `top_k` 参数控制召回数量，只取最相关的若干段原文。

| 维度 | 说明 |
|------|------|
| 检索目标 | 直接命中 `ContentFragment` 节点 |
| `result` 返回内容 | **原封不动的原始文本切片**（附带完整元数据），按相关度排序，数量受 `top_k` 限制 |
| `context` | 空字典 |
| `graphs` | `None`（不触碰图数据库） |
| 是否经过 LLM | ✗（单阶段检索，无生成步骤） |

**与传统 RAG 的对应关系**：
- 传统 RAG 的 **R（Retrieval）** = 本模式的全部功能（向量匹配 + 限量召回）
- 传统 RAG 的 **G（Generation）** = 需要开发者自行将召回的原文拼装为 Prompt，交给 LLM 生成回答
- 本模式只负责 R，不负责 G；如需端到端的问答，应选择 `TRIPLET_COMPLETION` 或 `EPISODIC` 模式

**适用场景**：
- 需要精确溯源到「入库原文」的场景（如事实核查、证据展示）
- 需要向用户展示「原文出处」或「相似文献列表」的场景
- 需要自行控制 LLM 生成逻辑的高级场景（先召回原文，再自定义 Prompt）

**返回示例**（查询词：`杜工部草堂诗笺`，`result` 字段片段）：
```json
{
  "name": "",
  "type": "ContentFragment",
  "chunk_size": 916,
  "chunk_index": 0,
  "cut_type": "paragraph_end",
  "text": "## 杜工部草堂诗笺\n\n- **原名**: 宋刻草堂诗笺\n- **时代**: 宋\n- **类别**: 雕版\n- **简介**: 《杜工部草堂诗笺》五十卷，以编年集注的形式笺注杜甫诗歌...",
  "metadata": {
    "sentence_classifications": [
      { "sentence_idx": 0, "event_topic": "杜工部草堂诗笺", "event_focus": "版本特征、孤本情况及收藏历史" },
      { "sentence_idx": 1, "event_topic": "杜工部草堂诗笺", "event_focus": "..." }
    ]
  }
}
```
> 可以看到，`text` 字段即为原封不动的入库原文，`context` 和 `graphs` 均为空。

### 4.2 TRIPLET_COMPLETION（三元组图检索）

**特性**：最能体现 Graph RAG 核心价值的模式——两阶段检索。

| 维度 | 说明 |
|------|------|
| 检索目标 | 图谱中的 `Episode`、`Entity`、`Facet` 节点及其连线 |
| `result` 返回内容 | **LLM 基于图谱上下文生成的自然语言回答** |
| `context` | 包含命中的节点文本和连线关系（格式化为文本供 LLM 阅读） |
| `graphs` | 完整的子图拓扑 JSON（节点 + 边，供前端渲染知识图谱） |
| 是否经过 LLM | ✓（先检索图谱上下文，再交由 LLM 生成回答） |

**`context` 的典型格式**：
```
Nodes:
Node: [Episode]
__node_content_start__
[May 06, 2026 (recorded)] ID: 杜工部草堂诗笺
Summary: 【杜工部草堂诗笺】宋代雕版印刷纸本线装书籍...
__node_content_end__
Node: 杜工部草堂诗笺
__node_content_start__
《杜工部草堂诗笺》是宋代编年集注杜甫诗歌的注本...
__node_content_end__

Connections:
[Episode] --[杜工部草堂诗笺 | 描述文本...]--> 杜工部草堂诗笺
```

**关键优势**：
- 图谱节点中存储的是 LLM 提炼后的**高密度知识**，消除了原文中的冗余噪音
- 通过边的拓扑关系，LLM 可以实现**跨文档多跳推理**

**返回示例**（查询词：`杜工部草堂诗笺`）：

`result`（LLM 生成的自然语言回答）：
> 《杜工部草堂诗笺》原名《宋刻草堂诗笺》，是宋代雕版印刷的纸本线装书籍，50卷的编年集注，注释杜甫诗歌，属宋代最重要的杜诗注本之一。现仅存5卷，包括宋祁的《传叙碑铭》、赵子栎与鲁訔的《年谱》以及蔡梦弼的《诗话》，为孤本，已列入《国家珍贵古籍名录》和《上海市珍贵古籍名录》。

`graphs`（子图拓扑，Nodes: 4, Edges: 3）：
```json
{
  "sample_node": {
    "id": "7898cde2-41ee-5681-97b8-e19dc9888786",
    "label": "杜工部草堂诗笺",
    "type": "Episode",
    "attributes": { "summary": "【杜工部草堂诗笺】（原名宋刻草堂诗笺），宋代雕版印刷..." }
  },
  "sample_edge": {
    "source": "7898cde2-...",
    "target": "257acfaf-...",
    "label": "involves_entity"
  }
}
```

### 4.3 EPISODIC（情景感知检索）

**特性**：专门针对 `Episode`（情景记忆锚点）进行检索，是 M-Flow 双轨记忆系统中「情景记忆」轨道的专属入口。

与 `TRIPLET_COMPLETION` 模式检索整个图谱（Episode + Entity + Facet）不同，
`EPISODIC` 模式**仅在 Episode 层级**进行语义匹配。系统将用户查询转化为向量，
直接在 `Episode.summary`（情景摘要）的向量集合中搜索最相关的事件锚点，
然后将命中的 Episode 摘要作为上下文交给 LLM 生成回答。

| 维度 | 说明 |
|------|------|
| 检索目标 | `Episode` 节点的 `summary` 字段 |
| 返回类型 | `list`（而非 `CombinedSearchResult`） |
| 返回内容 | LLM 基于匹配到的 Episode 摘要信息生成的回答列表 |
| `context` / `graphs` | 不单独返回（已融入 LLM 的生成过程中） |
| 是否经过 LLM | ✓ |

**与 TRIPLET_COMPLETION 的区别**：
- `TRIPLET_COMPLETION` 会遍历图谱拓扑（沿边扩展邻居节点），适合需要**跨实体推理**的复杂问题
- `EPISODIC` 只做 Episode 级别的平面匹配，适合 **「发生了什么事」** 类的直接事件查询，速度更快、噪音更少

**适用场景**：
- 事件回溯类查询（如「关于某次展览的记录」）
- 时间线梳理（Episode 天然带有时间戳信息 `mentioned_time_*`）
- 需要快速获取事件级别摘要而非深层推理的场景

**返回示例**（查询词：`杜工部草堂诗笺`）：
```json
["《杜工部草堂诗笺》原名《宋刻草堂诗笺》，是宋代雕版印刷的线装书籍，收录并注释杜甫的诗作，共50卷，现存5卷（包括《传叙碑铭》《年谱》《诗话》），为宋代最重要的杜诗注本之一，已入选《国家珍贵古籍名录》。"]
```
> 返回类型为 `list`，每个元素是 LLM 基于 Episode 摘要生成的自然语言回答字符串。

### 4.4 PROCEDURAL（过程知识检索）

**特性**：专门针对 `Procedure`（过程记忆锚点）进行检索。

| 维度 | 说明 |
|------|------|
| 返回类型 | `list` |
| 返回内容 | LLM 基于匹配到的 Procedure 信息生成的回答列表 |
| 注意事项 | 如果知识库中没有方法论/步骤类内容，该模式可能返回空结果 |

**返回示例**（查询词：`杜工部草堂诗笺`，知识库中无相关过程知识）：
```json
["The provided context does not contain any information about \"杜工部草堂诗笺\", so I cannot answer the question."]
```
> 当知识库中不存在与查询相关的过程/步骤类知识时，LLM 会明确告知无法回答。

> [!WARNING]
> `EPISODIC` 和 `PROCEDURAL` 模式在启用 `use_combined_context=True` 时，
> 底层的 `_merge_context_values` 方法会将 Edge 对象强制转为字符串，
> 导致后续函数在读取 `node1`/`node2` 属性时抛出 `AttributeError`。
> 这是 M-Flow SDK 的一个已知 Bug，当前的规避方案是在这两种模式下关闭 `use_combined_context`。

### 4.5 CYPHER（原生图谱查询）

**特性**：直接执行 Cypher 查询语句，返回图数据库的原始结果。

| 维度 | 说明 |
|------|------|
| 检索目标 | 直接查询图数据库中的节点和边 |
| `result` 返回内容 | 图数据库返回的原始节点/关系记录（包含完整的 Properties JSON） |
| `context` | 空 |
| `graphs` | `None` |
| 是否经过 LLM | ✗（透传图数据库的原始查询结果） |

### 4.6 模式选择速查表

| 场景 | 推荐模式 | 理由 |
|------|---------|------|
| 事实核查，需要精确溯源原文 | `CHUNKS_LEXICAL` | 返回原封不动的入库文本 |
| 知识问答，需要自然语言回答 + 图谱可视化 | `TRIPLET_COMPLETION` | 兼顾推理深度和图谱渲染 |
| 时间线/事件回溯类查询 | `EPISODIC` | 直接命中情景记忆锚点 |
| 操作步骤/方法论/SOP 查询 | `PROCEDURAL` | 直接命中过程记忆锚点 |
| 开发调试，直接探查图数据库 | `CYPHER` | 绕过一切封装，直读底层数据 |

---

## 五、企业级能力

### 5.1 多租户与权限控制（RBAC + ACL）

M-Flow 内置了完整的权限管理体系：

| 业务概念 | M-Flow 对象 | 说明 |
|---------|------------|------|
| 组织 | `Tenant`（租户） | 数据物理/逻辑隔离的最高边界 |
| 团队/角色 | `Role` | 在租户内定义访问级别 |
| 个人 | `User` | 绑定到具体角色 |
| 权限规则 | `ACL` / `Permission` | 细粒度控制每个用户/角色对每个 Dataset 的读写权限 |

查询时，只需在请求头中传入用户鉴权 Token，M-Flow 的 `search` 函数会**自动过滤**，
确保用户只能检索到其权限范围内的知识。

### 5.2 数据集隔离（Dataset）

`Dataset` 是 M-Flow 对知识的最高管理容器，可映射为业务中的「书籍」、「项目」或「知识域」。

- **入库隔离**：每本书/每个项目单独创建一个 `Dataset`，其切块和图谱节点均带有 `dataset_id` 标记。
- **查询圈定**：调用 `search` 时可传入 `dataset_ids` 参数，严格限定检索范围。

```python
# 仅在指定的两本书中检索
search_result = await m_flow_search(
    query_text="请问这本书的作者是谁？",
    query_type=RecallMode.CHUNKS_LEXICAL,
    dataset_ids=["dataset_id_book_A", "dataset_id_book_B"]
)
```

权限控制和数据集隔离构成了**双重过滤**：
1. **第一层（权限校验）**：确保用户只能看到有权访问的 Dataset。
2. **第二层（范围圈定）**：在用户的权限范围内，进一步缩小到其手动选择的 Dataset。

---

## 六、核心概念速查

| 概念 | 本质 | 存储位置 |
|------|------|---------|
| `ContentFragment` | 原始文本切片（保留原文） | 图数据库节点 + 向量数据库 |
| `Episode` | 情景记忆锚点（LLM 提炼的事件摘要） | 图数据库节点 + 向量数据库 |
| `Entity` | 原子级实体（人名/书名/概念） | 图数据库节点 + 向量数据库 |
| `Facet` | Episode 的细节维度 | 图数据库节点 + 向量数据库 |
| `FacetPoint` | Facet 下的细粒度信息点 | 图数据库节点 + 向量数据库 |
| `Procedure` | 过程记忆锚点（方法论/SOP） | 图数据库节点 + 向量数据库 |
| `MemorySpace` | 逻辑隔离分区（多租户） | 图数据库节点 |
| `Dataset` | 知识管理容器（书籍/项目） | 关系型数据库表 |
| `Tenant` / `User` / `Role` | 权限管理对象 | 关系型数据库表 |
| Embeddings | 节点文本的高维向量 | 向量数据库 |
