"""牌组商城的本地 JSON 存储：钱包 + 支付订单。

沿用 `storage_service.py` 的 aiofiles + JSON 文件模式（个人应用规模，无需数据库）。
额外加了一把 asyncio 锁，保证「读-改-写」式的扣款/入账不会因并发请求互相覆盖。
"""
import json
import asyncio
import aiofiles
from pathlib import Path
from typing import Optional, List, Dict

from store_models import Wallet, PaymentOrder
from config import WALLETS_FILE, PAYMENT_ORDERS_FILE

# 钱包与订单各自一把锁：序列化各自的读改写，避免并发请求互相覆盖。
_wallet_lock = asyncio.Lock()
_order_lock = asyncio.Lock()


async def _read_json(file_path: Path) -> dict:
    if not file_path.exists():
        return {}
    async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
        content = await f.read()
        return json.loads(content) if content else {}


async def _write_json(file_path: Path, data: dict):
    async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(data, ensure_ascii=False, indent=2))


class StoreStorage:
    """钱包与支付订单的持久化。"""

    wallet_lock = _wallet_lock
    order_lock = _order_lock

    # ── 钱包 ───────────────────────────────────────────────
    @staticmethod
    async def get_wallet(user_id: str) -> Optional[Wallet]:
        wallets = await _read_json(WALLETS_FILE)
        data = wallets.get(user_id)
        return Wallet(**data) if data else None

    @staticmethod
    async def save_wallet(wallet: Wallet):
        wallets = await _read_json(WALLETS_FILE)
        wallets[wallet.user_id] = wallet.model_dump()
        await _write_json(WALLETS_FILE, wallets)

    # ── 支付订单 ────────────────────────────────────────────
    @staticmethod
    async def get_order(order_id: str) -> Optional[PaymentOrder]:
        orders = await _read_json(PAYMENT_ORDERS_FILE)
        data = orders.get(order_id)
        return PaymentOrder(**data) if data else None

    @staticmethod
    async def get_order_by_out_trade_no(out_trade_no: str) -> Optional[PaymentOrder]:
        orders = await _read_json(PAYMENT_ORDERS_FILE)
        for data in orders.values():
            if data.get("out_trade_no") == out_trade_no:
                return PaymentOrder(**data)
        return None

    @staticmethod
    async def save_order(order: PaymentOrder):
        orders = await _read_json(PAYMENT_ORDERS_FILE)
        orders[order.order_id] = order.model_dump()
        await _write_json(PAYMENT_ORDERS_FILE, orders)
