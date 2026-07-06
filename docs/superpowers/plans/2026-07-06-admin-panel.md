# 后台管理页面 + Prompt 全面外置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 云端 `/admin` 轻量后台（看全部会话/用户/用量、在线改 prompt 即时生效），并把所有硬编码 prompt 外置为「仓库默认 + 运行时覆盖」双层文件，顺带修复占星 prompt 被测试版覆盖的线上 bug。

**Architecture:** 后端在现有 FastAPI 上加 `routers/admin.py`（`ADMIN_PASSWORD` env + JWT `role=admin` 鉴权，env 未配置则全部 404）与 `services/prompt_service.py`（白名单 5 个 prompt，默认版 `backend/prompts/` + 覆盖版 `backend/data/prompts/`，每请求热加载，原子写 + `.bak`）。前端在现有 React app 加 `/admin` 懒加载路由（独立 axios 实例 + 独立 localStorage token，UI 从简）。存储查询复用上轮 SQLite 影子列，不改表结构。

**Tech Stack:** FastAPI + aiosqlite（已有）、python-jose JWT（已有）、React 18 + react-router-dom v7 + axios（已有）。**零新依赖。**

**Spec:** `docs/superpowers/specs/2026-07-06-admin-panel-design.md`

**验证约定（全程遵守）：**
- 后端测试：`source venv/bin/activate && cd backend && python -m pytest -q`，一律 tmp_path/monkeypatch，**绝不碰 `backend/data/`**（那是 live 数据）。
- 前端验证：`cd frontend && npm run build`（lint 全仓坏，不用）。
- 提交频繁、粒度小；commit message 结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## File Structure（全景图）

```
backend/
  config.py                    [改] +PROMPT_OVERRIDES_DIR / ADMIN_PASSWORD / ADMIN_TOKEN_EXPIRE_MINUTES
  main.py                      [改] 挂载 admin router
  prompts/
    tarot_system.md            [新] 默认版（从 gemini_service 抽取）
    astrology_system.md        [新] 默认版（取 :207 真提示词）
    notebook_system.md         [新] 默认版（从 notebook_service 抽取，去 {{}} 转义）
    daily_oracle_system.md     [已有] 不动
    daily_journey.md           [已有] 不动
  services/
    prompt_service.py          [新] 统一热加载：默认+覆盖、渲染、原子保存、.bak、白名单
    gemini_service.py          [改] 删 4 处 prompt 定义（含 :281 bug），改走 prompt_service
    notebook_service.py        [改] 删 NOTEBOOK_PROMPT，改走 prompt_service
    daily_service.py           [改] render_template 收敛到 prompt_service
    auth_service.py            [改] +create_admin_token()
    storage_service.py         [改] +4 个管理只读查询
    rate_limit_service.py      [改] +get_today_usage() 公开读取
  routers/admin.py             [新] /api/admin：login/stats/conversations/users/usage/prompts
  tests/
    test_prompt_service.py     [新]
    test_admin_router.py       [新]
frontend/src/
  main.tsx                     [改] /admin 懒加载路由
  services/adminApi.ts         [新] 独立 axios 实例 + admin token + 类型
  pages/admin/
    AdminApp.tsx               [新] 登录门 + 顶栏 tab 布局
    OverviewPanel.tsx          [新] 指标卡
    ConversationsPanel.tsx     [新] 会话列表 + 聊天详情（核心页）
    UsersPanel.tsx             [新] 用户表
    PromptsPanel.tsx           [新] prompt 列表 + 编辑器
    UsagePanel.tsx             [新] 今日用量表
    admin.css                  [新] 极简暗色样式
.gitignore                     [改] +backend/data/prompts/
CLAUDE.md                      [改] 收尾更新地图
```

---

### Task 1: 修复占星 prompt shadowing bug + 抽取 3 个默认 prompt 文件

**Files:**
- Modify: `backend/services/gemini_service.py:202-205, 281-284`
- Create: `backend/prompts/tarot_system.md`、`backend/prompts/astrology_system.md`、`backend/prompts/notebook_system.md`
- Modify: `.gitignore`

背景：`gemini_service.py` 中 `ASTROLOGY_SYSTEM_PROMPT` 定义两次——:207 是真提示词，:281-284 是「测试任务」提示词且后定义生效（线上 bug）。必须**先删重复定义**，再用 Python 导入类属性的方式抽取（保证逐字一致，不靠手工复制）。

- [ ] **Step 1: 删除 :281-284 的测试版 ASTROLOGY_SYSTEM_PROMPT（修 bug）**

用 Edit 从 `backend/services/gemini_service.py` 删除以下整块（old_string → 空）：

```python
    ASTROLOGY_SYSTEM_PROMPT = """你是一位专业的塔罗师，现在需要协助我完成一系列占卜测试任务，你必须按照我的指令，
    当我跟你说抽塔罗，你回复好的，然后使用`draw_tarot_cards`工具抽3张牌，使用无牌阵，得到抽牌结果后，你只需要做简单解读即可，因为这是测试任务；
    当我说看星盘，你使用`get_astrology_chart` 工具获取星盘数据，然后你只需告诉我太阳星座，月亮星座是什么就够了；
    当我说填资料，你回复好的，然后使用`request_user_profile` 工具请求用户补充信息，然后你把结果简单告知我即可"""
```

同时删除 :202-205 被注释掉的塔罗测试版（git 历史可找回）：

```python
    # TAROT_SYSTEM_PROMPT = """你是一位专业的塔罗师，现在需要协助我完成一系列占卜测试任务，你必须按照我的指令，
    # 当我跟你说抽塔罗，你使用`draw_tarot_cards`工具抽3张牌，使用无牌阵，得到抽牌结果后，你只需要做简单解读即可，因为这是测试任务；
    # 当我说看星盘，你使用`get_astrology_chart` 工具获取星盘数据，然后你只需告诉我太阳星座，月亮星座是什么就够了；
    # 当我说填资料，你使用`request_user_profile` 工具请求用户补充信息，然后你把结果简单告知我即可"""
```

- [ ] **Step 2: 用导入方式抽取 3 个默认 prompt 文件（逐字一致）**

在仓库根目录运行：

```bash
venv/bin/python - <<'PY'
import sys
sys.path.insert(0, 'backend')
from pathlib import Path
from services.gemini_service import GeminiService
from services.notebook_service import NotebookService

p = Path('backend/prompts')
p.joinpath('tarot_system.md').write_text(GeminiService.TAROT_SYSTEM_PROMPT, encoding='utf-8')
p.joinpath('astrology_system.md').write_text(GeminiService.ASTROLOGY_SYSTEM_PROMPT, encoding='utf-8')
# notebook 原用 str.format,{{}} 是转义;prompt_service 用 str.replace 渲染,落盘时还原成单花括号
nb = NotebookService.NOTEBOOK_PROMPT.replace('{{', '{').replace('}}', '}')
p.joinpath('notebook_system.md').write_text(nb, encoding='utf-8')
print('written:', sorted(f.name for f in p.glob('*.md')))
PY
```

Expected: `written: ['astrology_system.md', 'daily_journey.md', 'daily_oracle_system.md', 'notebook_system.md', 'tarot_system.md']`

- [ ] **Step 3: 验证抽取一致性 + bug 已修**

```bash
venv/bin/python - <<'PY'
import sys
sys.path.insert(0, 'backend')
from pathlib import Path
from services.gemini_service import GeminiService
from services.notebook_service import NotebookService

p = Path('backend/prompts')
assert GeminiService.ASTROLOGY_SYSTEM_PROMPT.startswith('你是一位专业的占星师'), 'shadowing 未修复,类属性仍是测试 prompt!'
assert p.joinpath('tarot_system.md').read_text(encoding='utf-8') == GeminiService.TAROT_SYSTEM_PROMPT
assert p.joinpath('astrology_system.md').read_text(encoding='utf-8') == GeminiService.ASTROLOGY_SYSTEM_PROMPT
expect_nb = NotebookService.NOTEBOOK_PROMPT.replace('{{', '{').replace('}}', '}')
assert p.joinpath('notebook_system.md').read_text(encoding='utf-8') == expect_nb
assert '{conversation_content}' in expect_nb
print('OK: 三个文件逐字一致,占星 prompt 已是真提示词')
PY
```

Expected: `OK: 三个文件逐字一致,占星 prompt 已是真提示词`

