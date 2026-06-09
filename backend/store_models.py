"""牌组商城 / 钱包 / 支付相关的数据模型。

与 `models.py`（用户、对话、塔罗）解耦，单独成文件便于维护。
"""
from enum import Enum
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ── 钱包 ────────────────────────────────────────────────────────────────────
class Wallet(BaseModel):
    user_id: str
    balance: int = 0                          # 星尘（✦）余额
    owned_deck_ids: List[str] = []            # 已拥有/已解锁的牌组
    active_deck_id: str = "classic-rws"       # 当前「应用」于实际占卜的牌组
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def touch(self) -> None:
        """更新 updated_at 时间戳（每次变更后调用）。"""
        self.updated_at = datetime.utcnow().isoformat()


# ── 支付 ────────────────────────────────────────────────────────────────────
class PaymentProviderName(str, Enum):
    ALIPAY = "alipay"
    WECHAT = "wechat"
    MOCK = "mock"


class PaymentMethod(str, Enum):
    PC = "pc"        # 电脑网站支付（支付宝 page / 微信 native 扫码）
    H5 = "h5"        # 手机网站支付（支付宝 wap / 微信 h5）
    QR = "qr"        # 扫码支付
    JSAPI = "jsapi"  # 公众号 / 小程序内


class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    EXPIRED = "expired"


class PaymentOrder(BaseModel):
    order_id: str                  # 内部订单号
    out_trade_no: str              # 提交给支付渠道的商户订单号
    user_id: str
    package_id: str
    stardust: int                  # 基础星尘
    bonus: int                     # 赠送星尘
    amount: int                    # 人民币金额（分）
    provider: str                  # alipay | wechat | mock
    method: str                    # pc | h5 | qr | jsapi
    status: OrderStatus = OrderStatus.PENDING
    transaction_id: Optional[str] = None  # 渠道交易号
    credited: bool = False         # 星尘是否已入账（幂等保护）
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    paid_at: Optional[str] = None


# ── 请求/响应体 ──────────────────────────────────────────────────────────────
class PurchaseDeckRequest(BaseModel):
    deck_id: str


class SetActiveDeckRequest(BaseModel):
    deck_id: str


class TopUpRequest(BaseModel):
    user_id: str
    package_id: str
    provider: PaymentProviderName = PaymentProviderName.MOCK
    method: PaymentMethod = PaymentMethod.QR


class PurchaseResult(BaseModel):
    success: bool
    reason: Optional[str] = None   # 失败原因：insufficient_balance / not_purchasable / ...
    wallet: Wallet


class PayInstructionModel(BaseModel):
    """返回给前端、用于「拉起支付」的指令。"""
    type: str                          # qr | redirect | jsapi | mock
    qr_code: Optional[str] = None      # 待生成二维码的字符串（扫码支付）
    redirect_url: Optional[str] = None # 跳转支付页 URL（PC/H5）
    params: Optional[dict] = None      # JSAPI 唤起参数
    mock_pay_url: Optional[str] = None # 模拟支付：调用该接口即视为支付成功（仅开发期）


class TopUpResponse(BaseModel):
    order_id: str
    out_trade_no: str
    status: OrderStatus
    amount: int
    provider: str
    method: str
    pay: PayInstructionModel
