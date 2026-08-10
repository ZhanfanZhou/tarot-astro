# 前置占卜师 Agent（开场幕分幕接力）· 设计文档

日期：2026-07-14
状态：已评审定稿
关系：本设计**取代** [多 Agent 架构与占卜工作流重构](2026-07-14-multi-agent-redesign-design.md) 的 P2（缺口 2/3/4）；P1（画像卡+记忆 Agent）保持有效且与本设计解耦；P3 关系环不受影响。

> **这条线的全景与落地状态以总纲为准**：[多 Agent 架构与占卜工作流重构 · 现状总纲](2026-07-14-multi-agent-redesign-design.md)。
> 本文只负责开场幕这一件事的详细设计。首次真实联调发现的两个缺陷记在总纲 §5.4。

---

## 1. 背景与目标

当前开场体验的三个硬伤：

1. **打招呼千篇一律**：`routers/tarot.py` / `astrology.py` 各有 3 条硬编码模板随机选一条、逐字伪装流式输出，根本不经过模型——调提示词救不了。话术本身是客服体（菜单式列举、感叹号、口号），AI 感的五大来源（模板复现、菜单感、殷勤感、过长、每次一样）全占。
2. **只澄清问题，不读人**：现有提示词教的是**参数化澄清**（"看哪方面运势？时间跨度多大？"= 填表）。真实占卜/咨询在洗牌前已完成一半工作：判断来人想从这次咨询带走什么（求认同 / 要决策依据 / 看清现状 / 探索好奇）。这个判断决定牌阵选型与解读方向，当前完全悬空。
3. **读人行为靠祈使句祈祷**：所有流程控制混在一份大提示词里，行为时灵时不灵（原设计稿痛点 1、2）。

**目标**：新增一个前置占卜师 Agent，台前接管开场幕（迎接 → 共情 → 叙事性澄清），产出结构化策略单后无缝移交给解读 Agent。验收标准只有一条：**用户感觉和真实的心理咨询或占卜一样，没有人机感。**

## 2. 体验定义：开场幕的微观解剖

真实咨询的开场有四个微动作，每个都有明确的真实感来源与 AI 感陷阱：

| 微动作 | 真实的样子 | AI 感陷阱 |
|---|---|---|
| ① 迎接 | 短句、留白，"腾出空间"而非"填满空间"。回头客是熟人的松弛（"又来啦，这次是什么事"），认人靠语气不靠翻档案 | 菜单式列举、emoji、感叹号、口号、每次一样 |
| ② 共情确认 | 用户说出问题后第一拍先接住情绪（"听起来这事在你心里悬了有一阵了"），再开始工作 | 直接跳任务（"好的，那我们来看看"） |
| ③ 叙事性澄清 | **一个**开放问题（"最近是发生了什么，让你今天想来问这个？"），用户讲出的故事里同时包含事件、情绪浓度和目标。读人不是靠多问，是问对一个问题然后暗中听——四类目标大多藏在措辞里（"我们还有可能吗"=求认同；"该接 offer 还是留下"=辅助决策） | 参数化填表、一次问多个问题、连环追问（审问感） |
| ④ 静默移交 | 读人结论绝不外露，一句自然过渡（"嗯，我大概有感觉了，我们抽牌吧"）后进入仪式 | 暴露分类（"我判断你是求认同型"）、生硬换挡 |

**澄清预算：自适应 0–2 轮。** 措辞已清晰 → 0 轮直接交单；模糊 → 1 轮叙事性问题；情绪浓度高 → 允许第 2 轮纯共情（不推进任务）。上限硬卡 2 轮防审问感（由代码守卫兜底，见 §7）。

## 3. 已对齐的产品决策

1. **分幕接力，取代原设计稿 3.3 方案 (b)**。前置 Agent 真正台前说话，用独立小提示词（不被塔罗大提示词干扰）；完成判断后经工具移交。任意时刻单一声音，无每轮双推理——与被否决的"每轮导演层"(c) 有本质区别。
2. **双入口保留，入口 = 起手偏好**。前置 Agent 在塔罗/占星两个入口都生效；入口作为先验偏好写进策略单，读人后可建议不同/组合的工具路线。前端零改动。
3. **不硬依赖 P1 画像卡**。迎接的"认人"只需关系元数据（次数/间隔/昵称，代码可算、现成）；读人靠本场对话。画像卡上线后喂给解读 Agent 增强深度，**不喂迎接**（熟人感来自语气，不来自复述档案——"不翻旧账"决策沿用）。
4. **移交采用同轮无缝接力**。用户最后一句澄清回答发出后，同一次 SSE 回复内完成交单+切换，解读 Agent 直接说过渡语并抽牌，无需用户多回一句。
5. **相位用显式状态位控制，与策略单解耦**（评审中修正，见 §5）。策略单可以不存在（存量会话），会话照常运转。

