# 开场幕：前置占卜师 Agent

塔罗 / 占星会话的前半场由一个独立的前置 Agent 接管，把这场占卜定义清楚后交单移交。
每日一签与闲聊没有开场幕。落库形状与工具轮见 [会话与解读核心](conversation-core.md)。

---

## 1. 它只做一件事

**把这场占卜定义清楚，然后交单下班。** 定义清楚 = 三件事落地：

1. 一个具体的、可以直接起卦的问题（不是「我最近很烦」，是「该不该接这个外地的 offer」）
2. 用塔罗还是星盘起手
3. 走塔罗的话：什么牌阵、抽几张、每个位置代表什么

三件事齐了立刻调 `submit_reading_brief`，解读不归它管。

**它不产出任何关于人的判词**——不判断用户目标类型、不评估情绪浓度、不选解读策略。
陪伴与共情是解读阶段的事，前置 Agent 保持工具性。
这条是硬约束：一旦开场要给人定性，塔罗与星盘就在开场分成两条产品线；
而判词字段与交单纪律会在同一轮里互相打架（要共情就得说话，要交单就不能说话）。

### 开场幕的微观解剖

| 微动作 | 该是什么样 | 要避开的 |
|---|---|---|
| 迎接 | 短句、留白。回头客是熟人的松弛，认人靠语气不靠翻档案 | 菜单式列举、emoji、感叹号、口号、每次一样 |
| 叙事性澄清 | **一个**开放问题，让用户把事情讲出来 | 参数化填表、一次问多个、连环追问 |
| 静默移交 | 不预告、不解释判断，直接进仪式 | 「我判断你是求认同型」、生硬换挡 |

**追问预算最多 1 轮。** 用户说的已经够具体 → 0 轮直接交单；用户催「直接抽吧」→ 立刻交单。
**问了问题的那一轮不交单**——提问和交单不能同时出现，它在等回答。
这条写死在提示词里，harness 不做机械拦截：模型返回 text + tool_call 就执行工具继续循环，
是标准 agent loop 行为，不该为它加特例。

---

## 2. 相位与两条路线

```
会话相位 = conversation.phase（opening / reading），单向一次

opening:
  用户消息 → 前置 Agent（OPENING provider）
             提示词: opening_system.md + <入口> + <用户资料> + <用户画像> + <关系上下文> [+ <本轮强制>]
             工具:   submit_reading_brief + request_user_profile
             ↓ 调 submit_reading_brief
             harness: 归一化 → strategy 落库 + phase→reading
      ┌──────────────── 按 route 分两条 ────────────────┐
      ▼ route=tarot                        route=astrology ▼
  harness 照单直推抽牌器                同轮移交解读 Agent（READING provider）
  记成一条 assistant(tool_calls)        换提示词与工具集重建 session，
  收口等用户抽牌                        历史 = 落库的 + 本轮刚产生的那一对，
  （/draw 写结果，/resume 继续）         待发的是交单结果，由它自己取盘开口

reading:
  用户消息 → 解读 Agent（READING provider）
             提示词: tarot/astrology_system.md + <用户资料> + <用户画像>
                    + <本场起手> + reading_handoff.md
             工具:   draw_tarot_cards / get_astrology_chart /
                    request_user_profile / read_divination_notes
```

- **任意时刻单一声音。** 每场最多一次相位切换，没有每轮跑两个模型的导演层。
- **塔罗路线零额外往返。** 牌阵参数已经在单子里，harness 直接推抽牌器。
  不叫解读 Agent 出来说过渡语——那是纯浪费的往返，而且它会自己另选一副牌阵，跟单子对不上。
- **星盘路线同轮移交。** 解读 Agent 看到的历史就是落库的历史，待发的是交单结果，
  和它下一次请求从库里读到的完全一样，**不另造移交指令**。
- **前置 Agent 只活在开场，不回场。** 解读工具集里没有 `submit_reading_brief`：
  起手单是开场定下的一次性记录，不是可改写的当前状态。
  用户中途换角度、补抽牌阵、中途引入星盘，全部由解读 Agent 自理（它工具齐全）。

### 塔罗与星盘不是两条产品线

对前置 Agent 来说它们只是手段选项，判断逻辑同一套，`<入口>` 只是先验偏好，
它判断另一条更合适可以改。`route` 填的是**起手动作**，不是全场计划——
两个都想用就填先做的那个。

星盘需要出生信息，所以开场工具集里有 `request_user_profile`，且 `<用户资料>` 必须注入开场提示词：
看不见资料，模型就没法判断星盘这条路走不走得通，只能盲调工具去撞。
要资料的那一轮同样只说话不交单。信息不全绝不卡人——塔罗永远是通的那条路。

---

## 3. 起手单 `submit_reading_brief`

| 字段 | 取值 | 必填 |
|---|---|---|
| `question` | 一句话，具体到可以直接起卦 | ✅ |
| `context` | 2–3 句：用户讲出来的背景 | |
| `route` | `tarot` / `astrology`（`enum` 锁死） | ✅ |
| `spread_type` | 牌阵名（塔罗路线） | |
| `card_count` | 张数，须与 `positions` 长度一致 | |
| `positions` | 各位置含义（字符串数组） | |

必填由 schema 的 `required` 保证，**不做额外字段校验**：缺字段渲染器直接跳过，
塔罗路线牌阵字段缺失由 `_DEFAULT_SPREAD`（三张阵：现状 / 阻碍 / 流向）兜底，
不为这个再花一次往返去问模型。

牌阵选型表（问题类型 × 牌阵 × 位置含义）写在 `opening_system.md` 里，管理页可在线改。

