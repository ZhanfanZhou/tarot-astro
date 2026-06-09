# 牌组商店（发现新牌组）— 前端设计文档

**日期:** 2026-06-08
**范围:** 仅前端（frontend）。不触碰 `services/api.ts`，不改后端。
**入口:** `/showcase` 页面新增「✦ 发现新牌组」入口，打开一个全屏 overlay 商店，可预览、购买（模拟结账）不同塔罗牌组。

---

## 1. 目标与约束

- 在 `TarotShowcase` 页面新增「发现新牌组」入口；点击进入一个**类商店**界面。
- **不跳转新路由**：商店是挂载在 `TarotShowcase` 内、由本地 state 切换的全屏 overlay。允许遮挡牌廊浏览，但**退出返回牌廊必须简单易交互**（硬性要求）。
- 商店内可**预览**和**购买**不同牌组；购买/支付为**纯前端模拟**，无真实扣款。
- 当前只有一套真实牌组 `classic-rws`，其余牌组用**占位**模拟，不需要实际生成临时图片资源。
- 最高优先级：用**优雅、高级**的方式做好牌组的陈列与转化（merchandising），这影响购买率。
- 严格遵循「Astral Atelier」设计语言（近黑 `--void` + 古金 `--gold` + 月光蓝 `--moon` + 象牙 `--ivory` + 发丝金边 `--line`，Cinzel / Noto Serif SC 衬线字体），以 `/showcase` 为审美基准。

---

## 2. 信息架构与交互形态

- **形态:** 全屏 overlay（Approach A — Storefront），淡入叠加在牌廊之上，背景牌廊虚化。
- **内部视图状态机**（由 `DeckStore` 持有）：
  - `storefront` —— 精选 Hero + 牌组网格
  - `detail` —— 单个牌组详情（预览 + 文案 + 购买 CTA）
  - `checkout` —— 模拟结账面板（覆盖在 detail 之上）
- **入口:** 在现有 deck-switcher 行尾追加一个独立 chip `✦ 发现新牌组`（古金、微微辉光，读作「更多」而非又一套牌组）。
- 关闭 overlay 后回到牌廊**原位**，showcase 既有 state（activeDeck/activeSuit/scroll）不受影响。

---

## 3. 退出 / 返回（硬性要求）

- 右上角大号 `✕`（大点击区域）。
- 左上角 `‹ 返回牌廊` chip，复用现有 `.showcase-back` 样式与位置语言。
- **Esc 逐级返回:** `checkout → detail → storefront → 关闭`，每次按键回退一层。
- 在 `storefront` 层点击 backdrop 关闭整个商店。
- 任意层级都有清晰的返回上一层的 affordance（detail 有返回 storefront；checkout 有返回 detail）。

---

## 4. 数据模型与目录

### 4.1 `data/storeDecks.ts`

```ts
type DeckState = 'available' | 'partial' | 'coming-soon';
// 'owned' 不入此枚举 —— 由 wallet 派生

interface StoreDeck {
  id: string;
  name: string;
  tagline: string;          // 一句诗意短语（陈列文案）
  artist: string;
  style: string;
  description: string;      // detail 视图的叙事文案
  price: number;            // 单位 ✦星尘（模拟货币）
  accent: string;           // hex；驱动该牌组的辉光 / duotone
  state: DeckState;
  completed?: number;       // 仅 partial：已完成 N（满 78）
  previewCards: string[];   // 预览缩略图 url（.thumb.webp）
  liveDeckId?: string;      // 仅当 manifest 中存在真实牌组时设置（如 classic-rws）
}
```

### 4.2 种子目录

- `classic-rws`：**真实**牌组，种子为**已拥有**锚点，`liveDeckId: 'classic-rws'`，作为 Hero 精选。
- 3–4 套**占位**牌组，覆盖 `available` / `partial` / `coming-soon` 三种状态。
- 占位牌组**复用 `classic-rws` 的缩略图**，叠加各自 accent 的 CSS duotone 滤镜 → 观感为不同艺术风格，**零新增图片资产**。
- `coming-soon` 用程序化 CSS 封面（渐变 + 星象纹样 + 锁）。
- 将来上线真实牌组：把图片放入 `frontend/public/tarot-images/decks/<id>/`，在目录里把对应条目 `state` 改为 `available` 并设 `liveDeckId` 即可。

### 4.3 货币

- 模拟货币 **✦星尘（stardust）**，无真实金额语义。价格示例 `1280 星尘`。
- wallet 初始余额充足（如 `8888 星尘`），保证默认结账总能成功。
- 余额不足时显示温和的「余额不足」+ 模拟「充值」（**可选、低优先级**）。

