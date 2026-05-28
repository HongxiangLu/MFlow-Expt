# M-Flow RAG 后端系统

基于 **[M-Flow](https://github.com/FlowElement-ai/m_flow)** 知识引擎构建的 RAG（检索增强生成）后端服务。系统以 **FastAPI** 为 Web 框架，集成 M-Flow 提供知识图谱构建与多模式语义检索能力，接入 **MiniMax-M2.7** 大语言模型实现流式对话生成，面向博物馆文物领域提供 AI 问答与知识图谱可视化功能。

核心能力：
- **RAG 对话**（`/api/chat`）—— 基于 M-Flow 检索的文档上下文 + LLM 流式生成（SSE 协议），支持多轮对话历史
- **知识图谱查询**（`/api/graph/query`）—— 自动 Query Rewrite 消除指代歧义，从 M-Flow 图数据库检索实体与关系，返回结构化图谱 JSON
- **M-Flow 深度集成** —— 进程内直接调用 M-Flow Python 库，支持 EPISODIC / TRIPLET_COMPLETION / CHUNKS_LEXICAL 等多种检索模式

技术栈：FastAPI · SQLAlchemy (async) · SQLite · M-Flow · OpenAI SDK (MiniMax) · SSE

## M-Flow 源码说明

本项目中的 [`m_flow/`](./m_flow) 目录是从 [M-Flow GitHub 仓库](https://github.com/FlowElement-ai/m_flow) 克隆的源码，已脱离上游 Git 历史，作为项目代码的一部分直接管理。采用源码引用（而非 pip 包）的目的是**方便对 M-Flow 进行深度定制修改**，包括 Prompt 模板适配、模型兼容性处理、平台兼容性修复等。

## 📖 文档索引

项目的详细设计与规范文档位于 [`docs/`](./docs) 目录下：

| 文档 | 内容与作用 |
|:-----|:----------|
| [REQUIREMENTS.md](./docs/REQUIREMENTS.md) | **需求与架构说明书 (SRS/PRD)**。定义项目背景、核心技术选型理由、两大核心接口（Chat / Graph Query）的完整业务流、数据模型与状态管理策略、以及 MVP 阶段的非功能性约束（单用户模式、扩展性留白等）。是整个项目的需求基线。 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | **系统架构设计文档**。详述 Controller → Service → Data Access 三层架构、项目目录结构、各核心模块的职责与实现细节，以及 M-Flow 检索降时策略。 |
| [API.md](./docs/API.md) | **API 接口文档**。定义所有 RESTful 接口的请求/响应契约，包括 SSE 流式数据帧格式、图谱响应的完整 TypeScript 类型定义与字段校验规则，附带详尽的请求/响应示例。 |
| [MFLOW_GUIDE.md](./docs/MFLOW_GUIDE.md) | **M-Flow 引擎核心机制指南**。从原理层面系统性介绍 M-Flow 的知识摄入流水线（切分→抽取→建图）、知识图谱的拓扑组织结构、工作原理与选型指南。 |
| [DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md) | **分阶段开发计划**。按自底向上的开发方法论，将项目拆分为 7 个阶段（配置系统 → 数据访问层 → 外部集成层 → 业务逻辑层 → 路由控制层 → 应用入口 → 端到端集成测试），每阶段标注产出文件、关键设计、验证方式与预估工时。 |
| [MFLOW_DEV.md](./docs/MFLOW_DEV.md) | **M-Flow 源码修改日志**。记录对项目内 `m_flow/` 源码的所有直接修改。 |

## 启动步骤

**1. 创建 Conda 环境**

```bash
conda create -n mflow python=3.13.3
conda activate mflow
```

**2. 安装 M-Flow（editable 模式）**

以 editable 模式安装本地 M-Flow 源码，修改源码后无需重新安装即可生效：

```bash
pip install -e ./m_flow -i https://pypi.tuna.tsinghua.edu.cn/simple
```

**3. 安装其他依赖**

```bash
pip install sse_starlette -i https://pypi.tuna.tsinghua.edu.cn/simple
```

**4. 配置环境变量**

复制 `.env.example` 为 `.env`，填入所需的 API Key 等配置：

```bash
copy .env.example .env
```

**5. 启动开发服务器**

```bash
python main.py
```

---

## 知识库建立

后端的 RAG 能力依赖 M-Flow 知识库中的数据。在启动服务前，需要先将原始文档数据灌入 M-Flow 知识引擎。入库工具位于 [`tools/data_input.py`](./tools/data_input.py)。

M-Flow 的数据入库分为两个阶段：`m_flow.add()`（将原始数据挂载到指定 Dataset）→ `m_flow.memorize()`（触发 LLM 进行切块、实体识别、图谱构建并持久化）。具体参数与用法参见 `data_input.py` 源码。

执行入库：

```bash
conda activate mflow
cd backend
python tools/data_input.py
```

**当前已入库内容**：[`tools/file.md`](./tools/file.md) 中从开头到"齐都水印"封泥的部分。

---

## 项目数据迁移

移动项目目录后，向量检索可能返回空结果。这是因为 M-Flow 入库时会将向量数据库的**绝对路径**写入 SQLite（`dataset_database.vector_database_url`），迁移后路径失效。

修复方法——将数据库中的旧路径替换为新路径：

```bash
cd backend
python -c "
import sqlite3
conn = sqlite3.connect(r'.runtime\system\databases\experiment_mflow')
cur = conn.cursor()
cur.execute(\"UPDATE dataset_database SET vector_database_url = REPLACE(vector_database_url, '<旧路径>', '<新路径>')\")
conn.commit()
print('Updated', cur.rowcount, 'row(s)')
conn.close()
"
```

---

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