`context_service.to_plain()` 收口交单参数：Gemini 的 `function_call.args` 里数组是
RepeatedComposite、整数常以 float 到手，整个 JSON 要落库，留着 proto 类型会在 `json.dumps` 当场炸。

`strategy` 为 None 时起手单渲染器返回空串，解读 Agent 表现同没有开场幕——
**起手单是增强项，不是通行证。**

---

## 4. 预算守卫：三层强制交单

1. **提示词纪律（软）**：`opening_system.md` 写明追问预算与交单时机。绝大多数会话在这层完成。
2. **API 机械强制（硬）**：用户消息数 ≥ `OPENING_FORCE_BRIEF_AFTER_USER_MSGS`（默认 3）
   且未交单 → 该轮带 `force_tool="submit_reading_brief"`（Gemini 为 `mode=ANY`，
   OpenAI 兼容为 `tool_choice`）。这是解码层约束：该轮禁止纯文本输出，只能产出交单调用。
   同时注入 `<本轮强制>` 一行保证被强制时字段质量不崩。
   - 配套：强制轮模型在解码层一个字也说不出来。塔罗路线直推抽牌器前补一句
     `opening_force_brief.md` 的过渡语，别让抽牌器凭空弹到用户面前。
     其余路径一律不补——模型想说就说，不想说就沉默。
3. **harness 兜底（确定性下界）**：用户消息数 ≥ `OPENING_HARD_EXIT_AFTER_USER_MSGS`（默认 5）
   仍无起手单 → 代码直接翻 `phase="reading"`，`strategy` 保持 None（不伪造假单子）。
   预期永不触发，但保证**数学上不存在卡死在开场幕的会话**。

---

## 5. 开场白

`POST /api/conversations` 只建会话、立刻返回；开场白由
`POST /api/conversations/{id}/greeting` 单独取，SSE 形状与 `/message` 一致。
等待因此发生在对话里、和等一轮回复长得一样，而不是卡在首页那个按钮上。

- 提示词只发人设与迎接：`opening_persona.md` + `<入口>` + `<关系上下文>` + `opening_greeting.md`。
  无工具、短输出，超时 `OPENING_GREETING_TIMEOUT_SECONDS`（默认 8 秒）。
- 生成在进流之前做完——provider 挂了还能以 503 返回让前端提示重试；
  一旦进了流，就只剩正文可推、没法再表达失败。
- **任何异常或空输出 → 503，不发保底文案。** 开场白之后那一轮用的是同一个 provider，
  provider 挂了就是挂了；一句假问候只会让用户认真打完一个问题再撞同一堵墙，
  还会把关系元数据 SQL 出错、提示词文件缺失这类真问题盖成「看起来正常」。
- 已有消息的会话再请求 → 409，不凭空多一句台词。
- 额度在这个接口扣（开场白是真实 LLM 调用）。没有开场幕的会话类型不打 LLM、不扣额度。

---

## 6. 关系上下文

`context_service.build_relationship_meta()` 一条 SQL，不加载会话全文：

```sql
SELECT COUNT(*), MAX(updated_at) FROM conversations
WHERE user_id = ? AND conversation_id != ?
  AND json_array_length(data,'$.messages') > 1        -- 排除「点开又关」的空会话
  AND json_extract(data,'$.session_type') IN ('tarot','astrology')  -- 排除每日一签
```

两个过滤条件都是认人露馅的防线：没有 session_type 过滤，连续签到 7 天的新客
第一次开塔罗会被渲染成「第 8 次来访」；没有空会话过滤，点开又关会刷高次数。

渲染出来只有事实行：

```
<关系上下文>
称呼：小夏 ｜ 来访：第 4 次 ｜ 距上次：11 天
```

「新客要安静、回头客要熟人语气、禁止翻旧账」这类语气指令写在 `opening_system.md` 里，
代码里不藏文案。

---

## 7. 接场约束 `reading_handoff.md`

`tarot_system.md` / `astrology_system.md` 是给「从零开始的占卜师」写的，
里面仍命令「首次对话先欢迎用户」和「意图模糊时参数化澄清」，与开场幕直接打架。

解决方式不动那两份大提示词：起手单非空时在解读提示词后追加 `reading_handoff.md`，
宣告开场 / 迎接 / 澄清已完成、上述两条本场失效。
起手单为空（存量会话 / 守卫兜底）→ 不追加任何东西。

---

## 8. 错误处理

| 情况 | 处理 |
|---|---|
| 开场白 LLM 失败或超时 | 503，前端提示重试；不生成假问候 |
| 星盘移交重建 session 失败 | 该轮以起手单已落库结束，下轮自然进 reading |
| 模型不交单 | 三层守卫（§4） |
| 塔罗路线牌阵字段缺失 | `_DEFAULT_SPREAD` 三张阵兜底 |
| 交单参数含 proto 类型 | `to_plain()` 收口 |

---

## 9. 代码在哪

| 文件 | 管什么 |
|---|---|
| `prompts/opening_system.md` | 人设、迎接规范、追问纪律、路线选择、牌阵选型表、交单纪律 |
| `prompts/opening_persona.md` · `opening_greeting.md` | 开场白那一次发的两段 |
| `prompts/opening_force_brief.md` | 强制交单指令 + 过渡语 |
| `prompts/reading_handoff.md` | 接场约束 |
| `services/opening_service.py` | 开场白生成、守卫计数、交单落库、硬退出 |
| `services/context_service.py` | 相位判定、关系元数据、起手单渲染与归一、两相位提示词拼装、`first_action` |
| `services/gemini_service.py` | Agent Loop 按相位取 provider / 提示词 / 工具集，交单后分路 |
| `config.py` | 守卫两个阈值 + 开场白超时 |
| `pages/admin/ConversationsPanel.tsx` | 会话列表开场幕徽标 + 详情页起手单卡片 |
