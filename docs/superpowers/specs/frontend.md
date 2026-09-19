# 前端：外壳与设计体系

React + Vite + zustand。`/showcase` 是审美基准页——拿不准的样式去那儿对。

---

## 1. Astral Atelier 设计体系

近黑底 + 古金 + 月光蓝 + 象牙白正文，衬线字体（Cinzel / Noto Serif SC），
发丝金边，充足留白。CSS 变量定义在 `src/index.css` 的 `:root`：

| 变量 | 值 | 用途 |
|---|---|---|
| `--void` / `--void-2` / `--ink` | `#06060f` / `#0a0a16` / `#04040a` | 底色、抬起的面板、最深的暗角 |
| `--gold` / `--gold-bright` / `--gold-deep` | `#c9a96e` / `#f0d090` / `#8a6d3b` | 主强调色（占卜师） |
| `--moon` / `--moon-bright` / `--moon-deep` | `#a8d8ea` / `#c9e8f5` / `#6e9db5` | 月光蓝（问卜者） |
| `--ivory` / `--ivory-dim` / `--ivory-faint` | `#ede6d6` + 两档透明 | 正文与弱化文字 |
| `--line` / `--line-soft` | 金 / 中性发丝线 | 描边 |
| `--panel` / `--panel-solid` | 磨砂面板 | 卡片、弹窗 |

**一律用变量，不写死颜色。** 动效走 framer-motion，克制：入场 stagger、cross-fade、
spring 滑入；per-deck 的 accent 只驱动细微辉光。

---

## 2. 路由与外壳

```
/            App —— 殿堂（hub）与对话共用一个壳，AnimatePresence 交叉淡入
/showcase    TarotShowcase —— 牌廊 + 牌组商城 overlay
/admin       AdminApp —— React.lazy 独立 chunk，普通用户不加载
```

外壳：`Sidebar`（可折叠）+ 主列（`TopBar` → 居中阅读列 → `Composer`）。

- 桌面 ≥1024px：侧栏常驻 288px，可收成 64px 图标轨。
- <1024px：侧栏变抽屉，`☰` 唤起，主列单栏。
- 阅读列居中 `max-width: 720px`，顶部在 TopBar 下有渐隐。
- 输入坞 sticky 底部，带 `env(safe-area-inset-bottom)`。

**殿堂（hub）自上而下**：三张占卜入口卡 → 牌廊横幅 → 每日一签横幅 → 心灵奇旅卷宗横幅；
右上角钱包胸章，左上角菜单。

---

## 3. 组件约定

- **AI 消息走 Markdown 渲染**（`react-markdown` + `remark-gfm`，自动转义、不允许裸 HTML），
  样式映射到设计体系（`h2/h3` 金色小型大写标题、`strong` 亮金、`blockquote` 金色左线…）。
  **用户消息是纯文本**，不走 markdown。
- **Composer** 是自动增高的 textarea：Enter 发送、Shift+Enter 换行，长到约 6 行后滚动。
- **没有原生弹窗**：失败提示走 `useToastStore` + `<Toaster/>`，确认走 promise 形态的
  `useConfirmStore` + `ConfirmDialog`。代码里不应再出现 `alert` / `window.confirm`。
- **侧栏**：标题搜索（前端过滤）、按 `updated_at` 分组（今天 / 本周 / 更早）、
  条目显示类型环 + 标题 + 相对时间 + 抽过牌的 `✦`。
- 抽牌器 `TarotCardDrawer` 是全屏仪式组件（洗牌 + 扇形选牌），日运等单张场景用简化确认。

---

## 4. 状态

| store | 管什么 |
|---|---|
| `useAuthStore` | 当前用户 + token（持久化 localStorage） |
| `useConversationStore` | 当前会话、会话列表、进行中的那一轮 |
| `useDeckWallet` | 钱包（余额 / 已拥有 / 当前牌组），**后端为唯一来源** |
| `useToastStore` · `useConfirmStore` | 提示与确认 |

**界面状态不另存**：要不要显示抽牌 / 补资料按钮、抽牌器用什么牌阵，
都从当前会话末尾那条 assistant 的 `tool_calls` 推导（见 [会话与解读核心](conversation-core.md) §4）。

---

## 5. 接口层

`services/api.ts` 一处封装：axios 实例 + 拦截器（带 token、401 登出）+ SSE 解析。
SSE 端点用原生 `fetch`，手动拼 `Authorization`。
管理端另有 `services/adminApi.ts`，独立实例、独立 token。

---

## 6. 验证

**`npm run lint` 全仓坏，不用。** 验证门槛是两条：

```bash
cd frontend && npm run build   # tsc + vite
cd frontend && npm test        # vitest run
```

测试用 Vitest + jsdom + @testing-library，测试文件经 `tsconfig` 排除，不影响 build。