- [ ] **Step 4: .gitignore 加覆盖目录，并跑现有测试**

在 `.gitignore` 的 `# Data` 段追加一行：

```
backend/data/prompts/
```

```bash
source venv/bin/activate && cd backend && python -m pytest -q
```

Expected: 39 passed（现有测试全绿——本 task 只删了未被引用的重复定义）

- [ ] **Step 5: Commit**

```bash
git add backend/services/gemini_service.py backend/prompts/ .gitignore
git commit -m "fix: 修复占星 prompt 被测试版覆盖的 bug;抽取三个默认 prompt 文件

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: prompt_service（统一热加载 + 原子保存）

**Files:**
- Modify: `backend/config.py:20-22` 附近
- Create: `backend/services/prompt_service.py`
- Test: `backend/tests/test_prompt_service.py`

- [ ] **Step 1: config.py 加覆盖目录常量**

在 `PROMPTS_DIR` 定义之后（`backend/config.py` 的 `PROMPTS_DIR = BASE_DIR / "backend" / "prompts"` 行后）加：

```python
# 提示词覆盖目录：管理页在线编辑写这里（gitignored，git pull 不冲掉线上修改）；
# 默认版在 backend/prompts/ 随代码部署。读取时覆盖版优先。
PROMPT_OVERRIDES_DIR = DATA_DIR / "prompts"
```

- [ ] **Step 2: 写失败测试**

创建 `backend/tests/test_prompt_service.py`：

```python
"""prompt_service 测试：默认/覆盖双层、渲染、原子保存、白名单。
覆盖目录全程 monkeypatch 到 tmp_path，不碰 backend/data/。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def ps(tmp_path, monkeypatch):
    import services.prompt_service as mod
    monkeypatch.setattr(mod, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
    return mod


def test_get_prompt_falls_back_to_default(ps):
    text = ps.get_prompt("tarot_system.md")
    assert "职业占卜师" in text  # 仓库默认版


def test_override_takes_priority(ps):
    ps.save_override("tarot_system.md", "OVERRIDE-CONTENT")
    assert ps.get_prompt("tarot_system.md") == "OVERRIDE-CONTENT"
    info = ps.get_prompt_info("tarot_system.md")
    assert info["overridden"] is True


def test_save_writes_bak_of_previous_content(ps):
    default = ps.get_prompt("tarot_system.md")
    ps.save_override("tarot_system.md", "V1")
    bak = ps.PROMPT_OVERRIDES_DIR / "tarot_system.md.bak"
    assert bak.read_text(encoding="utf-8") == default  # 首次保存,备份默认版
    ps.save_override("tarot_system.md", "V2")
    assert bak.read_text(encoding="utf-8") == "V1"     # 再次保存,备份上一版


def test_reset_removes_override(ps):
    ps.save_override("tarot_system.md", "TMP")
    info = ps.reset_override("tarot_system.md")
    assert info["overridden"] is False
    assert "职业占卜师" in ps.get_prompt("tarot_system.md")


def test_unknown_name_rejected(ps):
    with pytest.raises(KeyError):
        ps.get_prompt("../../etc/passwd")
    with pytest.raises(KeyError):
        ps.save_override("evil.md", "x")


def test_empty_or_oversize_content_rejected(ps):
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "   ")
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "x" * (ps.MAX_PROMPT_CHARS + 1))


def test_render_replaces_placeholders_and_tolerates_braces(ps):
    ps.save_override("notebook_system.md", '记录:{conversation_content} 例:{"summary":"x"}')
    out = ps.render_prompt("notebook_system.md", {"conversation_content": "对话内容"})
    assert "对话内容" in out
    assert '{"summary":"x"}' in out  # 孤立花括号不崩、不吞


def test_missing_default_raises(ps, monkeypatch, tmp_path):
    monkeypatch.setattr(ps, "PROMPTS_DIR", tmp_path / "empty")  # 默认目录也指到空处
    with pytest.raises(FileNotFoundError):
        ps.get_prompt("tarot_system.md")


def test_list_prompts_has_all_five(ps):
    names = {p["name"] for p in ps.list_prompts()}
    assert names == {
        "tarot_system.md", "astrology_system.md", "notebook_system.md",
        "daily_oracle_system.md", "daily_journey.md",
    }
```

- [ ] **Step 3: 跑测试确认失败**

```bash
source venv/bin/activate && cd backend && python -m pytest tests/test_prompt_service.py -q
```

Expected: FAIL / ERROR（`ModuleNotFoundError: No module named 'services.prompt_service'`）

- [ ] **Step 4: 实现 prompt_service.py**

创建 `backend/services/prompt_service.py`：

```python
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
```

- [ ] **Step 5: 跑测试确认通过**

```bash
python -m pytest tests/test_prompt_service.py -q
```

Expected: 9 passed

注意：`test_save_writes_bak_of_previous_content` 里 `save_override` 调 `get_prompt(name)` 取旧内容——若默认文件也不存在会抛 FileNotFoundError，这正是想要的行为（没有可备份的基线就不该盲写）。

- [ ] **Step 6: Commit**

```bash
git add backend/config.py backend/services/prompt_service.py backend/tests/test_prompt_service.py
git commit -m "feat: prompt_service 统一提示词热加载(默认+覆盖双层,原子写+bak)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 接线——gemini/notebook/daily 全部改走 prompt_service

**Files:**
- Modify: `backend/services/gemini_service.py`（删常量、改 `_format_messages_for_gemini`）
- Modify: `backend/services/notebook_service.py`（删 `NOTEBOOK_PROMPT`、改 `generate_summary`）
- Modify: `backend/services/daily_service.py`（删本地 `render_template`）
- Test: `backend/tests/test_prompt_service.py`（追加接线测试）

- [ ] **Step 1: 写失败的接线测试**

追加到 `backend/tests/test_prompt_service.py` 末尾：

```python
# ---------------------------------------------------------------------------
# 接线测试：三个服务确实从 prompt_service 取词（覆盖版生效 = 证明走了文件）
# ---------------------------------------------------------------------------
from models import SessionType  # noqa: E402


def test_gemini_selects_prompt_file_by_session_type(ps):
    ps.save_override("tarot_system.md", "TAROT-FILE-PROMPT")
    ps.save_override("astrology_system.md", "ASTRO-FILE-PROMPT")
    from services.gemini_service import GeminiService
    svc = GeminiService()
    tarot_msgs = svc._format_messages_for_gemini([], user=None, session_type=SessionType.TAROT)
    astro_msgs = svc._format_messages_for_gemini([], user=None, session_type=SessionType.ASTROLOGY)
    assert tarot_msgs[0]["parts"][0]["text"].startswith("TAROT-FILE-PROMPT")
    assert astro_msgs[0]["parts"][0]["text"].startswith("ASTRO-FILE-PROMPT")


def test_gemini_hardcoded_prompts_removed(ps):
    from services.gemini_service import GeminiService
    assert not hasattr(GeminiService, "TAROT_SYSTEM_PROMPT")
    assert not hasattr(GeminiService, "ASTROLOGY_SYSTEM_PROMPT")


def test_notebook_hardcoded_prompt_removed(ps):
    from services.notebook_service import NotebookService
    assert not hasattr(NotebookService, "NOTEBOOK_PROMPT")


def test_daily_render_template_is_prompt_service(ps):
    from services import daily_service
    ps.save_override("daily_oracle_system.md", "DAILY:{nickname}")
    out = daily_service.render_template("daily_oracle_system.md", {"nickname": "小明"})
    assert out == "DAILY:小明"
```

- [ ] **Step 2: 跑测试确认失败**

```bash
python -m pytest tests/test_prompt_service.py -q
```

Expected: 前 9 个 pass，新增 4 个 FAIL（`hasattr` 仍为 True / gemini 用的还是常量）

- [ ] **Step 3: 改 gemini_service.py**

3a. 顶部 import 增加（`from models import ...` 行后）：

```python
from services import prompt_service
```

3b. **整块删除** `TAROT_SYSTEM_PROMPT = """..."""`（原 :123-201，从 `    TAROT_SYSTEM_PROMPT = """你是一位以精通塔罗和占星的职业占卜师` 起到对应结尾 `"""` 止）和 `ASTROLOGY_SYSTEM_PROMPT = """..."""`（原 :207-279，`    ASTROLOGY_SYSTEM_PROMPT = """你是一位专业的占星师` 起到对应 `"""` 止）。Task 1 已把内容落盘为默认文件并验证逐字一致。

3c. `_format_messages_for_gemini` 中把：

```python
            if session_type == SessionType.ASTROLOGY:
                system_prompt = self.ASTROLOGY_SYSTEM_PROMPT
            else:
                system_prompt = self.TAROT_SYSTEM_PROMPT
```

改为：

```python
            # 每次请求实时读文件（默认+覆盖双层），管理页改完即生效
            if session_type == SessionType.ASTROLOGY:
                system_prompt = prompt_service.get_prompt("astrology_system.md")
            else:
                system_prompt = prompt_service.get_prompt("tarot_system.md")
```

- [ ] **Step 4: 改 notebook_service.py**

4a. 顶部 import 增加：

```python
from services import prompt_service
```

4b. **整块删除**类属性 `NOTEBOOK_PROMPT = """..."""`（原 :78-95，含上方注释行 `# 笔记生成提示词（生成结构化输出：摘要 + 抽到的牌列表）`）。

4c. `generate_summary` 中把：

```python
        # 构建提示词（不再传递 cards_str，让 AI 从对话中提取）
        prompt = self.NOTEBOOK_PROMPT.format(
            start_time=start_time,
            question=question,
            conversation_content=conversation_str
        )
```

改为：

```python
        # 构建提示词（热加载文件模板；replace 渲染，正文 JSON 花括号安全）
        prompt = prompt_service.render_prompt("notebook_system.md", {
            "conversation_content": conversation_str,
            "start_time": start_time,
            "question": question,
        })
```

- [ ] **Step 5: 改 daily_service.py**

5a. 把 `from config import DAILY_DRAWS_FILE, PROMPTS_DIR` 改为：

```python
from config import DAILY_DRAWS_FILE
```

5b. **整块删除** `def render_template(name, variables)` 函数（原 :95-105，含 docstring），在原位置替换为：

```python
# render_template 已收敛到 prompt_service（默认+覆盖双层热加载），别名保持旧调用点不变
from services.prompt_service import render_prompt as render_template
```

（`render_daily_system_prompt` / `build_journey_prompt` 两个调用点无需改动。）

- [ ] **Step 6: 全量测试**

```bash
python -m pytest -q
```

Expected: 全部通过（39 旧 + 13 prompt/接线 = 52 passed；`test_daily_service.py` 是回归关键——daily 渲染行为不能变）

- [ ] **Step 7: Commit**

```bash
git add backend/services/gemini_service.py backend/services/notebook_service.py backend/services/daily_service.py backend/tests/test_prompt_service.py
git commit -m "refactor: 全部 prompt 外置,gemini/notebook/daily 统一走 prompt_service 热加载

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Admin 鉴权（config + admin token + 登录接口 + require_admin）

**Files:**
- Modify: `backend/config.py`（追加 admin 配置）
- Modify: `backend/services/auth_service.py`（+`create_admin_token`）
- Create: `backend/routers/admin.py`（登录 + 鉴权依赖）
- Modify: `backend/main.py`（挂载 router）
- Test: `backend/tests/test_admin_router.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_admin_router.py`：

```python
"""admin router 测试。config.ADMIN_PASSWORD 用 monkeypatch 注入（admin.py 必须
运行时经 config.ADMIN_PASSWORD 属性访问，不能 from config import 快照）。
存储指向 tmp_path 临时库，照例不碰 backend/data/。"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import User, UserType  # noqa: E402
from services.auth_service import create_access_token, decode_access_token  # noqa: E402

