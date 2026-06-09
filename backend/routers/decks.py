"""牌组（deck）相关接口。

showcase 页面运行时通过 `/api/decks/manifest` 实时扫描磁盘上的牌组目录，
不再依赖前端构建期的 import.meta.glob —— 往 decks/ 里丢一个新文件夹，刷新页面即出现。
重命名牌组（`PUT /api/decks/{deck_id}/name`）会把新名字写回该牌组的 deck.json，
对所有访问者持久生效。
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from typing import Optional, List
import json

from config import BASE_DIR

router = APIRouter(prefix="/api/decks", tags=["decks"])

# 牌组图片所在目录（前端 public，构建时会被 Vite 一并打进 dist/）
DECKS_DIR = BASE_DIR / "frontend" / "public" / "tarot-images" / "decks"
# 前端访问图片用的 URL 前缀（同源，由前端静态服务托管）
URL_PREFIX = "/tarot-images/decks"
# 合法的花色子目录
VALID_SUITS = {"major", "cups", "wands", "swords", "pentacles"}


class DeckImage(BaseModel):
    suit: str
    file: str  # 文件名去掉扩展名，可能含 "__variant" 后缀，如 "justice__alt"
    url: str            # 原图（点开 lightbox 用）
    thumb: Optional[str] = None  # 压缩缩略图（网格用）；无 .thumb.webp 时为 None，前端回退到原图


class Deck(BaseModel):
    id: str
    name: str
    artist: Optional[str] = None
    style: Optional[str] = None
    accent: Optional[str] = None
    order: Optional[int] = None
    images: List[DeckImage] = []


class Manifest(BaseModel):
    decks: List[Deck]


class RenameRequest(BaseModel):
    name: str


def _prettify(deck_id: str) -> str:
    """没有 deck.json 时，把文件夹名美化成展示名：classic-rws -> Classic Rws。"""
    return deck_id.replace("-", " ").replace("_", " ").strip().title() or deck_id


def _read_meta(deck_dir: Path, deck_id: str) -> dict:
    meta: dict = {}
    meta_file = deck_dir / "deck.json"
    if meta_file.is_file():
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta = loaded
        except (json.JSONDecodeError, OSError):
            meta = {}
    meta["id"] = deck_id  # 以文件夹名为准
    if not meta.get("name"):
        meta["name"] = _prettify(deck_id)
    return meta


def _scan_deck(deck_dir: Path) -> Deck:
    deck_id = deck_dir.name
    meta = _read_meta(deck_dir, deck_id)
    images: List[DeckImage] = []
    for suit in sorted(VALID_SUITS):
        suit_dir = deck_dir / suit
        if not suit_dir.is_dir():
            continue
        for img in sorted(suit_dir.glob("*.png")):
            base = f"{URL_PREFIX}/{deck_id}/{suit}"
            # ?v=<mtime> 做 cache-busting：文件没变 URL 就不变（命中浏览器/CDN 缓存），
            # 换了图 mtime 变、URL 变，自动重新下载——配合 Nginx 的 immutable 长缓存。
            url = f"{base}/{img.name}?v={int(img.stat().st_mtime)}"
            thumb_path = img.with_name(f"{img.stem}.thumb.webp")
            thumb = (
                f"{base}/{thumb_path.name}?v={int(thumb_path.stat().st_mtime)}"
                if thumb_path.is_file()
                else None
            )
            images.append(DeckImage(suit=suit, file=img.stem, url=url, thumb=thumb))
    return Deck(
        id=deck_id,
        name=meta.get("name"),
        artist=meta.get("artist"),
        style=meta.get("style"),
        accent=meta.get("accent"),
        order=meta.get("order"),
        images=images,
    )


def _resolve_deck_dir(deck_id: str) -> Path:
    """解析并校验牌组目录，防止路径穿越。"""
    deck_dir = (DECKS_DIR / deck_id).resolve()
    if deck_dir.parent != DECKS_DIR.resolve() or not deck_dir.is_dir():
        raise HTTPException(status_code=404, detail="deck not found")
    return deck_dir


@router.get("/manifest", response_model=Manifest)
async def get_manifest():
    """实时扫描 decks/ 目录，返回所有牌组及其图片清单。"""
    decks: List[Deck] = []
    if DECKS_DIR.is_dir():
        for deck_dir in sorted(DECKS_DIR.iterdir()):
            if deck_dir.is_dir():
                decks.append(_scan_deck(deck_dir))
    # 排序：order 升序（未设为 99），同序按名字
    decks.sort(key=lambda d: (d.order if d.order is not None else 99, d.name.lower()))
    return Manifest(decks=decks)


@router.put("/{deck_id}/name", response_model=Deck)
async def rename_deck(deck_id: str, body: RenameRequest):
    """重命名牌组：把新名字写回该牌组的 deck.json（不存在则创建）。"""
    deck_dir = _resolve_deck_dir(deck_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")

    meta_file = deck_dir / "deck.json"
    meta: dict = {}
    if meta_file.is_file():
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta = loaded
        except (json.JSONDecodeError, OSError):
            meta = {}
    meta["id"] = deck_id
    meta["name"] = name
    try:
        meta_file.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"failed to write deck.json: {e}")

    return _scan_deck(deck_dir)
