# 会话与解读核心

一场占卜从建会话到落库的全部机制。其余 spec 都挂在这条链路上：
[开场幕](opening-agent.md) 管前半场，[笔记本](notebook.md) 管离场之后，
[每日一签](daily-oracle.md) 是它的简化版，[多 Provider](llm-providers.md) 管每次调用发给谁。

---

## 1. 数据形状

### Conversation

```python
conversation_id, user_id, title, session_type      # tarot / astrology / daily / chat
phase: str = "reading"                              # opening / reading
strategy: Optional[dict] = None                     # 开场幕的起手单
has_drawn_cards: bool
messages: List[Message]
created_at, updated_at
```

`phase` 与 `strategy` 没有 SQL 列：`conversations` 表是文档型存储（整对象 JSON 在 `data` 列），
Pydantic 读旧行时自动补默认值，所以存量会话确定性落在 `reading`。
后台按起手单字段查询用 `json_extract(data,'$.strategy.…')`。

### Message：三种角色，对应两家 API 的消息

| role | 带什么 |
|---|---|
| `user` | 用户发言 |
| `assistant` | `content` + `tool_calls[{id, name, args}]` |
| `tool` | `tool_call_id` + 结果 JSON |

**记录即 API 形状**：重建历史时逐条映射（Gemini 的 `functionCall` / `functionResponse` part，
OpenAI 的 `assistant.tool_calls` / `role=tool`），不推断、不伪造任何一句台词。
牌面 (`tarot_cards`) 与抽牌请求 (`draw_request`) 作为展示字段挂在对应消息上。

**旧会话只读**：2026-09 之前的记录把抽牌结果套在 `system` 消息里、用伪造的用户发言当触发语，
没有记下调用。运行时判为只读（`tool_turns.is_legacy`，`/message` `/resume` 返回 409）。
`scripts/migrate_tool_turns.py` 可一次性改写成现在的形状。

---

## 2. 一轮对话

所有入口（`/api/tarot/*`、`/api/astrology/*`）都是薄壳，转 `turn_service`：

```
校验（归属 / 旧会话）→ 收口上一轮没做完的 interrupt → 额度（/message 用完就 429，/resume 只计数）
→ Agent Loop → 逐条落库 → SSE 推正文
```

Agent Loop（`gemini_service.stream_response`）按相位取 provider、提示词、工具集，
yield 三种事件：`content`（正文片段）、`message`（一条要落库的记录）、`done`。
**SSE 只推正文**，界面需要的其余状态从会话数据推导（见 §4）。

### 工具集

规格唯一真源在 `services/llm/tools.py`，五个工具：

| 工具 | 干什么 | 谁有 |
|---|---|---|
| `draw_tarot_cards` | 推出抽牌器 | 解读 / 每日一签 |
| `get_astrology_chart` | 调外部接口取详细星盘 | 解读 / 每日一签 |
| `request_user_profile` | 推出资料表单 | 开场 / 解读 / 每日一签 |
| `read_divination_notes` | 翻这个人以前每一场的占卜记录 | 解读 / 每日一签 |
| `submit_reading_brief` | 交起手单 | **只有开场** |

选工具集的优先级与选提示词一字不差：override > 相位 > 会话类型。

### interrupt 式工具

`draw_tarot_cards` / `request_user_profile` 的调用只是把界面推到用户面前，
结果要等用户动手，跨一次 HTTP 请求才产生。

- Loop 见到就**收口**：调用已落库，不喂假结果。
- `/draw` 生成真牌，写成那次调用的 TOOL 结果。
- 补资料由 `/resume` 从用户当前 profile 写结果，模型自己接着调 `get_astrology_chart`
  （工具描述就是这么写的），前端不替它取盘。`/resume` 不带 content——它不是发言。
- 用户不做那一步直接发消息：`/message` 先把「没做」记成结果，再记发言。
  两家 API 都要求每个调用后面跟着结果。

---

## 3. 抽牌仪式

选牌器是纯仪式：打开即洗牌（无需再点一次开始），洗完展开扇形让用户选牌，
但**选择不决定牌面**——真实牌由服务端
`TarotService.draw_cards` 随机产生。牌阵、张数、每个位置的含义来自模型的调用参数：
开场幕交单的塔罗路线只交一个牌阵 ID，位置由牌阵目录展开后 harness 照单直推，
与单子逐字一致（见[开场幕](opening-agent.md) §3.1）；解读中途补抽由解读 Agent
自己填 `draw_tarot_cards` 的参数，那一条路不受目录约束。

用户按下「确认抽牌」，选牌器当场退场，`/draw` 把真牌落库并直接返回牌面，前端用
`CardRevealOverlay` 在对话界面上把这几张牌逐张翻开（等牌那段先摆牌背），翻完淡出，
牌这时已经画在对话里了。

**翻牌不占用户的等待**：`/draw` 一回来就发 `/resume`，解读在翻牌那几秒里已经开始流；
对话里的牌面要刷一次会话才有（牌挂在 tool 记录上），那次刷新与 `/resume` 并排跑，
不挡在前面（这一轮结束时 `runTurn` 还会再刷一次，落地之后并行那次就不再覆盖）。

牌面取图按钱包里的 `active_deck_id`（见 [牌组商城](deck-store.md)）。

---

## 4. 界面状态从会话数据推导

