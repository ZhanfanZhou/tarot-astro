"""钱包业务逻辑：初始发放、用星尘解锁牌组、应用牌组、充值入账。

货币模型：人民币 —充值→ 星尘（✦）—解锁→ 牌组。
所有「读-改-写」均在 StoreStorage.wallet_lock 下进行，保证扣款/入账原子。
"""
from __future__ import annotations

from store_models import Wallet
from store_catalog import get_deck
from services.store_storage import StoreStorage

# 新用户初始：已拥有经典牌组 + 一笔星尘体验金（与前端旧 localStorage 种子一致）。
SEED_OWNED = ["classic-rws"]
SEED_BALANCE = 8888
SEED_ACTIVE = "classic-rws"

# 不可用星尘解锁的牌组状态（仅概念稿）。
NON_PURCHASABLE_STATES = {"coming-soon"}


class WalletService:
    @staticmethod
    def _seed_wallet(user_id: str) -> Wallet:
        return Wallet(
            user_id=user_id,
            balance=SEED_BALANCE,
            owned_deck_ids=list(SEED_OWNED),
            active_deck_id=SEED_ACTIVE,
        )

    @staticmethod
    async def get_or_create_wallet(user_id: str) -> Wallet:
        """获取钱包；不存在则按种子创建并持久化。"""
        wallet = await StoreStorage.get_wallet(user_id)
        if wallet is None:
            wallet = WalletService._seed_wallet(user_id)
            await StoreStorage.save_wallet(wallet)
        return wallet

    @staticmethod
    async def purchase_deck(user_id: str, deck_id: str) -> tuple[bool, str | None, Wallet]:
        """用星尘解锁牌组。返回 (成功?, 失败原因, 最新钱包)。

        失败原因：unknown_deck / not_purchasable / insufficient_balance。
        已拥有则幂等返回成功。价格以服务端目录为准（绝不信任前端）。
        """
        deck = get_deck(deck_id)
        if deck is None:
            wallet = await WalletService.get_or_create_wallet(user_id)
            return False, "unknown_deck", wallet

        async with StoreStorage.wallet_lock:
            wallet = await StoreStorage.get_wallet(user_id) or WalletService._seed_wallet(user_id)

            if deck_id in wallet.owned_deck_ids:
                return True, None, wallet  # 幂等

            if deck.state in NON_PURCHASABLE_STATES:
                return False, "not_purchasable", wallet

            if wallet.balance < deck.price:
                return False, "insufficient_balance", wallet

            wallet.balance -= deck.price
            wallet.owned_deck_ids.append(deck_id)
            wallet.touch()
            await StoreStorage.save_wallet(wallet)
            return True, None, wallet

    @staticmethod
    async def set_active_deck(user_id: str, deck_id: str) -> tuple[bool, str | None, Wallet]:
        """应用牌组到实际占卜。必须已拥有。返回 (成功?, 失败原因, 钱包)。"""
        async with StoreStorage.wallet_lock:
            wallet = await StoreStorage.get_wallet(user_id) or WalletService._seed_wallet(user_id)
            if deck_id not in wallet.owned_deck_ids:
                return False, "not_owned", wallet
            wallet.active_deck_id = deck_id
            wallet.touch()
            await StoreStorage.save_wallet(wallet)
            return True, None, wallet

    @staticmethod
    async def credit_stardust(user_id: str, amount: int) -> Wallet:
        """给钱包入账星尘（充值成功后调用）。"""
        async with StoreStorage.wallet_lock:
            wallet = await StoreStorage.get_wallet(user_id) or WalletService._seed_wallet(user_id)
            wallet.balance += amount
            wallet.touch()
            await StoreStorage.save_wallet(wallet)
            return wallet