## 4. 架构总览

```
会话相位 = conversation.phase 显式状态位（opening / reading）

opening 相位:
  用户消息 → 前置 Agent（opening_system.md + 关系上下文，工具仅 submit_reading_brief）
             迎接 / 共情 / 叙事性澄清（0–2 轮）
             ↓ 判断完成 → 调 submit_reading_brief(策略单)
             harness: strategy 落库 + phase→reading → 同一 SSE 轮内
             用解读提示词+完整工具集重建 chat，回放历史与工具交换
  解读 Agent 接着说过渡语 → 调 draw_tarot_cards → 抽牌按钮出现

reading 相位:
  用户消息 → 解读 Agent（现有 tarot/astro 提示词 + 策略单注入块）
             submit_reading_brief 仍在工具集中 = 中途改判（覆盖写 strategy，不动 phase）
```

要点：

- 任意时刻单一声音；每场会话最多一次移交，多付一次模型往返（仅移交轮）。
- 前端零改动：SSE 契约、抽牌 function_call 事件、"空消息触发开场白"的约定全部不变。
- 前置 Agent 只活在开场，不回场。中途换新问题时信任已建立、解读 Agent 有全部语境，由它重调 `submit_reading_brief` 覆盖策略单。
- 实现基础已核实：`chat = model.start_chat(history=…)` 是纯客户端状态（无服务端会话），系统提示词拼在 history 首条消息里——同轮切换 = 用新提示词+新工具集重建 chat 并回放历史。**且 `_format_messages_for_gemini()`（gemini_service.py:204-243）把历史消息全部转为纯文本，function_call/function_response 从不进入历史 → 重建 chat 不涉及工具调用配对，原「SDK 兼容性」风险已消除。**

## 5. 相位状态机与存储

**Conversation 模型加两个字段（无 schema 迁移）：**

```python
class Conversation(BaseModel):
    ...
    phase: str = "reading"            # opening / reading；默认值即存量迁移
    strategy: Optional[dict] = None   # 策略单；None = 无策略增强，照常运转
```

- **`phase` 默认 `"reading"` 就是存量迁移**：conversations 表是文档型存储（整对象 JSON 在 data 列），存量行没有 phase 字段，Pydantic 读出时自动补默认值 → 全部老会话确定性路由到解读 Agent，行为与现状一致。无回填脚本、无哨兵值、无上线顺序约束。
- 新会话在 `services/conversation_service.py` 的 `create_conversation()` 中按 session_type 写入初值：塔罗/占星 `phase="opening"`；每日一签/闲聊 `phase="reading"`（前置 Agent 只服务塔罗与占星入口）。router 只透传，不参与判断。
- 状态机单向一次：`opening → reading`，触发者为 `submit_reading_brief` 执行成功或守卫兜底（§7 第 3 层）。改判只覆盖 `strategy`，不动 `phase`。
- `strategy` 为 None 时策略单渲染器返回空串，解读 Agent 表现同今天——**策略单是增强项，不是通行证**。
- 后台按策略字段查询/统计用 `json_extract(data,'$.strategy.user_goal')`（storage_service 已有先例），不加影子列。

## 6. 前置 Agent 规格

**提示词 `prompts/opening_system.md`**（新增，登记 `PROMPT_REGISTRY`，管理页可在线编辑；文案由本项目起草初稿、联调迭代）。内容边界：

