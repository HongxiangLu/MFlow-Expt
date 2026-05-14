import asyncio
import sys
import os
import time
import json
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

# 获取 backend 目录并加入 sys.path，以便正确导入项目中定义的其他模块
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# 加载环境变量，确保底层 M-Flow 能读取到所需的配置（如 LLM_API_KEY）
load_dotenv(os.path.join(backend_dir, ".env"))

import m_flow


def _count_chars(file_path: str) -> int:
    """读取文件并返回总字符数。"""
    with open(file_path, "r", encoding="utf-8") as f:
        return len(f.read())


def _save_stats(stats: dict) -> str:
    """
    将统计信息以 JSON 格式追加写入 stats 目录下的日志文件。
    文件名格式：stats_MMDDHHMM.jsonl（每日一个文件，按行追加）。
    返回写入的文件路径。
    """
    stats_dir = os.path.join(os.path.dirname(__file__), "stats")
    os.makedirs(stats_dir, exist_ok=True)

    date_str = datetime.now().strftime("%m%d%H%M")
    stats_file = os.path.join(stats_dir, f"stats_{date_str}.jsonl")

    with open(stats_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(stats, ensure_ascii=False, indent=None) + "\n")

    return stats_file


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
    sample_text = os.path.abspath(os.path.join(os.path.dirname(__file__), 'file_1.md'))
    
    # 目标数据集名称，系统会自动为其分配或关联 UUID
    dataset_name = "artifacts_1"

    # ── 统计字符数 ──
    char_count = 0
    if os.path.isfile(sample_text):
        char_count = _count_chars(sample_text)
        print(f"📊 文件字符数: {char_count:,}")

    # ── 入库参数 ──
    chunk_size = 1000
    enable_episodic = True
    enable_content_routing = True

    # ── 计时 & 入库 ──
    total_start = time.perf_counter()
    add_elapsed = 0.0
    memorize_elapsed = 0.0
    success = False
    error_message = None

    try:
        # 2. 阶段一：将数据添加进系统 (数据加载与预处理)
        print(f"[{dataset_name}] 正在添加数据...")
        add_start = time.perf_counter()
        await m_flow.add(
            data=sample_text, 
            dataset_name=dataset_name
        )
        add_elapsed = time.perf_counter() - add_start
        print(f"✅ 数据预处理完成！(耗时 {add_elapsed:.2f}s)")

        # 3. 阶段二：触发大模型抽取与入库 (构建认知图谱并持久化)
        print("🧠 正在调用 LLM 进行片段记忆 (Episodic) 和图谱结构的抽取，请耐心等待...")
        memorize_start = time.perf_counter()
        await m_flow.memorize(
            datasets=dataset_name,
            # 开启片段式关联图谱构建 (Episodic Memory)，建立事件/侧面/实体之间的结构化关联
            enable_episodic=enable_episodic,
            # 控制文本块切分大小，需根据目标大模型的上下文窗口（Context Window）合理调整
            chunk_size=chunk_size,
            # 开启多句子语义级别的精细化切分路由，有助于提升后续检索的准确度
            enable_content_routing=enable_content_routing
        )
        memorize_elapsed = time.perf_counter() - memorize_start
        print(f"🎉 知识入库全部完成！(抽取耗时 {memorize_elapsed:.2f}s)")
        success = True
        
    except Exception as e:
        # 捕获并记录入库过程中的异常（如 LLM API 超时、数据库写入失败等）
        error_message = str(e)
        print(f"❌ 入库过程中发生异常: {e}")

    total_elapsed = time.perf_counter() - total_start

    # ── 组装统计结果 ──
    stats = {
        "char_count": char_count,
        "params": {
            "chunk_size": chunk_size,
            "enable_episodic": enable_episodic,
            "enable_content_routing": enable_content_routing,
        },
        "timing": {
            "add_seconds": round(add_elapsed, 3),
            "memorize_seconds": round(memorize_elapsed, 3),
            "total_seconds": round(total_elapsed, 3),
        },
        "success": success,
        "error": error_message,
    }

    # ── 写入统计文件 ──
    stats_file = _save_stats(stats)

    # ── 打印摘要 ──
    print("\n" + "=" * 60)
    print("📈 入库统计摘要")
    print("=" * 60)
    print(f"  字符数:       {char_count:,}")
    print(f"  预处理耗时:   {add_elapsed:.2f}s")
    print(f"  抽取入库耗时: {memorize_elapsed:.2f}s")
    print(f"  总耗时:       {total_elapsed:.2f}s")
    print(f"  状态:         {'✅ 成功' if success else '❌ 失败'}")
    if error_message:
        print(f"  错误:         {error_message}")
    print(f"  统计已写入:   {stats_file}")
    print("=" * 60)

if __name__ == "__main__":
    # 执行异步主入口
    asyncio.run(main())
