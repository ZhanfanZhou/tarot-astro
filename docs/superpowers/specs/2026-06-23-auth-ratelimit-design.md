# JWT 鉴权 + 限流 + 旧会话迁移 — Design Spec

Date: 2026-06-23
Scope: 后端安全加固 + 前端适配。上线管理三件事：GEMINI_MODEL 环境变量化；JWT Bearer token 全链路鉴权（修复 IDOR）；基于 token 身份的每日用量限流；旧会话无感迁移。

## 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| 鉴权方式 | JWT HS256，Bearer token，有效期 60 天 |
| 身份来源 | 全部从 token 解析，服务端不信任客户端传的 user_id |
| 限流粒度 | user_id + 日期，不做 IP 限流 |
| 限流额度 | 游客 10 次/天，注册用户 50 次/天（`.env` 可覆盖） |
| 限流计点位置 | LLM 调用前扣，开场白/缓存命中豁免 |
| 旧用户迁移 | 提供无密码迁移端点，前端启动时静默调用，用户无感知 |
| 模型切换 | GEMINI_MODEL 环境变量化，无需改代码换模型 |

## 架构总览

```
前端 localStorage
  ├─ user (已存在)
  └─ token (新增)
        │
        ▼ 每次请求
axios 拦截器 → Authorization: Bearer <token>
        │
        ▼ 后端
dependencies.py::get_current_user
  ├─ 无 token → 401
  ├─ token 无效/过期 → 401
  └─ 解析成功 → User 对象注入路由
        │
        ▼
ensure_owner(current_user, target_user_id)
  ├─ 不匹配 → 403
  └─ 匹配 → 继续
        │
        ▼ (仅 LLM 端点)
rate_limit_service::check_and_consume
  ├─ 超限 → 429 + 友好文案
  └─ 正常 → 扣 1 次，调用 Gemini
```

## 后端

### 新增文件

**`backend/services/auth_service.py`**
- `create_access_token(user_id, user_type)` → JWT string（`python-jose` HS256）
- `decode_access_token(token)` → payload dict or None（失败静默返回 None）
- 有效期从 `config.ACCESS_TOKEN_EXPIRE_MINUTES` 读（默认 60 天）

**`backend/dependencies.py`**
- `get_current_user(credentials: HTTPAuthorizationCredentials)` → User
  - 解码 token → 取 `sub`（user_id）→ 查 StorageService → 返回 User
  - 任一步骤失败抛 `HTTPException(401)`
- `ensure_owner(current_user, target_user_id)` → None or raise 403

**`backend/services/rate_limit_service.py`**
- 存储：`backend/data/usage.json`，结构 `{user_id: {"YYYY-MM-DD": count}}`
- 并发安全：`asyncio.Lock` + `os.replace` 原子写（与 StorageService 不同，这里已经实现原子写）
- `check_and_consume(user)` 超限抛 429，消息带剩余重置时间

### 修改文件

**`backend/models.py`**
- 新增 `AuthResponse(user, access_token, token_type="bearer")`

**`backend/routers/users.py`**
- 公开端点（无需 token）：`POST /guest`、`POST /register`、`POST /login`
- 新增迁移端点：`POST /{user_id}/token`（无密码，按 user_id 签发，见迁移机制）
- 受保护端点（需 token + ensure_owner）：`GET /{user_id}`、`PUT /{user_id}/profile`、`DELETE /{user_id}`、`POST /convert-guest`

**所有业务路由**（conversations / tarot / astrology / daily / wallet / payments）
- 全部加 `get_current_user` 依赖，从 token 取身份
- 涉及 LLM 调用的端点在调用前加 `check_and_consume`

**`backend/config.py`**
```python
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-lite")
SECRET_KEY = os.getenv("SECRET_KEY", ...)          # 生产必须覆盖
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60*24*60)))
GUEST_DAILY_MESSAGE_LIMIT = int(os.getenv("GUEST_DAILY_MESSAGE_LIMIT", "10"))
USER_DAILY_MESSAGE_LIMIT = int(os.getenv("USER_DAILY_MESSAGE_LIMIT", "50"))
USAGE_FILE = DATA_DIR / "usage.json"
```

## 旧会话迁移机制

**问题**：已有用户的 localStorage 里只有 `user` 对象，没有 `token`。新机制要求所有请求携带 Bearer token，否则 401 被踢出重新登录。

**方案**：无密码迁移端点 + 前端启动静默调用。

```
后端：POST /api/users/{user_id}/token
  → 按 user_id 查 users.json
  → 存在 → 签发 JWT，返回 AuthResponse
  → 不存在 → 404
  
安全性：user_id 是 UUIDv4，不可枚举，个人应用可接受。
```

```typescript
// frontend/src/App.tsx - 应用启动 useEffect
const { user: storedUser, token: storedToken } = useAuthStore.getState();
if (storedUser && !storedToken) {
  userApi.migrateToken(storedUser.user_id)
    .then(({ access_token }) => setAuth(storedUser, access_token))
    .catch(() => { /* 404 静默忽略，等后续 401 自然踢出 */ });
}
```

**用户体验**：打开应用 → 约 200ms 迁移请求 → 直接进入，无弹窗。

**旧游客用户**：localStorage 有 guest user_id → 同样无感迁移（只要 users.json 里还存在该记录）。若 guest 数据已丢失，404 静默，后续 401 踢出，用户重新选择游客模式。

## 前端

**`stores/useAuthStore.ts`**
- 新增 `token: string | null`（持久化到 localStorage）
- 新增 `setAuth(user, token)` 同时写入两者
- `logout()` 同时清除 user 和 token

**`services/api.ts`**
- 请求拦截器：自动带 `Authorization: Bearer <token>`
- 响应拦截器：401 → `logout()`（触发重新登录弹窗）
- `authHeaders()` 辅助函数：为 SSE 原生 `fetch` 手动拼 Authorization header
- `streamError()` 辅助函数：解析流式端点的非 2xx，401 时顺带 logout
- 新增 `userApi.migrateToken(userId)` → `AuthResponse`

**三个 SSE 端点**（tarot/astrology/daily journey）不走 axios，改用 `authHeaders()` 手动传 header。`beforeunload` exit 同样手动传。

## 测试

`backend/tests/test_auth.py`（mock StorageService，不碰真实数据）：

| 测试类 | 覆盖内容 |
|---|---|
| `TestCreateAccessToken` | 签发非空、sub/type 正确编码、枚举/字符串均支持 |
| `TestDecodeAccessToken` | 正常解码、无效 token 返回 None、篡改检测、round-trip |
| `TestMigrationTokenEndpoint` | 注册用户/游客均可获 token、404 返回正确、token 合法、password_hash 不暴露 |
| `TestGetCurrentUserDependency` | 无 token→401、无效 token→401、token 归属不符→403、归属匹配→200 |

运行：`source venv/bin/activate && cd backend && pytest tests/test_auth.py -v`

## AWS 部署要点

1. `.env` 必须更新 `SECRET_KEY`（`openssl rand -hex 32`）和 `GEMINI_MODEL`
2. `SECRET_KEY` 变更后旧 token 全部失效，但这正是首次上线 JWT，旧用户触发迁移端点即可
3. Nginx 配置需加 `proxy_buffering off; proxy_read_timeout 300s;`（SSE 流式必须）
4. 部署顺序：git pull → pip install -r requirements.txt → systemctl restart ftarot → npm run build

## 已知遗留问题

- Token 60 天到期后无刷新机制（到期后用户需重新登录）
- 无密码重置功能（首次重新登录时暴露）
- `StorageService` 的读写不是原子操作（只有 `rate_limit_service` 实现了原子写）
