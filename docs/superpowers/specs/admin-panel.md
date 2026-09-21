# 后台管理页

`/admin`，与主站同一个 React app 的懒加载路由（独立 chunk，主站 bundle 不受影响）。
UI 从简，不做视觉投入。

**开关**：`ADMIN_PASSWORD` 未配置 = 后台整体关闭，所有 `/api/admin/*` 返回 404。

---

## 1. 鉴权

单密码登录 → 签发 `role=admin` 的 JWT（有效期 `ADMIN_TOKEN_EXPIRE_MINUTES`，默认 24 小时），
不动用户表。admin token 存独立 localStorage key，`services/adminApi.ts` 用独立 axios 实例
只对 `/api/admin/*` 带它——与用户态完全隔离。401 / 403 → 清 token 回登录。

---

## 2. 接口

| 接口 | 作用 |
|---|---|
| `POST /login` | 密码换 admin token |
| `GET /stats` | 概览指标（只算正常会话，不含已归档） |
| `GET /conversations?limit&offset&type` | 全局会话分页（倒序，可按类型过滤，带开场幕相位）。用户删掉后归档的也在里面，和正常会话同一个顺序，带 `archived_at` |
| `GET /conversations/{id}` | 完整会话（含 messages），供详情渲染；已归档的也能取，带 `archived_at` |
| `GET /users?limit&offset` | 用户列表 + 每人会话数 + 最后活跃时间（不含已归档） |
| `GET /usage` · `DELETE /usage/{user_id}` | 今日各身份已用 LLM 次数 + 限额；按人清零 |
| `GET /prompts` | 整页一次取全：`items`（每份的生效内容 / 是否覆盖 / 更新时间 / 字符数）+ `stages`（按阶段分组的全部调用点） |
| `PUT /prompts/{name}` · `DELETE /prompts/{name}` | 保存覆盖（原子写 + `.bak`）· 重置为默认 |
| `GET /llm` · `PUT /llm/{agent}` · `DELETE /llm/{agent}` | 三个 Agent 的 provider / model 现状与可选清单 · 覆盖 · 撤销覆盖 |

`StorageService` 只增只读查询，沿用现有影子列（`user_id` / `updated_at`）索引，**不改表结构**。

---

## 3. Prompt 外置

### 双层文件

- `backend/prompts/*.md` — 仓库内**默认版**，随代码部署
- `backend/data/prompts/*.md` — 管理页保存的**覆盖版**，gitignored

读取时覆盖版优先，**每次请求实时读盘**：编辑即生效，无需重启；`git pull` 不会冲掉线上修改。

**白名单** `PROMPT_REGISTRY`（防路径穿越，新增 prompt 在此登记）：
`tarot_system` / `astrology_system` / `opening_persona` / `opening_system` / `opening_greeting` /
`opening_spread_catalog` / `spread_*`（一副阵一份）/ `reading_handoff` / `portrait_usage` /
`notebook_system` / `daily_oracle_system` / `daily_journey`。

**写入安全**：原子写（tmp + `os.replace`）、保存前旧内容存同名 `.bak`（单版本回退）、
文件名白名单校验、内容上限 100KB、不允许存空内容。

### 唯一视图：怎么拼出来的

没有单独的编辑页。左栏按阶段（**开场幕 / 解读 / 每日一签 / 笔记本**）分组，
列出这一段用到的文件；右侧摊开这一阶段每次模型调用的完整输入，按实际发送顺序列出各段：

- **接到 .md 的地方就是那份文件的编辑框**（等宽 textarea + 保存二次确认 / 重置为默认）。
  同一份文件在一页里出现两次就是两个框，共用一份草稿、互相同步，后出现的默认收起。
  只用到文件里某一节的位置，先给出这一处真正发出去的那段，再给整份的编辑框。
- **代码拼进去的段**（用户点开的入口 / 称呼与来访次数 / 用户资料 / 用户画像 / 本场起手）标明是
  「写死的文字」还是「示例数据」；模板文件的 `{变量}` 原样留在正文里，填进去的示例值列在编辑框下面。
- **分支分两类各自成标**：`条件` = 满足什么才有这一段（注册用户才有 / 开场幕交过单才有 /
  起手单走塔罗才有，卡片上另有虚线金边）；`形态` = 每次都有但长得不一样
  （本命星盘三种状态、第 1 次来访没有「距上次」…）。
- 另有发给哪个 Agent / 模型、可用工具、其后接的会话历史。

**来源是运行时代码本身**：`services/prompt_assembly.py` 直接调拼装函数
（它们产出带出处的 `prompt_service.Part`，运行时 join 发出、管理页原样展示），
不另写说明，拼装改了展示自动跟着变。

编辑框和「组成」是同一个界面，所以 `GET /prompts` 一个请求返回全量、保存后整体重取——
分开取会让两边对不上（改了 A 文件，B 调用里嵌的那份还是旧的）。

**新增 prompt 或调用点**：在 `_call_sites()` 登记并选一个 `_STAGES`，
`tests/test_prompt_assembly.py` 检查每次调用都落在某个阶段下、每份登记的提示词都能被找到。

---

## 4. 模型管理

与提示词同构的双层：`.env` 是默认，`backend/data/llm_agents.json` 是管理页写的覆盖层
（gitignored），每次 `get_provider` 实时读盘，改完下一次请求即生效。

覆盖只存**改过的** Agent——没改过的不写进去，这样 `.env` 换了默认值，
没被覆盖的 Agent 会跟着动，不会被一份陈旧快照钉死。

思考强度（`*_REASONING_EFFORT`）只有 `.env` 这一层，管理页不覆盖。

---

## 5. 页面

| 页 | 内容 |
|---|---|
| 登录 | 单密码输入框 |
| 概览 | 指标数字一排 |
| 会话 | 左列表（倒序 / 类型筛选 / 分页）+ 右详情（气泡区分角色，塔罗牌消息显示牌名 + 正逆位，开场幕会话带起手单卡片）；用户删掉的会话在列表和详情里标「已归档」；窄屏堆叠 |
| Prompt | §3 的单一视图 |
| 模型 | 三个 Agent 各自选 provider / model，可撤销回 `.env` |
| 用量 | 今日计数表，可按人清零 |

---

## 6. 明确不做

删除用户 / 会话、恢复已归档会话、prompt 多版本历史与 diff、prompt 在线试跑、每日一签与钱包的运营面板、操作审计日志。

---

## 7. 代码在哪

| 文件 | 管什么 |
|---|---|
| `routers/admin.py` | 全部管理接口 |
| `services/prompt_service.py` | 双层读取、白名单、原子写、`Part` 契约 |
| `services/prompt_assembly.py` | 阶段分组与调用点（管理页视图的唯一来源） |
| `services/llm/agent_config.py` · `catalog.py` | 模型覆盖层 · 可选 provider/model 清单 |
| `pages/admin/` | 登录、概览、会话、Prompt、模型、用量各面板 |
| `services/adminApi.ts` | 独立 axios 实例 + admin token |