SSE 里只有正文。要不要显示抽牌 / 补资料按钮、抽牌器用什么牌阵，
前端看**当前会话末尾那条 assistant 的 `tool_calls`**；进行中的一轮按会话 id 记在 store 里。
按钮和流式文本因此只属于它所在的那场会话，切换会话不串台，刷新页面也不丢。
判据与后端 `tool_turns.pending_interrupt` 是同一条。

---

## 5. 服务端单次生成的三处

没有对话历史、也没有用户发言要回的场合，不走 Agent Loop，直接一次生成：

| 场合 | 落成什么 |
|---|---|
| 开场白 | `POST /api/conversations/{id}/greeting`，会话的第一条 assistant |
| 每日一签的当日解读 | 抽签接口当场生成，当日的牌挂在这条 assistant 上 |
| 心灵奇旅 | 整段提示词一次生成，不落进会话 |

SSE 形状与 `/message` 一致，前端的等待体验因此和等一轮回复一样。

---

## 6. 星盘

- **基本星盘**：12 宫各落在哪个星座、每宫里有哪些星体及其所在星座，不写度数
  （`AstrologyService.format_chart_houses`）。存在 `User.natal_chart`，放进 `<用户资料>`，
  占卜师每轮都看得到。宫位制阿卡比特（接口参数 `h_sys=B`）。
- **详细星盘**：`get_astrology_chart` 每次调接口取，不存。解读提示词里写明
  `<用户资料>` 里那份只是 12 宫落座，要做星盘解读得调工具。
- 第一次取盘成功时顺手存下基本星盘；用户改出生年月日、时分、城市任何一项就直接删掉，
  下次取盘按新资料重存；只改昵称、性别不动它。
- 没存时 `<用户资料>` 最后一行报状态：`未保存（出生资料齐全，可以排盘）` /
  `无法排盘（缺出生时间、出生地点）`。
- 用户相关接口的返回一律排除 `natal_chart`，前端拿到的用户信息里没有它。
- 出生城市不在支持列表里时按北京坐标排盘（前端下拉只能选列表内的城市）。

---

## 7. 离场与删除

`POST /api/conversations/{id}/exit` 登记一个笔记任务，12 小时后生成（仅注册用户）。
机制见 [笔记本](notebook.md)。

`DELETE /api/conversations/{id}` 让这场对话从用户那边消失，这一场写过的占卜笔记跟着删（画像不回退）。
用户在里面说过话的，整行挪进 `archived_conversations` 表，后台管理还看得到、标「已归档」；
一句没说过的（只有开场白之类）直接删掉。用户那边的代码只读 `conversations`，
所以归档和删掉在用户看来是一样的。归档的一直留着，不过期、不恢复。

游客退出时选「永久删除」（`DELETE /api/users/{id}`）：人和笔记本删掉，
名下对话逐场走同一条规则——说过话的进归档，没说过的直接删。
**没接着聊过的每日一签不能删**（400）：用户在里面发过言，它才算普通对话、才能删；
删掉的只是对话，那天的日运记录（牌面、印证）留着。
前端的删除入口按同一条规则显示或隐藏（`utils/conversation.ts` 的 `canDelete`，
对应后端 `ConversationService.deletable`）。

---

## 8. 赞 / 踩

占卜师每条有正文的回复下面常驻「复制 / 赞 / 踩 / 分享」（分享暂时只是入口，点开弹窗写着还在筹备中）。可以都不点；点过的那个亮起，
再点一次取消，点另一个就是改主意。流式中的回复还没落库，不出赞踩。

- **不进会话**：记在单独的 `message_feedback` 表（主键 = 会话 id + 消息下标，另记那条消息的
  timestamp），会话的 `data` 一个字节不动，模型看到的历史里没有它，也不扣额度。
  一轮跑完整行保存会话时两者互不覆盖。
- **怎么认消息**：消息只追加，下标不变。`PUT /api/conversations/{id}/feedback`
  带 `message_index` + `message_timestamp` + `rating`（`up` / `down` / `null` = 取消）；
  下标越界或时间戳对不上 409，不是有正文的 assistant 消息 400，仅本人。
  `GET` 同一路径取本人在这场点过的 `{下标: up|down}`，前端进会话时拉一次，
  点的时候先亮起，没记上就退回并提示。
- **归档不影响**：用户删掉会话只挪 `conversations` 那一行，评价留着，后台照样看得到。
- 后台怎么显示见 [后台管理](admin-panel.md) §5。

---

## 9. 存储

| 数据 | 存哪 |
|---|---|
| 用户、会话、用户删掉的会话（`archived_conversations`）、赞 / 踩（`message_feedback`） | `backend/data/app.db`（SQLite / WAL，aiosqlite） |
| 日运、钱包、支付、用量、笔记本 | `backend/data/*.json`、`data/notebooks/` |

`backend/data/` 全部是实时数据，gitignored、无备份。**测试一律指向临时库或 mock，不碰它。**

---

## 10. 代码在哪

| 文件 | 管什么 |
|---|---|
| `services/turn_service.py` | 一轮对话的全流程（塔罗占星共用） |
| `services/tool_turns.py` | 工具轮落库形状、interrupt 结果、旧会话判定 |
| `services/gemini_service.py` | Agent Loop |
| `services/context_service.py` | 相位判定、提示词拼装、用户资料 / 画像 / 来访次数块 |
| `services/conversation_service.py` | 会话消息逻辑 |
| `services/storage_service.py` · `db.py` | SQLite 存取与建表 |
| `services/tarot_service.py` · `astrology_service.py` | 抽牌 · 星盘接口 |
| `routers/tarot.py` · `astrology.py` · `conversations.py` | 接口层 |
