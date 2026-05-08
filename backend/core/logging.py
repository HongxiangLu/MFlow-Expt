"""
全局日志基础设施配置模块 (core.logging)。

本模块是整个应用的日志横切关注点 (Cross-Cutting Concern) 的唯一归属地，
职责包括：

1. **格式化**  — 提供 ``_ColoredFormatter``，在终端中以 ANSI 颜色区分
   日志等级，提升可读性与问题定位效率。
2. **初始化**  — 暴露 ``setup_logging()`` 函数，由应用入口 ``main.py``
   在模块顶层调用一次，确保所有后续 ``logging.getLogger(__name__)``
   获取的 logger 均继承统一的格式和等级配置。
3. **日志工具** — 提供 ``preview_text()`` 等辅助函数，用于在日志中安全
   输出长文本的截断预览，避免大段原文刷屏。

设计决策：
- 使用标准库 ``logging`` 而非第三方库 (如 loguru)，减少外部依赖。
- 颜色仅通过 ANSI 转义序列实现，兼容主流终端（Windows Terminal、
  PowerShell、macOS Terminal、各 Linux 终端模拟器）。
- ``setup_logging()`` 会 **强制清除** root logger 上已有的 handler，
  以覆盖 uvicorn 在 reload 模式下预先注入的默认配置。

颜色方案：
    ========== ============
    日志部分    颜色
    ========== ============
    时间戳      灰色
    DEBUG       蓝色
    INFO        蓝色
    WARNING     黄色
    ERROR       红色
    CRITICAL    加粗红色
    模块名      同等级颜色
    消息正文    终端默认色
    ========== ============

Usage::

    # main.py（仅调用一次）
    from core.logging import setup_logging
    setup_logging()

    # 任意业务模块
    import logging
    logger = logging.getLogger(__name__)
    logger.info("Hello, %s!", "world")
"""

import logging

# =====================================================================
# ANSI 转义序列常量
# =====================================================================
# 参考: https://en.wikipedia.org/wiki/ANSI_escape_code#SGR_(Select_Graphic_Rendition)_parameters
# 仅使用广泛支持的 3/4-bit 色彩，确保跨平台兼容性。

_GRAY = "\033[90m"       # 亮黑 (即灰色)，用于时间戳等辅助信息
_BLUE = "\033[94m"       # 亮蓝，用于 DEBUG / INFO 等级及模块名
_YELLOW = "\033[93m"     # 亮黄，用于 WARNING 等级
_RED = "\033[91m"        # 亮红，用于 ERROR 等级
_BOLD_RED = "\033[1;91m" # 加粗亮红，用于 CRITICAL 等级
_RESET = "\033[0m"       # 重置所有属性

# 等级 → 颜色 映射表
# 未在此表中注册的等级将回退到 _RESET (终端默认色)。
_LEVEL_COLORS: dict[int, str] = {
    logging.DEBUG:    _BLUE,
    logging.INFO:     _BLUE,
    logging.WARNING:  _YELLOW,
    logging.ERROR:    _RED,
    logging.CRITICAL: _BOLD_RED,
}


# =====================================================================
# 自定义 Formatter
# =====================================================================

class _ColoredFormatter(logging.Formatter):
    """带 ANSI 颜色的日志格式化器。

    输出格式::

        <灰色时间戳> [<彩色等级>] <彩色模块名> - <消息正文>

    示例 (终端实际效果带颜色)::

        2026-05-08 10:09:01 [INFO] services.chat_service - 流式连接建立成功

    每条日志末尾额外追加一个空行 (``\\n``)，使相邻日志在终端中保持
    视觉间隔，便于快速扫读。
    """

    def format(self, record: logging.LogRecord) -> str:
        # 根据日志等级查找对应颜色；未注册等级回退为默认色
        color = _LEVEL_COLORS.get(record.levelno, _RESET)
        # 格式化时间戳，精度由 datefmt 控制（秒级）
        asctime = self.formatTime(record, self.datefmt)

        # 拼装最终日志行：灰色时间 + 彩色等级 + 彩色模块 + 默认色消息
        formatted = (
            f"{_GRAY}{asctime}{_RESET} "
            f"{color}[{record.levelname}]{_RESET} "
            f"{color}{record.name}{_RESET} - "
            f"{record.getMessage()}"
        )
        # 末尾追加空行，使相邻日志条目之间有视觉间隔
        return formatted + "\n"


# =====================================================================
# 日志工具函数
# =====================================================================

def preview_text(value: str, max_len: int = 200) -> str:
    """将长文本压缩为单行截断预览，适用于日志安全输出。

    处理流程:
        1. 将所有连续空白字符 (换行、制表符等) 归一化为单个空格。
        2. 若归一化后长度超过 ``max_len``，截断并追加省略标识 ``......``。
        3. 若未超过，则原样返回归一化后的文本。

    Args:
        value:   待预览的原始文本。
        max_len: 允许的最大字符数 (不含省略标识)，默认 200。

    Returns:
        截断后的预览字符串。若发生截断，末尾带有 ``......`` 标识。

    Examples::

        >>> preview_text("短文本")
        '短文本'
        >>> preview_text("a" * 200, max_len=10)
        'aaaaaaaaaa......'
    """
    normalized = " ".join(value.split())
    if len(normalized) > max_len:
        return normalized[:max_len] + "......"
    return normalized


# =====================================================================
# 公共初始化入口
# =====================================================================

def setup_logging(level: int = logging.INFO) -> None:
    """初始化全局日志配置。应在应用启动时 **调用且仅调用一次**。

    本函数会 **强制清除** root logger 上已有的所有 handler，然后注入
    项目自定义的 ``_ColoredFormatter``。这一行为是有意为之——uvicorn
    在 ``reload=True`` 模式下会先于应用代码配置日志，如果不主动清除，
    ``logging.basicConfig()`` 会因检测到已有 handler 而静默跳过。

    Args:
        level: 全局日志等级，默认 ``logging.INFO``。
               生产环境可传入 ``logging.WARNING`` 减少输出量。

    Side Effects:
        - 清除 ``logging.root.handlers``。
        - 向 root logger 添加一个 ``StreamHandler`` (输出到 stderr)。
        - 设置 root logger 的等级为 ``level``。
    """
    handler = logging.StreamHandler()
    handler.setFormatter(_ColoredFormatter(datefmt="%Y-%m-%d %H:%M:%S"))

    # 强制清除已有 handler，确保格式配置生效
    logging.root.handlers.clear()
    logging.root.addHandler(handler)
    logging.root.setLevel(level)
