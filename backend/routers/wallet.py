"""钱包 / 商城目录接口。

- 钱包：星尘余额、已拥有牌组、当前应用牌组；用星尘解锁牌组、应用牌组到实际占卜。
- 目录：牌组与星尘套餐的权威数据（价格/状态由服务端裁定，前端可改为读这里）。
"""
from fastapi import APIRouter, HTTPException, Depends

from models import User
from store_models import (
    Wallet, PurchaseDeckRequest, SetActiveDeckRequest, PurchaseResult,
)
from store_catalog import STORE_DECKS, STARDUST_PACKAGES
from services.wallet_service import WalletService
from dependencies import get_current_user, ensure_owner

router = APIRouter(prefix="/api", tags=["wallet"])


@router.get("/wallet/{user_id}", response_model=Wallet)
async def get_wallet(user_id: str, current_user: User = Depends(get_current_user)):
    """获取（或初始化）用户钱包（仅本人）。"""
    ensure_owner(current_user, user_id)
    return await WalletService.get_or_create_wallet(user_id)


@router.post("/wallet/{user_id}/purchase", response_model=PurchaseResult)
async def purchase_deck(
    user_id: str,
    body: PurchaseDeckRequest,
    current_user: User = Depends(get_current_user),
):
    """用星尘解锁牌组（仅本人）。余额不足/不可购返回 success=false（非 HTTP 错误，便于前端温和提示）。"""
    ensure_owner(current_user, user_id)
    success, reason, wallet = await WalletService.purchase_deck(user_id, body.deck_id)
    return PurchaseResult(success=success, reason=reason, wallet=wallet)


@router.post("/wallet/{user_id}/active-deck", response_model=PurchaseResult)
async def set_active_deck(
    user_id: str,
    body: SetActiveDeckRequest,
    current_user: User = Depends(get_current_user),
):
    """应用牌组到实际占卜（仅本人，必须已拥有）。"""
    ensure_owner(current_user, user_id)
    success, reason, wallet = await WalletService.set_active_deck(user_id, body.deck_id)
    if not success and reason == "not_owned":
        raise HTTPException(status_code=400, detail="尚未拥有该牌组")
    return PurchaseResult(success=success, reason=reason, wallet=wallet)


@router.get("/store/catalog")
async def get_catalog():
    """牌组商城目录（权威价格/状态）。"""
    return {"decks": [d.model_dump() for d in STORE_DECKS]}


@router.get("/store/packages")
async def get_packages():
    """星尘充值套餐（含人民币价格，单位：分）。"""
    return {"packages": [p.model_dump() for p in STARDUST_PACKAGES]}
