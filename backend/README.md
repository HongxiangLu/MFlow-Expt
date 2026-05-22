# M-Flow RAG 后端系统

基于 **[M-Flow](https://github.com/FlowElement-ai/m_flow)** 知识引擎构建的 RAG（检索增强生成）后端服务。系统以 **FastAPI** 为 Web 框架，集成 M-Flow 提供知识图谱构建与多模式语义检索能力，接入 **MiniMax-M2.7** 大语言模型实现流式对话生成，面向博物馆文物领域提供 AI 问答与知识图谱可视化功能。

核心能力：
- **RAG 对话**（`/api/chat`）—— 基于 M-Flow 检索的文档上下文 + LLM 流式生成（SSE 协议），支持多轮对话历史
- **知识图谱查询**（`/api/graph/query`）—— 自动 Query Rewrite 消除指代歧义，从 M-Flow 图数据库检索实体与关系，返回结构化图谱 JSON
- **M-Flow 深度集成** —— 进程内直接调用 M-Flow Python 库，支持 EPISODIC / TRIPLET_COMPLETION / CHUNKS_LEXICAL 等多种检索模式

技术栈：FastAPI · SQLAlchemy (async) · SQLite · M-Flow · OpenAI SDK (MiniMax) · SSE

---

## 📖 文档索引

项目的详细设计与规范文档位于 [`docs/`](./docs) 目录下：

| 文档 | 内容与作用 |
|:-----|:----------|
| [REQUIREMENTS.md](./docs/REQUIREMENTS.md) | **需求与架构说明书 (SRS/PRD)**。定义项目背景、核心技术选型理由、两大核心接口（Chat / Graph Query）的完整业务流、数据模型与状态管理策略、以及 MVP 阶段的非功能性约束（单用户模式、扩展性留白等）。是整个项目的需求基线。 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | **系统架构设计文档**。详述 Controller → Service → Data Access 三层架构、项目目录结构、各核心模块的职责与实现细节（路由层、业务逻辑层、M-Flow Facade、数据模型、LLM 集成），以及 M-Flow 检索降时策略（模式切换、参数调优、缓存、日志优化、耗时埋点等性能优化专项）。 |
| [API.md](./docs/API.md) | **API 接口文档**。定义所有 RESTful 接口的请求/响应契约，包括 SSE 流式数据帧格式、SSE 流内错误事件规范（错误码枚举）、检索降级策略、图谱响应的完整 TypeScript 类型定义与字段校验规则，附带详尽的请求/响应示例。 |
| [MFLOW_GUIDE.md](./docs/MFLOW_GUIDE.md) | **M-Flow 引擎核心机制指南**。从原理层面系统性介绍 M-Flow 的知识摄入流水线（切分→抽取→建图）、知识图谱的森林拓扑组织结构（Episode/Facet/Entity 等节点层级与跨树连接机制）、三层异构存储架构（图数据库 + 向量数据库 + 关系型数据库）、五种检索模式（CHUNKS_LEXICAL / TRIPLET_COMPLETION / EPISODIC / PROCEDURAL / CYPHER）的工作原理与选型指南，以及企业级多租户权限控制与数据集隔离能力。 |
| [DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md) | **分阶段开发计划**。按自底向上的开发方法论，将项目拆分为 7 个阶段（配置系统 → 数据访问层 → 外部集成层 → 业务逻辑层 → 路由控制层 → 应用入口 → 端到端集成测试），每阶段标注产出文件、关键设计、验证方式与预估工时。 |
| [MFLOW_FIX.md](./docs/MFLOW_FIX.md) | **M-Flow 源码修补方案**。记录本项目所需的全部 M-Flow 库源码级修改（Prompt 模板适配、Pydantic Schema 修正、MiniMax 模型兼容性处理、Windows 负数时间戳兼容、`only_context` 逻辑缺陷修复、版本标识修正等），以及项目数据迁移注意事项。附带一键自动修补脚本 [`patch_mflow.py`](./tools/patch_mflow.py)。 |

> [!IMPORTANT]
> **首次使用本项目前**，请务必先阅读 [MFLOW_FIX.md](./docs/MFLOW_FIX.md)，了解需要对 M-Flow 库源码进行的适配修改，然后执行自动修补脚本 [`python tools/patch_mflow.py`](./tools/patch_mflow.py) 完成所有修补。未执行修补将导致知识入库与检索流程出现兼容性异常。

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
