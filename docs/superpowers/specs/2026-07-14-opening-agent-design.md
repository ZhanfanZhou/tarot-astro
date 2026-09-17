# 前置占卜师 Agent（开场幕分幕接力）· 设计文档

创建：2026-07-14 ｜ 实施：2026-07-14 ｜ 首次联调修正：2026-08-10 ｜ 收敛重构：2026-09-15
状态：已实现并在 `feat/opening-agent` 分支运行。本文描述**当前实际机制**。

关系：本设计取代 [多 Agent 架构与占卜工作流重构 · 现状总纲](2026-07-14-multi-agent-redesign-design.md) 的 P2（缺口 2/3/4）；P1（画像卡 + 记忆 Agent）保持有效且与本设计解耦；P3 关系环不受影响。
全景与各缺口状态以总纲为准，本文只负责开场幕这一件事。

---

## 1. 背景与目标

开场体验原有三个硬伤：

1. **打招呼千篇一律**：`routers/tarot.py` / `astrology.py` 各有 3 条硬编码模板随机选一条、逐字伪装流式输出，根本不经过模型——调提示词救不了。话术本身是客服体（菜单式列举、感叹号、口号），AI 感的五大来源（模板复现、菜单感、殷勤感、过长、每次一样）全占。
2. **澄清是填表**：原提示词教的是参数化澄清（"看哪方面运势？时间跨度多大？"）。真实占卜师问的是叙事性问题，让人把事情讲出来。
3. **牌阵选择无依据**：提示词只说"你来决定"，没有任何选型表。牌阵是随手一抽，不是问题的物化。

另有一条结构性病根：所有流程控制混在一份大提示词里，行为靠祈使句祈祷，时灵时不灵。

**目标**：新增一个前置占卜师 Agent，台前接管开场幕，把这场占卜定义清楚后交单移交。
验收标准只有一条：**用户感觉和真实的占卜一样，没有人机感。**

## 2. 职责边界：前置 Agent 只做一件事

**把这场占卜定义清楚，然后交单下班。** 定义清楚 = 三件事落地：

1. 一个具体的、可以直接起卦的问题（不是"我最近很烦"，是"该不该接这个外地的 offer"）
2. 用塔罗还是星盘起手
3. 走塔罗的话：什么牌阵、抽几张、每个位置代表什么

三件事齐了立刻调 `submit_reading_brief`，解读不归它管。

### 2.1 它明确不做「读人」

**前置 Agent 不产出任何关于人的判词。** 不判断用户目标类型（求认同 / 辅助决策 / 探索好奇）、不评估情绪浓度、不选解读策略。

这是 2026-09-15 收敛重构删掉的一整块设计，原因有三，都在真实联调里暴露过（详见总纲 §5.4）：

- **判词字段会被模型抄串。** `reading_strategy` 合法值是验证式/决策式/探索式，实测四份单子三份填成了目标类型的值——两个字段的候选词在同一段 description 里相邻。
- **判词与交单纪律互相打架。** "情绪浓度高 → 下一轮纯共情"要求它说话，"读人完成即交单"要求它交单，两条指令同轮同时成立，结果是高情绪路径 3/3 首轮直奔抽牌。
- **判词让塔罗与星盘在开场就分叉。** 一旦开场要给人定性，两个入口就变成两条产品线；只定义占卜的话，入口只是先验偏好。

陪伴与共情是**解读阶段**的事。前置 Agent 保持工具性，不承担情感工作。

## 3. 体验定义：开场幕的微观解剖

| 微动作 | 真实的样子 | AI 感陷阱 |
|---|---|---|
| ① 迎接 | 短句、留白，"腾出空间"而非"填满空间"。回头客是熟人的松弛（"又来啦"），认人靠语气不靠翻档案 | 菜单式列举、emoji、感叹号、口号、每次一样 |
| ② 叙事性澄清 | **一个**开放问题（"最近是发生了什么，让你今天想来问这个？"），让用户把事情讲出来 | 参数化填表、一次问多个问题、连环追问（审问感） |
| ③ 静默移交 | 不预告、不解释判断、不外露任何结论，直接进仪式 | "我判断你是求认同型"、生硬换挡 |

**追问预算：最多 1 轮。** 用户说的已经够具体 → 0 轮直接交单；用户催（"直接抽吧"）→ 立刻交单。
**问了问题的那一轮不交单**——提问和交单不能同时出现，它在等回答。这条写死在提示词里，harness 不做机械拦截（模型返回 text + tool_call 就执行工具继续循环，是标准 agent loop 行为，不该为它加特例）。

## 4. 架构：相位与两条路线

