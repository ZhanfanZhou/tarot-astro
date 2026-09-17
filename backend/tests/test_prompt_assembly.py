"""prompt_assembly：管理页「组成」视图。

它不自己拼，只是用示例数据调运行时的拼装函数，所以展示和线上天然一致；
这里只守住「每个登记的提示词都接进了至少一处调用」。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def assembly(tmp_path, monkeypatch):
    import services.prompt_service as ps
    monkeypatch.setattr(ps, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
    from services import prompt_assembly
    return prompt_assembly


def test_every_registered_prompt_has_a_call_site(assembly):
    """新登记的提示词没接进 _call_sites()，管理页就看不到它的组成——在这里失败。"""
    from services import prompt_service

    missing = [name for name in prompt_service.PROMPT_REGISTRY if not assembly.call_sites_for(name)]
    assert missing == []


def test_unknown_prompt_rejected(assembly):
    with pytest.raises(KeyError):
        assembly.call_sites_for("evil.md")
