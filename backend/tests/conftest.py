import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Agent 的 provider/model 覆盖文件默认落 backend/data/。测试绝不能读到它：
# 用过一次管理页之后，线上配置就会悄悄改变整个测试套的行为。在导入任何
# services 之前指向一个空的临时路径，让测试永远只看见 .env 默认值。
os.environ.setdefault(
    "TAROT_LLM_CONFIG_FILE",
    str(Path(tempfile.gettempdir()) / "tarot-test-llm-agents-never-written.json"),
)


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _prompt_overrides_never_leak_from_data(tmp_path, monkeypatch):
    """管理页在线改的提示词落在 backend/data/prompts/，优先级高于仓库里的默认版。

    和上面那份 LLM 配置同一个道理：线上改过一句文案，整套断言就跟着线上文案漂，
    而且是在谁都没动代码的情况下。测试只认 backend/prompts/ 的默认版。
    """
    import services.prompt_service as ps
    monkeypatch.setattr(ps, "PROMPT_OVERRIDES_DIR", tmp_path / "prompt-overrides")
