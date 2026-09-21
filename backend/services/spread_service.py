"""牌阵目录：ID → 牌阵名、位置、解读说明。

一副牌阵一个 .md（`prompts/spread_<id>.md`，登记在 PROMPT_REGISTRY 里，管理页可在线改）。
文件头是机器读的那几项，正文是给解读 Agent 看的那份说明：

    ---
    id: three_card_state
    name: 三张无牌阵·状态／结果
    positions:
      - 左牌：共同回答本次问题
      ...
    ---
    # 三张无牌阵·状态／结果
    ## 牌阵属性 ...

positions 是这副牌阵位置的唯一真源：开场只交牌阵 ID，位置由这里展开，抽几张
就是位置的个数（见 DrawCardsRequest）。开场那份 <牌阵选择参考>
（opening_spread_catalog.md）是同一批牌阵的简介，供开场选阵；正文这份详解不进开场
提示词，等交单选定 ID 之后才接进解读提示词。

可用牌阵 = 注册表里所有 spread_*.md，加一副牌阵只有两步：放文件、在 PROMPT_REGISTRY
登记。文件头解析失败或 id 与文件名对不上一律抛错，不静默跳过——牌阵少一副，
开场的 enum 就少一个选项，必须当场看见。
"""
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

from services import prompt_service

_PREFIX = "spread_"
_SUFFIX = ".md"

_FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)
_LIST_ITEM = re.compile(r"\A\s+-\s+(.+?)\s*\Z")
_SCALAR = re.compile(r"\A([a-z_]+):\s*(.*?)\s*\Z")


@dataclass(frozen=True)
class Spread:
    id: str
    name: str
    positions: tuple       # 位置含义，顺序即牌序；个数即张数
    detail: str            # 正文：牌阵属性、适用场合、解读方法与限制

    @property
    def card_count(self) -> int:
        return len(self.positions)


def prompt_name(spread_id: str) -> str:
    return f"{_PREFIX}{spread_id}{_SUFFIX}"


def _spread_ids() -> List[str]:
    return [name[len(_PREFIX):-len(_SUFFIX)] for name in prompt_service.PROMPT_REGISTRY
            if name.startswith(_PREFIX)]


# 开场 submit_reading_brief 的 spread_type enum 取自这里，顺序即 <牌阵选择参考> 的顺序
SPREAD_IDS: List[str] = _spread_ids()


def _parse(text: str, spread_id: str) -> Spread:
    """文件头 + 正文。只认这份格式里实际用到的两种行：`key: value` 和 `  - 列表项`。

    位置含义里带全角冒号（「左牌：共同回答本次问题」），所以先判列表项再判 key: value，
    否则位置会被当成一个个字段吃掉。
    """
    matched = _FRONT_MATTER.match(text)
    if not matched:
        raise ValueError(f"{prompt_name(spread_id)} 缺少 --- 文件头")

    meta: Dict[str, str] = {}
    positions: List[str] = []
    current = ""
    for line in matched.group(1).splitlines():
        if not line.strip():
            continue
        item = _LIST_ITEM.match(line)
        if item:
            if current != "positions":
                raise ValueError(f"{prompt_name(spread_id)} 的 {current or '文件头'} 不该是列表")
            positions.append(item.group(1))
            continue
        scalar = _SCALAR.match(line)
        if not scalar:
            raise ValueError(f"{prompt_name(spread_id)} 文件头读不懂这一行：{line!r}")
        current, value = scalar.group(1), scalar.group(2)
        if value:
            meta[current] = value

    if meta.get("id") != spread_id:
        raise ValueError(f"{prompt_name(spread_id)} 的 id 写成了 {meta.get('id')!r}，"
                         f"必须和文件名一致")
    if not meta.get("name"):
        raise ValueError(f"{prompt_name(spread_id)} 没写 name")
    if not positions:
        raise ValueError(f"{prompt_name(spread_id)} 没写 positions，这副牌阵抽不了牌")

    # 正文首行的一级标题就是牌阵名，注入时已经由块头写过一次，留着会和块标题同级打架
    detail = re.sub(r"\A#\s+.*\n+", "", text[matched.end():].strip())
    return Spread(id=spread_id, name=meta["name"], positions=tuple(positions), detail=detail)


def get(spread_id: Optional[str]) -> Optional[Spread]:
    """按 ID 取牌阵；不在目录里 → None。每次实时读盘，管理页改完下一次请求即生效。"""
    if not spread_id or spread_id not in SPREAD_IDS:
        return None
    return _parse(prompt_service.get_prompt(prompt_name(spread_id)), spread_id)


def require(spread_id: Optional[str]) -> Spread:
    """取牌阵，取不到就抛。用在「ID 早已校验过」的地方（交单之后的抽牌）。"""
    spread = get(spread_id)
    if spread is None:
        raise KeyError(f"未知牌阵 ID: {spread_id!r}；可用：{'、'.join(SPREAD_IDS)}")
    return spread


def all_spreads() -> List[Spread]:
    return [require(spread_id) for spread_id in SPREAD_IDS]
