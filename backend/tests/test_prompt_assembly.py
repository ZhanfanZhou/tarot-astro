"""prompt_assembly：管理页按阶段摊开的「怎么拼出来的」视图。

它不自己拼，只是用示例数据调运行时的拼装函数，所以展示和线上天然一致；
这里只守住「每个登记的提示词都接进了至少一处调用，而且落在某个阶段下」。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest


@pytest.fixture
def assembly(tmp_path, monkeypatch):
    import services.prompt_service as ps
    monkeypatch.setattr(ps, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
    from services import prompt_assembly
    return prompt_assembly


def test_every_registered_prompt_shows_up_under_a_stage(assembly):
    """新登记的提示词没接进 _call_sites()，管理页里就改不到它——在这里失败。"""
    from services import prompt_service

    listed = {name for stage in assembly.stages() for name in stage["prompts"]}
    assert listed == set(prompt_service.PROMPT_REGISTRY)


def test_every_call_site_lands_in_a_stage(assembly):
    """调用点的 stage 写错（不在 _STAGES 里），它就从管理页上消失了。"""
    staged = sum(len(stage["sites"]) for stage in assembly.stages())
    assert staged == len(assembly._call_sites())
