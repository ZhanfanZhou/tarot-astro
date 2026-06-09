"""牌组商城的**权威目录**（服务端唯一可信来源）。

价格、状态等必须由服务端裁定，绝不能信任前端传来的金额，否则用户可篡改价格。
此目录镜像前端 `frontend/src/data/storeDecks.ts` 与 `stardustPackages.ts`，
将来新增/调整牌组或套餐时，两边同步即可（或让前端改为读 `GET /api/store/catalog`）。

货币模型：真钱（人民币）—充值→星尘（✦，模拟币）—解锁→牌组。
"""
from typing import Optional, List
from pydantic import BaseModel


# ── 牌组目录 ────────────────────────────────────────────────────────────────
class StoreDeck(BaseModel):
    id: str
    name: str
    price: int                 # 单位：星尘（✦）。0 = 免费/初始已拥有
    state: str                 # 'available' | 'partial' | 'coming-soon'
    completed: Optional[int] = None   # 仅 partial：已绘制张数（满 78）
    accent: Optional[str] = None
    live_deck_id: Optional[str] = None  # manifest 中存在的真实牌组才设置


# classic-rws 为真实牌组、价格 0、所有用户初始即拥有（见 wallet_service SEED）。
STORE_DECKS: List[StoreDeck] = [
    StoreDeck(id="classic-rws", name="Rider–Waite–Smith", price=0,
              state="available", accent="#C9A96E", live_deck_id="classic-rws"),
    StoreDeck(id="lunar-mirage", name="Lunar Mirage", price=1280,
              state="available", accent="#A8D8EA"),
    StoreDeck(id="gilded-ember", name="Gilded Ember", price=980,
              state="partial", completed=32, accent="#F4A261"),
    StoreDeck(id="verdant-oracle", name="Verdant Oracle", price=1180,
              state="coming-soon", accent="#90BE6D"),
]

_DECKS_BY_ID = {d.id: d for d in STORE_DECKS}


def get_deck(deck_id: str) -> Optional[StoreDeck]:
    return _DECKS_BY_ID.get(deck_id)


# ── 星尘充值套餐 ─────────────────────────────────────────────────────────────
# price_cents 为人民币分（¥6 = 600）。这些是**示例定价**，上线前按需调整。
class StardustPackage(BaseModel):
    id: str
    stardust: int        # 基础星尘
    bonus: int           # 赠送星尘
    price_cents: int     # 人民币价格（分）
    tag: Optional[str] = None


STARDUST_PACKAGES: List[StardustPackage] = [
    StardustPackage(id="starter", stardust=1000, bonus=0, price_cents=600),
    StardustPackage(id="plus", stardust=3000, bonus=200, price_cents=1800),
    StardustPackage(id="popular", stardust=6000, bonus=800, price_cents=3000, tag="热门"),
    StardustPackage(id="value", stardust=12000, bonus=2400, price_cents=6800, tag="超值"),
]

_PACKAGES_BY_ID = {p.id: p for p in STARDUST_PACKAGES}


def get_package(package_id: str) -> Optional[StardustPackage]:
    return _PACKAGES_BY_ID.get(package_id)
