"""统一提示词服务：默认文件 + 运行时覆盖，双层热加载。

- 默认版: backend/prompts/*.md（checked in，随代码部署）
- 覆盖版: backend/data/prompts/*.md（管理页在线编辑，gitignored，git pull 不冲掉）
每次调用实时读盘——编辑保存后下一次请求立即生效，无需重启。
渲染用 str.replace 而非 str.format，模板正文含孤立花括号不会崩。
写入原子替换（tmp + os.replace）并把旧的生效内容留 .bak（一步回退）。
"""
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List
from uuid import uuid4

from config import PROMPTS_DIR, PROMPT_OVERRIDES_DIR

# 可管理提示词白名单（防路径穿越；新增 prompt 在此登记）
# 名字在管理页左栏按阶段分好组之后显示，不必再带「开场幕·」这类前缀
PROMPT_REGISTRY: Dict[str, str] = {
    "tarot_system.md": "塔罗对话系统提示词",
    "astrology_system.md": "占星对话系统提示词",
    "opening_persona.md": "人设与迎接",
    "opening_system.md": "前置占卜师要做的事",
    "opening_spread_catalog.md": "牌阵选择参考（开场选阵用的简介）",
    "opening_greeting.md": "开场白那一轮的指令",
    "reading_handoff.md": "接场约束",
    # 牌阵详解：一副一份，文件名里的 id 就是牌阵 ID（见 spread_service）。
    # 顺序即 <牌阵选择参考> 的顺序，也是交单 spread_type 那个 enum 的顺序。
    "spread_three_card_state.md": "牌阵详解 · 三张无牌阵（状态／结果）",
    "spread_three_card_timeline.md": "牌阵详解 · 三张无牌阵（未来时间流）",
    "spread_thoughts_development.md": "牌阵详解 · 想法及发展（六张）",
    "spread_development_five.md": "牌阵详解 · 五张发展",
    "spread_choice_two.md": "牌阵详解 · 二选一分支发展",
    "portrait_usage.md": "用户画像块怎么用",
    "notebook_system.md": "笔记本生成（占卜笔记 + 用户画像）",
    "daily_oracle_system.md": "每日一签解读",
    "daily_journey.md": "心灵奇旅",
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


@dataclass
class Part:
    """发给模型的一段文字，带出处。

    拼装函数产出 parts，运行时 join 成整段发出去，管理页把同一份 parts 原样摊开——
    看到的拼接顺序和代码实际发的是同一个来源，不另写一份说明。
      prompt    来自哪个 .md（管理页可改）；空 = 代码拼的
      variable  True = 这段是 prompt 模板里某个变量填进去的值，不是文件正文
      sample    True = 这段正文是运行时数据，管理页里看到的只是示例；False = 代码里写死的字
      label     这一段是什么（代码段的名字、模板变量名、文件里的哪个小节）
      when      满足什么条件才有这一段；空 = 每次都有
      variants  这一段有哪几种形态（每次都有，但内容长得不一样）；空 = 只有一种
    """
    text: str
    prompt: str = ""
    variable: bool = False
    sample: bool = False
    label: str = ""
    when: str = ""
    variants: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def join(parts: List[Part]) -> str:
    return "".join(p.text for p in parts)


def prompt_part(name: str, **kw) -> Part:
    return Part(get_prompt(name), prompt=name, **kw)


def render_prompt_parts(name: str, variables: Dict[str, str]) -> List[Part]:
    """取当前生效内容，按 {key} 占位符切开：模板正文是文件段，占位符处是变量值。

    只替换模板里的占位符；变量值里碰巧含 {key}（用户发言、笔记正文）原样保留。
    """
    text = get_prompt(name)
    if not variables:
        return [Part(text, prompt=name)]
    pattern = "|".join(re.escape("{" + key + "}") for key in variables)
    parts = []
    for i, piece in enumerate(re.split(f"({pattern})", text)):
        if i % 2:
            parts.append(Part(str(variables[piece[1:-1]]), prompt=name,
                              variable=True, sample=True, label=piece))
        elif piece:
            parts.append(Part(piece, prompt=name))
    return parts


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
            datetime.fromtimestamp(src.stat().st_mtime, tz=timezone.utc).isoformat()
            if src.exists() else None
        ),
    }


def list_prompts() -> List[dict]:
    return [get_prompt_info(name) for name in PROMPT_REGISTRY]


def save_override(name: str, content: str) -> dict:
    """保存覆盖版：白名单/非空/限长校验，旧生效内容留 .bak，原子写。"""
    _validate_name(name)
    content = content.lstrip("﻿")  # 剥离粘贴带入的 BOM
    if not content or not content.strip():
        raise ValueError("提示词内容不能为空")
    if len(content) > MAX_PROMPT_CHARS:
        raise ValueError(f"提示词过长（>{MAX_PROMPT_CHARS} 字符）")
    PROMPT_OVERRIDES_DIR.mkdir(parents=True, exist_ok=True)
    ov = _override_path(name)
    old = get_prompt(name)
    ov.with_suffix(ov.suffix + ".bak").write_text(old, encoding="utf-8")
    tmp = ov.with_suffix(ov.suffix + f".{os.getpid()}.{uuid4().hex}.tmp")
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
