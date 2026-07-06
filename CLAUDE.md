# CLAUDE.md

塔罗/占星/心灵陪伴应用。后端 FastAPI + SQLite(用户/会话) + JSON 文件(其余) + Gemini；前端 React+Vite+zustand。
快速地图，先定位再读文件。约定：JWT Bearer 鉴权（身份从 token 取）；对话走 SSE 流式 + Gemini Function Calling Agent Loop；数据在 `backend/data/`（用户+会话存 `app.db` SQLite/WAL，日运/钱包等仍 `*.json`；全部实时/gitignored/无备份，勿跑写测试，测试用临时库或 mock）。

## backend/
- `main.py` FastAPI 装配 + CORS + 启动笔记定时调度器
- `config.py` 全局配置（路径/Gemini/JWT/限流/CORS）+ 塔罗牌表
- `models.py` Pydantic 数据模型
- `dependencies.py` 鉴权依赖（get_current_user / ensure_owner）
- routers/ 接口层
  - `users.py` 注册/登录/游客/资料/转正（签发 token）· `/{user_id}/token` 无密码迁移签发
  - `conversations.py` 会话 CRUD + `/exit`（触发生成笔记）
  - `tarot.py` 塔罗对话(SSE) + 抽牌
  - `astrology.py` 星座对话 + 抽牌 + 星盘
  - `daily.py` 每日一签：抽签/概览/印证/心灵奇旅
  - `wallet.py` 钱包+商城 · `payments.py` 支付 · `decks.py` 牌组资源
- services/ 业务层
  - `gemini_service.py` ★Gemini 封装 / 系统提示词 / 工具 / Agent Loop
  - `conversation_service.py` 会话消息逻辑 · `storage_service.py` 用户+会话存取(SQLite) · `db.py` SQLite 连接/建表(aiosqlite+WAL)
  - `user_service.py` 用户/密码 · `auth_service.py` JWT · `rate_limit_service.py` 限流
  - `daily_service.py` 每日一签逻辑 · `astrology_service.py` 星盘 API · `tarot_service.py` 抽牌
  - `notebook_service.py` 占卜笔记本 · `notebook_task_scheduler.py` 定时生成笔记
  - `wallet_service.py` / `payment_service.py` / `store_storage.py` 商城支付
- `prompts/*.md` 每日一签提示词（热加载） · `data/` 运行时数据：`app.db`(用户+会话, SQLite/WAL) + 其余 `*.json`(日运/钱包/支付/笔记)
- `scripts/migrate_json_to_sqlite.py` 一次性迁移 users/conversations JSON→app.db（只读源、自动备份、逐条校验零丢失）
- `tests/` 单元+集成测试（mock StorageService 或指向临时 DB，不碰 `data/`）

## frontend/src/
- `App.tsx` 主容器（会话状态 / 登录 / 弹窗编排）
- `services/api.ts` API 封装 + axios 拦截器 + SSE 解析
- `stores/` zustand：useAuthStore（用户+token）、useDeckWallet（钱包）
- `components/` 弹窗与 UI（AuthModal/CardDrawer/daily/wallet…）
- `pages/TarotShowcase.tsx` /showcase 设计参考 · `types/` 类型

## 构建
后端 `./run_backend.sh`(:8000)、`source venv/bin/activate && cd backend && pytest`；前端 `./run_frontend.sh`(:5173)、验证用 `npm run build`（lint 全仓坏）。配置见根 `.env`。
