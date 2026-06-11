# 每日一签 · 心灵奇旅 (Daily Oracle) — Design Spec

Date: 2026-06-11
Scope: 前后端新特性。殿堂主页新增每日日运入口;弹窗内回看两周、抽牌、流式解读、印证反馈、可延续为占卜对话;以连续天数 + 串联解读 + 用户触发的"心灵奇旅"叙事提升复访黏性。
Style: 遵循 "Astral Atelier" 设计体系(近黑 `#06060f` + 古金 `#C9A96E` + 月光蓝 `#A8D8EA` + 象牙白衬线),`/showcase` 为视觉基准。

## 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| 抽牌频次 | 每"生效日"仅一次,不可重抽 |
| 生效日规则 | 按浏览器本地时间:18:00 前抽算今天,18:00 后算明天("晚上为明日求签") |
| 牌阵 | 单张牌 |
| 解读上下文 | 最近 7 次日运记录(最远回溯 14 天,不足 7 次按实际次数)+ 用户资料,**不读对话正文** |
| 反馈机制 | 双轨:日历回访"印证"控件(应验/没感觉+一句话)+ 继续聊天经 notebook 沉淀 |
| 对话建模 | 每日一个独立对话,新增 `SessionType.DAILY` |
| 入口形态 | 独立仪式横幅,与牌廊横幅同宽,叠放在牌廊**下方** |
| 弹窗布局 | 单列纵向:顶部 14 格日历带 + 主体"今日舞台" |
| 故事机制(首版) | streak 连续天数 + 串联解读 + 日历回看 + **用户主动触发**的心灵奇旅叙事(不自动定期生成) |
| 提示词 | 不写死代码,放 `backend/prompts/` 模板文件,每次请求实时读取(改完即生效,无需重启) |

## 架构总览

**日运记录是轻量索引,重内容全部活在对话系统里。** 解读文字、后续聊天、笔记沉淀复用现有 conversation + notebook 机制;新增存储只记"哪天抽了什么牌、反馈如何"。

```
殿堂主页
 └─ DailyOracleBanner(未抽:呼吸牌背 / 已抽:今日牌面+签语 / streak 徽记)
     └─ DailyOracleModal
         ├─ 14 格日历带(回看 + 印证反馈)
         ├─ 今日舞台(抽牌按钮 → 复用全屏 TarotCardDrawer → 牌面揭示 + SSE 流式解读)
         ├─ 「继续这段对话 ›」→ 关弹窗,daily 对话设为当前会话,进入聊天
         └─ 「回望这段旅程 ✦」→ SSE 流式心灵奇旅叙事(同日缓存)
```

抽牌-解读链路复用现状:选牌器是纯仪式 UI(用户选择不决定牌面),真实牌由服务端随机;解读由前端发固定消息「请根据抽牌结果进行解读」走 `/api/tarot/message` SSE 触发,`should_attach_tarot_cards` 机制把牌面附到 AI 消息上。daily 完整沿用这条链路。

## 后端

### 数据模型(models.py)

- `SessionType` 新增 `DAILY = "daily"`。
- 新增:

```python
class DailyFeedback(BaseModel):
    verdict: Optional[Literal["hit", "miss"]] = None   # 应验了 / 没感觉
    note: Optional[str] = None                          # 一句话附言,存全文不截断
    fed_back_at: Optional[str] = None

class DailyDrawRecord(BaseModel):
    effective_date: str            # "YYYY-MM-DD",用户本地生效日
    card: TarotCard
    conversation_id: str
    drawn_at: str                  # ISO UTC
    feedback: DailyFeedback = DailyFeedback()
```

### 存储(`backend/data/daily_draws.json`)

沿用 StorageService 的 JSON 文件模式,新文件结构:

```json
{
  "<user_id>": {
    "records": { "<effective_date>": { ...DailyDrawRecord } },
    "journey_cache": { "generated_on": "YYYY-MM-DD", "text": "..." }
  }
}
```

- 一日一条,以 effective_date 为键天然去重。
- **streak 不落库**,读取时从 records 倒推:从"今日生效日"(若今日未抽则从昨日)起连续有记录的天数。

### 新路由 `backend/routers/daily.py` + 新服务 `backend/services/daily_service.py`