- **人设段**：与 `tarot_system.md` 首段同一占卜师人设（复写保持口吻一致，接受这点重复）
- **迎接规范**：短句、留白；禁菜单式列举 / 禁 emoji / 禁口号 / 禁过度热情；新客与回头客变体由关系上下文区分；回头客**明令禁止主动翻旧话题**
- **共情确认**：用户说出问题后第一拍先接情绪，不跳任务
- **读人判据**：四类目标的措辞判据表、情绪浓度判断、节奏容忍度（用户催抽牌 → 立即用现有信息交单，pacing=快）
- **叙事性澄清**：一次只问一个开放问题；预算 0–2 轮；措辞已清晰 → 0 轮直接交单
- **牌阵选型表**：问题类型 × 目标类型 → 牌阵与各位置含义（策略的物化，当前完全空白的一块）
- **交单纪律**：判断完成即调 `submit_reading_brief`；分类结论绝不外露；交单后不再说话（过渡语由解读 Agent 说）

**工具集**：opening 相位只有 `submit_reading_brief`——看不见抽牌/星盘工具，机械杜绝"没读人先抽牌"。

**关系元数据**（代码计算，随提示词注入，无新存储）：昵称、第几次来访、距上次会话天数。详见 §8。

**开场白生成**：两个 router 的空消息分支由硬编码模板改为一次无工具轻量 LLM 调用（opening 提示词 + 关系上下文，短输出，同模型）；**调用失败降级回现有模板**（保底不坏）。开场白照旧存为 assistant 消息。

## 7. 预算守卫：三层强制交单

治"祈使句不可靠"的老病，一层比一层硬：

1. **提示词纪律（软）**：`opening_system.md` 写明预算与交单时机。正常路径绝大多数在这层完成。
2. **API 机械强制（硬）**：代码判定——opening 相位 且 用户消息数 ≥ 3（阈值进 `config.py`）且未交单 → 该轮 Gemini 调用带 `tool_config = {"function_calling_config": {"mode": "ANY", "allowed_function_names": ["submit_reading_brief"]}}`。`mode="ANY"` 是解码层约束：**该轮禁止纯文本输出，只能产出交单调用**。同时注入一行说明（"澄清预算已用尽，用现有信息交单，不确定字段按最可能值填"）保证被强制时字段质量不崩。交单后同轮进 reading 相位，恢复 `mode="AUTO"`。
3. **harness 兜底（确定性下界）**：用户消息数 ≥ 5 仍无策略单（第 2 层因 SDK/网络异常未走成）→ 代码直接翻 `phase="reading"`，`strategy` 保持 None（不伪造假策略单）。约 10 行，预期永不触发，但保证**数学上不存在卡死在开场幕的会话**。

## 8. context_service.py（新增，约 120–150 行，纯逻辑）

"相位"概念的唯一权威——提示词选择、工具集选择、function_executor 分支、守卫计数四处全调它，不各自判断。

**1. `build_relationship_meta(user_id, current_conversation_id)`**：一条 SQL，不加载会话全文：

```sql
SELECT COUNT(*), MAX(updated_at) FROM conversations
WHERE user_id = ? AND conversation_id != ?
  AND json_array_length(data,'$.messages') > 1   -- 排除只有开场白的空会话
  AND json_extract(data,'$.session_type') IN ('tarot','astrology')  -- 排除每日一签
```

> **实施期修正**：最初漏了 session_type 过滤。每日一签每天都建一个会话，导致连续签到 7 天的用户**第一次**开塔罗时被渲染成"来访：第 8 次｜距上次：1 天"——占卜师对陌生人说"又来啦"，正是本设计要防的"认人露馅"。

产出 visit_count（COUNT+1）、days_since_last、昵称，渲染为注入块：

```
<关系上下文>
称呼：小夏 ｜ 来访：第 4 次 ｜ 距上次：11 天
（回头客：熟人语气，不主动提及任何旧话题）
```

COUNT=0 → 新客变体。排除空会话防止"点开又关"刷高次数——否则第 2 次真正来的人被叫"第 5 次来访"，认人露馅。

**2. `get_phase(conversation)`**：读 `phase` 字段 + session_type 门控（非塔罗/占星恒为 reading）。价值在单一出口，杜绝"路由认为在开场、工具集却给了抽牌"的分裂。

**3. `render_brief_block(strategy)`**：dict → 固定顺序中文块，缺字段跳过，None 返回空串：

```
<本场策略单>（内部参考，绝不向用户外露）
目标类型：求认同 ｜ 情绪浓度：高 ｜ 节奏：深
背景：上周男友突然冷淡，用户反复回看聊天记录…
想带走：确认这段关系还值不值得等
路线：塔罗优先 ｜ 牌阵：三张关系阵（现状/他的态度/流向） ｜ 解读策略：验证式
```

