# CLAUDE.md

塔罗/占星/心灵陪伴应用。后端 FastAPI + SQLite(用户/会话) + JSON 文件(其余) + Gemini；前端 React+Vite+zustand。
快速地图，先定位再读文件。约定：JWT Bearer 鉴权（身份从 token 取）；对话走 SSE 流式 + Function Calling Agent Loop（多 provider）；数据在 `backend/data/`（用户+会话存 `app.db` SQLite/WAL，日运/钱包等仍 `*.json`；全部实时/gitignored/无备份，勿跑写测试，测试用临时库或 mock）。
会话记录按官方 API 形状存：`Message` 三种角色 user / assistant(tool_calls) / tool(tool_call_id)，重建历史逐条映射，不伪造任何 user/assistant 台词。抽牌、补资料是 interrupt 式工具：Loop 见到就收口，结果由 `/draw` 或 `/resume` 补写；前端的按钮从当前会话末尾的 `tool_calls` 推导（不另存状态）；含 `system` 记录的旧会话只读。

## backend/
- `main.py` FastAPI 装配 + CORS + 启动笔记定时调度器
- `config.py` 全局配置（路径/Gemini/JWT/限流/CORS）+ 塔罗牌表
- `models.py` Pydantic 数据模型
- `dependencies.py` 鉴权依赖（get_current_user / ensure_owner）
- routers/ 接口层
  - `users.py` 注册/登录/游客/资料/转正（签发 token）· `/{user_id}/token` 无密码迁移签发
  - `conversations.py` 会话 CRUD（创建时生成开场白）+ `/exit`（触发生成笔记）
  - `tarot.py` / `astrology.py` 薄壳：`/message` `/resume` `/draw` 都转 `turn_service`
  - `daily.py` 每日一签：抽签（服务端当场生成解读）/概览/印证/心灵奇旅（单次生成）
  - admin.py 后台管理(/api/admin:登录/概览/全局会话/用户/用量/prompt 在线编辑+组成查看;env ADMIN_PASSWORD 未配置则整体404)
  - `wallet.py` 钱包+商城 · `payments.py` 支付 · `decks.py` 牌组资源
- services/ 业务层
  - `turn_service.py` ★一轮对话：校验/收口 interrupt/扣额度/跑 Loop/逐条落库/SSE（塔罗占星共用）· `tool_turns.py` 工具轮落库形状、interrupt 结果、旧会话判定
  - `gemini_service.py` ★Agent Loop（按相位取 provider/提示词/工具集；yield content/message/done；SSE 只推正文）
  - `llm/` provider 抽象：`base.py` 中性消息契约 · `gemini_provider.py` / `openai_provider.py` · `tools.py` 工具规格唯一真源（含 INTERRUPT_TOOL_NAMES）· `catalog.py` `agent_config.py`
  - `conversation_service.py` 会话消息逻辑 · `storage_service.py` 用户+会话存取(SQLite) · `db.py` SQLite 连接/建表(aiosqlite+WAL)
  - prompt_service.py 提示词统一热加载(默认 prompts/*.md + 覆盖 data/prompts/,白名单见 PROMPT_REGISTRY,原子写+bak);拼装函数产出带出处的 `Part` 再 join
  - `prompt_assembly.py` 管理页「组成」视图:用示例数据调运行时拼装函数,列出每个 prompt 用在哪些调用、前后接了什么;新增 prompt/调用点在 `_call_sites()` 登记(测试会检查)
  - `user_service.py` 用户/密码 · `auth_service.py` JWT · `rate_limit_service.py` 限流
  - `daily_service.py` 每日一签逻辑 · `astrology_service.py` 星盘 API（阿卡比特宫位制；基本星盘=12 宫落座存 `User.natal_chart` 放进用户资料，改出生资料即删；详细星盘仍由工具调接口）· `tarot_service.py` 抽牌
  - `notebook_service.py` 笔记本（仅注册用户）= 一场一条的占卜笔记 + 一人一份的用户画像；一次调用出两样，笔记追加、画像按字段打补丁（模型只回要改的字段，每项的 `confirmed_at` 由代码写）；`build_transcript` 把会话记录逐条转写，只换格式不丢内容；画像由 `context_service` 每轮注入开场/解读提示词（空画像也出这一块，写明还没有印象；使用规则在 `prompts/portrait_usage.md`）；机制与待办见 `docs/superpowers/specs/2026-09-18-notebook-design.md` · `notebook_task_scheduler.py` 定时生成
  - `wallet_service.py` / `payment_service.py` / `store_storage.py` 商城支付
- prompts/*.md 全部系统提示词默认版(塔罗/占星/笔记本/每日×2;热加载;管理页可在线覆盖到 data/prompts/) · `data/` 运行时数据：`app.db`(用户+会话, SQLite/WAL) + 其余 `*.json`(日运/钱包/支付/笔记)
- `scripts/migrate_json_to_sqlite.py` 一次性迁移 users/conversations JSON→app.db · `scripts/migrate_tool_turns.py` 一次性把旧格式会话改成工具轮形状（可选；不跑则旧会话只读）· `scripts/check_providers.py` 真 key 联通自检 · `scripts/cleanup_guest_notebooks.py` 一次性删游客笔记本（默认只列出，`--apply` 才删）
- `tests/` 单元+集成测试（mock StorageService 或指向临时 DB，不碰 `data/`）

## frontend/src/
- `App.tsx` 主容器（会话状态 / 登录 / 弹窗编排）
- `services/api.ts` API 封装 + axios 拦截器 + SSE 解析
- `stores/` zustand：useAuthStore（用户+token）、useDeckWallet（钱包）
- `components/` 弹窗与 UI（AuthModal/CardDrawer/daily/wallet…）
- `pages/TarotShowcase.tsx` /showcase 设计参考 · `types/` 类型
- pages/admin/ 后台管理页(/admin 懒加载 chunk,独立 tarot_admin_token,services/adminApi.ts)

## 构建
后端 `./run_backend.sh`(:8000)、`source venv/bin/activate && cd backend && pytest`；前端 `./run_frontend.sh`(:5173)、验证用 `npm run build`（lint 全仓坏）。配置见根 `.env`。后台管理需 .env 配 ADMIN_PASSWORD（不配=功能关闭）。