```
会话相位 = conversation.phase 显式状态位（opening / reading）

opening 相位:
  用户消息 → 前置 Agent（OPENING provider）
             提示词: opening_system.md + <入口> + <用户资料> + <关系上下文> [+ <本轮强制>]
             工具:   submit_reading_brief + request_user_profile
             ↓ 调 submit_reading_brief
             harness: normalize_brief → strategy 落库 + phase→reading
             ↓ 按 route 分两条路
      ┌──────────────────────────────┴───────────────────────────┐
      ▼ route=tarot                                route≠tarot（星盘）▼
  harness 替解读 Agent 发起 draw_tarot_cards    同轮移交解读 Agent（READING provider）
  记成一条 assistant(tool_calls) + 推抽牌器     用解读提示词+解读工具集重建 session，
  yield done → 收口等用户抽牌                   历史 = 落库的 + 本轮刚产生的（交单那一对），
  （/draw 写 TOOL 结果，/resume 继续）           待发的是交单结果，由它自己取盘开口

reading 相位:
  用户消息 → 解读 Agent（READING provider）
             提示词: tarot/astrology_system.md + <用户资料> + <本场起手> + reading_handoff.md
             工具:   draw_tarot_cards / get_astrology_chart /
                     request_user_profile / read_divination_notebook
```

要点：

- **任意时刻单一声音。** 每场会话最多一次相位切换，不存在每轮跑两个模型的导演层。
- **塔罗路线零额外往返。** 牌阵参数已经在单子里，harness 直接推抽牌器。不叫解读 Agent 出来说一句过渡语——那是纯浪费的往返，而且它会自己另选一副牌阵，跟单子对不上。
- **星盘路线同轮移交。** 不需要用户动手，换提示词和工具集后接着跑。解读 Agent 看到的历史就是落库的历史（用户那句、开场 Agent 交单的那一轮），待发的是交单结果——和它下一次请求从库里读到的完全一样，**不另造移交指令**。历史里出现本次未声明的 `submit_reading_brief`，Gemini / OpenAI 都接受（2026-09 对真 Gemini 验证）。
- **前置 Agent 只活在开场，不回场。** 解读工具集里没有 `submit_reading_brief`：起手单是开场定下的一次性记录，不是可改写的当前状态。用户中途换角度、补抽牌阵、中途引入星盘，全部由解读 Agent 自理（它工具齐全）。
- **开场白由「创建会话」产生。** `POST /api/conversations` 生成开场白、写成第一条消息随响应返回。开场白是会话的内容，不是某次发送的产物；客户端不需要为了让占卜师先开口而反过来发一条消息。

### 4.1 塔罗与星盘不是两条产品线

对前置 Agent 来说它们只是手段选项，判断逻辑同一套，`<入口>` 只是先验偏好，它判断另一条更合适可以改。
`route` 填的是**起手动作**，不是全场计划——两个都想用就填先做的那个。

星盘需要出生信息，所以开场工具集里有 `request_user_profile`，且 `<用户资料>` 必须注入开场提示词：
看不见资料，模型就没法判断星盘这条路走不走得通，只能盲调工具去撞。
要资料的那一轮同样**只说话不交单**，等用户反应（填了走星盘，说抽牌走塔罗）。信息不全绝不卡人——塔罗永远是通的那条路。

### 4.2 工具轮按官方形状落库

`Message` 三种角色和两家 API 的消息一一对应：`user`、`assistant`（`content` + `tool_calls[{id,name,args}]`）、`tool`（`tool_call_id` + 结果 JSON）。Agent Loop 每一轮都 yield `{"message"}` 交给 `turn_service` 按序落库；重建历史时逐条映射（Gemini `functionCall`/`functionResponse` part，OpenAI `assistant.tool_calls`/`role=tool`），不推断、不伪造任何台词。

**interrupt 式工具**（`llm/tools.INTERRUPT_TOOL_NAMES`：抽牌、补资料）的结果要等用户动手，跨一次 HTTP 请求：Loop 见到就收口（调用已落库，不喂假结果）；`/draw` 生成真牌写成那次调用的 TOOL 结果；补资料由 `/resume` 从用户当前 profile 写结果，模型自己接着调 `get_astrology_chart`（工具描述就是这么写的），前端不替它取盘。用户不做那一步直接发消息，`/message` 先把「没做」记成结果再记发言——两家 API 都要求每个调用后面跟着结果。`/resume` 不带 content：它不是发言。

**界面状态从会话数据推导。** SSE 只有正文。要不要显示抽牌 / 补资料按钮、抽牌器用什么牌阵，前端看当前会话末尾那条 assistant 的 `tool_calls`；进行中的一轮按会话 id 记在 store 里。按钮和流式文本因此只属于它所在的那场会话，切换会话不会串台，刷新页面也不会丢。