**4. 两个相位的提示词拼装**收拢至此（开场 = opening_system + 关系上下文 + 入口类型（塔罗/占星，作为 tool_route 的默认偏好）+ 守卫指令；解读 = 现有系统提示词 + 用户资料 + 策略单块 + **接场约束**），`gemini_service._format_messages_for_gemini()` 的内联拼装逻辑迁入。

> **实施期新增「接场约束」**：`tarot_system.md` / `astrology_system.md` 里写着"首次对话先欢迎用户"和"意图模糊时参数化澄清（问哪方面、时间跨度）"——后者正是本设计要消灭的填表式澄清。移交后这两条会与开场幕**直接打架**（100% 的新会话都走这条路，原计划"联调后视情况删两句"实为必做）。解决方式不动那两份提示词，而是在 `build_reading_prompt()` 中：策略单非空时追加一段约束，宣告"开场/迎接/澄清已完成，上述两条本场失效；`submit_reading_brief` 仅在用户彻底换议题时才重调"。策略单为空（存量会话）→ 不追加任何东西，行为与改动前逐字一致。

## 9. 策略单 schema（submit_reading_brief 九字段）

| 字段 | 取值 |
|---|---|
| question_topic | 感情 / 事业 / 财务 / 自我成长 / 综合 / 玄学知识 |
| user_goal | 求认同 / 辅助决策 / 看清现状 / 探索好奇 |
| emotional_intensity | 低 / 中 / 高 |
| context_summary | 2–3 句：用户叙事背景（发生了什么） |
| desired_takeaway | 一句话：用户想带走什么 |
| tool_route | 塔罗优先 / 星盘优先 / 结合（默认 = 入口偏好） |
| suggested_spread | 牌阵名 + 各位置含义（塔罗路线时） |
| reading_strategy | 验证式 / 决策式 / 探索式 |
| pacing | 快（少铺垫） / 深（愿意聊） |

必填字段（question_topic / user_goal / emotional_intensity / reading_strategy）由 Gemini 的 `required` schema 保证。**不做额外字段校验**：缺失字段由渲染器直接跳过（`render_brief_block`），不会造成故障——加校验层是过度设计。

## 10. 改动面清单

| 位置 | 改动 |
|---|---|
| `prompts/opening_system.md` | **新增**（含人设复写、读人判据、牌阵选型表；本项目起草初稿） |
| `services/prompt_service.py` | `PROMPT_REGISTRY` 登记 1 个新提示词 |
| `services/context_service.py` | **新增**：关系元数据、相位判定、策略单渲染、提示词拼装 |
| `services/gemini_service.py` | 相位选提示词与工具集；新增 `submit_reading_brief` 声明；loop 内移交重建 chat；守卫轮 tool_config |
| `routers/tarot.py` / `astrology.py` | 开场白分支改 LLM 生成+模板降级；function_executor 加交单分支 |
| `routers/conversations.py` | 创建会话时按 session_type 写入 phase 初值 |
| `models.py` | Conversation 加 `phase` / `strategy` 两字段 |
| `config.py` | 守卫阈值（2 层 / 3 层）配置 |
| `prompts/tarot_system.md`、`astrology_system.md` | 不动（澄清段落与新流程轻微冗余，联调后视情况删两句） |
| `services/storage_service.py` | `list_conversations_admin` 带出 phase（后台可见卡在开场幕的会话） |
| `pages/admin/ConversationsPanel.tsx` + `adminApi.ts` + `admin.css` | 会话列表开场幕徽标 + 详情页策略单卡片（"它当时凭什么这么解读"终于可见） |
| 用户端前端 | **零改动**（SSE 契约、抽牌事件、开场白触发约定全不变） |
| Prompt 管理面板 | **零改动**——由 `PROMPT_REGISTRY` 驱动，登记后自动多出可编辑条目 |

成本：移交轮 +1 次模型往返（每场一次）；开场白由免费模板变为一次短 LLM 调用；opening 相位提示词远小于塔罗大提示词，token 反而更省。

## 10.5 额度与成本（实施期新增决策）

开场白从"零成本本地模板"变成"真实 LLM 调用"后，原先"开场白不扣额度"的约定变成了**一个无限免费调用 Gemini 的洞**——`POST /api/conversations` 本身不限流，`建会话 → 发空消息拿开场白` 可无限循环，游客 token 即可跑。

