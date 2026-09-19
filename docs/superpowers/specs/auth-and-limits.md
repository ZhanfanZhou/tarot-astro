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

- 粒度：**user_id + 日期**，不做 IP 限流。
- 额度：游客 `GUEST_DAILY_MESSAGE_LIMIT` 默认 **15**，注册用户 `USER_DAILY_MESSAGE_LIMIT` 默认 **50**。
  游客可清缓存重置额度，所以额度宜小、主要额度绑到注册账号；
  15 这个数是为了让游客在有开场白（1 次）+ 澄清轮（0–1 次）的情况下仍能走完一场完整占卜。
- 计点位置：**每次真实 LLM 调用之前扣一次**。包括开场白（`/greeting`）、每轮对话、
  每日一签抽签、心灵奇旅。缓存命中的旅程回放不扣。
- 存储：`backend/data/usage.json`，`{user_id: {"YYYY-MM-DD": count}}`，
  `asyncio.Lock` + `os.replace` 原子写。
- 超限 → 429，消息里带重置时间。后台可按人清零。

---

## 3. 代码在哪

| 文件 | 管什么 |
|---|---|
| `services/auth_service.py` | 签发 / 解码 JWT |
| `dependencies.py` | `get_current_user` / `ensure_owner` |
| `services/rate_limit_service.py` | 计数、扣点、原子写 |
| `services/user_service.py` | 用户、密码、游客转正 |
| `stores/useAuthStore.ts` · `services/api.ts` | 前端持久化与拦截器 |

---

## 4. 部署相关

- `.env` 必须覆盖 `SECRET_KEY`（`openssl rand -hex 32`）。变更后旧 token 全部失效。
- Nginx 必须有 `proxy_buffering off; proxy_read_timeout 300s;`，否则 SSE 不通。