**每日一签 / 心灵奇旅**没有对话历史也没有用户发言要回，和开场白同理，服务端单次生成：抽签接口当场生成解读、落成第一条 assistant（当日的牌挂在它上面）随响应返回；心灵奇旅整段提示词一次生成。

**旧会话**（2026-09 之前：抽牌结果套在 SYSTEM、触发语伪装成用户发言）没有记录调用，运行时判为只读（`tool_turns.is_legacy`，`/message` `/resume` 409）；`scripts/migrate_tool_turns.py` 可一次性改写成新形状。

## 5. 相位状态机与存储

**Conversation 模型加两个字段（无 schema 迁移）：**

```python
phase: str = "reading"            # opening / reading；默认值即存量迁移
strategy: Optional[dict] = None   # 起手单；None = 无增强，照常运转
```

- **`phase` 默认 `"reading"` 就是存量迁移**：conversations 表是文档型存储（整对象 JSON 在 `data` 列），存量行没有 phase 字段，Pydantic 读出时自动补默认值 → 老会话确定性路由到解读 Agent。无回填脚本、无哨兵值、无上线顺序约束。
- 新会话在 `conversation_service.create_conversation()` 中按 session_type 写初值：塔罗/占星 `opening`；每日一签/闲聊 `reading`。router 只透传，不参与判断。
- 状态机单向一次：`opening → reading`，触发者为交单成功或守卫兜底（§7 第 3 层）。
- `strategy` 为 None 时起手单渲染器返回空串，解读 Agent 表现同开场幕上线前——**起手单是增强项，不是通行证**。
- 后台按起手单字段查询用 `json_extract(data,'$.strategy.…')`，不加影子列。

## 6. 起手单 schema（`submit_reading_brief` 六字段）

| 字段 | 取值 | 必填 |
|---|---|---|
| `question` | 一句话，具体到可以直接起卦 | ✅ |
| `context` | 2–3 句：用户讲出来的背景 | |
| `route` | `tarot` / `astrology`（`enum` 锁死） | ✅ |
| `spread_type` | 牌阵名（塔罗路线） | |
| `card_count` | 张数，须与 `positions` 长度一致 | |
| `positions` | 各位置含义（字符串数组） | |

必填由 schema 的 `required` 保证。**不做额外字段校验**：缺字段渲染器直接跳过，塔罗路线牌阵字段缺失由 `_DEFAULT_SPREAD`（三张阵：现状/阻碍/流向）兜底，不为这个再花一次往返去问模型。

牌阵选型表（问题类型 × 牌阵 × 位置含义）写在 `opening_system.md` 里，管理页可在线改。模型可按问题特质自主设计位置含义，但必须有依据。

**数据兜底 `context_service.to_plain()`**：Gemini 的 `function_call.args` 里数组是 RepeatedComposite、整数常以 float 到手，起手单要整个 JSON 落库，留着 proto 类型会在 `json.dumps` 当场炸。`positions` 进单子之后这条路径才第一次出现，所以交单参数统一在此收口。

## 7. 预算守卫：三层强制交单

治"祈使句不可靠"的老病，一层比一层硬：

1. **提示词纪律（软）**：`opening_system.md` 写明追问预算与交单时机。绝大多数会话在这层完成。
2. **API 机械强制（硬）**：用户消息数 ≥ `OPENING_FORCE_BRIEF_AFTER_USER_MSGS`（默认 3）且未交单 → 该轮带 `force_tool="submit_reading_brief"`（Gemini 为 `mode=ANY`，OpenAI 兼容为 `tool_choice`）。这是解码层约束：**该轮禁止纯文本输出，只能产出交单调用**。同时注入 `<本轮强制>` 一行保证被强制时字段质量不崩。
   - 配套：强制轮模型在解码层一个字也说不出来，这时候的沉默不是它的选择。塔罗路线直推抽牌器前补一句 `FORCED_BRIEF_HANDOFF_LINE`，别让抽牌器凭空弹到用户面前。其余路径一律不补——模型想说就说，不想说就沉默，两种都正常。
3. **harness 兜底（确定性下界）**：用户消息数 ≥ `OPENING_HARD_EXIT_AFTER_USER_MSGS`（默认 5）仍无起手单 → 代码直接翻 `phase="reading"`，`strategy` 保持 None（不伪造假单子）。预期永不触发，但保证**数学上不存在卡死在开场幕的会话**。

## 8. `context_service.py`：相位概念的唯一权威