---

## 5. 状态持久化 — `stores/useDeckWallet.ts`

- 轻量 zustand store，遵循现有 store 模式（`useToastStore` 等）。
- 持久化到 `localStorage`（key 例：`tarot.deckWallet`）：
  - `ownedDeckIds: string[]`（种子含 `classic-rws`）
  - `balance: number`（星尘余额）
- API：`owns(id)`、`purchase(id, price)`（扣余额 + 加入 owned，写回 localStorage）、`balance`。
- 刷新后保持「已拥有 + 余额」状态。

---

## 6. 牌组状态与 CTA

| 状态 | 含义 | 徽章 | 主 CTA | 行为 |
|---|---|---|---|---|
| 已拥有 Owned | 已解锁（wallet 派生；`classic-rws` 初始即是） | 古金 ✓ 已拥有 | 进入牌廊 | 有 `liveDeckId` → 关闭商店并切到该牌组；占位牌组 → 轻提示「即将上线」toast |
| 可获取 Available | 全套已设计，可预览可购 | 价格 | 获取（结账） | 进入 checkout |
| 抢先体验 Partial | 仅部分卡已完成 | 设计中 · N/78 | 抢先获取 | 进入 checkout；预览仅显示已完成卡 |
| 敬请期待 Coming soon | 仅概念 | 即将上架 | 通知我 | toast 反馈，不结账 |

---

## 7. Storefront 视图（`StorefrontView.tsx`）

- **Hero**（精选 1 套）：超大 duotone 封面 + 扇形铺开的预览卡；Cinzel 名称、tagline、价格/状态徽章、主 CTA。入场 staggered 动效。
- **网格**：`grid-template-columns: repeat(auto-fill, minmax(...))` 的 `DeckTile`：封面、名称、artist、状态徽章、价格。Hover 上浮 + accent 辉光，呼应现有 `.card-item` 手感。
- 点击 Hero 或 tile → 进入 detail（cross-fade，沿用该牌组 accent）。
- 从 2 套到 20 套都保持优雅（网格自适应）。

---

## 8. Detail 视图（`DeckDetailView.tsx`）

- 桌面两栏 / 移动堆叠：
  - 左：大封面 + 该牌组卡面的横向预览条（partial 仅显示已完成卡，其余显示「设计中」占位）。
  - 右：名称、叙事文案、style/artist 元信息、价格、主 CTA。
- 顶部有返回 storefront 的 affordance。

---

## 9. Checkout（模拟结账，`CheckoutPanel.tsx`）

由 `获取` / `抢先获取` 触发，sheet 以 spring 动效覆盖 detail：

1. 行项目（缩略图 + 名称 + 价格）、伪支付方式选择器（✦星尘余额 / 🪙金币，纯装饰）、当前余额。
2. `确认支付` → 按钮形变为「结算中…」spinner（约 1.2s）。
3. 成功：对勾迸发 + 「已收入囊中」；wallet 扣星尘 + 写入 owned（持久化）；牌组在各处翻为「已拥有」；CTA 变为 进入牌廊 / 完成。
4. 余额默认充足总会成功；余额不足时温和「余额不足」+ 模拟「充值」（可选）。

---

## 10. 封面处理（`coverArt.ts`）

- 占位牌组封面 = `classic-rws` 缩略图 + 按 accent 的 CSS duotone（颜色叠加 / `mix-blend-mode` + 渐变），各成一格风格。
- `coming-soon` = 程序化 CSS 封面（渐变 + 星座纹 + 锁），不依赖任何卡面图。
- helper 输出可复用的 style/className，供 Hero / Tile / Detail 统一调用。

---

## 11. 美学与动效

- 严格 Astral Atelier：复用 `--void/--gold/--moon/--ivory/--line` CSS 变量，Cinzel + Noto Serif SC，发丝金边，充足留白。
- Framer-motion：overlay 淡入 + scale；Hero / tile 入场 stagger；detail cross-fade；checkout spring 滑入。
- Per-deck accent 仅驱动**细微辉光**；避免嘈杂/繁忙动画（符合「高级简约大气」基调）。

---

## 12. 与 TarotShowcase 的集成

- `TarotShowcase` 新增本地 state `storeOpen`，在 deck-switcher 行尾渲染入口 chip。
- 渲染 `<DeckStore open={storeOpen} onClose={...} onEnterDeck={(liveDeckId) => { setActiveDeck(liveDeckId); setStoreOpen(false); }} />`。
- 占位牌组不在 manifest 中，不会出现在 showcase 的 deck-switcher，互不干扰。

---

## 13. 范围与验收

