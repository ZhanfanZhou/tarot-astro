"""统一提示词服务：默认文件 + 运行时覆盖，双层热加载。

- 默认版: backend/prompts/*.md（checked in，随代码部署）
- 覆盖版: backend/data/prompts/*.md（管理页在线编辑，gitignored，git pull 不冲掉）
每次调用实时读盘——编辑保存后下一次请求立即生效，无需重启。
渲染用 str.replace 而非 str.format，模板正文含孤立花括号不会崩。
写入原子替换（tmp + os.replace）并把旧的生效内容留 .bak（一步回退）。
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from config import PROMPTS_DIR, PROMPT_OVERRIDES_DIR

# 可管理提示词白名单（防路径穿越；新增 prompt 在此登记）
PROMPT_REGISTRY: Dict[str, str] = {
    "tarot_system.md": "塔罗对话系统提示词",
    "astrology_system.md": "占星对话系统提示词",
    "notebook_system.md": "占卜笔记生成提示词",
    "daily_oracle_system.md": "每日一签系统提示词",
    "daily_journey.md": "心灵奇旅提示词",
}

MAX_PROMPT_CHARS = 100_000


def _validate_name(name: str) -> None:
    if name not in PROMPT_REGISTRY:
        raise KeyError(f"未知提示词: {name}")


def _override_path(name: str) -> Path:
    return PROMPT_OVERRIDES_DIR / name


def _default_path(name: str) -> Path:
    return PROMPTS_DIR / name


def get_default(name: str) -> str:
    """仓库默认版内容；缺失抛 FileNotFoundError（绝不静默空 prompt）。"""
    _validate_name(name)
    path = _default_path(name)
    if not path.exists():
        raise FileNotFoundError(f"提示词默认文件缺失: {path}")
    return path.read_text(encoding="utf-8")


def get_prompt(name: str) -> str:
    """当前生效内容：覆盖版优先，否则默认版。"""
    _validate_name(name)
    ov = _override_path(name)
    if ov.exists():
        return ov.read_text(encoding="utf-8")
    return get_default(name)


def render_prompt(name: str, variables: Dict[str, str]) -> str:
    """取当前生效内容并替换 {key} 占位符。"""
    text = get_prompt(name)
    for key, value in variables.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def get_prompt_info(name: str) -> dict:
    _validate_name(name)
    ov = _override_path(name)
    overridden = ov.exists()
    src = ov if overridden else _default_path(name)
    return {
        "name": name,
        "label": PROMPT_REGISTRY[name],
        "overridden": overridden,
        "chars": len(get_prompt(name)),
        "updated_at": (
            datetime.utcfromtimestamp(src.stat().st_mtime).isoformat()
            if src.exists() else None
        ),
    }


def list_prompts() -> List[dict]:
    return [get_prompt_info(name) for name in PROMPT_REGISTRY]


def save_override(name: str, content: str) -> dict:
    """保存覆盖版：白名单/非空/限长校验，旧生效内容留 .bak，原子写。"""
    _validate_name(name)
    if not content or not content.strip():
        raise ValueError("提示词内容不能为空")
    if len(content) > MAX_PROMPT_CHARS:
        raise ValueError(f"提示词过长（>{MAX_PROMPT_CHARS} 字符）")
    PROMPT_OVERRIDES_DIR.mkdir(parents=True, exist_ok=True)
    ov = _override_path(name)
    old = get_prompt(name)
    ov.with_suffix(ov.suffix + ".bak").write_text(old, encoding="utf-8")
    tmp = ov.with_suffix(ov.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, ov)
    return get_prompt_info(name)


def reset_override(name: str) -> dict:
    """删除覆盖版，回到仓库默认。"""
    _validate_name(name)
    ov = _override_path(name)
    if ov.exists():
        ov.unlink()
    return get_prompt_info(name)