提示词选择、工具集选择、`function_executor` 分支、守卫计数四处全调它，不各自判断——杜绝"路由认为在开场、工具集却给了抽牌"的分裂。

**`build_relationship_meta(user_id, current_conversation_id)`**：一条 SQL，不加载会话全文，产出来访次数与距上次天数。

```sql
SELECT COUNT(*), MAX(updated_at) FROM conversations
WHERE user_id = ? AND conversation_id != ?
  AND json_array_length(data,'$.messages') > 1        -- 排除「点开又关」的空会话
  AND json_extract(data,'$.session_type') IN ('tarot','astrology')  -- 排除每日一签
```

两个过滤条件都是认人露馅的防线：没有 session_type 过滤，连续签到 7 天的新客第一次开塔罗会被渲染成"第 8 次来访"，占卜师对陌生人说"又来啦"；没有空会话过滤，点开又关会刷高次数。

**`render_relationship_block(meta)`** 只注入事实行：

```
<关系上下文>
称呼：小夏 ｜ 来访：第 4 次 ｜ 距上次：11 天
```

"新客要安静、回头客要熟人语气、禁止翻旧账"这类语气指令**写在 `opening_system.md` 里**（管理页可在线改），不硬编码在代码。

**`first_action(strategy)`**：起手单 → 交单后 harness 要执行的第一个动作。`route=tarot` 返回 `("draw_tarot_cards", 牌阵参数)`，其余返回 `(None, None)` 走星盘移交。

**`render_brief_block(strategy)`** 渲染为 `<本场起手>` 块注入解读提示词。措辞是"本场起手"而不是"当前策略"：它是开场定下的一次性记录，用户后来换角度、补抽牌阵都不会回写，解读 Agent 不该拿它当当前指令用。

### 8.1 接场约束 `reading_handoff.md`

`tarot_system.md` / `astrology_system.md` 是给"从零开始的占卜师"写的，里面仍命令"首次对话先欢迎用户"和"意图模糊时参数化澄清"——后者正是本设计要消灭的填表式澄清。移交后这两条会与开场幕直接打架（100% 的新会话都走这条路）。

解决方式**不动那两份大提示词**，而是在 `build_reading_prompt()` 中：起手单非空时追加 `reading_handoff.md`（已登记 `PROMPT_REGISTRY`，管理页可改），宣告开场/迎接/澄清已完成、上述两条本场失效。起手单为空（存量会话 / 守卫兜底）→ 不追加任何东西，行为与改动前逐字一致。

## 9. 开场白生成

硬编码模板改为一次**无工具轻量 LLM 调用**（`opening_service.build_greeting()`，走 OPENING provider，opening 提示词 + 关系上下文，短输出），在 `POST /api/conversations` 里完成，开场白作为第一条 assistant 消息随创建响应返回。

**为什么在创建接口里做。** 早先的实现是前端建完会话再发一条 `content: ""` 的消息当暗号。那是拿数据的空值编码一个动作：接口签名说不出自己在干什么，得靠一条守卫去区分「请开场」和「真的发了空消息」，前端注释也跟着长期过期。开场白由创建产生之后，这些全部消失——少一次往返、少一条守卫、少一个暗号。代价是创建接口会阻塞在一次 LLM 调用上（超时封顶 8 秒），这是可接受的：用户点完卡片本来就在等占卜师落座。

- **超时 8 秒**（`config.OPENING_GREETING_TIMEOUT_SECONDS`）：开场白是全 App 的第一印象，provider 卡住 = 永久转圈。
- **任何异常或空输出 → 抛 `GreetingUnavailable`，创建接口返回 503，前端提示重试。不发保底文案。** 理由：开场白之后紧接着的那一轮 Agent Loop 用的是同一个 OPENING provider，provider 挂了就是挂了，一句假问候只会让用户认真打完一个问题再撞同一堵墙，还会把关系元数据 SQL 出错、提示词文件缺失这类真问题盖成"看起来正常"。有用的 fallback 是重试，不是假内容。
- 流式：开场白不走 SSE。它是一次性短文本，此前的"逐字 yield"是假流式（先拿到完整文本再拆字符），没有保留价值。

**额度**：开场白是真实 LLM 调用，`RateLimitService.check_and_consume()` 在 `POST /api/conversations` 里、生成之前扣一次——这个接口原先完全不限流，反复建会话即可白嫖。无开场幕的会话类型（每日一签 / 闲聊）不打 LLM、不扣额度。同时游客每日上限 **10 → 15**，补偿开场幕新增的开销（开场白 1 条 + 追问 0–1 条），保证一场完整占卜仍能跑完。注册用户上限本就宽松（50），不动。