ADMIN_PW = "test-admin-pw"


@pytest.fixture
def client(tmp_path, monkeypatch):
    import config
    import services.db as db_mod
    import routers.admin as admin_mod

    monkeypatch.setattr(config, "ADMIN_PASSWORD", ADMIN_PW)
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    # 重置登录失败计数（进程内状态，测试间隔离）
    admin_mod._login_fails.update({"count": 0, "locked_until": 0.0})

    from main import app
    return TestClient(app)


def _admin_headers(client) -> dict:
    token = client.post("/api/admin/login", json={"password": ADMIN_PW}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestAdminLogin:
    def test_disabled_when_password_unset(self, client, monkeypatch):
        import config
        monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
        assert client.post("/api/admin/login", json={"password": "x"}).status_code == 404

    def test_wrong_password_401(self, client):
        assert client.post("/api/admin/login", json={"password": "nope"}).status_code == 401

    def test_correct_password_returns_admin_token(self, client):
        resp = client.post("/api/admin/login", json={"password": ADMIN_PW})
        assert resp.status_code == 200
        payload = decode_access_token(resp.json()["access_token"])
        assert payload["role"] == "admin"
        assert payload["sub"] == "admin"

    def test_lockout_after_5_fails(self, client):
        for _ in range(5):
            assert client.post("/api/admin/login", json={"password": "no"}).status_code == 401
        # 第 6 次（即使密码正确）也被锁
        assert client.post("/api/admin/login", json={"password": ADMIN_PW}).status_code == 429


class TestRequireAdmin:
    """经无业务依赖的受保护端点 GET /api/admin/ping 测试门卫（数据端点 Task 5 才有）。"""

    def test_no_token_401(self, client):
        assert client.get("/api/admin/ping").status_code == 401

    def test_user_token_403(self, client):
        user_token = create_access_token("user_abc", UserType.REGISTERED)
        resp = client.get("/api/admin/ping", headers={"Authorization": f"Bearer {user_token}"})
        assert resp.status_code == 403

    def test_admin_token_ok(self, client):
        resp = client.get("/api/admin/ping", headers=_admin_headers(client))
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
python -m pytest tests/test_admin_router.py -q
```

Expected: ERROR（`No module named 'routers.admin'` / 404）

- [ ] **Step 3: 实现**

3a. `backend/config.py` 末尾（CORS 配置前）追加：

```python
# ── 后台管理 ────────────────────────────────────────────────────────────────
# 管理员密码：留空 = 后台功能整体关闭（所有 /api/admin 路由 404）。
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
# admin token 有效期（默认 24 小时）
ADMIN_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", str(24 * 60)))
```

3b. `backend/services/auth_service.py`：import 行改为

```python
from config import (
    ACCESS_TOKEN_EXPIRE_MINUTES, ADMIN_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY,
)
```

文件末尾追加：

```python
def create_admin_token() -> str:
    """后台管理 token：role=admin，与用户 token 同密钥、凭 role 区分。
    sub='admin' 不对应任何真实用户，误用于用户接口时 get_current_user 查库必失败。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

3c. 创建 `backend/routers/admin.py`：

```python
"""后台管理接口。

- 功能开关：env ADMIN_PASSWORD 未配置时全部路由 404。
- 鉴权：POST /login 换 role=admin 的 JWT；require_admin 只认 admin role。
- 防爆破：进程内失败计数，连续 5 次错锁 60 秒（单 worker 部署下可靠）。
注意：本模块必须通过 `config.ADMIN_PASSWORD` 属性访问（运行时求值），
不能 `from config import ADMIN_PASSWORD` 快照——测试与热改 env 都依赖这点。
"""
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

import config
from services.auth_service import create_admin_token, decode_access_token

router = APIRouter(prefix="/api/admin", tags=["admin"])
security = HTTPBearer(auto_error=False)

_login_fails = {"count": 0, "locked_until": 0.0}
MAX_FAILS = 5
LOCK_SECONDS = 60.0


def _ensure_enabled() -> None:
    if not config.ADMIN_PASSWORD:
        raise HTTPException(status_code=404, detail="Not Found")


async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> None:
    """管理接口统一门卫：无 token 401，非 admin token 403。"""
    _ensure_enabled()
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="未登录")
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权访问")


class AdminLoginRequest(BaseModel):
    password: str


@router.post("/login")
async def admin_login(request: AdminLoginRequest):
    _ensure_enabled()
    now = time.monotonic()
    if now < _login_fails["locked_until"]:
        raise HTTPException(status_code=429, detail="尝试过于频繁，请 1 分钟后再试")
    if not secrets.compare_digest(request.password, config.ADMIN_PASSWORD):
        _login_fails["count"] += 1
        if _login_fails["count"] >= MAX_FAILS:
            _login_fails["count"] = 0
            _login_fails["locked_until"] = now + LOCK_SECONDS
        raise HTTPException(status_code=401, detail="密码错误")
    _login_fails["count"] = 0
    _login_fails["locked_until"] = 0.0
    return {"access_token": create_admin_token(), "token_type": "bearer"}


@router.get("/ping")
async def admin_ping(_: None = Depends(require_admin)):
    """探活/鉴权自检（前端进入管理页时校验 token 是否仍有效）。"""
    return {"ok": True}
```

3d. `backend/main.py`：

```python
from routers import users, conversations, tarot, astrology, decks, wallet, payments, daily, admin
```

并在 `app.include_router(daily.router)` 后加：

```python
app.include_router(admin.router)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
python -m pytest tests/test_admin_router.py -q
```

Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/services/auth_service.py backend/routers/admin.py backend/main.py backend/tests/test_admin_router.py
git commit -m "feat: 后台管理鉴权(ADMIN_PASSWORD+admin JWT,失败锁定,未配置即404)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 管理数据接口（stats / conversations / users / usage）

**Files:**
- Modify: `backend/services/storage_service.py`（+4 个只读查询）
- Modify: `backend/services/rate_limit_service.py`（+`get_today_usage`）
- Modify: `backend/routers/admin.py`（+5 个端点）
- Test: `backend/tests/test_admin_router.py`（追加）

- [ ] **Step 0: 环境 sanity——确认 SQLite JSON1 可用**

```bash
venv/bin/python -c "import sqlite3; print(sqlite3.connect(':memory:').execute(\"select json_extract('{\\\"a\\\":1}','\$.a')\").fetchone())"
```

Expected: `(1,)`（macOS 与 Ubuntu 的 Python 均默认带 JSON1；若失败则 EC2 上同样跑一遍确认）

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_admin_router.py`：

```python
from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, UserProfile,
)
from services.storage_service import StorageService  # noqa: E402


def _seed(client):
    """2 用户（1 游客 1 注册）+ 3 会话。"""
    async def _run():
        await StorageService.save_user(User(user_id="guest_1", user_type=UserType.GUEST,
                                            profile=UserProfile(nickname="小游")))
        await StorageService.save_user(User(user_id="user_1", user_type=UserType.REGISTERED,
                                            username="alice"))
        await StorageService.save_conversation(Conversation(
            conversation_id="c1", user_id="guest_1", session_type=SessionType.TAROT,
            title="塔罗A", updated_at="2026-07-01T10:00:00",
            messages=[Message(role=MessageRole.USER, content="你好")]))
        await StorageService.save_conversation(Conversation(
            conversation_id="c2", user_id="user_1", session_type=SessionType.CHAT,
            title="聊愈B", updated_at="2026-07-03T10:00:00"))
        await StorageService.save_conversation(Conversation(
            conversation_id="c3", user_id="user_1", session_type=SessionType.TAROT,
            title="塔罗C", updated_at="2026-07-02T10:00:00"))
    asyncio.run(_run())


class TestAdminData:
    def test_stats(self, client):
        _seed(client)
        s = client.get("/api/admin/stats", headers=_admin_headers(client)).json()
        assert s["total_users"] == 2 and s["guest_users"] == 1 and s["registered_users"] == 1
        assert s["total_conversations"] == 3

    def test_conversations_sorted_filtered_enriched(self, client):
        _seed(client)
        h = _admin_headers(client)
        r = client.get("/api/admin/conversations", headers=h).json()
        assert r["total"] == 3
        assert [c["conversation_id"] for c in r["items"]] == ["c2", "c3", "c1"]  # updated_at 倒序
        assert r["items"][2]["nickname"] == "小游"          # 用户信息已联查
        assert r["items"][2]["message_count"] == 1
        r2 = client.get("/api/admin/conversations?session_type=tarot", headers=h).json()
        assert r2["total"] == 2
        r3 = client.get("/api/admin/conversations?limit=1&offset=1", headers=h).json()
        assert [c["conversation_id"] for c in r3["items"]] == ["c3"]

    def test_conversation_detail(self, client):
        _seed(client)
        h = _admin_headers(client)
        d = client.get("/api/admin/conversations/c1", headers=h).json()
        assert d["messages"][0]["content"] == "你好"
        assert client.get("/api/admin/conversations/nope", headers=h).status_code == 404

    def test_users_with_counts(self, client):
        _seed(client)
        r = client.get("/api/admin/users", headers=_admin_headers(client)).json()
        assert r["total"] == 2
        by_id = {u["user_id"]: u for u in r["items"]}
        assert by_id["user_1"]["conversation_count"] == 2
        assert by_id["user_1"]["last_active"] == "2026-07-03T10:00:00"
        assert by_id["guest_1"]["user_type"] == "guest"

    def test_usage(self, client, tmp_path, monkeypatch):
        _seed(client)
        import json as _json
        from datetime import date
        import services.rate_limit_service as rl
        usage_file = tmp_path / "usage.json"
        usage_file.write_text(_json.dumps({date.today().isoformat(): {"guest_1": 3}}), encoding="utf-8")
        monkeypatch.setattr(rl, "USAGE_FILE", usage_file)
        r = client.get("/api/admin/usage", headers=_admin_headers(client)).json()
        assert r["entries"][0]["user_id"] == "guest_1" and r["entries"][0]["used"] == 3
        assert r["entries"][0]["nickname"] == "小游"
        assert r["guest_daily_limit"] > 0
```

- [ ] **Step 2: 跑测试确认失败**

```bash
python -m pytest tests/test_admin_router.py -q
```

Expected: 新增用例 404/AttributeError FAIL，Task 4 的 8 个仍 pass

- [ ] **Step 3: StorageService 加管理查询**

追加到 `backend/services/storage_service.py` 末尾（类内）：

```python
    # ── 后台管理只读查询 ──────────────────────────────────────────────────
    @staticmethod
    async def get_admin_stats() -> dict:
        """概览指标。今日按 UTC 日界（与 created_at/updated_at 的 utcnow 一致）。"""
        from datetime import datetime
        today = datetime.utcnow().date().isoformat()
        async with get_db() as db:
            async def _one(sql: str, *params):
                async with db.execute(sql, params) as cur:
                    return (await cur.fetchone())[0]

            total_users = await _one("SELECT COUNT(*) FROM users")
            guest_users = await _one(
                "SELECT COUNT(*) FROM users WHERE json_extract(data,'$.user_type')='guest'")
            total_conversations = await _one("SELECT COUNT(*) FROM conversations")
            today_new = await _one(
                "SELECT COUNT(*) FROM conversations WHERE json_extract(data,'$.created_at')>=?",
                today)
            today_messages = 0
            async with db.execute(
                "SELECT data FROM conversations WHERE updated_at>=?", (today,)
            ) as cur:
                async for row in cur:
                    for m in json.loads(row["data"]).get("messages", []):
                        if m.get("timestamp", "") >= today:
                            today_messages += 1
        return {
            "total_users": total_users,
            "guest_users": guest_users,
            "registered_users": total_users - guest_users,
            "total_conversations": total_conversations,
            "today_new_conversations": today_new,
            "today_messages": today_messages,
        }

    @staticmethod
    async def list_conversations_admin(
        limit: int = 20, offset: int = 0,
        session_type: Optional[str] = None, user_id: Optional[str] = None,
    ) -> tuple:
        """全局会话摘要（不含消息全文），updated_at 倒序。返回 (items, total)。"""
        where, params = [], []
        if session_type:
            where.append("json_extract(data,'$.session_type')=?")
            params.append(session_type)
        if user_id:
            where.append("user_id=?")
            params.append(user_id)
        w = ("WHERE " + " AND ".join(where)) if where else ""
        async with get_db() as db:
            async with db.execute(
                f"SELECT COUNT(*) FROM conversations {w}", params
            ) as cur:
                total = (await cur.fetchone())[0]
            async with db.execute(
                f"""SELECT conversation_id, user_id, updated_at,
                           json_extract(data,'$.session_type') AS session_type,
                           json_extract(data,'$.title')        AS title,
                           json_extract(data,'$.created_at')   AS created_at,
                           json_array_length(data,'$.messages') AS message_count
                    FROM conversations {w}
                    ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
                params + [limit, offset],
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows], total

    @staticmethod
    async def get_users_brief(user_ids: List[str]) -> dict:
        """{user_id: {username, nickname, user_type}}，供列表联查显示。"""
        ids = list(set(user_ids))
        if not ids:
            return {}
        qs = ",".join("?" * len(ids))
        async with get_db() as db:
            async with db.execute(
                f"""SELECT user_id, username,
                           json_extract(data,'$.user_type')        AS user_type,
                           json_extract(data,'$.profile.nickname') AS nickname
                    FROM users WHERE user_id IN ({qs})""",
                ids,
            ) as cur:
                rows = await cur.fetchall()
        return {r["user_id"]: dict(r) for r in rows}

    @staticmethod
    async def list_users_admin(limit: int = 50, offset: int = 0) -> tuple:
        """用户列表 + 会话数 + 最后活跃，活跃倒序。返回 (items, total)。"""
        async with get_db() as db:
            async with db.execute("SELECT COUNT(*) FROM users") as cur:
                total = (await cur.fetchone())[0]
            async with db.execute(
                """SELECT u.user_id, u.username,
                          json_extract(u.data,'$.user_type')        AS user_type,
                          json_extract(u.data,'$.profile.nickname') AS nickname,
                          json_extract(u.data,'$.created_at')       AS created_at,
                          COUNT(c.conversation_id)                  AS conversation_count,
                          MAX(c.updated_at)                         AS last_active
                   FROM users u
                   LEFT JOIN conversations c ON c.user_id = u.user_id
                   GROUP BY u.user_id
                   ORDER BY (last_active IS NULL), last_active DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset),
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows], total
```

- [ ] **Step 4: rate_limit_service 加公开读取**

追加到 `backend/services/rate_limit_service.py` 末尾（模块级）：

```python
def get_today_usage() -> tuple:
    """(今日日期, {user_id: 已用次数})——供后台展示，只读。"""
    today = _today()
    return today, _read().get(today, {})
```

- [ ] **Step 5: admin.py 加数据端点**

`backend/routers/admin.py` 顶部 import 增加：

```python
from typing import Optional

from services.rate_limit_service import get_today_usage
from services.storage_service import StorageService
```

文件末尾追加：

```python
@router.get("/stats")
async def admin_stats(_: None = Depends(require_admin)):
    return await StorageService.get_admin_stats()


@router.get("/conversations")
async def admin_conversations(
    limit: int = 20,
    offset: int = 0,
    session_type: Optional[str] = None,
    user_id: Optional[str] = None,
    _: None = Depends(require_admin),
):
    limit = max(1, min(limit, 100))
    items, total = await StorageService.list_conversations_admin(
        limit, offset, session_type, user_id)
    users = await StorageService.get_users_brief([it["user_id"] for it in items])
    for it in items:
        u = users.get(it["user_id"], {})
        it["username"] = u.get("username")
        it["nickname"] = u.get("nickname")
        it["user_type"] = u.get("user_type")
    return {"items": items, "total": total}


@router.get("/conversations/{conversation_id}")
async def admin_conversation_detail(
    conversation_id: str, _: None = Depends(require_admin)
):
    conversation = await StorageService.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation


@router.get("/users")
async def admin_users(
    limit: int = 50, offset: int = 0, _: None = Depends(require_admin)
):
    limit = max(1, min(limit, 200))
    items, total = await StorageService.list_users_admin(limit, offset)
    return {"items": items, "total": total}


@router.get("/usage")
async def admin_usage(_: None = Depends(require_admin)):
    today, day = get_today_usage()
    users = await StorageService.get_users_brief(list(day.keys()))
    entries = []
    for uid, used in sorted(day.items(), key=lambda kv: -kv[1]):
        u = users.get(uid, {})
        entries.append({
            "user_id": uid, "used": used,
            "username": u.get("username"), "nickname": u.get("nickname"),
            "user_type": u.get("user_type"),
        })
    return {
        "date": today,
        "entries": entries,
        "guest_daily_limit": config.GUEST_DAILY_MESSAGE_LIMIT,
        "user_daily_limit": config.USER_DAILY_MESSAGE_LIMIT,
    }
```

- [ ] **Step 6: 跑测试确认通过**

```bash
python -m pytest tests/test_admin_router.py -q
```

Expected: 13 passed

- [ ] **Step 7: Commit**

```bash
git add backend/services/storage_service.py backend/services/rate_limit_service.py backend/routers/admin.py backend/tests/test_admin_router.py
git commit -m "feat: 管理数据接口(概览/全局会话/用户列表/今日用量)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Prompt 管理端点

**Files:**
- Modify: `backend/routers/admin.py`
- Test: `backend/tests/test_admin_router.py`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_admin_router.py`（注意 fixture 需同时隔离 prompt 覆盖目录——修改 `client` fixture，在 `monkeypatch.setattr(db_mod, ...)` 之后加两行）：

```python
    import services.prompt_service as ps_mod
    monkeypatch.setattr(ps_mod, "PROMPT_OVERRIDES_DIR", tmp_path / "prompt_overrides")
```

然后追加测试类：

```python
class TestAdminPrompts:
    def test_list_prompts(self, client):
        r = client.get("/api/admin/prompts", headers=_admin_headers(client)).json()
        assert len(r["items"]) == 5
        assert all(not p["overridden"] for p in r["items"])

    def test_get_save_reset_roundtrip(self, client):
        h = _admin_headers(client)
        d = client.get("/api/admin/prompts/tarot_system.md", headers=h).json()
        assert "职业占卜师" in d["content"]
        assert d["content"] == d["default_content"]

        r = client.put("/api/admin/prompts/tarot_system.md",
                       json={"content": "新版提示词"}, headers=h)
        assert r.status_code == 200 and r.json()["overridden"] is True
        d2 = client.get("/api/admin/prompts/tarot_system.md", headers=h).json()
        assert d2["content"] == "新版提示词"
        assert "职业占卜师" in d2["default_content"]  # 默认版不受影响

        r2 = client.delete("/api/admin/prompts/tarot_system.md", headers=h)
        assert r2.status_code == 200 and r2.json()["overridden"] is False

    def test_unknown_name_404(self, client):
        h = _admin_headers(client)
        assert client.get("/api/admin/prompts/evil.md", headers=h).status_code == 404
        assert client.put("/api/admin/prompts/evil.md", json={"content": "x"}, headers=h).status_code == 404

    def test_empty_content_400(self, client):
        h = _admin_headers(client)
        r = client.put("/api/admin/prompts/tarot_system.md", json={"content": "  "}, headers=h)
        assert r.status_code == 400

    def test_requires_admin(self, client):
        assert client.get("/api/admin/prompts").status_code == 401
```

- [ ] **Step 2: 跑测试确认失败**

```bash
python -m pytest tests/test_admin_router.py -q
```

Expected: TestAdminPrompts 5 个 FAIL（404 no route），其余 13 个 pass

- [ ] **Step 3: 实现端点**

`backend/routers/admin.py` import 增加：

```python
from services import prompt_service
```

末尾追加：

```python
class PromptSaveRequest(BaseModel):
    content: str


@router.get("/prompts")
async def admin_prompts(_: None = Depends(require_admin)):
    return {"items": prompt_service.list_prompts()}


@router.get("/prompts/{name}")
async def admin_prompt_detail(name: str, _: None = Depends(require_admin)):
    try:
        info = prompt_service.get_prompt_info(name)
        return {
            **info,
            "content": prompt_service.get_prompt(name),
            "default_content": prompt_service.get_default(name),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/prompts/{name}")
async def admin_prompt_save(
    name: str, request: PromptSaveRequest, _: None = Depends(require_admin)
):
    try:
        return prompt_service.save_override(name, request.content)
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/prompts/{name}")
async def admin_prompt_reset(name: str, _: None = Depends(require_admin)):
    try:
        return prompt_service.reset_override(name)
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
```

- [ ] **Step 4: 全量后端测试**

```bash
python -m pytest -q
```

Expected: 全部通过（52 + 18 admin ≈ 70 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/routers/admin.py backend/tests/test_admin_router.py
git commit -m "feat: prompt 在线管理接口(读/保存覆盖/重置默认)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 前端骨架（adminApi + 登录 + 布局 + 概览 + 用量）

**Files:**
- Create: `frontend/src/services/adminApi.ts`
- Create: `frontend/src/pages/admin/AdminApp.tsx`、`OverviewPanel.tsx`、`UsagePanel.tsx`、`admin.css`
- Modify: `frontend/src/main.tsx`

无测试框架；每步后以 `npm run build` 为验证门槛。本 task 先建骨架时，`AdminApp.tsx` 中对另外三个面板的引用**同时创建最小占位**（Task 8/9 替换实现），保证 build 始终绿。

- [ ] **Step 1: 创建 adminApi.ts**

`frontend/src/services/adminApi.ts`：

```typescript
import axios from 'axios';

// 与用户态完全隔离:独立 token key + 独立 axios 实例(只有管理页使用)
const ADMIN_TOKEN_KEY = 'tarot_admin_token';

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (t: string) => localStorage.setItem(ADMIN_TOKEN_KEY, t);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_TOKEN_KEY);

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' });

api.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401) clearAdminToken();
    return Promise.reject(error);
  }
);

export const errMsg = (e: unknown): string => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : '请求失败';
};

export const isAuthError = (e: unknown): boolean => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
};

export interface AdminStats {
  total_users: number;
  guest_users: number;
  registered_users: number;
  total_conversations: number;
  today_new_conversations: number;
  today_messages: number;
}

export interface AdminConvSummary {
  conversation_id: string;
  user_id: string;
  updated_at: string;
  created_at: string;
  session_type: string;
  title: string;
  message_count: number;
  username: string | null;
  nickname: string | null;
  user_type: string | null;
}

export interface AdminMessage {
  role: string;
  content: string;
  timestamp?: string;
  tarot_cards?: Array<{ card_id: number; card_name: string; reversed: boolean }> | null;
}

export interface AdminConversation {
  conversation_id: string;
  user_id: string;
  session_type: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: AdminMessage[];
}

export interface AdminUser {
  user_id: string;
  username: string | null;
  nickname: string | null;
  user_type: string;
  created_at: string;
  conversation_count: number;
  last_active: string | null;
}

export interface AdminUsage {
  date: string;
  entries: Array<{
    user_id: string; used: number;
    username: string | null; nickname: string | null; user_type: string | null;
  }>;
  guest_daily_limit: number;
  user_daily_limit: number;
}

export interface PromptInfo {
  name: string;
  label: string;
  overridden: boolean;
  chars: number;
  updated_at: string | null;
}

export interface PromptDetail extends PromptInfo {
  content: string;
  default_content: string;
}

export const displayName = (u: {
  username?: string | null; nickname?: string | null; user_id: string;
}) => u.nickname || u.username || u.user_id.slice(0, 12);

export const adminApi = {
  login: async (password: string): Promise<string> =>
    (await api.post('/api/admin/login', { password })).data.access_token,
  stats: async (): Promise<AdminStats> => (await api.get('/api/admin/stats')).data,
  conversations: async (params: {
    limit?: number; offset?: number; session_type?: string;
  }): Promise<{ items: AdminConvSummary[]; total: number }> =>
    (await api.get('/api/admin/conversations', { params })).data,
  conversation: async (id: string): Promise<AdminConversation> =>
    (await api.get(`/api/admin/conversations/${id}`)).data,
  users: async (params: { limit?: number; offset?: number }): Promise<{ items: AdminUser[]; total: number }> =>
    (await api.get('/api/admin/users', { params })).data,
  usage: async (): Promise<AdminUsage> => (await api.get('/api/admin/usage')).data,
  prompts: async (): Promise<{ items: PromptInfo[] }> => (await api.get('/api/admin/prompts')).data,
  prompt: async (name: string): Promise<PromptDetail> => (await api.get(`/api/admin/prompts/${name}`)).data,
  savePrompt: async (name: string, content: string): Promise<PromptInfo> =>
    (await api.put(`/api/admin/prompts/${name}`, { content })).data,
  resetPrompt: async (name: string): Promise<PromptInfo> =>
    (await api.delete(`/api/admin/prompts/${name}`)).data,
};
```

- [ ] **Step 2: 创建 AdminApp.tsx + 三个面板占位**

`frontend/src/pages/admin/AdminApp.tsx`：

```tsx
import { useState } from 'react';
import { adminApi, clearAdminToken, errMsg, getAdminToken, setAdminToken } from '@/services/adminApi';
import OverviewPanel from './OverviewPanel';
import ConversationsPanel from './ConversationsPanel';
import UsersPanel from './UsersPanel';
import PromptsPanel from './PromptsPanel';
import UsagePanel from './UsagePanel';
import './admin.css';

type Tab = 'overview' | 'conversations' | 'users' | 'prompts' | 'usage';
const TABS: Array<[Tab, string]> = [
  ['overview', '概览'],
  ['conversations', '会话'],
  ['users', '用户'],
  ['prompts', 'Prompt'],
  ['usage', '用量'],
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [tab, setTab] = useState<Tab>('conversations');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      setAdminToken(await adminApi.login(password));
      setAuthed(true);
      setPassword('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <div className="admin-login">
        <h1>后台管理</h1>
        <input
          type="password"
          value={password}
          placeholder="管理员密码"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && password && login()}
        />
        <button onClick={login} disabled={busy || !password}>
          {busy ? '登录中…' : '登录'}
        </button>
        {error && <p className="admin-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="admin-root">
      <header className="admin-header">
        <span className="admin-brand">占卜屋 · 后台</span>
        <nav>
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button
          className="admin-logout"
          onClick={() => {
            clearAdminToken();
            setAuthed(false);
          }}
        >
          退出
        </button>
      </header>
      <main className="admin-main">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'conversations' && <ConversationsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'prompts' && <PromptsPanel />}
        {tab === 'usage' && <UsagePanel />}
      </main>
    </div>
  );
}
```

`frontend/src/pages/admin/OverviewPanel.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { adminApi, errMsg, isAuthError, type AdminStats } from '@/services/adminApi';

export default function OverviewPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.stats().then(setStats).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!stats) return <p className="admin-dim">加载中…</p>;

  const items: Array<[string, number]> = [
    ['总用户', stats.total_users],
    ['游客', stats.guest_users],
    ['注册用户', stats.registered_users],
    ['总会话', stats.total_conversations],
    ['今日新会话', stats.today_new_conversations],
    ['今日消息', stats.today_messages],
  ];
  return (
    <div className="admin-stats">
      {items.map(([label, value]) => (
        <div key={label} className="admin-stat-card">
          <div className="num">{value}</div>
          <div className="label">{label}</div>
        </div>
      ))}
    </div>
  );
}
```

`frontend/src/pages/admin/UsagePanel.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { adminApi, displayName, errMsg, isAuthError, type AdminUsage } from '@/services/adminApi';

export default function UsagePanel() {
  const [data, setData] = useState<AdminUsage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.usage().then(setData).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!data) return <p className="admin-dim">加载中…</p>;

  return (
    <div>
      <p className="admin-dim">
        {data.date} · 限额：游客 {data.guest_daily_limit} 次/天，注册 {data.user_daily_limit} 次/天
      </p>
      {data.entries.length === 0 ? (
        <p className="admin-dim">今日暂无调用</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>用户</th><th>类型</th><th>今日已用</th></tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.user_id}>
                <td>
                  {displayName(e)}
                  <div className="admin-dim">{e.user_id}</div>
                </td>
                <td>{e.user_type === 'guest' ? '游客' : e.user_type ? '注册' : '未知'}</td>
                <td>{e.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

占位（Task 8/9 会整体替换）——`frontend/src/pages/admin/ConversationsPanel.tsx`：

```tsx
export default function ConversationsPanel() {
  return <p className="admin-dim">会话面板（Task 8 实现）</p>;
}
```

`frontend/src/pages/admin/UsersPanel.tsx`：

```tsx
export default function UsersPanel() {
  return <p className="admin-dim">用户面板（Task 8 实现）</p>;
}
```

`frontend/src/pages/admin/PromptsPanel.tsx`：

```tsx
export default function PromptsPanel() {
  return <p className="admin-dim">Prompt 面板（Task 9 实现）</p>;
}
```

- [ ] **Step 3: admin.css（极简暗色，功能优先）**

`frontend/src/pages/admin/admin.css`：

```css
/* 后台管理:极简功能性暗色,不追随主站视觉投入 */
.admin-root { min-height: 100vh; background: #14121a; color: #d8d4c8; font-size: 14px; }
.admin-login {
  min-height: 100vh; background: #14121a; color: #d8d4c8;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
}
.admin-login h1 { font-size: 20px; font-weight: 600; }
.admin-login input {
  width: 240px; padding: 8px 12px; background: #201d29; color: inherit;
  border: 1px solid #3a3548; border-radius: 6px; outline: none;
}
.admin-login button, .admin-main button {
  padding: 6px 14px; background: #2a2536; color: #cfc6a8;
  border: 1px solid #4a4358; border-radius: 6px; cursor: pointer;
}
.admin-main button:disabled, .admin-login button:disabled { opacity: 0.45; cursor: default; }
.admin-header {
  display: flex; align-items: center; gap: 16px; padding: 10px 16px;
  border-bottom: 1px solid #2c2838; position: sticky; top: 0; background: #14121a; z-index: 5;
}
.admin-brand { font-weight: 600; color: #cfa94a; white-space: nowrap; }
.admin-header nav { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.admin-header nav button { border: none; background: none; color: #9a94a8; padding: 6px 10px; }
.admin-header nav button.active { color: #cfa94a; border-bottom: 2px solid #cfa94a; border-radius: 0; }
.admin-logout { white-space: nowrap; }
.admin-main { padding: 16px; max-width: 1100px; margin: 0 auto; }
.admin-error { color: #d97b6c; margin: 8px 0; }
.admin-notice { color: #7fae7a; margin: 8px 0; }
.admin-dim { color: #7d7788; font-size: 12px; }
.admin-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.admin-toolbar .title { font-weight: 600; }
.admin-toolbar select {
  background: #201d29; color: inherit; border: 1px solid #3a3548; border-radius: 6px; padding: 5px 8px;
}
/* 概览 */
.admin-stats { display: flex; flex-wrap: wrap; gap: 12px; }
.admin-stat-card {
  background: #1c1926; border: 1px solid #2c2838; border-radius: 8px;
  padding: 14px 20px; min-width: 120px; text-align: center;
}
.admin-stat-card .num { font-size: 24px; color: #cfa94a; }
.admin-stat-card .label { margin-top: 4px; color: #9a94a8; font-size: 12px; }
/* 表格 */
.admin-table { width: 100%; border-collapse: collapse; }
.admin-table th, .admin-table td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid #2c2838; vertical-align: top;
}
.admin-table th { color: #9a94a8; font-weight: 500; font-size: 12px; }
/* 会话:桌面双栏,窄屏堆叠(详情打开时藏列表) */
.admin-conv { display: flex; gap: 16px; align-items: flex-start; }
.admin-conv-list { flex: 1; min-width: 0; }
.admin-conv-list ul { list-style: none; padding: 0; margin: 0; }
.admin-conv-list li {
  padding: 10px 12px; border: 1px solid #2c2838; border-radius: 8px;
  margin-bottom: 8px; cursor: pointer; background: #1c1926;
}
.admin-conv-list li.active { border-color: #cfa94a; }
.admin-conv-list .row1 { display: flex; justify-content: space-between; gap: 8px; }
.admin-conv-list .title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-conv-list .row2 { margin-top: 4px; }
.admin-conv-detail { flex: 1.4; min-width: 0; }
.admin-conv-detail .messages { display: flex; flex-direction: column; gap: 10px; }
.admin-conv-detail .msg { background: #1c1926; border: 1px solid #2c2838; border-radius: 8px; padding: 10px 12px; }
.admin-conv-detail .msg-user { border-left: 3px solid #6f86a8; }
.admin-conv-detail .msg-assistant { border-left: 3px solid #cfa94a; }
.admin-conv-detail .msg-system { border-left: 3px solid #7d7788; opacity: 0.8; }
.admin-conv-detail .content { white-space: pre-wrap; word-break: break-word; margin-top: 6px; line-height: 1.6; }
.admin-conv-detail .cards { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.card-chip {
  background: #2a2536; border: 1px solid #4a4358; border-radius: 999px;
  padding: 2px 10px; font-size: 12px; color: #cfc6a8;
}
@media (max-width: 800px) {
  .admin-conv.has-detail .admin-conv-list { display: none; }
}
/* prompt */
.admin-prompts { display: flex; gap: 16px; align-items: flex-start; }
.prompt-list { list-style: none; padding: 0; margin: 0; width: 260px; flex-shrink: 0; }
.prompt-list li {
  padding: 10px 12px; border: 1px solid #2c2838; border-radius: 8px; margin-bottom: 8px;
  cursor: pointer; background: #1c1926; display: flex; justify-content: space-between; gap: 8px;
}
.prompt-list li.active { border-color: #cfa94a; }
.prompt-list .badge {
  font-style: normal; color: #cfa94a; border: 1px solid #cfa94a;
  border-radius: 4px; padding: 0 4px; margin-right: 4px; font-size: 11px;
}
.prompt-editor { flex: 1; min-width: 0; }
.prompt-editor textarea {
  width: 100%; min-height: 60vh; background: #201d29; color: #d8d4c8;
  border: 1px solid #3a3548; border-radius: 8px; padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.6;
  resize: vertical; box-sizing: border-box;
}
@media (max-width: 800px) {
  .admin-prompts { flex-direction: column; }
  .prompt-list { width: 100%; }
}
```

- [ ] **Step 4: main.tsx 加懒加载路由**

`frontend/src/main.tsx` 整体改为：

```tsx
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import TarotShowcase from './pages/TarotShowcase'
import './index.css'

// 管理端独立 chunk:普通用户不加载
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/showcase" element={<TarotShowcase />} />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<div style={{ color: '#888', padding: '2rem' }}>加载中…</div>}>
              <AdminApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
```

- [ ] **Step 5: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功；输出里能看到独立的 `AdminApp-*.js` chunk

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/adminApi.ts frontend/src/pages/admin/ frontend/src/main.tsx
git commit -m "feat(admin): 管理端骨架(独立token登录/布局/概览/用量,懒加载chunk)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 会话面板（核心页）+ 用户面板

**Files:**
- Modify: `frontend/src/pages/admin/ConversationsPanel.tsx`（整体替换占位）
- Modify: `frontend/src/pages/admin/UsersPanel.tsx`（整体替换占位）

- [ ] **Step 1: ConversationsPanel.tsx 整体替换为：**

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  adminApi, displayName, errMsg, isAuthError,
  type AdminConvSummary, type AdminConversation,
} from '@/services/adminApi';

const PAGE = 20;
const TYPE_LABELS: Record<string, string> = {
  tarot: '塔罗', astrology: '星盘', chat: '聊愈', daily: '每日一签',
};

const fmtTime = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default function ConversationsPanel() {
  const [items, setItems] = useState<AdminConvSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState('');
  const [detail, setDetail] = useState<AdminConversation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (offset: number, sessionType: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await adminApi.conversations({
        limit: PAGE, offset, session_type: sessionType || undefined,
      });
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setTotal(r.total);
    } catch (e) {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0, type);
  }, [type, load]);

  const open = async (id: string) => {
    setError('');
    try {
      setDetail(await adminApi.conversation(id));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className={`admin-conv ${detail ? 'has-detail' : ''}`}>
      <section className="admin-conv-list">
        <div className="admin-toolbar">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <span className="admin-dim">{total} 个会话</span>
        </div>
        {error && <p className="admin-error">{error}</p>}
        <ul>
          {items.map((c) => (
            <li
              key={c.conversation_id}
              className={detail?.conversation_id === c.conversation_id ? 'active' : ''}
              onClick={() => open(c.conversation_id)}
            >
              <div className="row1">
                <span className="title">{c.title}</span>
                <span className="admin-dim">{TYPE_LABELS[c.session_type] || c.session_type}</span>
              </div>
              <div className="row2 admin-dim">
                {displayName(c)}
                {c.user_type === 'guest' ? '（游客）' : ''} · {c.message_count} 条 · {fmtTime(c.updated_at)}
              </div>
            </li>
          ))}
        </ul>
        {items.length < total && (
          <button disabled={loading} onClick={() => load(items.length, type)}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </section>
      {detail && (
        <section className="admin-conv-detail">
          <div className="admin-toolbar">
            <button onClick={() => setDetail(null)}>← 返回</button>
            <span className="title">{detail.title}</span>
            <span className="admin-dim">{fmtTime(detail.created_at)}</span>
          </div>
          <div className="messages">
            {detail.messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}`}>
                <div className="admin-dim">
                  {m.role === 'user' ? '用户' : m.role === 'assistant' ? '占卜师' : '系统'} · {fmtTime(m.timestamp)}
                </div>
                <div className="content">{m.content}</div>
                {m.tarot_cards && m.tarot_cards.length > 0 && (
                  <div className="cards">
                    {m.tarot_cards.map((card, j) => (
                      <span key={j} className="card-chip">
                        {card.card_name}{card.reversed ? '（逆）' : '（正）'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: UsersPanel.tsx 整体替换为：**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { adminApi, displayName, errMsg, isAuthError, type AdminUser } from '@/services/adminApi';

const PAGE = 50;

export default function UsersPanel() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback((offset: number) => {
    adminApi.users({ limit: PAGE, offset }).then((r) => {
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setTotal(r.total);
    }).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div>
      {error && <p className="admin-error">{error}</p>}
      <table className="admin-table">
        <thead>
          <tr><th>用户</th><th>类型</th><th>会话数</th><th>注册时间</th><th>最后活跃</th></tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.user_id}>
              <td>
                {displayName(u)}
                <div className="admin-dim">{u.user_id}</div>
              </td>
              <td>{u.user_type === 'guest' ? '游客' : '注册'}</td>
              <td>{u.conversation_count}</td>
              <td>{u.created_at ? u.created_at.slice(0, 10) : ''}</td>
              <td>{u.last_active ? u.last_active.slice(0, 16).replace('T', ' ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length < total && <button onClick={() => load(items.length)}>加载更多</button>}
    </div>
  );
}
```

- [ ] **Step 3: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/ConversationsPanel.tsx frontend/src/pages/admin/UsersPanel.tsx
git commit -m "feat(admin): 会话列表+聊天详情面板、用户列表面板

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Prompt 编辑面板

**Files:**
- Modify: `frontend/src/pages/admin/PromptsPanel.tsx`（整体替换占位）

- [ ] **Step 1: PromptsPanel.tsx 整体替换为：**

```tsx
import { useEffect, useState } from 'react';
import {
  adminApi, errMsg, isAuthError, type PromptDetail, type PromptInfo,
} from '@/services/adminApi';

export default function PromptsPanel() {
  const [list, setList] = useState<PromptInfo[]>([]);
  const [current, setCurrent] = useState<PromptDetail | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    adminApi.prompts().then((r) => setList(r.items)).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });

  useEffect(() => {
    refresh();
  }, []);

  const open = async (name: string) => {
    setError('');
    setNotice('');
    try {
      const d = await adminApi.prompt(name);
      setCurrent(d);
      setText(d.content);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    if (!current) return;
    if (!window.confirm(`确认保存对「${current.label}」的修改？保存后下一次对话立即生效。`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await adminApi.savePrompt(current.name, text);
      setNotice('已保存，即时生效');
      await open(current.name);
      refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!current) return;
    if (!window.confirm(`确认丢弃线上修改，恢复「${current.label}」为代码默认版？`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await adminApi.resetPrompt(current.name);
      setNotice('已重置为默认');
      await open(current.name);
      refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-prompts">
      <ul className="prompt-list">
        {list.map((p) => (
          <li key={p.name} className={current?.name === p.name ? 'active' : ''} onClick={() => open(p.name)}>
            <span>{p.label}</span>
            <span className="admin-dim">
              {p.overridden && <em className="badge">已覆盖</em>}
              {p.chars} 字
            </span>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="prompt-editor">
          <div className="admin-toolbar">
            <span className="title">{current.label}</span>
            <span className="admin-dim">{current.name}</span>
            <button disabled={busy || text === current.content} onClick={save}>保存</button>
            <button disabled={busy || !current.overridden} onClick={reset}>重置为默认</button>
          </div>
          {error && <p className="admin-error">{error}</p>}
          {notice && <p className="admin-notice">{notice}</p>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </div>
      ) : (
        <p className="admin-dim">← 选择一个提示词查看/编辑</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/PromptsPanel.tsx
git commit -m "feat(admin): prompt 在线编辑面板(保存覆盖/重置默认/覆盖徽标)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 端到端冒烟 + 文档收尾

**Files:**
- Modify: `CLAUDE.md`
- 无代码改动（冒烟只读线上数据，写操作仅 prompt 覆盖文件且立即重置）

- [ ] **Step 1: 后端全量测试**

```bash
source venv/bin/activate && cd backend && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 2: 本地端到端冒烟**

```bash
# 终端 A：带 ADMIN_PASSWORD 启动后端
cd /Users/zhanfan/PycharmProjects/tarot-astro && source venv/bin/activate \
  && ADMIN_PASSWORD=localtest python backend/main.py
```

```bash
# 终端 B：接口冒烟（只读 + prompt 覆盖后立即重置，不留痕）
TOKEN=$(curl -s -X POST localhost:8000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"localtest"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s localhost:8000/api/admin/stats -H "Authorization: Bearer $TOKEN"
curl -s "localhost:8000/api/admin/conversations?limit=3" -H "Authorization: Bearer $TOKEN" | head -c 500
curl -s localhost:8000/api/admin/prompts -H "Authorization: Bearer $TOKEN"
# 保存覆盖 → 确认 overridden=true → 重置
curl -s -X PUT localhost:8000/api/admin/prompts/tarot_system.md \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"冒烟测试覆盖"}'
curl -s -X DELETE localhost:8000/api/admin/prompts/tarot_system.md -H "Authorization: Bearer $TOKEN"
# 未配置密码时应 404（重启后端去掉 ADMIN_PASSWORD 再验，或跳过此条）
```

Expected: stats/conversations 返回真实数据；prompt 保存后 `overridden:true`，重置后 `false`；全程不动 `backend/data/` 其余文件。浏览器访问 `http://localhost:5173/admin`（起前端 dev server）过一遍登录 → 看会话 → 改 prompt → 重置。

- [ ] **Step 3: 更新 CLAUDE.md**

- services 行追加：`prompt_service.py 提示词热加载(默认backend/prompts/+覆盖data/prompts/,白名单5个)`
- routers 行追加：`admin.py 后台管理(/api/admin,ADMIN_PASSWORD 开关+admin JWT)`
- `prompts/*.md` 说明改为：`prompts/*.md 全部系统提示词默认版(塔罗/占星/笔记本/每日×2,热加载,管理页可在线覆盖至 data/prompts/)`
- frontend 部分追加：`pages/admin/ 后台管理页(/admin,懒加载,独立token)`
- 构建段追加：`.env 需 ADMIN_PASSWORD 才启用后台`

- [ ] **Step 4: 最终 Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 收录后台管理与 prompt 外置

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 报告 EC2 部署清单（输出给用户，不执行）**

```
1. .env 追加: ADMIN_PASSWORD=<强密码>
2. git pull && 重启后端 (prompt 默认文件/新路由随代码到位)
3. 前端重新构建部署 (npm run build 产物同步)
4. 验证: https://域名/admin 登录; 改 prompt 保存 → 发起一次新对话确认生效;
   git pull 后确认 data/prompts/ 覆盖版仍在
```

---

## Self-Review 记录

- **Spec 覆盖**：云端 /admin ✓（T7 路由+Nginx零改动）；会话查看 ✓（T5 接口 + T8 面板，游客+注册同查）；prompt 在线编辑+热加载+双层 ✓（T1/2/3/6/9）；shadowing bug ✓（T1 Step1）；用户列表+概览 ✓（T5/T7/T8）；用量查看 ✓（T5/T7）；ADMIN_PASSWORD+admin JWT+404 开关+防爆破 ✓（T4）；错误处理（401 回登录、缺省文件 500、原子写）✓；测试策略 ✓（各 task TDD + T10 冒烟）；部署步骤 ✓（T10 Step5）。范围外条目均未混入。
- **Placeholder 扫描**：无 TBD/TODO；占位组件是显式计划产物（T8/9 整体替换）；所有代码步骤含完整代码。
- **类型/命名一致性**：`prompt_service` 函数名在 T2 定义、T3/T6 引用一致；`_login_fails`/`require_admin` T4 定义、T5/T6 复用一致；adminApi 接口字段与后端返回字段逐一核对一致（含 `nickname/username/user_type` 联查字段）；测试 fixture 的 monkeypatch 目标（`config.ADMIN_PASSWORD` 属性访问、`ps_mod.PROMPT_OVERRIDES_DIR` 模块全局）与实现方式匹配。
- **已知取舍**：今日指标按 UTC 日界（与库内 utcnow 一致，个人应用可接受）；`json_extract` 依赖 SQLite JSON1（T5 Step0 有 sanity check）；进程内登录锁单 worker 有效（部署即单 worker）。
