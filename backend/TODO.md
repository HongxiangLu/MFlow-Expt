# M-Flow RAG 后端 — 开发任务列表 (TODO)

## 🔴 待确认的问题 (Blockers for Scaffolding)

以下事项需尽快决定，以便开始编码：

1.  **CORS 配置范围**:
    *   允许的 Origin 列表是什么？MVP 阶段是否直接 `allow_origins=["*"]`？
2.  **Uvicorn 启动配置**:
    *   开发阶段的 host/port 是否固定为 `0.0.0.0:8000`？是否需要 `--reload`？
3.  **图谱展示中心点选取策略**:
    *   目前初步定为选取检索结果中权重最高或首个 `artifact` 节点。是否需要更复杂的算法？

---

## 🟡 待办事项 (Implementation Tasks)

1.  **项目脚手架搭建**:
    *   [ ] 创建目录结构骨架 (api, core, db, schemas, services)。
    *   [ ] 实现 `core/config.py` (pydantic-settings)。
    *   [ ] 实现 `db/database.py` (SQLAlchemy 异步引擎 + WAL 初始化)。
2.  **日志规范实现**:
    *   [ ] 引入 `loguru` 进行结构化日志记录。
    *   [ ] 记录 LLM 调用的耗时、M-Flow 检索的耗时等关键指标。
3.  **开发资产搜集与迁移**:
    *   [ ] 将 Copilot/Gemini 网页版对话历史中有价值的信息搜集下来。
    *   [ ] 将前期性能测试用的脚本迁移至项目中。
4.  **优化建议 (可选)**:
    *   [ ] **重写逻辑的复用优化**：前端先请求 `/api/rewrite` 获取独立 Query，再并发请求 Chat 和 Graph 接口。

---

## ✅ 已解决事项 (Completed)

- [x] **架构选型确认**：FastAPI + SQLAlchemy (aiosqlite) + WAL 模式。
- [x] **目录结构规范**：已在 `ARCHITECTURE.md` §2 定义。
- [x] **依赖包管理**：已在 `requirements.txt` 补全核心依赖。
- [x] **流式错误处理**：已在 `API.md` §1.5.2 定义 `event: error` 事件帧。
- [x] **配置系统**：Pydantic-settings + 单个 `.env` 分区管理。
- [x] **M-Flow API 确认**：已确认 `query` 和 `search` 签名及调用方式。
- [x] **数据映射逻辑**：确认 `graphId` 哈希生成、`nodeType` 映射与 fallback 逻辑。
