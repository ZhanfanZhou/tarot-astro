"""支付服务：渠道抽象 + 充值下单 + 回调入账。

设计目标（个人应用、轻量）：
- 一套 `PaymentProvider` 抽象，下面挂三种实现：
  - `MockProvider`：**当前默认**。无需任何凭证即可跑通「下单 → 支付 → 入账」全链路，
    前端拉起后调用 `mock_pay_url` 即视为支付成功。
  - `AlipayProvider` / `WechatProvider`：真实渠道**脚手架**。凭证齐全时启用，
    缺失时（且 PAYMENTS_ALLOW_MOCK）自动回退到 Mock，便于先联调前端。
    真实下单/验签处用 lazy import 接官方 SDK，并标注了接入点。
- 金额与套餐以服务端目录为准，回调入账带幂等保护（credited 标记）。

接真实支付需要的凭证见仓库根目录 `docs/.../payments-setup.md`（本次新建）。
"""
from __future__ import annotations

import uuid
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import config
from store_models import (
    PaymentOrder, OrderStatus, PaymentProviderName, PaymentMethod,
)
from store_catalog import get_package
from services.store_storage import StoreStorage
from services.wallet_service import WalletService


# ── 渠道返回的数据结构 ────────────────────────────────────────────────────────
@dataclass
class PayInstruction:
    type: str                              # qr | redirect | jsapi | mock
    qr_code: Optional[str] = None
    redirect_url: Optional[str] = None
    params: Optional[dict] = None
    mock_pay_url: Optional[str] = None


@dataclass
class NotifyResult:
    success: bool
    out_trade_no: Optional[str] = None
    transaction_id: Optional[str] = None
    amount: Optional[int] = None           # 渠道回传金额（分），用于核对
    raw: dict = field(default_factory=dict)


