# 牌组商城后端 + 支付接入说明

**日期:** 2026-06-09
**范围:** 后端（FastAPI）。新增钱包（星尘余额 / 已拥有牌组 / 当前应用牌组）、用星尘解锁牌组、应用牌组到实际占卜、人民币充值（支付宝 / 微信支付）。

货币模型：**人民币 —充值→ 星尘（✦，模拟币）—解锁→ 牌组**。

> 当前状态：充值默认走**模拟支付**（无需任何凭证即可跑通全链路）。接入真实支付宝/微信只需补齐下方凭证并实现两个 provider 的下单/验签方法。

---

## 1. 新增接口一览

| 方法 & 路径 | 作用 |
|---|---|
| `GET /api/wallet/{user_id}` | 获取（或初始化）钱包：星尘余额、已拥有牌组、当前应用牌组 |
| `POST /api/wallet/{user_id}/purchase` `{deck_id}` | 用星尘解锁牌组（余额不足/不可购返回 `success:false`） |
| `POST /api/wallet/{user_id}/active-deck` `{deck_id}` | 应用牌组到实际占卜（须已拥有） |
| `GET /api/store/catalog` | 牌组目录（权威价格/状态） |
| `GET /api/store/packages` | 星尘充值套餐（含人民币价格，单位：分） |
| `POST /api/payments/topup` `{user_id, package_id, provider, method}` | 创建充值订单，返回拉起支付指令 |
| `GET /api/payments/order/{order_id}` | 轮询订单状态（直到 `paid`） |
| `POST /api/payments/mock/pay/{order_id}` | **模拟支付**：标记已支付并入账（仅 `PAYMENTS_ALLOW_MOCK`） |
| `POST /api/payments/notify/alipay` | 支付宝异步回调 |
| `POST /api/payments/notify/wechat` | 微信支付 V3 异步回调 |

`provider` ∈ `alipay | wechat | mock`；`method` ∈ `pc | h5 | qr | jsapi`。
真实渠道未配置凭证时，下单会自动回退到模拟渠道（受 `PAYMENTS_ALLOW_MOCK` 控制）。

**典型前端流程：** `topup` 下单 → 拿 `pay.qr_code`/`redirect_url` 拉起支付 → 轮询 `order/{id}` 直到 `paid` → 刷新钱包。模拟期：直接 `POST mock/pay/{order_id}` 即支付成功。

---

## 2. 需要你提供的账号 / 凭证

接真实支付前，请在后端 `.env` 配置以下变量（变量名见 `backend/config.py`）。

### 通用
- `PUBLIC_BASE_URL` — 后端公网可达地址（支付回调 notify_url 用，**必须公网可访问**，本地联调可用内网穿透 ngrok/cpolar）。
- `FRONTEND_BASE_URL` — 前端地址（支付完成同步跳转回前端）。
- `PAYMENTS_ALLOW_MOCK` — 上线接真实支付后设为 `false`，关闭模拟通道。

### 支付宝（https://open.alipay.com/）
需要在开放平台创建网页/移动应用并签约「电脑网站支付 / 手机网站支付 / 当面付」：
- `ALIPAY_APP_ID` — 应用 AppID
- `ALIPAY_APP_PRIVATE_KEY` — 应用私钥（PEM）
- `ALIPAY_PUBLIC_KEY` — 支付宝公钥（PEM，用于验签回调）
- （可选）`ALIPAY_GATEWAY` / `ALIPAY_NOTIFY_URL` / `ALIPAY_RETURN_URL`

### 微信支付 V3（https://pay.weixin.qq.com/）
需要已认证的服务号/开放平台应用 + 微信商户号，开通 Native(扫码) / H5 / JSAPI：
- `WECHAT_APP_ID` — 公众号/开放平台 AppID
- `WECHAT_MCH_ID` — 商户号
- `WECHAT_API_V3_KEY` — APIv3 密钥
- `WECHAT_CERT_SERIAL` — 商户 API 证书序列号
- `WECHAT_MERCHANT_PRIVATE_KEY` — 商户私钥（PEM）
- （可选）`WECHAT_NOTIFY_URL`

> 把这些填好告诉我（或写进 `.env`），我再实现 `AlipayProvider` / `WechatProvider` 的 `create_payment` 与 `verify_notification`（接入点已在 `backend/services/payment_service.py` 标注，依赖 `alipay-sdk-python` / `wechatpayv3`，见 `requirements.txt` 注释）。

---

## 3. 定价（可调）

`backend/store_catalog.py`：
- 牌组价格（星尘）：`classic-rws` 0、`lunar-mirage` 1280、`gilded-ember` 980、`verdant-oracle`（coming-soon，不可购）。
- 充值套餐（人民币，**示例价**，上线前请确认）：starter 1000✦/¥6、plus 3000+200✦/¥18、popular 6000+800✦/¥30、value 12000+2400✦/¥68。

新用户初始种子：余额 8888✦、已拥有 `classic-rws`（见 `wallet_service.py`）。

---

## 4. 安全 / 实现要点

- 价格、套餐金额一律以**服务端目录**为准，绝不信任前端传值。
- 充值入账有**幂等保护**（`PaymentOrder.credited`），回调/模拟支付重复触发不会重复加星尘。
- 回调入账前**核对渠道回传金额**与下单金额一致，防篡改。
- 钱包扣款/入账在 `asyncio` 锁内「读-改-写」，避免并发覆盖（个人应用规模，JSON 文件存储，无需数据库）。
</content>