## 10. 改动面清单

| 位置 | 改动 |
|---|---|
| `prompts/opening_system.md` | **新增**：人设、迎接规范、追问纪律、路线选择、牌阵选型表、交单纪律 |
| `prompts/reading_handoff.md` | **新增**：开场→解读接场约束 |
| `services/prompt_service.py` | `PROMPT_REGISTRY` 登记上述 2 个提示词（管理页自动多出可编辑条目） |
| `services/context_service.py` | **新增**：相位判定、关系元数据、起手单渲染与归一、两相位提示词拼装、`first_action` |
| `services/opening_service.py` | **新增**：开场白生成（失败即抛 `GreetingUnavailable`）、守卫计数、交单落库、硬退出 |
| `services/gemini_service.py` | Agent Loop 按相位取 provider / 提示词 / 工具集；交单后分两条路线 |
| `routers/conversations.py` | 创建会话时生成开场白并落为第一条消息；扣额度；失败 503 |
| `services/turn_service.py` | **新增**：一轮对话（校验 → 收口 interrupt → 扣额度 → Loop → 逐条落库 → SSE），塔罗占星共用 · `services/tool_turns.py` 工具轮落库形状 / interrupt 结果 / 旧会话判定 |
| `routers/tarot.py` / `astrology.py` | 薄壳：`/message` `/resume` `/draw` 转 `turn_service` |
| `routers/conversations.py` | 创建会话时按 session_type 写 phase 初值 |
| `models.py` | Conversation 加 `phase` / `strategy` |
| `config.py` | 守卫两个阈值 + 开场白超时 |
| `services/storage_service.py` | `list_conversations_admin` 带出 phase |
| `pages/admin/ConversationsPanel.tsx` + `adminApi.ts` + `admin.css` | 会话列表开场幕徽标 + 详情页起手单卡片 |
| `prompts/tarot_system.md`、`astrology_system.md` | **一字不动** |
| 用户端前端 | **零改动** |

**成本**：星盘路线移交轮 +1 次模型往返（每场一次）；塔罗路线零额外往返；开场白由免费模板变为一次短 LLM 调用。开场相位提示词远小于塔罗大提示词，该相位 token 反而更省。

## 11. 错误处理与降级

- 开场白 LLM 失败或超时 → 建会话返回 503，前端提示重试（§9）；不生成假问候
- 星盘移交重建 session 失败 → 该轮以起手单已落库结束，下轮自然进 reading 相位（用户只感觉停顿了一下）
- 模型不交单 → 三层守卫（§7）
- 塔罗路线牌阵字段缺失 → `_DEFAULT_SPREAD` 三张阵兜底
- 交单参数含 proto 类型 → `to_plain()` 收口（§6）

## 12. 测试与验证

**单测**（mock provider / `TAROT_DB_FILE` 临时库，不碰 `data/`）：相位路由（含存量会话默认 reading、每日一签门控）、phase 初值写入、守卫 2/3 层触发、交单落库、开场白失败即抛、建会话计费与 503、关系元数据 SQL（空会话与每日一签排除）、塔罗直推抽牌、星盘同轮移交。

**联调重点（人工，未完成清单见总纲 §5.3）**：口吻一致性（星盘移交前后盲测无断裂感）、回头客不翻旧账、催抽牌路径（立即交单）、牌阵与起手单逐字一致、守卫第 2 层强制交单的字段质量（需临时把阈值调成 1 才触发得到）。

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 星盘路线移交前后口吻断裂 | 同人设段复写 + 联调盲测 |
| 模型不交单 / 交单时机差 | 小提示词单一职责 + 三层守卫 |
| 非 Gemini provider 不尊重强制交单（守卫第 2 层） | 见总纲缺口 7——`tool_choice` 支持度是该项的重点验证项 |
| 开场白 LLM 延迟/失败 | 短输出 + 8s 超时 + 503 让用户重试（卡片上有"落座中…"反馈） |
| 提示词文案不达"无人机感"标准 | 管理页在线编辑热加载，联调快速迭代 |

## 14. 与总纲的衔接

- 取代总纲 P2（缺口 2 接场 / 缺口 3 读人 / 缺口 4 策略单工具）。其中**缺口 3 的"读人"部分已在 09-15 撤销**，见 §2.1；缺口 3 真正落地的只有牌阵选型。
- **P1（画像卡 + 记忆 Agent）解耦并行**：画像卡上线后注入**解读 Agent**（增强深度），**不注入迎接**——熟人感来自语气，不来自复述档案，"不翻旧账"决策沿用。
- P3 关系环不受影响，钩子消费方案不变。