- **仅前端**：不改 `services/api.ts`、不改后端、不改既有空消息/流式/抽牌/星盘序列。
- 验收：
  - `cd frontend && npm run build`（tsc 通过、构建成功）。
  - 手动走查：浏览 → 预览（含 partial 仅显示已完成卡）→ 结账动效 → 成功翻为已拥有 → 退出回到牌廊原位。
  - 逐级 Esc 返回正确。
  - 刷新后 `localStorage` 的「已拥有 + 余额」保持。

---

## 14. 明确不做（YAGNI）

- 不接真实支付 / 真实货币。
- 不新增后端接口、不改 manifest 扫描逻辑。
- 不实际生成临时新牌组的图片资源（仅模拟陈列）。
- 「充值」「通知我」为模拟反馈，不接任何真实系统。

---

## 15. 扩展（2026-06-09）：钱包陈列、卡牌浏览、链路补全

第一版上线后围绕「预览→购买」链路补全的支撑功能。仍**仅前端**、不改后端。

### 15.1 钱包陈列（hub + store）

- 此前星尘余额只在结账面板出现 → 现在**主页（hub）右上角**和**商店顶栏**都常驻钱包胸章。
- `components/wallet/WalletChip.tsx`：紧凑金色胶囊 `✦ {balance}`（`toLocaleString` 千分位）+ 「充值」按钮；自包含，内部管理 `TopUpModal`。读 `useDeckWallet` 的 `balance`。复用于 hub 与 store，二者只需放置定位。
  - hub：`App.tsx` hub 容器内 `absolute top-4 right-4`（与左上 `Menu` 对称）。
  - store：`DeckStore` 顶栏右侧分组 `.deckstore-topbar-right`（与 ✕ 同组）。

### 15.2 充值（模拟，预设套餐）

- `data/stardustPackages.ts`：`STARDUST_PACKAGES`（1000 / 3000+200 / 6000+800「热门」/ 12000+2400「超值」）。星尘即模拟币，充值 = `topUp(stardust+bonus)`，下无真实货币。
- `components/wallet/TopUpModal.tsx`：固定遮罩（`z-index:1400`，高于商店 1200）。`pick → processing(~1s) → success` 状态机，含 timer cleanup（卸载/关闭取消计时器）。默认选中「热门」。成功后 `topUp` 入账、显示新余额。
- 结账面板「余额不足」时的旧 `+5000` 入口保留（轻量兜底）；正式充值走 `TopUpModal`。

### 15.3 牌组详情：浏览全部卡牌 + 放大

- 痛点：详情此前只展示固定 5 张预览。现在 `available/owned` 牌组可**翻阅全部 78 张**。
- `data/deckCardImages.ts`：单一数据源。Vite glob `classic-rws/**/*.thumb.webp`（+ `*.png` 供放大），剔除 `__alt/__backup` 变体，按规范顺序排序（大阿卡纳固定序，副牌 ace→king），导出 `ALL_CARD_IMAGES: CardImage[]`（实测完整 78 张）。占位「可获取」牌组复用此集合，叠加各自 accent duotone，**零新增图片资产**。
- `DeckDetailView` 重构为**纵向**：上为 `.ds-detail-head`（封面 | 信息+CTA 两栏），下为 `.ds-cards` 全宽卡牌网格（`auto-fill`）。
  - `available/owned`：78 张全部可点。
  - `partial`：前 `completed` 张可点放大，其余灰显「设计中」（与 `/78` 进度条一致）。
  - `coming-soon`：无网格（仅程序化封面 + 通知我）。
- `components/deckstore/CardZoomLightbox.tsx`：点击卡牌 → 放大层（`z-index:1300`），`‹ ›` 翻页、计数、Esc/点击外关闭，按 accent 叠 duotone，原图 `fullUrl`（失败回退 `thumbUrl`）。
  - **Esc 协调**：放大层挂 `[data-ds-zoom]`；`DeckStore` 的 Esc 处理在检测到该元素时**让位**（先关放大层，不连带弹出商店）。

### 15.4 链路补全/收尾

- 结账伪支付的「🪙 金币」由可选改为 **disabled「敬请期待」**，消除选了金币仍扣星尘的信任漏洞（星尘为唯一可选）。
- 已拥有牌组在网格/详情通过 `badgeFor` 的「✓ 已拥有」体现（沿用既有）。

### 15.5 验收（扩展项）

- `npm run build` 通过。
- hub 与 store 顶栏均见余额胸章；充值套餐弹窗 → 余额增加并持久化（刷新保留）。
- 详情可浏览全部 78 张并逐张放大翻页；partial 仅已完成卡可放大；coming-soon 无网格。
- 放大层 Esc 只关自己、不连带退出商店。
- 金币方式不可选。

