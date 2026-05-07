"""项目通用工具函数。"""


def preview_text(value: str, max_len: int = 120) -> str:
    """生成单行预览文本，避免日志输出大段原文。"""
    normalized = " ".join(value.split())
    return normalized[:max_len]

