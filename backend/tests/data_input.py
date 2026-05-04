import asyncio
import sys
import os
from dotenv import load_dotenv

# 获取 backend 目录并加入 sys.path，以便正确导入项目中定义的其他模块
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# 加载环境变量，确保底层 M-Flow 能读取到所需的配置（如 LLM_API_KEY）
load_dotenv(os.path.join(backend_dir, ".env"))

import m_flow

async def main() -> None:
    """
    测试 M-Flow 知识引擎的数据入库（Ingestion）流程。
    
    该异步函数用于模拟和验证业务系统向 M-Flow 底层图数据库灌入数据的完整生命周期。
    主要涵盖两个核心阶段：
    1. `m_flow.add()`: 预处理阶段。将非结构化原始数据（如普通文本、文档、URL）挂载至指定的 Dataset 中。
    2. `m_flow.memorize()`: 认知构建阶段。触发 LLM 工作流，自动执行文本切块、摘要、命名实体识别（NER）
       以及结构化/语义边（Edge）的构建，最终将结果持久化至向量数据库和 Kuzu 图数据库。
    """
    print("🚀 开始进行 M-Flow 数据入库测试...")
    
    # 1. 准备测试文本数据
    # M-Flow 的 add 方法支持多态数据输入：
    # - 纯文本：直接传入字符串（如下方示例）。
    # - 本地文件：传入绝对/相对路径（如 data="c:/path/to/document.pdf"）。
    # - 批量文件：传入路径列表（如 data=["file1.txt", "file2.docx"]）。
    # - 网络爬取：传入 URL（如 data="https://example.com/article"）。
    # sample_text = "司母戊鼎，又称后母戊大方鼎，是商代晚期的一件青铜礼器，出土于河南安阳殷墟。"

    # M-Flow 内部的 Path.cwd() 指向当前工作目录，容易找不到文件
    # 此处使用绝对路径更加保险
    sample_text = os.path.abspath(os.path.join(os.path.dirname(__file__), 'file.md'))
    
    # 目标数据集名称，系统会自动为其分配或关联 UUID
    dataset_name = "artifacts_1"

    try:
        # 2. 阶段一：将数据添加进系统 (数据加载与预处理)
        print(f"[{dataset_name}] 正在添加数据...")
        await m_flow.add(
            data=sample_text, 
            dataset_name=dataset_name
        )
        print("✅ 数据预处理完成！")

        # 3. 阶段二：触发大模型抽取与入库 (构建认知图谱并持久化)
        print("🧠 正在调用 LLM 进行片段记忆 (Episodic) 和图谱结构的抽取，请耐心等待...")
        await m_flow.memorize(
            datasets=dataset_name,
            # 开启片段式关联图谱构建 (Episodic Memory)，建立事件/侧面/实体之间的结构化关联
            enable_episodic=True,
            # 控制文本块切分大小，需根据目标大模型的上下文窗口（Context Window）合理调整
            chunk_size=1000,
            # 开启多句子语义级别的精细化切分路由，有助于提升后续检索的准确度
            enable_content_routing=True
        )
        print("🎉 知识入库全部完成！节点和关系已成功写入图数据库和向量数据库中。")
        
    except Exception as e:
        # 捕获并记录入库过程中的异常（如 LLM API 超时、数据库写入失败等）
        print(f"❌ 入库过程中发生异常: {e}")

if __name__ == "__main__":
    # 执行异步主入口
    asyncio.run(main())
