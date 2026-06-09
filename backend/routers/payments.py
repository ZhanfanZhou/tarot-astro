"""支付接口：充值下单、订单状态轮询、渠道异步回调、模拟支付。

货币模型：人民币 —充值→ 星尘。下单成功后前端拉起支付（二维码/跳转），
真实渠道支付完成由渠道回调 notify 入账；模拟渠道由 /mock/pay 直接入账。
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

import config
from store_models import (
    TopUpRequest, TopUpResponse, PayInstructionModel, PaymentOrder,
)
from services.payment_service import PaymentService

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/topup", response_model=TopUpResponse)
async def create_topup(body: TopUpRequest):
    """创建星尘充值订单，返回拉起支付所需指令。"""
    try:
        order, instruction = await PaymentService.create_topup_order(
            user_id=body.user_id,
            package_id=body.package_id,
            provider_name=body.provider.value,
            method=body.method.value,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (RuntimeError, NotImplementedError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    return TopUpResponse(
        order_id=order.order_id,
        out_trade_no=order.out_trade_no,
        status=order.status,
        amount=order.amount,
        provider=order.provider,
        method=order.method,
        pay=PayInstructionModel(
            type=instruction.type,
            qr_code=instruction.qr_code,
            redirect_url=instruction.redirect_url,
            params=instruction.params,
            mock_pay_url=instruction.mock_pay_url,
        ),
    )


@router.get("/order/{order_id}", response_model=PaymentOrder)
async def get_order(order_id: str):
    """查询订单状态（前端下单后轮询，直到 status=paid）。"""
    from services.store_storage import StoreStorage
    order = await StoreStorage.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


@router.post("/mock/pay/{order_id}", response_model=PaymentOrder)
async def mock_pay(order_id: str):
    """模拟支付：把订单标记为已支付并入账星尘（仅开发期 / PAYMENTS_ALLOW_MOCK）。"""
    if not config.PAYMENTS_ALLOW_MOCK:
        raise HTTPException(status_code=403, detail="模拟支付通道已禁用")
    order = await PaymentService.mark_paid(order_id, transaction_id="MOCK")
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


@router.post("/notify/alipay")
async def notify_alipay(request: Request):
    """支付宝异步回调。验签成功须返回纯文本 success。"""
    body = await request.body()
    ok = await PaymentService.handle_notification("alipay", dict(request.headers), body)
    return PlainTextResponse("success" if ok else "fail")


@router.post("/notify/wechat")
async def notify_wechat(request: Request):
    """微信支付 V3 异步回调。失败须返回非 200 让微信重试。"""
    body = await request.body()
    ok = await PaymentService.handle_notification("wechat", dict(request.headers), body)
    if not ok:
        raise HTTPException(status_code=400, detail="verify failed")
    return {"code": "SUCCESS", "message": "成功"}