### 15.6 明确不做（扩展 YAGNI）

- 不做交易流水/收据、不做「我的牌组」独立页面、不做真实充值或多币种。
- 不为修复仓库级坏掉的 `npm run lint` 引入 eslint flat config（验收以 `npm run build` 为准，见 [[project_frontend_verification_gate]]）。

---

## 16. 遗留前端任务（待办）

截至 2026-06-09，商城前端主链路已完成，以下为已知遗留/后续项：

- **可视化走查 QA（未做）**：桌面 + 移动端真机点测全链路（hub 余额 → 充值 → 商店 → 详情翻 78 张 → 放大翻页 → 购买 → 退出 → 刷新持久化）。目前仅 `npm run build`（tsc）+ 静态审查，未在浏览器实跑。
- **自动化测试（已完成 2026-06-09）**：已落地 Vitest + jsdom + @testing-library，`npm test`（`vitest run`）共 26 个单测通过，覆盖 `useDeckWallet`（购买/幂等/余额不足/充值/持久化）、`coverArt` 的 `badgeFor`/`ctaFor`/`hexA`、`deckCardImages`（78 张与排序）、`stardustPackages`、`WalletChip` 冒烟。测试文件经 `tsconfig` 排除，不影响 `npm run build`。**后续可扩展**：组件交互流（结账/充值状态机、放大层翻页）的 RTL 测试。
- **真实牌组接入**：当某占位牌组的实际美术就绪 → 图片落 `frontend/public/tarot-images/decks/<id>/` → 在 `data/storeDecks.ts` 把该条目 `state` 改 `available` 并设 `liveDeckId`（详见 §4.2）。
- **充值入口统一（小清理）**：结账「余额不足」处旧的 `+5000` 兜底按钮与正式 `TopUpModal` 并存，未来可统一为只弹 `TopUpModal`。
- **「我的牌组」收藏视图（暂缓）**：当前已拥有仅靠网格/详情徽章体现，未做独立收藏页（YAGNI，待需求）。
- **会话内钱包入口（待定）**：余额胸章目前仅在 hub 与商店顶栏；会话页是否需要入口未定。

---

## 16. 下一步待办：前端接入后端钱包/支付（2026-06-09）

后端已完成钱包 + 星尘解锁牌组 + 应用牌组 + 真钱充值（支付宝/微信，当前走模拟支付）。
接口与凭证清单见 `docs/superpowers/specs/2026-06-09-deck-store-backend-payments-setup.md`。
本次仅做后端；前端仍是 localStorage，待迁移如下（**TODO**）：

- [ ] **钱包改为后端来源**：把 `stores/useDeckWallet.ts` 从 localStorage 改为调用
      `GET /api/wallet/{user_id}`，按 `user_id`（游客/注册皆有）持久化；
      `owns(id)` / `balance` / `ownedDeckIds` 读后端，启动时拉取一次并缓存。
- [ ] **解锁牌组走后端**：`CheckoutPanel` 的「确认支付（用星尘）」改调
      `POST /api/wallet/{user_id}/purchase {deck_id}`；`success:false` 时按
      `reason`（`insufficient_balance` / `not_purchasable`）做温和提示。价格以
      `GET /api/store/catalog` 为准（可替换前端硬编码 `storeDecks.ts` 的 price）。
- [ ] **充值走真实支付下单**：`TopUpModal` 的套餐改调
      `POST /api/payments/topup {user_id, package_id, provider, method}`，
      用返回的 `pay.qr_code`（扫码）/`redirect_url`（跳转）拉起支付；轮询
      `GET /api/payments/order/{order_id}` 直到 `paid` 后刷新余额。
      模拟期可直接 `POST /api/payments/mock/pay/{order_id}` 走通。
      套餐与人民币价格读 `GET /api/store/packages`（替换 `stardustPackages.ts`）。
- [ ] **「应用卡牌」落地到实际占卜（前端尚未完成）**：后端已存
      `active_deck_id`（`POST /api/wallet/{user_id}/active-deck`）。前端需：
      ① 在牌组详情/已拥有处加「应用此牌组」CTA 调该接口；
      ② 实际占卜的 `TarotCardDrawer` / 牌面渲染读取 `active_deck_id`，
      按对应牌组目录（manifest）取图，使抽到的牌用所选牌组的图（占位牌组
      可沿用 duotone 处理直到有真实图片资产）。
- [ ] 迁移后删除 localStorage 种子逻辑，避免双源不一致；保留一次性迁移读取旧
      localStorage 余额的兜底（可选）。
