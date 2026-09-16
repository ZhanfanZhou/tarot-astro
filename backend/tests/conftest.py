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