| 接口 | 行为 |
|---|---|
| `GET /api/daily/{user_id}/overview?date=YYYY-MM-DD` | `date` 为前端算出的今日生效日。返回 `{today_record\|null, streak, history: [近14天逐日 {effective_date, record?, tagline?, conversation_exists}]}`。tagline(签语)从对应对话首条 assistant 消息懒取首句(~30 字),不冗余存储;对话已删则 `conversation_exists=false`、tagline 为空 |
| `POST /api/daily/{user_id}/draw` body `{effective_date}` | ① 校验该日无记录(有则 409)且与服务器日期偏差 ≤1 天(否则 422);② 创建 `session_type=daily` 对话,标题「M月D日 · 每日一签」;③ 服务端随机抽 1 张(复用 `TarotService.draw_cards`,single 牌阵,position「今日指引」),以 SYSTEM 消息「用户已完成抽牌」+ tarot_cards 写入对话(与现有 `/api/tarot/draw` 一致);④ 落 DailyDrawRecord;⑤ 返回 `{record, conversation_id}`。**不在此生成解读**——前端随后走现有 `/api/tarot/message` SSE |
| `POST /api/daily/{user_id}/feedback` body `{effective_date, verdict, note}` | 更新该日 feedback;近 14 天内任意有记录的日期均可印证/修改 |
| `POST /api/daily/{user_id}/journey?force=false` | 流式(SSE)生成心灵奇旅叙事。上下文 = 近 14 天记录+反馈 + 这些 daily 对话的 notebook 笔记(有则带)。`journey_cache.generated_on == 今日` 且非 force 时直接回放缓存文本(不花 token);生成成功后更新缓存 |

main.py 注册路由。对话的 get / exit / delete、notebook 退出沉淀调度均零改动(daily 对话天然享受)。

### 提示词模板机制(新目录 `backend/prompts/`)

- `daily_oracle_system.md` — 每日解读系统提示词。占位符:`{nickname}` `{birth_info}` `{today_date}` `{today_card}` `{history_block}`。
- `daily_journey.md` — 心灵奇旅叙事提示词。占位符:`{nickname}` `{history_block}` `{notebook_block}` `{date_range}`。
- **每次请求时实时读文件并渲染**(个人应用 IO 可忽略),编辑模板保存后下一次请求立即生效,无需重启——这就是调试方式。文件缺失时抛出明确错误(启动时校验存在性)。
- `{history_block}` 由 daily_service 从 `daily_draws.json` 生成。窗口规则:取**最近 7 次**日运记录,最远回溯 14 天(14 天内不足 7 次则按实际次数;0 次时该块为「这是旅程的第一签」)。每条记录一行:`6月10日 | 宝剑三·逆位 | 印证:应验了 | 附言:确实和同事起了争执`;未反馈显示「未印证」;附言存全文、不截断。**只读日运记录,不读对话正文**(聊天细节由 notebook 沉淀,仅 journey 使用)。journey 的 `{history_block}` 不受此窗口限制,仍用近 14 天全量记录。
- 模板内容首版给出可用底稿:日运人设(简短温暖、有连续感,主动呼应近日牌面与用户印证,结尾留一个开放问题引导继续聊),journey 为第二人称旅程叙事。

### gemini_service 适配

`stream_response` 按 session_type 选提示词处增加 daily 分支:**每次请求**调用 daily_service 渲染 `daily_oracle_system.md`(而非创建对话时固化)。好处:模板热编辑对已有对话生效;"继续聊天"在之后任意一天发生时,history_block 始终是最新的。除提示词外,daily 走与 tarot 相同的 Agent Loop(function 工具集不变;模板中明示"今日牌已抽出,不要再调用 draw_tarot_cards")。

## 前端

### `DailyOracleBanner.tsx`(新,挂在 App.tsx 殿堂区 GalleryBanner 下方)

与牌廊横幅同宽(max-w-2xl 容器内)、稍矮(~88px),同构的玻璃面板 + 金线描边。

- **未抽态**:左侧一张牌背缩略(~44×72,同牌廊卡片规格),金色辉光以 4s 周期"呼吸"(box-shadow 脉动),hover 时牌背轻微上浮、横幅金边增亮(同 GalleryBanner 的 hover 范式);eyebrow「DAILY ORACLE」,主文案「今日一签 · 待启」,副文案「静心抽取,看看今天的指引」,右侧 CTA「抽取 ›」。18:00 后未抽时主文案变「为明日求一签」。
- **已抽态**:牌背 3D 翻转(framer-motion rotateY)为今日牌面缩略,显示「牌名 · 正/逆位」+ 签语首句(overview 的 tagline),CTA 变「查看今日指引 ›」,辉光停止呼吸、定格为静雅金边。
- **streak 徽记**:右上角「连续 N 天 ✦」细字(N≥2 才显示,避免"连续 1 天"的尴尬)。
- 数据:挂载时与窗口重新聚焦时调 `dailyApi.overview`(生效日按本地时间现算)。

### `DailyOracleModal.tsx`(新)

点横幅打开,居中弹窗(桌面 ~560px 宽,移动端近全屏),不离开主页。单列纵向:

1. **顶部日历带**:14 格横向(移动端可横滑),每格 = 星期缩写 + 日号 + 牌面缩略(未抽日为暗格「·」);今日金边高亮;逐格 stagger 浮现(40ms 间隔)。格子可点选。
2. **今日舞台**(默认选中今日):
   - 未抽:居中大牌背 + 按钮「静心 · 抽取今日指引」→ 唤起全屏 TarotCardDrawer;
   - 抽牌返回后:牌面翻转揭示 → 自动调 `/api/tarot/message`(content=「请根据抽牌结果进行解读」)流式打出解读文字(复用现有 SSE 渲染范式 + Markdown 组件);
   - 解读完成:出现「继续这段对话 ›」金色 CTA。
3. **回顾态**(点过往某日):该日牌面 + 签语 + 印证控件(「应验了 ✓」「没感觉 ◦」二选一 + 一句话输入,已反馈则显示当前值可修改)+「查看当日对话 ›」(对话已删则显示「这段对话已随风而逝」);
4. **「回望这段旅程 ✦」**:日历带右上角细字入口,点击后舞台区切换为叙事面板,文字流式缓慢渐显;同日重复点直接回放缓存,旁置小字「重新生成」(force=true)。

「继续这段对话」:关闭弹窗 → `conversationApi.get` 拉取该对话 → `setCurrentConversation`,无缝进入聊天界面(沿用 hub→conversation 的 AnimatePresence 过渡)。

### TarotCardDrawer 适度优化

不动核心交互(洗牌 + 扇形选牌),新增可选 props:

- `title` / `subtitle` 文案可定制(日运语境:「为今日抽取一张指引」);
- 单张场景(card_count=1)简化确认步骤:选中即翻牌确认,省去二次确认面板。

选牌结果仍是纯仪式——daily 的真实牌面来自 `POST /api/daily/draw` 的响应(调用时机:用户在选牌器中确认后,即现有 onCardsDrawn 的位置,由 modal 提供 daily 专用回调,不走 App.tsx 的会话抽牌回调)。

### 其余改动面

- `types`:SessionType 增 `DAILY`,新增 daily 相关类型。
- `services/api.ts`:新增 `dailyApi`(overview / draw / feedback / journey-SSE)。
- `Sidebar` / `TopBar` / `ChatMessage`:`daily` 类型的标签与图标适配(显示「日运」标识,渲染逻辑沿用 tarot 分支)。
- `App.tsx`:挂横幅 + 弹窗 + daily 抽牌回调;hub 不新增其他元素,纵向高度增量 ≈ 一条横幅。

## 边界与错误处理

- **重复抽取**:后端 409 → 前端 toast「今日已抽过」并静默刷新 overview 纠正状态(多标签页/多设备场景)。
- **跨天停留**:横幅与弹窗在 window focus 时重算生效日并拉 overview;18:00 边界穿越同理(文案与状态随 overview 刷新)。
- **解读中断**(SSE 断流/用户关弹窗):对话里已有牌面 SYSTEM 消息,记录已落;重新打开弹窗发现今日已抽但无解读(tagline 为空且对话无 assistant 消息)时,提供「重新生成解读」按钮重发解读消息。
- **删除 daily 对话**:记录保留(日历、牌面、反馈完整),回顾态解读区显示「这段对话已随风而逝」。
- **访客用户**:与注册用户同等支持(user_id 机制一致);访客转正后记录随 user_id 延续。
- **journey 无足够素材**(<3 天记录):入口置灰,hover 提示「再积累几天,旅程自会显形」。

## 验收清单

前端 `npm run build`(tsc+vite)通过(repo 的 lint 已知损坏,不使用);后端无测试框架,本地起服手动验证:

1. 首抽:殿堂横幅呼吸态 → 抽牌 → 弹窗揭示 + 流式解读 → 横幅变已抽态,日历今日有牌。
2. 同日重抽被拒:接口 409,前端状态自洽。
3. 17:59 / 18:01 各抽一次(改本地钟验证):分别落在今日/明日。
4. 次日回访:昨日格可印证,印证内容出现在今日解读的上下文中(查后端日志的渲染后提示词)。
5. 继续聊天:进入 daily 对话续聊,退出后 notebook 生成笔记;该笔记进入 journey 上下文。
6. journey:<3 天置灰;≥3 天可生成;同日二次点击命中缓存;force 重新生成。
7. 编辑 `prompts/daily_oracle_system.md` 保存后,下一次解读立即采用新模板(无需重启)。
8. 删除某 daily 对话后,日历回看不报错,显示降级文案。
9. 移动端(<1024px):横幅、弹窗、日历横滑、选牌器全链路可用。

## 二期候选(本版不做)

- 每日解读注入占卜笔记(notebook)摘要,个性化更深。
- 自动周期性旅程回顾(周报推送式)。
- 花星尘重抽 / 三张牌(晨午晚)偏好。
- streak 里程碑奖励(第 7/21 天赠星尘,接入现有钱包)。
