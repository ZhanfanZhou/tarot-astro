# 牌组商城：钱包 · 星尘 · 支付

货币模型：**人民币 —充值→ 星尘（✦，模拟币）—解锁→ 牌组 —应用→ 实际占卜的牌面**。

---

## 1. 钱包

一人一份，按 `user_id` 存（游客 / 注册都有），落 `backend/data/wallets.json`：
星尘余额、已拥有牌组、当前应用牌组 `active_deck_id`。
新用户初始种子：余额 8888 ✦、已拥有 `classic-rws`。

扣款 / 入账在 `asyncio` 锁内「读—改—写」，避免并发覆盖。

| 接口 | 作用 |
|---|---|
| `GET /api/wallet/{user_id}` | 获取（或初始化）钱包 |
| `POST /api/wallet/{user_id}/purchase` `{deck_id}` | 用星尘解锁牌组；余额不足 / 不可购返回 `success:false` + `reason` |
| `POST /api/wallet/{user_id}/active-deck` `{deck_id}` | 应用牌组到实际占卜（须已拥有） |
| `GET /api/store/catalog` | 牌组目录（**权威**价格与状态） |
| `GET /api/store/packages` | 星尘充值套餐（含人民币价格，单位：分） |

**价格、套餐金额一律以服务端目录为准，绝不信任前端传值**（`backend/store_catalog.py`）。

---

## 2. 支付

| 接口 | 作用 |
|---|---|
| `POST /api/payments/topup` `{user_id, package_id, provider, method}` | 创建充值订单，返回拉起支付的指令 |
| `GET /api/payments/order/{order_id}` | 轮询订单状态直到 `paid` |
| `POST /api/payments/mock/pay/{order_id}` | 模拟支付：标记已支付并入账（仅 `PAYMENTS_ALLOW_MOCK`） |
| `POST /api/payments/notify/alipay` · `/notify/wechat` | 渠道异步回调 |

`provider` ∈ `alipay | wechat | mock`；`method` ∈ `pc | h5 | qr | jsapi`。
**当前实际走的是模拟支付**：`AlipayProvider` / `WechatProvider` 的下单与验签是
`NotImplementedError` 占位，凭证缺失时下单自动回退到模拟渠道。

前端流程：`topup` 下单 → 用 `pay.qr_code` / `redirect_url` 拉起 → 轮询 `order/{id}` 直到 `paid`
→ 刷新钱包。模拟期直接点「模拟支付完成」调 `mock/pay/{order_id}`。

**安全要点：**
- 入账有幂等保护（`PaymentOrder.credited`），回调 / 模拟支付重复触发不会重复加星尘。
- 回调入账前核对渠道回传金额与下单金额一致。

接真实渠道要配的环境变量（见 `backend/config.py`）：
`PUBLIC_BASE_URL`（回调必须公网可达）、`FRONTEND_BASE_URL`、`PAYMENTS_ALLOW_MOCK=false`，
支付宝 `ALIPAY_APP_ID` / `ALIPAY_APP_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY`，
微信 V3 `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_API_V3_KEY` / `WECHAT_CERT_SERIAL` /
`WECHAT_MERCHANT_PRIVATE_KEY`。

---

## 3. 商店界面

挂在 `/showcase` 里的全屏 overlay（不跳路由），由本地 state 切换，关掉回到牌廊原位。
入口是 deck-switcher 行尾的 `✦ 发现新牌组` chip。

**三层视图状态机**：`storefront`（精选 Hero + 牌组网格）→ `detail`（封面 + 文案 + 全部卡牌网格 + CTA）
→ `checkout`（结账面板）。

**退出是硬要求**：右上角大 `✕`、左上角 `‹ 返回牌廊`、**Esc 逐级返回**
（checkout → detail → storefront → 关闭），storefront 层点 backdrop 关闭。
卡牌放大层挂 `[data-ds-zoom]`，商店的 Esc 处理检测到它时让位，先关放大层。

### 牌组状态与 CTA

| 状态 | 徽章 | 主 CTA |
|---|---|---|
| 已拥有 | ✓ 已拥有 | 进入牌廊 / 应用到占卜 |
| 可获取 | 价格 | 获取（结账） |
| 抢先体验 partial | 设计中 · N/78 | 抢先获取；预览仅显示已完成卡 |
| 敬请期待 | 即将上架 | 通知我（不结账，无卡牌网格） |

`available` / `owned` 的牌组可翻阅全部 78 张并逐张放大翻页。

### 零新增图片资产

只有 `classic-rws` 有真实牌图。占位牌组复用它的缩略图，叠各自 accent 的 CSS duotone，
观感为不同艺术风格；`coming-soon` 用程序化 CSS 封面（渐变 + 星象纹 + 锁）。
`data/deckCardImages.ts` 是卡面图的唯一数据源：Vite glob 扫 `classic-rws/**/*.thumb.webp`
（`*.png` 供放大），剔除 `__alt` / `__backup` 变体，按规范顺序排序（大阿卡纳固定序，副牌 ace→king）。

**上线真实牌组**：图片放进 `frontend/public/tarot-images/decks/<id>/`（走 `sync-assets.sh` 的 rsync，
不进 git），在 `data/storeDecks.ts` 把该条目 `state` 改 `available` 并设 `liveDeckId`。

### 占卜牌面按 active_deck_id 取图

`data/activeDeckImage.ts` 的 `resolveActiveCardImage` 解析 `config/tarotCards.ts` 的 classic 路径：
classic-rws 用原图；占位牌组沿用 classic 图叠 accent duotone；真实牌组走路径替换。
`ChatMessage` 的牌面展示与抽牌器预览都接这一份。

---

## 4. 钱包胸章

`components/wallet/WalletChip.tsx`：金色胶囊 `✦ {balance}` + 「充值」按钮，自包含
（内部管理 `TopUpModal`）。常驻主页右上角与商店顶栏。

`TopUpModal` 读 `GET /api/store/packages` 拿含人民币价的套餐，选套餐 + 渠道后下单、轮询、刷新余额。
结账时余额不足直接内嵌它。

---

## 5. 代码在哪

| 文件 | 管什么 |
|---|---|
| `services/wallet_service.py` | 钱包读写、解锁、应用牌组 |
| `services/payment_service.py` | 渠道抽象 + Mock / Alipay / Wechat provider、下单、回调入账 |
| `services/store_storage.py` · `store_catalog.py` · `store_models.py` | 目录、套餐、订单模型 |
| `routers/wallet.py` · `payments.py` · `decks.py` | 接口层（`decks.py` 出牌组 manifest） |
| `components/deckstore/` | 商店 overlay 全部视图 |
| `components/wallet/` | 胸章 + 充值弹窗 |
| `stores/useDeckWallet.ts` | 钱包状态（后端为唯一来源，不用 localStorage） |
| `data/storeDecks.ts` · `deckCardImages.ts` · `stardustPackages.ts` · `activeDeckImage.ts` | 前端目录与图片解析 |
