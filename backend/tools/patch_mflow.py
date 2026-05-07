"""
M-Flow 环境补丁脚本
==================
根据 backend/README.md 中记录的兼容性问题，对已安装的 m_flow 库源文件进行
自动化热补丁。脚本可重复执行，已修补的文件会被跳过。

用法:
    # 在激活了目标 conda 环境后执行
    python patch_mflow.py

    # 或者通过 conda run 直接指定环境
    conda run -n mflow python patch_mflow.py

    # 还原所有补丁（恢复 .bak 备份）
    python patch_mflow.py --revert
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import site
import sys
import textwrap

# Windows 控制台编码兼容：强制 stdout/stderr 使用 UTF-8
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace"
    )
from pathlib import Path
from typing import NamedTuple


# ──────────────────────────────────────────────────────────────
# 辅助工具
# ──────────────────────────────────────────────────────────────

class PatchResult(NamedTuple):
    path: str
    status: str  # "patched" | "skipped" | "reverted" | "error"
    message: str


def _site_packages() -> Path:
    """获取当前环境的 site-packages 路径。"""
    candidates = site.getsitepackages()
    for p in candidates:
        sp = Path(p)
        if sp.exists() and (sp / "m_flow").is_dir():
            return sp
    # 回退：使用 m_flow 包自身路径推断
    try:
        import m_flow
        return Path(m_flow.__file__).resolve().parent.parent
    except ImportError:
        print("[FATAL] m_flow 未安装，请先执行 pip install mflow-ai", file=sys.stderr)
        sys.exit(1)


def _backup(path: Path) -> None:
    """创建 .bak 备份（若尚不存在）。"""
    bak = path.with_suffix(path.suffix + ".bak")
    if not bak.exists():
        shutil.copy2(path, bak)


def _apply_text_patch(
    file_path: Path,
    old: str,
    new: str,
    *,
    label: str = "",
) -> PatchResult:
    """
    在 *file_path* 中查找 *old* 并替换为 *new*。

    - 若 *old* 不存在且 *new* 已存在 → 视为已打过补丁，跳过。
    - 若 *old* 不存在且 *new* 也不存在 → 报错。
    """
    rel = file_path.name
    tag = f"[{label or rel}]"

    if not file_path.exists():
        return PatchResult(str(file_path), "error", f"{tag} 文件不存在")

    content = file_path.read_text(encoding="utf-8")

    if old in content:
        _backup(file_path)
        content = content.replace(old, new, 1)
        file_path.write_text(content, encoding="utf-8")
        return PatchResult(str(file_path), "patched", f"{tag} 补丁已应用 ✓")

    if new in content:
        return PatchResult(str(file_path), "skipped", f"{tag} 已是最新，跳过")

    return PatchResult(
        str(file_path),
        "error",
        f"{tag} 未找到待替换内容，文件可能已被其他方式修改",
    )


def _revert_file(file_path: Path, *, label: str = "") -> PatchResult:
    """从 .bak 恢复原始文件。"""
    rel = file_path.name
    tag = f"[{label or rel}]"
    bak = file_path.with_suffix(file_path.suffix + ".bak")
    if not bak.exists():
        return PatchResult(str(file_path), "skipped", f"{tag} 无备份文件，跳过")
    shutil.copy2(bak, file_path)
    bak.unlink()
    return PatchResult(str(file_path), "reverted", f"{tag} 已还原 ✓")


# ──────────────────────────────────────────────────────────────
# 补丁定义
# ──────────────────────────────────────────────────────────────

def patch_entity_types(sp: Path) -> PatchResult:
    """修改节点实体类型提示词 → 自定义业务类型。"""
    target = sp / "m_flow" / "llm" / "prompts" / "write_entity_descriptions.txt"

    old = textwrap.dedent("""\
        ENTITY TYPES (choose one):
        - Person: individuals, people names
        - Organization: companies, institutions, teams, groups
        - Location: places, cities, countries, regions
        - Event: conferences, incidents, historical events
        - Product: software, hardware, services, tools
        - Technology: methods, algorithms, frameworks, standards
        - Metric: numbers, statistics, measurements, versions
        - Date: specific dates, time periods
        - Entity: abstract ideas, theories, terms
        - Thing: default for anything else""")

    new = textwrap.dedent("""\
        ENTITY TYPES (choose one):
        - artifact: historical relics, antiques, vessels, bronze wares (e.g., Houmuwu Ding)
        - dynasty: historical periods, eras, dynasties (e.g., Shang Dynasty)
        - material: physical substances, raw materials (e.g., bronze, jade, gold)
        - category: artifact classifications, object types (e.g., Ding, Zun, Gui)
        - pattern: decorative designs, motifs (e.g., animal mask motif/Taotie)
        - site: archaeological sites, excavation locations, ancient ruins (e.g., Yinxu)
        - craft: manufacturing techniques, production methods (e.g., piece-mold casting)
        - inscription: carved texts, epigraphy, oracle bone script
        - usage: functions, use cases, ceremonial purposes (e.g., ritual offering)
        - concept: cultural symbols, social systems, religious beliefs (e.g., ritual system)
        - person: historical figures, individuals, archaeologists
        - collection: museums, exhibitions, current holding institutions
        - other: default for anything else that does not fit the above""")

    return _apply_text_patch(target, old, new, label="实体类型提示词")


def patch_node_guidelines(sp: Path) -> PatchResult:
    """修改知识图谱抽取提示词 → 自定义节点类型。"""
    target = sp / "m_flow" / "llm" / "prompts" / "knowledge_graph_extractor.txt"

    old = (
        "1. Types — assign each node a broad category label:\n"
        "   Person, Organization, Location, Date, Event, Concept, Product, Metric.\n"
        "   Prefer broad labels over narrow ones (e.g., \"Person\" rather than \"Scientist\")."
    )

    new = (
        "1. Types — assign each node a broad category label:\n"
        "   artifact, dynasty, material, category, pattern, site, craft, inscription, usage, concept, person, collection, other."
    )

    return _apply_text_patch(target, old, new, label="节点指南提示词")


def patch_llm_gateway_system_role(sp: Path) -> PatchResult:
    """LLMGateway: 将 system 角色合并至 user 角色（兼容 MiniMax）。"""
    target = sp / "m_flow" / "llm" / "LLMGateway.py"

    old = (
        '            messages = [\n'
        '                {"role": "system", "content": instructions},\n'
        '                {"role": "user", "content": source_text},\n'
        '            ]'
    )

    new = (
        '            messages = [\n'
        '                {"role": "user", "content": instructions + "\\n\\n" + source_text},\n'
        '            ]'
    )

    return _apply_text_patch(target, old, new, label="LLMGateway system→user")


def patch_adapter_build_messages(sp: Path) -> PatchResult:
    """OpenAI Adapter: 将 system 角色合并至 user 角色（兼容 MiniMax）。"""
    target = (
        sp / "m_flow" / "llm" / "backends"
        / "litellm_instructor" / "llm" / "openai" / "adapter.py"
    )

    old = (
        '    def _build_messages(self, user_input: str, system_prompt: str) -> list:\n'
        '        """Construct chat message list."""\n'
        '        return [\n'
        '            {"role": "user", "content": user_input},\n'
        '            {"role": "system", "content": system_prompt},\n'
        '        ]'
    )

    new = (
        '    def _build_messages(self, user_input: str, system_prompt: str) -> list:\n'
        '        """Construct chat message list."""\n'
        '        return [\n'
        '            {"role": "user", "content": system_prompt + "\\n\\n" + user_input},\n'
        '        ]'
    )

    return _apply_text_patch(target, old, new, label="Adapter system→user")


def patch_version_package_name(sp: Path) -> PatchResult:
    """修正版本获取时使用的包名 m_flow → mflow-ai。"""
    target = sp / "m_flow" / "version.py"

    old = 'importlib.metadata.version("m_flow")'
    new = 'importlib.metadata.version("mflow-ai")'

    return _apply_text_patch(target, old, new, label="版本包名修正")


def patch_ui_download_url(sp: Path) -> PatchResult:
    """修正 UI 静态资源 GitHub 下载地址的仓库所有者。"""
    target = sp / "m_flow" / "api" / "v1" / "ui" / "ui.py"

    old = "https://github.com/m-flow-project/m_flow/archive/refs/tags/v"
    new = "https://github.com/FlowElement-ai/m_flow/archive/refs/tags/v"

    return _apply_text_patch(target, old, new, label="UI 下载地址修正")


def patch_query_time_parser(sp: Path) -> PatchResult:
    """修复 Windows 负数时间戳：query_time_parser.py。"""
    target = sp / "m_flow" / "retrieval" / "time" / "query_time_parser.py"

    old = "    now_dt = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)"
    new = "    now_dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=now_ms / 1000)"

    return _apply_text_patch(target, old, new, label="时间解析器负数时间戳修复")


def patch_mentioned_time_extractor(sp: Path) -> PatchResult:
    """修复 Windows 负数时间戳：mentioned_time_extractor.py。"""
    target = sp / "m_flow" / "retrieval" / "time" / "mentioned_time_extractor.py"

    old = "                ts_ms = int(dt.timestamp() * 1000)"
    new = "                ts_ms = int((dt - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds() * 1000)"

    return _apply_text_patch(target, old, new, label="时间提取器负数时间戳修复")


# ──────────────────────────────────────────────────────────────
# 主函数
# ──────────────────────────────────────────────────────────────

ALL_PATCHES = [
    patch_entity_types,
    patch_node_guidelines,
    patch_llm_gateway_system_role,
    patch_adapter_build_messages,
    patch_version_package_name,
    patch_ui_download_url,
    patch_query_time_parser,
    patch_mentioned_time_extractor,
]

ALL_FILES_RELATIVE = [
    "m_flow/llm/prompts/write_entity_descriptions.txt",
    "m_flow/llm/prompts/knowledge_graph_extractor.txt",
    "m_flow/llm/LLMGateway.py",
    "m_flow/llm/backends/litellm_instructor/llm/openai/adapter.py",
    "m_flow/version.py",
    "m_flow/api/v1/ui/ui.py",
    "m_flow/retrieval/time/query_time_parser.py",
    "m_flow/retrieval/time/mentioned_time_extractor.py",
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="M-Flow 环境补丁脚本 — 自动修补已安装的 m_flow 库。"
    )
    parser.add_argument(
        "--revert",
        action="store_true",
        help="还原所有补丁（从 .bak 恢复）",
    )
    args = parser.parse_args()

    sp = _site_packages()
    print("")
    print("=" * 60)
    print(f"  M-Flow 补丁工具")
    print(f"  site-packages: {sp}")
    print(f"  Python: {sys.version.split()[0]}")
    print("=" * 60)
    print()

    results: list[PatchResult] = []

    if args.revert:
        print(">> 模式：还原补丁\n")
        for rel in ALL_FILES_RELATIVE:
            r = _revert_file(sp / rel, label=rel.split("/")[-1])
            results.append(r)
            print(f"  {r.message}")
    else:
        print(">> 模式：应用补丁\n")
        for patch_fn in ALL_PATCHES:
            r = patch_fn(sp)
            results.append(r)
            print(f"  {r.message}")

    # 汇总
    patched = sum(1 for r in results if r.status in ("patched", "reverted"))
    skipped = sum(1 for r in results if r.status == "skipped")
    errors = sum(1 for r in results if r.status == "error")

    print("")
    print("-" * 60)
    action = "还原" if args.revert else "应用"
    print(f"  完成：{action} {patched} 项 | 跳过 {skipped} 项 | 错误 {errors} 项")
    print("-" * 60)
    print()

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
