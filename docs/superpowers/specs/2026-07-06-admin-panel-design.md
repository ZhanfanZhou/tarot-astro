# 后台管理页面 + Prompt 全面外置 — 设计文档

日期：2026-07-06
状态：已与用户确认

## 背景与目标

个人塔罗/占星应用，部署在 EC2 T3 nano（Nginx + FastAPI:8000 + SQLite/JSON 混合存储）。需要一个**轻量级**后台管理页面：

1. 查看最近所有会话记录（游客 + 注册用户，二者同库存于 `app.db`）
2. 在线修改 prompt，改完即生效
3. 基础管理：用户列表 + 概览指标、用量/限流查看

明确不做：删除操作、每日一签/钱包运营数据、任何重型依赖。

### 现状问题（本设计一并解决）

- Prompt 一半热加载（`prompts/daily_*.md`）、一半硬编码在代码里（塔罗/占星/笔记本三个主 prompt），调 prompt 靠改代码提交（近期 commit "change prompt" ×2 即痛点）。
- **线上 bug**：`gemini_service.py` 中 `ASTROLOGY_SYSTEM_PROMPT` 定义两次（:207 真提示词、:281 测试提示词），后者生效——**当前占星会话跑的是测试 prompt**。本次外置时以 :207 为准，删除 :281（git 历史可找回）。
- `notebook_service.NOTEBOOK_PROMPT` 用 `str.format` 填变量，正文含孤立花括号会崩；统一为 `str.replace("{key}")` 方式。

## 关键决策（已确认）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 云端 vs 本地 | **云端 `/admin`**，同域同进程 | prompt 文件和 SQLite 都在 EC2，管理 API 必须在服务端；本地方案省不掉服务端改造，只失去随时随地可用。防护用独立密码 + admin JWT + 限流，个人项目足够 |
| 实现路线 | **同一 React app + `/admin` 懒加载路由** | 一套技术栈，复用 axios/构建链；code-split 后主站 bundle 不变 |
| Admin 鉴权 | **`ADMIN_PASSWORD`（env）+ JWT role=admin** | 不动用户表；改密码改 env 重启即可；未配置 = 功能整体关闭（404） |
| UI 投入 | **从简**：能顺手复用现有组件就复用，否则最朴素的功能性界面 | 用户明确要求，不做视觉投入 |
| 游客数据 | 只读查看，不做清理/留存策略 | 沿用上轮迁移决策 |

## 一、Prompt 外置（新 `services/prompt_service.py`）

### 双层文件机制

- `backend/prompts/*.md` — 仓库内**默认版**（checked in，随代码部署）
- `backend/data/prompts/*.md` — 管理页保存的**覆盖版**（gitignored 运行时数据）
- 读取：override 存在则用之，否则用默认。每次请求实时读盘（沿用 daily 模式），**编辑即生效，无需重启**；`git pull` 部署不会冲掉线上修改。

### 外置清单（5 个，白名单即此表）

| 文件名 | 来源 | 变量占位符 |
|---|---|---|
| `tarot_system.md` | `gemini_service.TAROT_SYSTEM_PROMPT`（:123 搬出） | 无（用户上下文仍代码拼接） |
| `astrology_system.md` | `ASTROLOGY_SYSTEM_PROMPT` **以 :207 真提示词为准**，删 :281 测试版 | 无 |
| `notebook_system.md` | `notebook_service.NOTEBOOK_PROMPT` | `{conversation_text}` 等，改用 replace 填充 |
| `daily_oracle_system.md` | 已存在 | 现有占位符不变 |
| `daily_journey.md` | 已存在 | 现有占位符不变 |

`daily_service.render_template` 迁移/收敛进 `prompt_service`，全应用一个 prompt 入口。

### 写入安全

- 原子写：tmp 文件 + `os.replace`
- 保存前旧内容存同名 `.bak`（单版本回退）
- 文件名白名单校验（防路径穿越）、内容上限 100KB、不允许存空内容
- 「重置为默认」= 删除 override 文件

### 加载失败语义

默认 + override 均缺失 → 抛错返回 500（带文件名），**绝不静默用空 prompt 喂 Gemini**。

## 二、Admin API（新 `routers/admin.py`，前缀 `/api/admin`）

### 鉴权

