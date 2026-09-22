# 鉴权与限流

---

## 1. JWT Bearer

- 签发：`auth_service.create_access_token(user_id, user_type)`，HS256，
  有效期 `ACCESS_TOKEN_EXPIRE_MINUTES`（默认 60 天——游客无法重新登录，所以给得长）。
- **身份全部从 token 解析，服务端不信任客户端传的 `user_id`。**

```
dependencies.get_current_user
  ├─ 无 token / 无效 / 过期 → 401
  └─ 解析成功 → 查库 → User 注入路由
        ↓
ensure_owner(current_user, target_user_id)  → 不匹配 403
```

公开端点（无需 token）：`POST /api/users/guest` `register` `login`，
以及无密码迁移端点 `POST /api/users/{user_id}/token`。其余全部受保护。

**无密码迁移端点**：localStorage 里只有 user 没有 token 的老用户，
前端启动时静默调用它换一个 token，用户无感。
`user_id` 是 UUIDv4、不可枚举，个人应用可接受；查不到就 404 静默忽略，
后续 401 自然踢出。

前端：`useAuthStore` 持久化 `user` + `token`；`services/api.ts` 的请求拦截器自动带
`Authorization: Bearer`，响应拦截器 401 → `logout()`。
SSE 端点不走 axios，用 `authHeaders()` 手动拼 header。

---

## 2. 每日用量限流

- 粒度：**user_id + 日期**（服务器本地日期），不做 IP 限流。
- 额度：游客 `GUEST_DAILY_MESSAGE_LIMIT` 默认 **15**，注册用户 `USER_DAILY_MESSAGE_LIMIT` 默认 **50**。
  游客可清缓存重置额度，所以额度宜小、主要额度绑到注册账号；
  15 这个数是为了让游客在有开场白（1 次）+ 澄清轮（0–1 次）的情况下仍能走完一场完整占卜。
- **计数**：每次真实 LLM 调用计一次，被拒的请求不计。旅程当天已写过、直接回放的不计。
- **拦截只在用户开口对话时**（`check_and_consume`，用完 → 429）：

  | 调用 | 用完额度时 |
  |---|---|
  | `/message`（输入框、快捷回复、日签接着聊） | 429 |
  | `/greeting`（新开塔罗 / 占星的开场白） | 429 |
  | `/resume`（抽牌 / 补资料之后的解读） | 放行，照样计一次（`consume`） |
  | 每日一签抽签 | 放行，照样计一次 |
  | 心灵奇旅 | 放行，照样计一次；一天只写一篇，写过就回放 |

  放行的几类都是一次性调用，入口本身有次数上限（一日一签、一天一篇、interrupt 由模型发起）。
- 查询：`GET /api/users/{user_id}/quota` → `{used, limit}`，只能查自己的。
- 游客转正后 `user_id` 不变、上限当场换成注册用户的，已用次数照算。
- 存储：`backend/data/usage.json`，`{"YYYY-MM-DD": {user_id: count}}`，每次写只留当天；
  `asyncio.Lock` + `os.replace` 原子写。后台可按人清零当天次数。

### 前端提示

- **发消息不预先查**：直接发，后端 `/message` 拦下（429）才知道。被拒的那句在扣额度之前就被拒了，
  没落库，也就不进模型上下文。库里的会话还是发这句之前的样子，所以前端不再拉会话，只在本地撤下
  先显示出去的这一句（`useConversationStore.rejectTurn`，按引用找，其余消息原样不动），字回到输入框（`Composer`），
  额度够了（转正 / 第二天）直接再发，记录里只有一条。输入框从不锁。
- **进对话前先查**（`App.ensureQuota` → `GET /quota`）：新开塔罗 / 占星、今天的日签「继续这段对话」。
  用完就提示、不建会话 / 不进对话。回看往日的日签对话不查；只抽日签、心灵奇旅、抽牌 / 补资料都不查。
- 提示是一个弹窗（`utils/quota.ts` 的 `quotaNotice`）：游客「今日免费次数已用完 /
  注册账号可获得更好的占卜体验和更多使用额度，现在注册会保留你的对话，今天就能接着聊。」，
  按钮「明天再来」「注册账号」（打开转为注册用户）；注册用户「今日次数已用完 / 明天再来吧。」，只有「知道了」。
- 登录弹窗里注册那一项（以及注册表单的副标题）写「更好的占卜体验 · 更多使用额度」。

---

## 3. 代码在哪

| 文件 | 管什么 |
|---|---|
| `services/auth_service.py` | 签发 / 解码 JWT |
| `dependencies.py` | `get_current_user` / `ensure_owner` |
| `services/rate_limit_service.py` | 计数、拦截（`check_and_consume`）/ 只计数（`consume`）、查询、原子写 |
| `routers/users.py` | `GET /{user_id}/quota` |
| `services/user_service.py` | 用户、密码、游客转正 |
| `stores/useAuthStore.ts` · `services/api.ts` | 前端持久化与拦截器 |
| `App.tsx`（`ensureQuota` / `showQuotaPrompt` / `runTurn` 的 429）· `utils/quota.ts` · `Composer` | 前端额度提示 |

---

## 4. 部署相关

- `.env` 必须覆盖 `SECRET_KEY`（`openssl rand -hex 32`）。变更后旧 token 全部失效。
- Nginx 必须有 `proxy_buffering off; proxy_read_timeout 300s;`，否则 SSE 不通。