# ── 渠道抽象 ──────────────────────────────────────────────────────────────────
class PaymentProvider(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """凭证是否齐全、可用于真实下单。"""

    @abstractmethod
    def create_payment(self, order: PaymentOrder, subject: str) -> PayInstruction:
        """向渠道下单，返回前端拉起支付所需指令。"""

    @abstractmethod
    def verify_notification(self, headers: dict, body: bytes) -> NotifyResult:
        """验签并解析异步回调。"""


class MockProvider(PaymentProvider):
    """模拟渠道：无凭证即可跑通全链路。支付通过 mock_pay_url 触发。"""
    name = "mock"

    def is_configured(self) -> bool:
        return True

    def create_payment(self, order: PaymentOrder, subject: str) -> PayInstruction:
        mock_url = f"{config.PUBLIC_BASE_URL}/api/payments/mock/pay/{order.order_id}"
        return PayInstruction(
            type="mock",
            qr_code=mock_url,        # 前端可把它当二维码内容渲染，扫码/点击即「支付」
            mock_pay_url=mock_url,
        )

    def verify_notification(self, headers: dict, body: bytes) -> NotifyResult:
        # 模拟渠道不走异步回调，入账由 mock_pay 接口直接完成。
        return NotifyResult(success=False, raw={"detail": "mock provider has no callback"})


class AlipayProvider(PaymentProvider):
    """支付宝渠道脚手架。需要 ALIPAY_APP_ID / 应用私钥 / 支付宝公钥。

    接入点（凭证齐全后实现）：
    - create_payment：用官方 `alipay-sdk-python`（AlipayClient）按 method 调用
      电脑网站支付(alipay.trade.page.pay) / 手机网站支付(wap) / 当面付扫码(precreate)。
    - verify_notification：用支付宝公钥验签 notify 表单。
    """
    name = "alipay"

    def is_configured(self) -> bool:
        return bool(
            config.ALIPAY_APP_ID
            and config.ALIPAY_APP_PRIVATE_KEY
            and config.ALIPAY_PUBLIC_KEY
        )

    def create_payment(self, order: PaymentOrder, subject: str) -> PayInstruction:
        raise NotImplementedError(
            "AlipayProvider 尚未接入真实 SDK：请配置凭证并实现 create_payment。"
        )

    def verify_notification(self, headers: dict, body: bytes) -> NotifyResult:
        raise NotImplementedError(
            "AlipayProvider 尚未接入真实 SDK：请实现 verify_notification（支付宝公钥验签）。"
        )


class WechatProvider(PaymentProvider):
    """微信支付 V3 渠道脚手架。需要 APPID / 商户号 / APIv3 密钥 / 证书序列号 / 商户私钥。

    接入点（凭证齐全后实现）：
    - create_payment：用 `wechatpayv3` 按 method 调用 Native(扫码) / H5 / JSAPI 下单。
    - verify_notification：用 APIv3 密钥 AES-GCM 解密 + 平台证书验签回调。
    """
    name = "wechat"

    def is_configured(self) -> bool:
        return bool(
            config.WECHAT_APP_ID
            and config.WECHAT_MCH_ID
            and config.WECHAT_API_V3_KEY
            and config.WECHAT_CERT_SERIAL
            and config.WECHAT_MERCHANT_PRIVATE_KEY
        )

    def create_payment(self, order: PaymentOrder, subject: str) -> PayInstruction:
        raise NotImplementedError(
            "WechatProvider 尚未接入真实 SDK：请配置凭证并实现 create_payment。"
        )

    def verify_notification(self, headers: dict, body: bytes) -> NotifyResult:
        raise NotImplementedError(
            "WechatProvider 尚未接入真实 SDK：请实现 verify_notification（APIv3 解密验签）。"
        )


_REAL_PROVIDERS = {
    PaymentProviderName.ALIPAY.value: AlipayProvider(),
    PaymentProviderName.WECHAT.value: WechatProvider(),
}
_MOCK = MockProvider()


def get_provider(name: str) -> PaymentProvider:
    """按名取渠道：真实渠道凭证齐全则用之，否则在允许 mock 时回退到模拟渠道。"""
    if name == PaymentProviderName.MOCK.value:
        return _MOCK
    provider = _REAL_PROVIDERS.get(name)
    if provider is None:
        raise ValueError(f"未知支付渠道: {name}")
    if provider.is_configured():
        return provider
    if config.PAYMENTS_ALLOW_MOCK:
        return _MOCK
    raise RuntimeError(f"支付渠道 {name} 未配置凭证，且已禁用模拟通道")


class PaymentService:
    @staticmethod
    async def create_topup_order(
        user_id: str, package_id: str, provider_name: str, method: str
    ) -> tuple[PaymentOrder, PayInstruction]:
        """创建充值订单并向渠道下单。校验套餐有效性、金额由服务端目录裁定。"""
        package = get_package(package_id)
        if package is None:
            raise ValueError("未知充值套餐")

        provider = get_provider(provider_name)
        # 商户订单号：时间 + 短 uuid，渠道侧唯一。
        out_trade_no = f"TP{int(time.time())}{uuid.uuid4().hex[:8]}"
        order = PaymentOrder(
            order_id=f"order_{uuid.uuid4().hex[:16]}",
            out_trade_no=out_trade_no,
            user_id=user_id,
            package_id=package_id,
            stardust=package.stardust,
            bonus=package.bonus,
            amount=package.price_cents,
            provider=provider.name,        # 实际使用的渠道（可能回退成 mock）
            method=method,
        )
        await StoreStorage.save_order(order)

        subject = f"星尘充值 · {package.stardust + package.bonus}✦"
        instruction = provider.create_payment(order, subject)
        return order, instruction

    @staticmethod
    async def mark_paid(order_id: str, transaction_id: Optional[str] = None) -> Optional[PaymentOrder]:
        """把订单置为已支付并入账星尘（幂等：credited 标记保证只入账一次）。"""
        async with StoreStorage.order_lock:
            order = await StoreStorage.get_order(order_id)
            if order is None:
                return None
            if order.credited:
                return order  # 已入账，幂等返回
            order.status = OrderStatus.PAID
            order.transaction_id = transaction_id
            order.paid_at = datetime.utcnow().isoformat()
            order.credited = True
            await StoreStorage.save_order(order)

        # 入账放在订单锁外（用钱包锁），避免锁嵌套。
        await WalletService.credit_stardust(order.user_id, order.stardust + order.bonus)
        return order

    @staticmethod
    async def handle_notification(provider_name: str, headers: dict, body: bytes) -> bool:
        """处理渠道异步回调：验签 → 核对金额 → 入账。成功返回 True。"""
        provider = get_provider(provider_name)
        result = provider.verify_notification(headers, body)
        if not result.success or not result.out_trade_no:
            return False
        order = await StoreStorage.get_order_by_out_trade_no(result.out_trade_no)
        if order is None:
            return False
        # 金额核对：渠道回传金额必须与下单金额一致，防篡改。
        if result.amount is not None and result.amount != order.amount:
            return False
        await PaymentService.mark_paid(order.order_id, result.transaction_id)
        return True