- `POST /login` `{password}` → 与 env `ADMIN_PASSWORD` 恒时比较（`secrets.compare_digest`）→ 签发 JWT（`sub="admin"`, `role="admin"`，复用 `auth_service`，有效期 24h，可 env 覆盖）。
- 登录防爆破：**进程内简单失败计数**（如连续失败 5 次锁 60 秒），不复用 `rate_limit_service`（那是按身份计 LLM 次数的，语义不符）。单 worker 部署下进程内状态即可靠。
- 依赖 `require_admin`：仅认 `role=admin` 的 token；普通用户 token 403。
- **env 未配置 `ADMIN_PASSWORD` → 所有 admin 路由 404**（功能开关）。

### 接口面

| 接口 | 说明 |
|---|---|
| `GET /stats` | 总用户数、游客/注册分布、总会话数、今日新会话、今日消息数（SQL count） |
| `GET /conversations?limit&offset&session_type&user_id` | 全局摘要列表，`updated_at` 倒序：id、user_id、用户昵称/用户名、type、title、消息数、更新时间。**不含消息全文**。`session_type` 过滤用 `json_extract`（数据量小，不加影子列） |
| `GET /conversations/{id}` | 完整 Conversation（含 messages），供详情渲染 |
| `GET /users?limit&offset` | 用户列表 + 每人会话数（LEFT JOIN count）+ 最后活跃时间 |
| `GET /usage` | 今日各身份已用 LLM 次数（usage.json）+ 限额配置 |
| `GET /prompts` | 清单：name、是否已覆盖默认、更新时间、字符数 |
| `GET /prompts/{name}` | 当前生效内容 + 默认内容 + 是否覆盖 |
| `PUT /prompts/{name}` `{content}` | 保存 override（原子写 + .bak） |
| `DELETE /prompts/{name}` | 重置为默认（删 override） |

`StorageService` 增补只读查询：全局会话分页（可选过滤）、用户列表带会话数、各类 count。沿用现有影子列（`user_id`/`updated_at`）索引，**不改表结构**。

## 三、前端（`/admin` 懒加载路由，UI 从简）

- `main.tsx`：`<Route path="/admin/*" element={<AdminApp/>}>`，`React.lazy` code-split，主站 bundle 不受影响。
- admin token 存独立 localStorage key；独立 axios 实例只对 `/api/admin/*` 带 admin token——与用户态完全隔离。
- 页面（能复用现有组件就复用，否则最简功能性界面）：
  - **登录**：单密码输入框。
  - **概览**：指标数字一排。
  - **会话**（核心）：左列表（倒序、类型筛选、分页）+ 右详情（气泡区分 user/assistant，塔罗牌消息显示牌名+正逆位）；窄屏堆叠。
  - **Prompt**：文件列表（覆盖徽标+更新时间）→ 等宽 textarea 编辑 → 保存（二次确认）/ 重置为默认。
  - **用量**：今日计数表。

## 四、错误处理

- 前端：401/403 → 清 admin token 回登录；保存失败/超限明确报错；详情拉取失败可重试。
- 后端：prompt 缺失 500 带文件名；写入失败不留半截文件（原子写保证）。

## 五、测试与验证

- pytest（tmp_path/临时库，照例不碰 `data/`）：
  - 登录：正确/错误密码、未配置 ADMIN_PASSWORD 时 404
  - `require_admin`：普通用户 token 被拒
  - prompts CRUD：白名单、原子写、.bak、重置
  - conversations/users：分页、过滤、倒序
  - **搬运一致性**：外置后 gemini_service/notebook_service 实际取到的 prompt 与原硬编码逐字一致（占星取 :207 版本）
- 前端验证：`npm run build`（lint 全仓坏，不用）。

## 六、部署（EC2 步骤）

1. `.env` 加 `ADMIN_PASSWORD=<强密码>`
2. `git pull` + 重启后端（prompt 默认文件随代码到位）
3. Nginx **零改动**（SPA fallback 已存在，`/showcase` 可直达即证明）；无新进程/端口，T3 nano 内存增量≈0
4. `.gitignore` 加 `backend/data/prompts/`

## 范围外（明确不做）

删除用户/会话、prompt 多版本历史、diff 视图、prompt 在线试跑、每日一签/钱包运营面板、操作审计日志。
