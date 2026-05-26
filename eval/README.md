# eval — RAG 系统评估模块

本目录对应飞书文档《知识图谱构建调研》中对 M-Flow 与 AnythingLLM 的对比测试部分，包含用于对 **M-Flow** 与 **AnythingLLM (ALLM)** 两套 RAG 系统进行自动化评估的全部脚本和数据文件，旨在通过统一的测试集和评估框架进行客观的效果对比。

## 目录结构

```
eval/
├── init.py              # 评估数据集初始化脚本
├── eval_M-Flow.py       # M-Flow 系统评估脚本
├── eval_ALLM.py         # AnythingLLM 系统评估脚本
├── raw_M-Flow.json      # M-Flow 评估用原始测试集
├── raw_ALLM.json        # AnythingLLM 评估用原始测试集
└── README.md            # 本说明文件
```

---

## 脚本说明

### `init.py` — 评估数据集初始化

此脚本负责为 M-Flow 系统构建用于评估的**知识图谱数据基础**。它读取指定的 Markdown 格式文档（当前配置为《骆驼祥子》的两个章节），调用 M-Flow 框架的接口完成文本解析、实体与关系抽取，最终将结构化知识存入底层知识图谱数据库中。

**核心流程：**

1. **文档读取** — 遍历 `MARKDOWNS` 列表中配置的 Markdown 文件路径，以 UTF-8 编码读取文件内容。
2. **文本灌入** — 调用 `m_flow.add(text)` 将纯文本送入 M-Flow 的处理队列进行切片。
3. **知识抽取** — 调用 `m_flow.memorize()` 触发大模型进行实体 (Entities)、关系 (Relations) 抽取，并将结果转化为 Episodes、Facets、FacetPoints 等内部数据结构落盘存储。

> **注意：** 在运行评估脚本前，必须先执行 `init.py` 完成知识图谱的构建，否则 M-Flow 评估脚本将无法检索到有效的上下文信息。

---

### `eval_M-Flow.py` 与 `eval_ALLM.py` — 系统评估脚本

这两个脚本分别对 **M-Flow** 和 **AnythingLLM** 进行自动化 RAG 评估，它们共享相同的评估框架和指标体系，仅在**答案获取方式**上存在差异：

| 对比维度 | `eval_M-Flow.py` | `eval_ALLM.py` |
|---|---|---|
| **评估目标** | M-Flow RAG 系统 | AnythingLLM RAG 系统 |
| **答案获取方式** | 调用 `m_flow.query()` Python 接口 | 通过 HTTP POST 请求调用 AnythingLLM REST API |
| **输入测试集** | `raw_M-Flow.json` | `raw_ALLM.json` |
| **结果存储** | `res_M-Flow.json` → `res_M-Flow.csv` | `res_ALLM.json` → `res_ALLM.csv` |
| **数据清洗** | 去除列表/字符串包裹符号 | 使用正则去除 `<think>...</think>` 推理标签 |

**共同的评估流程：**

1. **答案生成（支持断点续传）** — 循环读取原始测试集 (`raw_*.json`) 中的问题，逐一获取系统回答。每获取一条回答，立即将结果追加到 `res_*.json` 并从原始队列中移除该问题。若中途发生网络异常或 API 错误，脚本优雅退出并保留进度，再次运行即可从断点继续。
2. **数据清洗** — 对获取的回答进行针对性清理（如去除推理过程标签或包裹符号），防止干扰评估结果。
3. **Ragas 评估** — 使用 [Ragas](https://docs.ragas.io/) 框架进行多维度指标打分，评估指标包括：
   - **AnswerRelevancy（答案相关性）** — 回答与问题的相关程度
   - **AnswerSimilarity（答案相似度）** — 回答与标准答案的语义相似度
   - **AnswerCorrectness（答案正确性）** — 回答的事实准确性与完整度
4. **结果导出** — 输出综合评估得分并导出评估明细 CSV 文件。

**裁判模型配置：**

两个脚本均使用以下模型作为 Ragas 的裁判，通过环境变量在 `backend/.env` 中配置：

- **Judge LLM** — MiniMax（默认模型 `MiniMax-M2.7`），负责打分判断
- **Embedding Model** — Jina Embeddings（默认模型 `jina-embeddings-v4`），负责语义向量化

---

## 数据文件说明

### `raw_M-Flow.json` 与 `raw_ALLM.json` — 原始测试集

这两个 JSON 文件包含**完全相同的测试用例**，各 20 道基于《骆驼祥子》文本内容的阅读理解问题。之所以提供两份副本，是因为评估脚本采用**消费式队列**设计——每回答完一个问题就将其从原始文件中移除，以实现断点续传。因此两个评估脚本需要各自独立的数据副本。

**数据格式：**

```json
[
    {
        "question": "祥子的职业是什么？",
        "ground_truth": "祥子是一个人力车夫，以拉车为生。"
    }
]
```

每条测试用例包含两个字段：

| 字段 | 说明 |
|---|---|
| `question` | 向 RAG 系统提出的测试问题 |
| `ground_truth` | 人工标注的标准答案，作为评估基准 |

---

## 使用方法

```bash
# 1. 初始化 M-Flow 知识图谱（仅需执行一次）
python eval/init.py

# 2. 运行 M-Flow 评估
python eval/eval_M-Flow.py

# 3. 运行 AnythingLLM 评估（需确保 AnythingLLM 服务已启动且工作区已灌入文档）
python eval/eval_ALLM.py
```

> **前置条件：** 确保 `backend/.env` 中已正确配置 MiniMax、Jina 及 AnythingLLM 的 API Key 和接口地址。
