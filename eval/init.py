"""
初始化评估数据集的脚本 (Initialization Script for Evaluation Dataset)

此脚本负责读取指定的 Markdown 格式的文档内容，并调用 M-Flow 框架的接口
进行文本解析、实体与关系抽取，最终将结构化的知识存入底层知识图谱数据库中，
为后续的 RAG (Retrieval-Augmented Generation) 评估提供数据基础。
"""
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量配置，优先加载 backend 目录下的 .env 文件
load_dotenv("backend/.env")

import m_flow

# 待处理的源文档路径列表
# 建议配置为相对路径，基于运行该脚本的工作目录
MARKDOWNS = [
    r"docs/骆驼祥子1.md",
    r"docs/骆驼祥子2.md",
]

async def main() -> None:
    """
    主异步函数，遍历配置的 Markdown 文件并将其摄入 M-Flow 系统。
    
    处理流程：
    1. 读取 Markdown 文件内容为字符串。
    2. 调用 m_flow.add(text) 将纯文本灌入缓存或文本切片库。
    3. 调用 m_flow.memorize() 触发大模型进行知识图谱的实体抽取与关系构建，并落盘存储。
    """
    for markdown_file in MARKDOWNS:
        # 使用 pathlib 安全地读取文件，指定 UTF-8 编码防止乱码
        md_text = Path(markdown_file).read_text(encoding="utf-8")
        
        print(f"\n[{markdown_file}] ----- 开始处理 -----")
        
        # 步骤 1: 将纯文本内容加入 M-Flow 系统的处理队列
        print(f"[{markdown_file}] 解析文档切片中......")
        await m_flow.add(md_text)
        
        # 步骤 2: 触发记忆固化，抽取实体(Entities)、关系(Relations)
        # 并转化为 Episodes, Facets 和 FacetPoints 等内部数据结构落库
        print(f"[{markdown_file}] 抽取实体和关系入库......")
        await m_flow.memorize()
        
        print(f"[{markdown_file}] 处理并落盘完毕")

if __name__ == "__main__":
    # 使用 asyncio 运行异步主函数
    asyncio.run(main())