**决策**：`RateLimitService.check_and_consume()` 提到开场白分支之前（开场白是 LLM 调用，就该计费）；同时游客每日上限 **10 → 15**，补偿开场幕新增的开销（开场白 1 条 + 澄清 0–2 条），保证一场完整占卜仍能跑完。注册用户上限本就宽松（50），不动。

## 11. 错误处理与降级

- 开场白 LLM 失败 → 现有模板兜底。**超时同样兜底**：`request_options={"timeout": 8}`（`config.OPENING_GREETING_TIMEOUT_SECONDS`）——降级只兜异常不兜挂起，而开场白是全 App 的第一印象，卡住 = 永久转圈。
- 移交重建 chat 失败 → 该轮以策略单已落库结束，下轮自然进 reading 相位（用户只感觉停顿了一下）。
- 模型不交单 → 三层守卫（§7）。
- 策略单字段非法 → 重试一次后截断收录。
- 若 Gemini SDK 对跨 chat 的 function_response 配对有约束（实现期第一验证点）→ 退化方案：移交轮由 harness 直接结束输出，下轮进 reading——体验略降但可用。

## 12. 测试与验证

- **单测**（mock Gemini / TAROT_DB_FILE 临时库，不碰 `data/`）：相位路由（含存量会话默认 reading、每日一签门控）、phase 初值写入、守卫 2/3 层触发、交单落库与改判覆盖、开场白降级、移交后历史重建的 function_call/response 配对、关系元数据 SQL（空会话排除）。
- **联调重点（人工）**：口吻一致性（移交前后盲测无断裂感）、回头客不翻旧账、催抽牌路径（立即交单）、高情绪共情轮、守卫强制交单的字段质量。

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 移交前后口吻断裂 | 同模型 + 人设段复写 + 联调盲测（**当前头号风险**） |
| 模型不交单 / 交单时机差 | 小提示词单一职责 + 三层守卫 |
| ~~跨 chat 重建的 SDK 兼容性~~ | **已消除**：历史全为纯文本，无工具调用配对问题（§4） |
| 开场白 LLM 延迟/失败 | 短输出 + 模板降级 |
| 提示词文案不达"无人机感"标准 | 管理页在线编辑热加载，联调快速迭代 |

## 13.5 实施结果（2026-07-14 完成，分支 feat/opening-agent）

152 个后端测试通过，前端 build 通过。实施期相对本设计的**六处修正**（均已回写到上文对应章节）：

1. **限流洞**（严重）：开场白绕过限流 = 无限免费 LLM 调用 → `check_and_consume` 前置 + 游客上限 15（§10.5）。
2. **每日一签污染来访次数**（严重）：新用户被当老客 → SQL 加 session_type 过滤（§8）。
3. **解读提示词与开场幕打架**（重要）：移交后仍命令"欢迎用户 + 参数化澄清" → `build_reading_prompt` 注入接场约束（§8）。
4. **开场白无超时**（重要）：降级兜异常不兜挂起 → 8 秒超时（§11）。
5. **`OPENING_PHASE_SESSIONS` 定义两份**（重要）："唯一权威"的规矩没守住，分叉时静默故障 → 收归 context_service。
6. **移交时连续两个 user turn**（重要）：history 以用户澄清结尾 + 移交指令(user)，模型可能把移交指令当用户的话来回应 → history 末尾补一条 model 确认语，沿用本文件既有惯例（系统提示词后的"我明白了。"、抽牌结果后的"我看到了…"）。

另修掉一个既有 bug（`done` 事件可能发两次 → assistant 消息重复落库）、删除死代码 `continue_with_function_result`（93 行，全仓无调用方）。

**唯一的测试盲区**：Gemini SDK 对"移交时重建 chat"的真实行为（尤其角色交替）在 mock 下看不见。**合并前必须用真 key 手动跑一次完整链路**（见 §12 联调清单）。

## 14. 与原设计稿的关系及后续衔接

- 取代原稿 P2（接场块 / 读人块 / set_reading_strategy）。原稿已加标注。
- P1（画像卡 + 记忆 Agent）解耦并行：上线后画像卡注入**解读 Agent**（增强深度），不注入迎接；记忆 Agent 可将策略单纳入沉淀素材（user_goal 的长期分布本身是画像）。
- P3 关系环不受影响，钩子消费方案不变。
