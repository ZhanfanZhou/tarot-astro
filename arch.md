# 塔罗占卜应用 - 架构设计文档

## 项目概述

这是一个基于 AI 的塔罗占卜应用，使用 Google Gemini 2.0 Flash 模型提供专业的塔罗牌解读。应用采用前后端分离架构，前端使用 React，后端使用 FastAPI，数据存储使用本地 JSON 文件。

## 技术架构

### 整体架构

```
┌─────────────────┐         ┌─────────────────┐         ┌──────────────────┐
│                 │         │                 │         │                  │
│  React Frontend │ ◄─────► │  FastAPI Backend│ ◄─────► │ Gemini 2.0 Flash │
│                 │  HTTP   │                 │   API   │                  │
└─────────────────┘         └─────────────────┘         └──────────────────┘
         │                           │
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│                 │         │                 │
│  LocalStorage   │         │   JSON Files    │
│   (Browser)     │         │   (Backend)     │
└─────────────────┘         └─────────────────┘
```

### 技术栈

**后端：**
- FastAPI 0.115.0 - Web 框架
- Uvicorn - ASGI 服务器
- Google GenerativeAI 0.8.3 - Gemini API SDK
- Pydantic 2.9.2 - 数据验证
- Passlib - 密码加密
- Aiofiles - 异步文件操作

**前端：**
- React 18.3.1 - UI 框架
- TypeScript 5.7.2 - 类型安全
- Vite 6.0.5 - 构建工具
- Tailwind CSS 3.4.17 - 样式框架
- Framer Motion 11.11.17 - 动画库
- Zustand 5.0.2 - 状态管理
- Axios 1.7.9 - HTTP 客户端

---

## 后端架构设计

### 1. 核心模块

#### 1.1 数据模型层 (models.py)

**功能：** 定义所有数据结构和类型

**核心模型：**
- `User` - 用户模型（包含 ID、类型、用户名、密码哈希、个人资料）
- `UserProfile` - 用户资料（昵称、性别、出生日期）
- `UserRegister` - 用户注册请求（用户名、密码、个人资料）
- `ConvertGuestToRegisteredRequest` - 游客转注册用户请求（用户ID、用户名、密码）
- `Conversation` - 对话模型（包含消息列表、会话类型、完成状态）
- `Message` - 消息模型（角色、内容、时间戳、塔罗牌结果、抽牌请求）
  - `tarot_cards`: 抽到的牌列表（可选，用于在对话中显示抽牌结果）
  - `draw_request`: 抽牌请求信息（可选，包含牌阵类型、牌数、位置含义）
- `TarotCard` - 塔罗牌模型（牌ID、牌名、是否逆位）
- `DrawCardsRequest` - 抽牌请求（牌阵类型、牌数、位置含义）

**设计机制：**
- 使用 Pydantic BaseModel 实现数据验证
- 使用 Enum 定义枚举类型（UserType, Gender, MessageRole, SessionType, TarotSpread）
- 使用 Field 添加默认值和验证规则
- **抽牌结果显示机制**：AI解读消息会附加 `tarot_cards` 和 `draw_request` 字段，前端根据这些字段在对话窗口中渲染美化的卡牌UI

#### 1.2 配置层 (config.py)

**功能：** 集中管理所有配置项

**配置内容：**
- API 密钥配置（Gemini API Key）
- 文件路径配置（数据目录、用户文件、对话文件）
- CORS 配置（允许的源）
- 塔罗牌数据（78张牌的名称列表）

**设计机制：**
- 使用环境变量加载敏感配置
- 使用 pathlib 管理文件路径
- 自动创建必要的目录

#### 1.3 存储服务层 (services/storage_service.py)

**功能：** 统一管理本地 JSON 文件存储

**核心方法：**

**用户相关：**
- `get_user(user_id)` - 根据 ID 获取用户
- `get_user_by_username(username)` - 根据用户名获取用户
- `save_user(user)` - 保存用户
- `delete_user(user_id)` - 删除用户

**对话相关：**
- `get_conversation(conversation_id)` - 获取对话
- `get_user_conversations(user_id)` - 获取用户的所有对话
- `save_conversation(conversation)` - 保存对话
- `delete_conversation(conversation_id)` - 删除对话
- `delete_user_conversations(user_id)` - 删除用户的所有对话

**设计机制：**
- 使用 aiofiles 实现异步文件操作，提高性能
- 所有方法都是异步的（async/await）
- 使用 JSON 格式存储，易于调试和迁移
- 内部使用字典作为索引，提高查询效率
- 批量删除操作使用字典推导式过滤，高效且安全

#### 1.4 用户服务层 (services/user_service.py)

**功能：** 处理用户相关的业务逻辑

**核心方法：**
- `hash_password(password)` - 密码哈希
- `verify_password(plain, hashed)` - 密码验证
- `create_guest_user(profile)` - 创建游客用户
- `create_registered_user(register_data)` - 创建注册用户
- `authenticate_user(username, password)` - 用户认证
- `update_user_profile(user_id, profile)` - 更新用户资料
- `get_user(user_id)` - 获取用户信息
- `convert_guest_to_registered(user_id, username, password)` - 将游客转换为注册用户
- `delete_user_and_conversations(user_id)` - 删除用户及其所有对话

**调用关系：**
```
create_guest_user → generate UUID → save_user (StorageService)
create_registered_user → check username → hash_password → save_user
authenticate_user → get_user_by_username → verify_password
update_user_profile → get_user → save_user
convert_guest_to_registered → get_user → check username → hash_password → save_user
delete_user_and_conversations → delete_user_conversations (StorageService) → delete_user (StorageService)
```

**设计机制：**
- 游客 ID 使用 `guest_` 前缀 + 12位随机字符
- 注册用户 ID 使用 `user_` 前缀 + 12位随机字符
- 使用 bcrypt 算法加密密码，保证安全性
- 注册时检查用户名唯一性
- **游客转换机制**：保留原 user_id 和所有对话记录，只修改 user_type、username 和 password_hash
- **数据清理机制**：删除用户时级联删除其所有对话，防止数据残留

#### 1.5 对话服务层 (services/conversation_service.py)

**功能：** 管理对话生命周期和消息

**核心方法：**
- `create_conversation(user_id, session_type)` - 创建新对话
- `get_conversation(conversation_id)` - 获取对话
- `get_user_conversations(user_id)` - 获取用户的所有对话
- `add_message(conversation_id, role, content, tarot_cards, draw_request)` - 添加消息
  - 支持附加 `tarot_cards` 和 `draw_request` 参数
  - 用于在AI解读消息中包含抽牌结果
- `get_latest_tarot_cards(conversation)` - 从对话历史中获取最近的抽牌结果
  - 返回 `(tarot_cards, draw_request)` 元组
  - 用于在AI回复时附加抽牌数据
- `update_conversation_title(conversation_id, title)` - 更新标题
- `mark_cards_drawn(conversation_id)` - 标记已抽牌
- `mark_completed(conversation_id)` - 标记已完成
- `delete_conversation(conversation_id)` - 删除对话

**调用关系：**
```
create_conversation → generate UUID → save_conversation
add_message → get_conversation → append message → update timestamp → save_conversation
mark_cards_drawn → get_conversation → set flag → save_conversation
```

**设计机制：**
- 对话 ID 使用 `conv_` 前缀 + 16位随机字符
- 自动根据会话类型生成默认标题
- 用户第一条消息自动生成对话标题（截取前20字符）
- 每次添加消息都更新 `updated_at` 时间戳
- 使用 `has_drawn_cards` 标记防止重复抽牌
- 使用 `is_completed` 标记完成状态

#### 1.6 Gemini AI 服务层 (services/gemini_service.py)

**功能：** 与 Gemini API 交互，实现 AI 对话、塔罗解读和星盘分析，支持 Function Calling Agent Loop

**核心方法：**
- `_build_user_context(user)` - 构建用户上下文信息
- `_format_messages_for_gemini(messages, user, session_type)` - 格式化消息
- `stream_response(messages, user, session_type)` - 流式生成回复（支持Function Calling的Agent Loop）
- `continue_with_function_result(messages, user, session_type, function_name, function_result)` - 在收到函数执行结果后继续Agent Loop

**Function Calling 工具定义：**

**注意：塔罗AI和星座AI都可以使用以下所有工具，实现灵活的跨领域解读**

1. **draw_tarot_cards** - 塔罗抽牌工具
   ```python
   参数:
   - spread_type: 牌阵类型 (single/three_card/celtic_cross/custom)
   - card_count: 抽牌数量 (1-10张)
   - positions: 牌阵位置含义 (可选)
   
   适用场景：
   - 塔罗AI：主要功能，为用户抽牌占卜
   - 星座AI：辅助功能，可结合星盘分析抽牌，提供综合性指引
   ```

2. **get_astrology_chart** - 获取星盘数据工具
   ```python
   参数:
   - reason: 调用原因说明
   
   适用场景：
   - 星座AI：主要功能，获取本命盘进行深入分析
   - 塔罗AI：扩展功能，可在塔罗解读中结合用户星盘，提供更个性化的建议
   ```

3. **request_user_profile** - 请求用户补充个人信息工具
   ```python
   参数:
   - reason: 请求信息的原因说明
   - required_fields: 需要的字段列表 (birth_date/birth_time/birth_city/nickname/gender)
   
   适用场景：
   - 星座AI：当需要星盘分析但用户资料不完整时调用
   - 塔罗AI：当需要结合星盘进行深入解读时调用
   
   交互流程（类似抽牌流程）：
   1. AI 调用工具 → 后端返回 SSE: {"need_profile": {...}}
   2. 前端显示"补充资料"按钮（蓝色渐变，FileUser 图标）
   3. 用户点击按钮 → 打开资料填写弹窗
   4. 用户填写/跳过 → 清除按钮状态
   ```

4. **read_divination_notes** - 翻用户以前的占卜记录（一场一条的占卜笔记）
   ```python
   参数:
   - reason: 这次要翻记录的原因

   适用场景：
   - 用户提起「上次」「以前问过」，要那几场的细节
   - 想知道以前那件事后来怎么样了、哪张牌哪个问题反复出现

   返回内容：
   - note_count: 记录条数
   - notes: 格式化的记录正文（每条含日期、问题与背景、抽到的牌、解读记录、用户反馈）

   工作机制：
   - 调用 notebook_service.get_notes(user_id) 取这位用户的占卜笔记
   - 没有记录时返回一句说明（笔记在每场占卜结束、用户离开对话后生成）
   - 游客没有笔记本，返回 success=False
   - 「这个人是谁」由每轮注入的 <用户画像> 承担，这个工具只出以前那几场的原文
   ```

**系统提示词（TAROT_SYSTEM_PROMPT）：**
```
你是一位专业的塔罗占卜师和命理师...
1. 首次对话时，引导用户说出问题
2. 分析问题，决定牌阵和牌数
3. 使用 draw_tarot_cards 工具为用户抽牌（每次对话只能抽一次）
4. 收到抽牌结果后，进行专业解读
5. 解读完毕后，询问是否继续探讨
6. 不能再次抽牌
```

**系统提示词（ASTROLOGY_SYSTEM_PROMPT）：**
```
你是一位专业的占星师和星座分析师...
1. 首次对话时，引导用户提问
2. 判断问题是否需要星盘资料
3. 如需星盘且用户资料完整，使用 get_astrology_chart 工具获取数据
4. 收到星盘数据后，进行深入解读
5. 如不需要星盘，直接回答星座知识问题
```

**Agent Loop 调用关系：**
```
stream_response → _format_messages_for_gemini → _build_user_context
              → create GenerativeModel with tools
              → start_chat → send_message_async (non-stream)
              → check for function_call
              → yield {"function_call": {...}} if found
              → yield {"content": text} for text chunks
              → yield {"done": True} when complete

路由层执行函数 → 调用实际服务（TarotService/AstrologyService）
              → 构造 function_result

continue_with_function_result → format messages with function result
                              → send function_response to AI
                              → stream final AI response
                              → yield {"content": text} chunks
                              → yield {"done": True}
```

**设计机制：**
- **Agent Loop架构**：AI可以主动调用工具，工具执行后将结果喂回AI继续处理
- **Function Calling协议**：使用Gemini标准的Function Calling机制，符合API规范
- **可扩展性**：工具定义与业务逻辑分离，易于添加新工具
- **统一工具集**：塔罗和星座AI使用相同的工具集（所有4个工具），实现跨领域解读能力
  - 塔罗AI可以调用星盘数据，提供更精准的个性化解读
  - 星座AI可以抽塔罗牌，从另一角度辅助星盘分析
  - 两个AI都可以请求用户补充资料
  - 两个AI都可以读取用户的占卜笔记本，提供更有连续性的解读
- **流式输出**：支持流式返回文本和函数调用事件
- **错误处理**：函数执行失败时返回错误信息，AI会据此调整回复
- **笔记本集成**：AI可以主动读取用户的历史占卜记录，发现重复模式和主题
- 用户资料（昵称、性别、生日）会被添加到系统提示中，用于个性化
- 历史消息会被完整传递给 AI，保持上下文连贯性
- 函数结果会被保存为SYSTEM消息，供AI参考

#### 1.7 星盘服务层 (services/astrology_service.py)

**功能：** 处理星盘数据获取和格式化

**核心方法：**
- `fetch_natal_chart(birth_info)` - 调用外部星盘API获取本命盘数据
- `format_chart_data_to_text(chart_data, user_info)` - 将星盘数据格式化为文字描述
- `get_city_coordinates(city)` - 获取城市经纬度
- `get_current_zodiac_sign()` - 获取当前时间对应的星座

**星盘API集成：**
```python
1. 使用 httpx 异步调用外部星盘API
2. 传递用户出生信息（年月日时分、城市）
3. 城市名转换为经纬度和时区
4. 获取行星位置、宫位、星座等信息
5. 格式化为易读的文字描述
```

**城市坐标数据：**
- 内置主要城市（北京、上海、广州等18个城市）的经纬度和时区
- 如果城市不在列表，使用北京作为默认值
- 未来可扩展为完整的地理编码服务

**星盘数据格式化：**
- 基本信息：出生日期、时间、地点
- 行星落座：太阳、月亮、水星等10颗行星的星座和宫位
- 四轴点：上升点(ASC)、天底(IC)、下降点(DSC)、天顶(MC)

**设计机制：**
- 使用外部星盘API（http://www.xingpan.vip）
- Access Token 通过环境变量配置
- 异步HTTP请求，设置30秒超时
- 错误处理：API失败返回None，由调用方处理

#### 1.8 塔罗牌服务层 (services/tarot_service.py)

**功能：** 处理塔罗牌抽牌逻辑

**核心方法：**
- `draw_cards(draw_request)` - 抽取塔罗牌
- `get_all_cards()` - 获取所有塔罗牌名称
- `get_card_name(card_id)` - 根据ID获取牌名

**抽牌算法：**
```python
1. 生成0-77的完整牌组（78张）
2. 使用 random.shuffle 洗牌
3. 抽取前 N 张牌
4. 每张牌有30%概率逆位
5. 返回 TarotCard 对象列表
```

**设计机制：**
- 使用 Python 内置 random 模块实现随机抽牌
- 牌 ID 从 0-77 对应 TAROT_CARDS 列表
- 逆位概率设置为 30%，符合塔罗占卜惯例
- 抽牌结果包含牌 ID、牌名、逆位状态

#### 1.9 占卜笔记本服务层 (services/notebook_service.py)

**功能：** 为每个用户管理独立的占卜笔记本，自动记录占卜历史

**核心方法：**
- `generate_update(conversation, portrait)` - 记忆 Agent 一次调用产出这场的笔记 + 画像补丁（JSON 不合格就重摇，最多 `NOTE_ATTEMPTS` 次）
- `generate_and_save(user_id, conversation, user)` - 直接生成并保存这场的笔记，顺带并入画像改动（供定时任务调用，不检查时间条件）
- `update_entry(user_id, conversation, user)` - 检查是否需要创建定时任务（不再直接生成笔记）
- `delete_notebook(user_id)` - 删除用户的笔记和画像（游客登出时使用）
- `get_notes(user_id)` - 获取用户的占卜笔记
- `get_portrait(user_id)` - 获取用户画像（`context_service.build_portrait_context` 每轮读它，注册用户的开场与解读提示词都带）

#### 1.10 占卜笔记定时任务调度器 (services/notebook_task_scheduler.py)

**功能：** 管理延迟12小时生成笔记的定时任务，确保任务持久化和顺序执行

**核心类：**
- `NotebookTask` - 任务数据类，包含 conversation_id、user_id、scheduled_time、created_at
- `NotebookTaskScheduler` - 单例模式的任务调度器

**核心方法：**
- `add_task(conversation_id, user_id)` - 添加新任务（防重复）
- `remove_task(conversation_id)` - 移除任务
- `start_worker()` - 启动后台工作线程
- `stop_worker()` - 停止后台工作线程
- `get_pending_tasks()` - 获取待处理任务列表（用于调试）
- `_worker_loop()` - 后台工作循环，每分钟检查到期任务
- `_process_task(task)` - 处理单个任务，顺序执行（使用 asyncio.Lock）
- `_load_tasks()` - 从文件加载任务列表
- `_save_tasks()` - 保存任务列表到文件

**特性：**
- **单例模式**：全局唯一实例，避免重复初始化
- **持久化存储**：任务列表保存到 `backend/data/notebook_task_list.json`
- **自动恢复**：后端重启时自动加载待处理任务
- **顺序执行**：使用 asyncio.Lock 保证任务不并行执行
- **防重复**：同一对话不会创建多个任务
- **生命周期管理**：通过 FastAPI lifespan 事件管理启动和关闭

**数据结构：**
```python
NoteEntry:
  - conversation_id: 对话ID
  - start_time: 对话开始时间
  - end_time: 对话结束时间（对应 conversation.updated_at）
  - question: 讨论的问题
  - cards_drawn: 抽到的牌列表
  - summary: AI生成的摘要（以用户第一人称视角）
  - user_feedback: 用户反馈
```

**存储机制：**
- 每个用户独立的笔记本文件：`backend/data/notebooks/note_{user_id}.log`
- 使用 JSON 格式存储
- 游客和注册用户都有独立笔记本
- 游客转注册时，笔记本自动保留（因为 user_id 不变）
- 游客登出时，笔记本自动删除

**AI 摘要生成：**
- 使用独立的 Gemini-2.5-flash 模型（与占卜模型分离）
- 独立的提示词系统，专注于笔记记录而非占卜
- 以用户第一人称视角书写
- 限制在 300 字以内
- 记录问题、抽到的牌、用户经历和反馈

**触发条件（创建定时任务）：**
- 对话退出时（切换对话、新建对话、页面关闭、登出）
- 且对话内容有新增（消息数 > 1）
- 且对话中抽过塔罗牌
- **且对话内容有变化**（end_time != conversation.updated_at）

**笔记生成机制（定时任务）：**
- **延迟12小时生成**：对话退出时不立即生成笔记，而是创建定时任务，12小时后由后台调度器执行
- **定时任务调度器**（`NotebookTaskScheduler`）：
  - 单例模式，应用启动时自动启动 worker 线程
  - 每分钟检查一次，顺序执行到期任务（使用 asyncio.Lock 保证不并行）
  - 任务列表持久化到 `backend/data/notebook_task_list.json`
  - 后端重启时自动恢复待处理任务
- **防重复任务**：同一对话不会创建多个定时任务
- **防重复生成**：通过比对 end_time 和 updated_at 判断对话是否有新内容
- 使用异步 AI 生成，避免阻塞
- 自动去重：同一对话多次退出只更新同一条记录
- 不对外展示，仅用于内部记录
- 错误容忍：生成失败时使用简单默认摘要
- **详细调试输出**：对话退出时打印所有条件检查结果，方便排查问题

### 2. API 路由层

#### 2.1 用户路由 (routers/users.py)

**端点：**
- `POST /api/users/guest` - 创建游客用户
- `POST /api/users/register` - 用户注册
- `POST /api/users/login` - 用户登录
- `GET /api/users/{user_id}` - 获取用户信息
- `PUT /api/users/{user_id}/profile` - 更新用户资料
- `POST /api/users/convert-guest` - 将游客转换为注册用户
- `DELETE /api/users/{user_id}` - 删除用户及其所有对话

**调用流程：**
```
POST /api/users/register
  → UserService.create_registered_user
  → UserService.hash_password
  → StorageService.save_user
  → 返回 User（不包含密码哈希）

POST /api/users/convert-guest
  → UserService.convert_guest_to_registered
  → 验证用户类型和用户名唯一性
  → 更新用户信息（保留原 user_id）
  → 返回 User（不包含密码哈希）

DELETE /api/users/{user_id}
  → UserService.delete_user_and_conversations
  → StorageService.delete_user_conversations
  → 如果是游客：NotebookService.delete_notebook
  → StorageService.delete_user
  → 返回成功消息
```

**设计机制：**
- 所有返回的 User 对象都不包含 password_hash（安全考虑）
- 使用 HTTPException 统一错误处理
- 登录失败返回 401 状态码
- 用户不存在返回 404 状态码
- **游客转换机制**：只允许游客用户转换，转换后保留所有对话历史和笔记本（user_id 不变）
- **数据清理机制**：删除用户时自动级联删除所有对话；游客登出时额外删除笔记本

#### 2.2 对话路由 (routers/conversations.py)

**端点：**
- `POST /api/conversations?user_id={user_id}` - 创建新对话
- `GET /api/conversations/{conversation_id}` - 获取对话详情
- `GET /api/conversations/user/{user_id}` - 获取用户的所有对话
- `PUT /api/conversations/title` - 更新对话标题
- `DELETE /api/conversations/{conversation_id}` - 删除对话
- `POST /api/conversations/{conversation_id}/exit` - 对话退出（保存笔记）

**调用流程：**
```
POST /api/conversations
  → ConversationService.create_conversation
  → StorageService.save_conversation
  → 返回 Conversation

POST /api/conversations/{conversation_id}/exit
  → 获取对话信息
  → 检查是否满足生成笔记的条件
    - 条件1: 消息数 > 1
    - 条件2: 抽过塔罗牌
  → 如果满足条件：
    → NotebookService.update_entry
    → 生成 AI 摘要并保存
  → 返回是否更新笔记的状态
```

**设计机制：**
- 创建对话时通过 query 参数传递 user_id
- 获取用户对话时按 updated_at 倒序排序
- 删除对话返回成功消息
- **笔记保存机制**：对话退出时自动检查条件并生成笔记，避免空对话产生记录

#### 2.3 塔罗路由 (routers/tarot.py)

**端点：**
- `POST /api/tarot/message` - 发送消息并获取AI流式回复（塔罗占卜，支持Function Calling）
- `POST /api/tarot/draw?conversation_id={id}` - 抽取塔罗牌（保留用于手动抽牌）
- `GET /api/tarot/cards` - 获取所有塔罗牌

#### 2.4 星盘路由 (routers/astrology.py)

**端点：**
- `POST /api/astrology/message` - 发送消息并获取AI流式回复（星盘解读，支持Function Calling）
- `POST /api/astrology/draw?conversation_id={id}` - 抽取塔罗牌（星座AI辅助解读用）
- `POST /api/astrology/fetch-chart?conversation_id={id}` - 获取用户星盘数据（保留用于手动获取）
- `GET /api/astrology/check-profile/{user_id}` - 检查用户星盘资料完整性
- `GET /api/astrology/current-zodiac` - 获取当前时间对应的星座

**核心功能 - Agent Loop流式消息（支持Function Calling）：**

```python
POST /api/tarot/message (新架构)
  1. 获取对话和用户信息
  2. 添加用户消息
  3. 调用 GeminiService.stream_response（返回事件流）
  4. 处理事件流：
     a. {"content": "..."} - 流式输出文本
     b. {"function_call": {...}} - 检测到函数调用
        → 执行对应的函数（draw_tarot_cards）
        → 调用 TarotService.draw_cards
        → 保存抽牌结果到对话（SYSTEM消息）
        → 调用 GeminiService.continue_with_function_result
        → 流式输出AI的最终解读
     c. {"done": True} - 对话完成
  5. 保存所有AI消息

POST /api/astrology/message (新架构)
  1. 获取对话和用户信息
  2. 添加用户消息
  3. 调用 GeminiService.stream_response（返回事件流）
  4. 处理事件流：
     a. {"content": "..."} - 流式输出文本
     b. {"function_call": {...}} - 检测到函数调用
        → 执行对应的函数：
           - get_astrology_chart: 获取星盘数据
           - draw_tarot_cards: 抽塔罗牌（辅助解读）
           - request_user_profile: 请求用户补充资料
        → 调用 GeminiService.continue_with_function_result
        → 流式输出AI的最终解读
     c. {"done": True} - 对话完成
  5. 保存所有AI消息

POST /api/astrology/draw (抽牌接口)
  1. 验证对话存在性
  2. 检查是否已抽过牌
  3. 调用 TarotService.draw_cards 抽牌
  4. 保存抽牌结果到对话（SYSTEM消息）
  5. 标记已抽牌状态
  6. 返回抽牌结果
```

**流式响应格式（Server-Sent Events）：**
```
data: {"content": "文本内容"}\n\n
data: {"draw_cards": {...}, "cards": [...]}\n\n  # 塔罗抽牌结果
data: {"need_profile": {...}}\n\n  # 需要补充资料
data: [DONE]\n\n
```

**调用流程：**
```
POST /api/tarot/draw
  → ConversationService.get_conversation
  → 检查 has_drawn_cards
  → TarotService.draw_cards
  → ConversationService.add_message (SYSTEM role)
  → ConversationService.mark_cards_drawn
  → 返回 DrawCardsResponse
```

**设计机制：**
- 使用 StreamingResponse 实现流式输出
- 使用 SSE（Server-Sent Events）协议
- 抽牌前检查 has_drawn_cards 防止重复抽牌
- 抽牌结果以 SYSTEM 角色保存，不在前端显示
- 抽牌指令从 AI 回复中提取并移除，不显示给用户

### 3. 主应用 (main.py)

**功能：** FastAPI 应用入口

**配置：**
- CORS 中间件（允许前端跨域请求）
- 路由注册（users, conversations, tarot, astrology）
- 健康检查端点

**开发环境 CORS/代理机制：**
- 前端通过 Vite 代理将同源 `/api/*` 请求转发到后端 `http://localhost:8000`
- 前端 `services/api.ts` 默认 `API_BASE_URL = ''`，优先使用同源，避免预检请求 400 问题
- 如需绕过代理直连后端，可在 `.env` 设置 `VITE_API_URL`，例如 `VITE_API_URL=http://localhost:8000`

**端点：**
- `GET /` - 根路径，返回API信息
- `GET /health` - 健康检查
- `GET /docs` - Swagger UI 文档

---

## 前端架构设计

### 1. 状态管理

#### 1.1 认证状态 (stores/useAuthStore.ts)

**功能：** 管理用户登录状态

**状态：**
- `user: User | null` - 当前登录用户
- `setUser(user)` - 设置用户
- `logout()` - 退出登录

**设计机制：**
- 使用 Zustand persist 中间件持久化到 localStorage
- 存储键名为 `auth-storage`
- 退出登录时清空用户信息

#### 1.2 对话状态 (stores/useConversationStore.ts)

**功能：** 管理对话列表和当前对话

**状态：**
- `conversations: Conversation[]` - 对话列表
- `currentConversation: Conversation | null` - 当前对话
- `setConversations` - 设置对话列表
- `setCurrentConversation` - 设置当前对话
- `addConversation` - 添加对话（插入到列表头部）
- `updateConversation` - 更新对话
- `removeConversation` - 移除对话

**设计机制：**
- 不持久化到 localStorage，每次登录后从服务器加载
- 添加对话时插入到列表头部（最新的在前面）
- 更新对话时同时更新列表和当前对话（如果匹配）
- `addMessageToCurrentConversation` - 将单个消息添加到当前对话（用于立即显示用户输入）

### 2. API 服务层 (services/api.ts)

#### 2.1 用户 API (userApi)

**方法：**
- `createGuest(profile)` - 创建游客
- `register(username, password, profile)` - 注册
- `login(username, password)` - 登录
- `getUser(userId)` - 获取用户信息
- `updateProfile(userId, profile)` - 更新资料

#### 2.2 对话 API (conversationApi)

**方法：**
- `create(userId, sessionType)` - 创建对话
- `get(conversationId)` - 获取对话
- `getUserConversations(userId)` - 获取用户对话列表
- `updateTitle(conversationId, title)` - 更新标题
- `delete(conversationId)` - 删除对话

#### 2.3 塔罗 API (tarotApi)

**方法：**
- `sendMessage(conversationId, content, onChunk, onDrawCards)` - 发送消息
- `drawCards(conversationId, drawRequest)` - 抽牌
- `getAllCards()` - 获取所有塔罗牌

**流式消息处理：**
```javascript
sendMessage 流程：
1. 使用 fetch API 发送请求
2. 获取 response.body.getReader()
3. 使用 TextDecoder 解码字节流
4. 按行分割，解析 SSE 格式
5. 如果是 content，调用 onChunk 回调
6. 如果是 draw_cards，调用 onDrawCards 回调
7. 遇到 [DONE] 结束
```

**设计机制：**
- 使用 Axios 处理普通 HTTP 请求
- 使用原生 Fetch API 处理流式请求
- 流式消息使用回调函数实时处理数据块
- 错误处理统一抛出异常

### 3. UI 组件

#### 3.1 侧边栏组件 (Sidebar.tsx)

**功能：** 显示对话列表和功能按钮

**Props：**
- `conversations` - 对话列表
- `currentConversationId` - 当前对话ID
- `onNewConversation` - 新建对话回调
- `onSelectConversation` - 选择对话回调
- `onDeleteConversation` - 删除对话回调
- `onOpenSettings` - 打开设置回调

**UI 结构：**
```
┌─────────────────┐
│  [+ 新占卜]      │  <- Header
├─────────────────┤
│  对话1 [删除]    │
│  对话2 [删除]    │  <- 对话列表（可滚动）
│  对话3 [删除]    │
├─────────────────┤
│  [⚙️ 设置]       │  <- Footer
└─────────────────┘
```

**交互：**
- 鼠标悬停显示删除按钮
- 当前对话高亮显示
- 对话按更新时间排序
- 时间显示相对时间（今天、昨天、N天前）

**设计机制：**
- 使用 Framer Motion 实现进入动画
- 使用 group-hover 实现悬停效果
- 删除时阻止事件冒泡（stopPropagation）

#### 3.2 聊天消息组件 (ChatMessage.tsx)

**功能：** 显示单条消息

**Props：**
- `message: Message` - 消息对象
- `showDrawButton` - 是否显示抽牌按钮
- `onReadyToDraw` - 点击抽牌按钮的回调
- `showProfileButton` - 是否显示补充资料按钮
- `onReadyToFillProfile` - 点击补充资料按钮的回调

**UI 结构：**
```
用户消息（右侧）:
[头像]  [消息气泡]  [时间]

AI消息（左侧）:
[时间]  [消息气泡]  [头像]

如果有塔罗牌结果，在消息下方显示：
抽到的牌：
位置1: 牌名 (正/逆位)
位置2: 牌名 (正/逆位)

如果需要抽牌，在消息下方显示：
[✨ 我准备好了 ✨]  (金色渐变按钮)

如果需要补充资料，在消息下方显示：
[📋 补充资料 📋]  (蓝色渐变按钮)
```

**设计机制：**
- 用户消息使用主题色背景，AI消息使用暗色背景
- 使用 Framer Motion 实现淡入动画
- 系统消息不显示（role === 'system'）
- 支持显示抽牌结果和位置含义
- **交互按钮设计**：
  - 抽牌按钮：金色渐变（mystic-gradient），Sparkles 图标
  - 补充资料按钮：蓝色渐变（from-blue-500 to-cyan-500），FileUser 图标
  - 按钮支持 hover 放大和 tap 缩小动画

#### 3.3 聊天输入组件 (ChatInput.tsx)

**功能：** 消息输入框

**Props：**
- `onSend(message)` - 发送消息回调
- `disabled` - 是否禁用
- `placeholder` - 占位符文本

**交互：**
- 回车键发送消息
- 发送按钮动画效果（hover 放大，tap 缩小）
- 发送后自动清空输入框
- 禁用时显示不可用状态

#### 3.4 快捷回复组件 (QuickReplies.tsx)

**功能：** 在输入框上方显示预设的快捷回复话语，用户点击后自动发送

**Props：**
- `conversationType: SessionType` - 会话类型（tarot/astrology）
- `onReplyClick(text)` - 点击回复回调

**预设话语：**

**塔罗占卜（10个）：**
1. 确实是这样，你继续说
2. 好像是有点这种感觉
3. 我可以问什么问题？
4. 塔罗算得准吗？
5. 你最擅长什么问题？
6. 看看我下半年的感情运势
7. 我下个月的事业运怎么样？
8. 帮我看看最近的运势
9. 我该怎么做决定？
10. 能再详细解释一下吗？

**星座占卜（10个）：**
1. 确实是这样，你继续说
2. 好像是有点这种感觉
3. 我可以问什么问题？
4. 星盘是什么意思？准吗？
5. 你最擅长什么问题？
6. 看看我下半年的感情运势
7. 我下个月的事业运怎么样？
8. 分析一下我的性格特点
9. 我和什么星座最配？
10. 能再详细解释一下吗？

**UI 样式：**
- 悬浮窗口样式（白色半透明背景，阴影效果）
- 圆角胶囊按钮
- hover 时放大并加深边框颜色
- 水平排列，自动换行

**设计机制：**
- 根据会话类型自动显示对应的预设话语
- 点击后直接调用 `onReplyClick` 发送消息
- 使用 Tailwind CSS 实现响应式布局和动画效果
- 每个按钮显示完整文本，鼠标悬停时有 tooltip

#### 3.5 会话按钮组件 (SessionButtons.tsx)

**功能：** 选择会话类型（塔罗、星盘、聊愈）

**Props：**
- `onSelectSession(sessionType)` - 选择会话回调
- `disabled` - 是否禁用

**UI 结构：**
```
[塔罗占卜]  [星盘解读]  [聊愈]
    ✨         ⭐        💬
```

**设计机制：**
- 每个按钮有独特的渐变色
- hover 时放大并上移
- 星盘和聊愈标记为"即将推出"
- 即将推出的按钮禁用并显示提示

#### 3.6 塔罗牌抽牌器组件 (TarotCardDrawer.tsx)

**功能：** 塔罗牌抽牌动画和交互

**Props：**
- `isOpen` - 是否打开
- `drawRequest` - 抽牌请求
- `onClose` - 关闭回调
- `onCardsDrawn(cards)` - 抽牌完成回调

**交互流程：**
```
1. 打开弹窗 → 显示"开始洗牌"按钮
2. 点击洗牌 → 播放洗牌动画（2秒）
3. 洗牌完成 → 牌以扇形展开
4. 用户点击牌 → 牌被选中并高亮
5. 选够指定数量 → 显示"确认抽牌"按钮
6. 确认抽牌 → 牌移动到顶部卡槽
7. 延迟1.5秒 → 关闭并返回结果
```

**UI 结构：**
```
┌──────────────────────────────┐
│  抽取塔罗牌            [X]    │  <- Header
│  请选择3张牌 (已选2张)        │
├──────────────────────────────┤
│  [卡槽1] [卡槽2] [卡槽3]      │  <- 顶部卡槽
│                              │
│       🎴🎴🎴🎴🎴              │  <- 扇形展开的牌
│      🎴       🎴             │
│     🎴         🎴            │
│                              │
│     [确认抽牌]               │  <- 确认按钮
└──────────────────────────────┘
```

**洗牌动画：**
- 每次随机生成 14-20 张动画牌，并从“轨道旋转”“瀑布穿梭”“爆裂散射”三种运动模式中随机挑选，让洗牌轨迹与节奏始终保持新鲜感（整体时长约 2s~3.6s）
- 模式内部仍会为每张卡片随机分配旋转角度、抛物线高度、起止延迟与缩放关键帧，确保同一模式下也不存在重复
- 洗牌阶段的卡片基础尺寸提升到 112×176px，并在动画过程中峰值放大到约 1.25 倍，营造更有沉浸感的视觉体量（扇形选牌阶段维持 96×144px 不变）
- 洗牌舞台叠加 `TABLE_BACKGROUND_IMAGE` (`/assets/table.png`) 桌面纹理与柔和金色光晕，整体舞台面积放大至 4xl 区域

**扇形展开算法：**
```javascript
78张牌排列成约110度扇形：
- 角度范围：-55° ~ 55°
- 半径：450px
- Y轴压缩：0.62倍，配合 +48px 的基准下移偏移，让扇形更扁平并整体靠近底部
- 每张牌旋转：angle
- 水平居中：所有卡片以 left: 50% 为基准，额外减去卡片半宽（48px）保证左右对称
```

**设计机制：**
- 使用 Framer Motion 实现所有动画
- 点击背景关闭（洗牌时禁用）
- 选中的牌放大并上移
- 扇形容器高度压缩为 280px，顶部序号圆点缩至 8px 直径，整体视觉高度减少但卡片尺寸保持 96×144px
- 简化可拖动滑动条：位于扇形牌组上方 (top: 160px)，宽度 256px (w-64)，高度 8px (h-2)，无文字标签，包含渐变色高亮窗口 (约 28.2% 宽度) 和金色指示点，可直接拖动滑动条来旋转扇形牌组，hover 时放大 1.05 倍，拖动时放大 1.08 倍
- 使用半透明黑色背景+模糊效果
- 卡槽显示位置名称或序号
- 抽牌与洗牌区域统一使用桌面背景纹理，柔化光晕避免视觉过度集中

#### 3.7 星盘资料填写弹窗组件 (AstrologyProfileModal.tsx)

**功能：** 用户填写星盘所需的出生资料

**触发方式：**
- AI 调用 `request_user_profile` 工具
- 前端先显示"补充资料"按钮（蓝色渐变，FileUser 图标）
- 用户点击按钮后才打开弹窗
- **设计理念**：与抽牌流程保持一致，给用户更多控制权，不会突然弹出打断对话

**Props：**
- `isOpen` - 是否打开
- `currentProfile` - 当前用户资料
- `onClose` - 关闭回调
- `onSubmit(profile)` - 提交资料回调
- `onSkip()` - 跳过填写回调

**UI 结构：**
```
┌──────────────────────────────┐
│  完善星盘资料            [X]  │  <- Header
│  提供准确的出生信息...        │
├──────────────────────────────┤
│  性别：[男] [女] [其他] [保密]│
│                              │
│  出生日期：*                 │
│  [年份▼] [月份▼] [日期▼]     │
│                              │
│  出生时间：*                 │
│  [小时▼] [分钟▼]             │
│  准确的出生时间对星盘解读很重要│
│                              │
│  出生城市：*                 │
│  [请选择城市▼]               │
│  北京、上海、广州...         │
│                              │
│  [保存并继续] [暂时跳过]      │
└──────────────────────────────┘
```

**交互：**
- 性别为可选项，其他为必填项
- 年份范围：1950-2024
- 时间：0-23小时，0-59分钟
- 城市：18个主要城市下拉选择
- 提交前验证必填项
- 跳过后进入无资料模式

**设计机制：**
- 使用下拉选择器简化输入
- 日期和时间使用数字选择器
- 城市列表与后端保持一致
- 表单验证提示友好

#### 3.8 认证弹窗组件 (AuthModal.tsx)

**功能：** 用户登录/注册

**Props：**
- `isOpen` - 是否打开
- `onClose` - 关闭回调
- `onGuestLogin(profile)` - 游客登录回调
- `onRegister(username, password, profile)` - 注册回调
- `onLogin(username, password)` - 登录回调

**模式切换：**
```
choice (选择) → guest (游客)
             → register (注册)
             → login (登录)
```

**UI 结构（选择模式）：**
```
欢迎来到塔罗占卜

[游客模式]
 快速开始，但不保存历史记录

[注册账号]
 保存历史记录，随时查看

[已有账号？立即登录]
```

**设计机制：**
- 使用状态机管理模式切换
- 游客模式可填写昵称（可选）
- 注册/登录需要用户名和密码
- 使用图标增强输入框视觉效果
- 表单提交后自动关闭弹窗

#### 3.9 转换为注册用户弹窗组件 (ConvertToRegisteredModal.tsx)

**功能：** 将游客用户转换为注册用户

**Props：**
- `isOpen` - 是否打开
- `onClose` - 关闭回调
- `onConvert(username, password)` - 转换回调
- `currentProfile` - 当前用户资料（用于预填充）

**UI 结构：**
```
转为注册用户
转换后可以保存您的所有对话历史

用户名 *
[👤] [输入框 - 自动填充昵称]

密码 *
[🔒] [输入框 - 至少6位]

确认密码 *
[🔒] [输入框 - 再次输入]

[提示信息] 您的个人信息将会保留：
• 昵称: xxx
• 出生日期: xxx
• 出生地: xxx

[取消]  [转换为注册用户]
```

**功能特性：**
1. **自动预填充**：
   - 用户名自动填充为昵称（如果有）
   - 显示将被保留的个人信息
2. **表单验证**：
   - 用户名必填
   - 密码至少6位
   - 两次密码必须一致
3. **错误提示**：
   - 实时显示验证错误
   - API 错误友好提示

**设计机制：**
- 使用 `useEffect` 自动预填用户名
- 实时表单验证，在提交前阻止无效输入
- 显示用户已填写的个人信息，增加用户信心
- 转换成功后更新 Zustand 状态，无需重新登录
- 使用 z-index: 110 确保在设置弹窗之上

#### 3.10 神秘背景组件 (MysticBackground.tsx)

**功能：** 应用全局背景，包含静态背景图和动态视觉效果

**视觉效果：**
- 静态背景图：红色帷幕和水晶球（`/bg.png`）
- 窗帘飘动：左右两侧的帷幕微微飘动效果
- 水晶球光芒：多层次光晕效果（外层、中层、内层）
- 闪烁效果：水晶球中心的闪烁光点
- 星星点缀：随机位置的闪烁星星（8个）
- 径向光效：从水晶球向外扩散的波纹

**动画机制：**
- 使用 Framer Motion 的 `motion.div` 实现流畅动画
- 窗帘飘动：x 轴微小位移 + scaleX 变化（4-4.5秒循环）
- 光芒效果：scale + opacity 同时变化（2-3秒循环，不同层延迟触发）
- 闪烁星星：opacity + scale 变化（每颗星独立延迟）
- 径向光效：scale 0.8→1.5 + opacity 0→0.4→0（4秒循环）

**样式特点：**
- 使用 `fixed` 定位和 `z-index: -1` 确保背景在最底层
- 使用 `mix-blend-mode: screen/overlay` 实现光效融合
- 使用 `filter: blur()` 增强光晕效果
- 响应式设计：移动端光效尺寸自动缩小
- 添加暗化遮罩（rgba(0,0,0,0.3)）确保前景内容可读

**设计机制：**
- 背景图使用 `background-size: cover` 适应各种屏幕
- 所有动效元素设置 `pointer-events: none` 避免干扰交互
- 多层光效叠加营造深度感和神秘氛围
- 动画时长错开避免视觉疲劳

### 4. 主应用 (App.tsx)

**功能：** 应用主入口，整合所有组件和逻辑

**状态：**
- `showAuthModal` - 是否显示认证弹窗
- `showSettings` - 是否显示设置
- `showConvertModal` - 是否显示转换为注册用户弹窗
- `isLoading` - 是否加载中
- `streamingMessage` - 流式输出的消息
- `showCardDrawer` - 是否显示抽牌器
- `pendingDrawRequest` - 待处理的抽牌请求
- `showDrawButton` - 是否显示抽牌按钮
- `showProfileButton` - 是否显示补充资料按钮
- `pendingProfileRequest` - 待处理的资料请求
- `showAstrologyProfileModal` - 是否显示资料填写弹窗
- `pendingAstrologyConversation` - 待处理资料的对话ID

**生命周期：**
```
1. 组件挂载 → 检查用户登录状态
   - 未登录 → 显示认证弹窗
   - 已登录 → 加载用户对话列表

2. 用户登录成功 → 加载对话列表 → 隐藏认证弹窗

3. 选择会话类型 → 创建新对话 → 自动发送初始消息

4. 用户发送消息 → 流式接收AI回复 → 检测抽牌指令
   - 有抽牌指令 → 打开抽牌器
   - 无抽牌指令 → 正常显示回复

5. 用户抽牌 → 保存抽牌结果 → 自动发送解读请求

6. 消息更新 → 自动滚动到底部
```

**核心方法：**

**handleSelectSession(sessionType):**
```
1. 创建新对话（API 调用）
2. 添加到对话列表
3. 设置为当前对话（React 状态更新）
4. 如果是塔罗占卜：
   a. 随机选择一种开场白（5种）
   b. 直接使用 newConv.conversation_id 发送消息
   c. 设置 loading 状态
   d. 调用 tarotApi.sendMessage（流式接收）
   e. 刷新对话并更新状态
```

**重要**：直接使用 `newConv.conversation_id` 而不是依赖 `currentConversation` 状态，避免 JavaScript 闭包捕获旧状态的问题。这是处理 React 异步状态更新的正确方式。

**handleSendMessage(content):**
```
1. 立即将用户消息添加到对话中（用户输入立即显示）
   - 创建 Message 对象，role='user'
   - 调用 addMessageToCurrentConversation 将消息加入本地状态
   - 无需等待 API 响应
2. 设置加载状态
3. 调用 tarotApi.sendMessage 或 astrologyApi.sendMessage
4. 实时接收文本块 → 更新 streamingMessage
5. 接收到指令（抽牌、获取资料、获取星盘等） → 触发对应处理
6. 流式结束 → 刷新对话 → 清空 streamingMessage
```

**设计机制：**
- **立即显示原则**：用户的输入在按下发送按钮后立即显示，不阻塞于 AI 响应
- **本地状态优先**：使用 `addMessageToCurrentConversation` 方法直接修改 Zustand 状态
- **服务端同步**：后续 `conversationApi.get()` 刷新确保与服务端数据保持一致
- 提升用户体验：反馈迅速，即使 AI 响应较慢也不会影响消息显示
- **抽牌按钮占位机制**：当 Gemini 只返回 `draw_tarot_cards` 函数调用而没有文本块时，`showDrawButton + pendingDrawRequest` 触发一个纯按钮的助手气泡，按钮文案改为"点我抽牌"，确保用户仍能看到交互入口；若 AI 同时返回文本，则按钮附着在最后一条助手消息上并显示"我准备好了"。
- **资料按钮占位机制**：同样的机制应用于 `request_user_profile` 工具调用，`showProfileButton + pendingProfileRequest` 触发"补充资料"按钮（蓝色渐变），用户点击后打开资料填写弹窗。

**handleCardsDrawn(cards):**
```
1. 调用 tarotApi.drawCards 保存抽牌结果（SYSTEM 消息）
2. 标记 has_drawn_cards = true（防止重复抽牌）
3. 刷新对话
4. 清空 pendingDrawRequest
5. 延迟0.5秒后自动发送"请根据抽牌结果进行解读"（USER 消息，界面不显示）
6. 触发 AI 流式解读
7. 后端检测到"请根据抽牌结果进行解读"消息，在AI回复时附加 tarot_cards 数据
8. 前端渲染带有抽牌结果的AI消息，显示美化的卡牌UI
```

**抽牌结果显示机制：**
- 后端在保存AI解读消息时，检测用户最后一条消息是否为"请根据抽牌结果进行解读"
- 如果是，从对话历史中获取最近的抽牌结果（通过 `get_latest_tarot_cards()`）
- 将抽牌结果附加到AI消息的 `tarot_cards` 和 `draw_request` 字段
- 前端 ChatMessage 组件检测到消息包含 `tarot_cards` 字段时，渲染美化的卡牌UI
- 每张卡片显示：渐变色背景、卡牌名称、正逆位标记、位置标签（如"过去"、"现在"、"未来"）
- 正位卡片使用紫粉渐变（from-purple-500 to-pink-600），逆位卡片使用靛紫渐变（from-indigo-600 to-purple-700）
- 鼠标悬停时卡片放大，增强交互体验

**handleLogout():**
```
1. 检查用户类型
2. 如果是游客用户：
   a. 弹出第一次确认："退出后将无法找回对话历史"
   b. 用户点击确定 → 弹出第二次确认："是否删除所有数据"
   c. 用户选择确定 → 调用 deleteUser API 删除数据
   d. 用户选择取消 → 引导转换为注册用户（打开转换弹窗）
3. 如果是注册用户：
   a. 正常退出确认
4. 清空前端状态（logout、清空对话列表）
```

**设计机制：**
- **游客特殊处理**：两次确认机制，防止误操作
- **数据清理选项**：游客可选择删除或保留数据
- **引导转换**：在第二次确认时引导游客转换为注册用户
- **级联删除**：删除用户时后端自动删除所有对话

**handleConvertToRegistered(username, password):**
```
1. 调用 userApi.convertGuestToRegistered(user_id, username, password)
2. 后端验证：
   a. 检查用户类型（必须是游客）
   b. 检查用户名唯一性
   c. 更新用户信息（保留原 user_id 和对话）
3. 更新前端状态：setUser(updatedUser)
4. 关闭转换弹窗
5. 提示转换成功
```

**设计机制：**
- **保留历史**：转换时保留 user_id，所有对话历史自动继承
- **无缝切换**：转换后直接更新 Zustand 状态，无需重新登录
- **自动预填**：用昵称预填用户名，减少输入
- **表单验证**：前端实时验证，后端二次验证

**UI 布局：**
```
┌────────────────────────────────────────┐
│ [Sidebar]  │  [Main Content]           │
│            │                            │
│ 对话列表    │  欢迎页面                  │
│            │  或                        │
│            │  聊天界面                  │
│            │                            │
│ [设置]     │  [输入框]                  │
└────────────────────────────────────────┘
```

**设计机制：**
- 无当前对话时显示欢迎页面和会话按钮
- 有当前对话时显示聊天界面
- 使用 ref 实现自动滚动到底部
- 流式消息作为临时消息显示，完成后替换为真实消息
- 抽牌后允许继续对话和深入探讨
- 自动触发解读的消息在界面上隐藏（内容为"请根据抽牌结果进行解读"）
- 所有弹窗使用 AnimatePresence 实现进出动画

---

## 核心流程详解

### 1. 用户注册/登录流程

```
前端                     后端                      存储
 │                        │                         │
 │  POST /api/users/register                        │
 ├───────────────────────>│                         │
 │                        │  hash_password          │
 │                        │  check_username_exists  │
 │                        ├────────────────────────>│
 │                        │<────────────────────────│
 │                        │  save_user              │
 │                        ├────────────────────────>│
 │<───────────────────────│                         │
 │  User (without password_hash)                    │
 │                        │                         │
 │  setUser(user)         │                         │
 │  localStorage.setItem  │                         │
 │                        │                         │
```

### 2. 创建对话流程

```
前端                     后端                      存储
 │                        │                         │
 │  选择会话类型           │                         │
 │  POST /api/conversations?user_id=xxx             │
 ├───────────────────────>│                         │
 │                        │  generate_conv_id       │
 │                        │  create_conversation    │
 │                        ├────────────────────────>│
 │<───────────────────────│                         │
 │  Conversation          │                         │
 │                        │                         │
 │  addConversation       │                         │
 │  setCurrentConversation│                         │
 │                        │                         │
```

### 3. 塔罗占卜完整流程

```
前端                         后端                      Gemini API
 │                            │                          │
 │  1. 用户点击"塔罗占卜"      │                          │
 │  创建对话，发送空消息       │                          │
 │  POST /api/tarot/message (content="")                │
 ├───────────────────────────>│                          │
 │                            │  检测首次对话             │
 │                            │  （空消息 && 0条历史）    │
 │                            │  ✅ 使用预设硬编码开场白  │
 │                            │  随机选择3种文案之一      │
 │                            │  "{昵称}！欢迎来到塔罗..." │
 │<────────────streaming──────│  直接返回（不调用AI）     │
 │  "朋友！欢迎来到塔罗..."   │  逐字流式输出             │
 │  （秒级响应）               │  保存到对话历史           │
 │                            │                          │
 │  2. 用户输入具体问题        │                          │
 │  POST /api/tarot/message   │                          │
 ├───────────────────────────>│                          │
 │                            │  add_user_message        │
 │                            │  stream_response         │
 │                            ├─────────────────────────>│
 │<────────────streaming──────│<─────────streaming───────│
 │  "我建议使用三张牌..."     │                          │
 │  <draw_cards>{...}</...>   │                          │
 │                            │  extract_draw_instruction│
 │<───────────────────────────│                          │
 │  data: {"draw_cards":{...}}│                          │
 │                            │  add_assistant_message   │
 │                            │  (with draw_request)     │
 │                            │                          │
 │  3. 打开抽牌器             │                          │
 │  用户选择3张牌             │                          │
 │  POST /api/tarot/draw      │                          │
 ├───────────────────────────>│                          │
 │                            │  TarotService.draw_cards │
 │                            │  add_system_message      │
 │                            │  (tarot_cards + draw_request) │
 │                            │  mark_cards_drawn=true   │
 │<───────────────────────────│                          │
 │  DrawCardsResponse         │                          │
 │                            │                          │
 │  4. 自动触发解读（隐藏）   │                          │
 │  POST /api/tarot/message   │                          │
 │  "请根据抽牌结果进行解读"  │                          │
 │  (界面不显示此消息)         │                          │
 ├───────────────────────────>│                          │
 │                            │  add_user_message        │
 │                            │  stream_response         │
 │                            │  format_messages:        │
 │                            │  - [抽牌结果] ...（转为user）│
 │                            │  - "请根据..." (user)    │
 │                            ├─────────────────────────>│
 │                            │  AI 看到抽牌结果标记     │
 │<────────────streaming──────│<─────────streaming───────│
 │  "根据你抽到的牌..."       │  不返回抽牌指令          │
 │  "过去位置：愚者（正位）..."│                         │
 │  "建议..."                 │                          │
 │                            │                          │
 │  5. 继续多轮对话            │                          │
 │  用户可以继续提问            │                          │
 │  AI 可以继续讨论            │                          │
 │                           │                          │
```

**关键机制说明：**
1. **硬编码开场白（性能优化）**：点击塔罗按钮后，后端直接返回预设开场白，而不调用AI生成
   - **检测条件**：空消息（`content=""`) 且对话历史为空（`len(messages)==0`）
   - **预设文案**：3种开场白模板，随机选择一种
     - `"{昵称}！欢迎来到塔罗的神秘世界～ 今天有什么想问的吗？无论是爱情、事业还是人生困惑，塔罗都会为你指引方向。"`
     - `"{昵称}，你好呀！✨ 塔罗牌已经准备好了，想探索什么问题呢？感情、工作、还是内心的迷茫？"`
     - `"嗨，{昵称}！很高兴见到你～ 让塔罗牌为你揭示答案吧！你可以问我关于爱情、事业、决策等任何问题哦！"`
   - **昵称处理**：使用 `user.profile.nickname`（如果有），否则使用"朋友"作为默认称呼
   - **流式输出**：保持逐字流式输出，确保UI体验一致
   - **性能提升**：从原来的几秒AI生成时间优化到几乎即时响应
2. **抽牌结果传递**：SYSTEM 消息在发送给 AI 时转换为带 `[抽牌结果]` 标记的 USER 消息
3. **软约束抽牌**：使用 AI 提示词引导，避免不必要的重复抽牌，但允许新问题时再次抽牌
4. **自动触发解读**：前端自动发送触发消息，但通过 ChatMessage 组件过滤，不显示在界面上
5. **AI 识别机制**：系统提示词明确告诉 AI 看到 `[抽牌结果]` 后直接解读，不要再次返回抽牌指令
6. **继续对话**：解读完成后，用户仍可继续提问和深入探讨

### 4. 星座咨询完整流程（AI智能判断）

```
前端                         后端                      外部API / Gemini API
 │                            │                          │
 │  1. 用户点击"星座"按钮      │                          │
 │  创建对话，发送空消息       │                          │
 │  POST /api/astrology/message (content="")            │
 ├───────────────────────────>│                          │
 │                            │  检测首次对话             │
 │                            │  （空消息 && 0条历史）    │
 │                            │  ✅ 使用预设硬编码开场白  │
 │                            │  随机选择3种文案之一      │
 │                            │  "{昵称}！今天有什么想问的？"
 │<────────────streaming──────│  直接返回（不调用AI）     │
 │  "朋友！今天有什么想问的..." │  逐字流式输出             │
 │  （秒级响应）               │  保存到对话历史           │
 │                            │                          │
 │  2. 用户提出问题            │                          │
 │  POST /api/astrology/message                         │
 │  "我的上升星座是什么？"     │                          │
 ├───────────────────────────>│                          │
 │                            │  add_user_message        │
 │                            │  stream_response         │
 │                            ├─────────────────────────>│
 │                            │  AI 判断：需要星盘资料   │
 │                            │  检查用户资料：不完整     │
 │<────────────streaming──────│<─────────────streaming───│
 │  "这个问题需要根据您的本命盘来分析..."                │
 │  <need_profile>{...}</need_profile>                  │
 │                            │  检测到 need_profile 标签│
 │<───────────────────────────│                          │
 │  data: {"need_profile":{}}  │                          │
 │                            │                          │
 │  3. 前端显示"补充资料"按钮  │                          │
 │  [补充资料] 蓝色渐变按钮    │                          │
 │  用户点击按钮               │                          │
 │  → 弹出资料填写窗口         │                          │
 │  用户填写：性别、出生年月日  │                          │
 │  时分、出生城市             │                          │
 │                            │                          │
 │  4. 提交资料                │                          │
 │  PUT /api/users/{id}/profile                         │
 ├───────────────────────────>│                          │
 │                            │  save_user               │
 │<───────────────────────────│                          │
 │                            │                          │
 │  5. 获取星盘数据            │                          │
 │  POST /api/astrology/fetch-chart                     │
 ├───────────────────────────>│                          │
 │                            │  fetch_natal_chart       │
 │                            ├─────────────────────────>│
 │                            │  POST xingpan.vip API   │
 │                            │<─────────────────────────│
 │                            │  format_chart_to_text    │
 │                            │  add_system_message      │
 │<───────────────────────────│  ([星盘数据])            │
 │                            │                          │
 │  6. 通知AI资料已补充        │                          │
 │  POST /api/astrology/message                         │
 │  "我已经填写好出生信息了"   │                          │
 ├───────────────────────────>│                          │
 │                            │  add_user_message        │
 │                            │  stream_response         │
 │                            │  (携带星盘数据)           │
 │                            ├─────────────────────────>│
 │                            │  AI 看到星盘数据          │
 │<────────────streaming──────│<─────────streaming───────│
 │  "太好了！根据您的星盘..."  │  AI 基于星盘解读         │
 │  "您的上升星座是..."        │                          │
 │                            │                          │
 │  【情况2：不需要星盘的问题】│                          │
 │  POST /api/astrology/message                         │
 │  "双子座今天运势如何？"     │                          │
 ├───────────────────────────>│                          │
 │                            │  add_user_message        │
 │                            │  stream_response         │
 │                            ├─────────────────────────>│
 │                            │  AI 判断：不需要星盘资料 │
 │<────────────streaming──────│<─────────streaming───────│
 │  "双子座今天运势..."        │  AI 直接回答             │
 │  （不触发资料收集）         │                          │
 │                            │                          │
 │  【情况3：用户跳过填写资料】│                          │
 │  用户点击"暂时跳过"         │                          │
 │  关闭弹窗，继续对话         │                          │
 │  AI 可以基于一般星座知识回答                          │
 │                            │                          │
```

**关键机制说明：**
1. **硬编码开场白（性能优化）**：点击星座按钮后，后端直接返回预设开场白，而不调用AI生成
   - **检测条件**：空消息（`content=""`) 且对话历史为空（`len(messages)==0`）
   - **预设文案**：3种开场白模板，随机选择一种
     - `"{昵称}！今天有什么想问的？我可以帮你看星座、运势、星盘等任何问题～"`
     - `"{昵称}，你好呀！✨ 想聊聊你的星座、运势，还是想深入了解你的本命盘？"`
     - `"嗨，{昵称}！很高兴见到你～ 今天想探索什么呢？星座、塔罗还是星盘分析都可以哦！"`
   - **昵称处理**：使用 `user.profile.nickname`（如果有），否则使用"朋友"作为默认称呼
   - **流式输出**：保持逐字流式输出，确保UI体验一致
   - **性能提升**：从原来的几秒AI生成时间优化到几乎即时响应
2. **AI智能判断**：AI根据用户问题自动判断是否需要星盘资料
   - 需要星盘资料的问题：本命盘、上升星座、月亮星座、个人行星落座、宫位、相位等
   - 不需要星盘资料的问题：星座性格、一般运势、星座配对、星座知识等
3. **按需触发资料收集**：
   - AI通过 `<need_profile>` 标签告知前端需要用户资料
   - 前端检测到标签后弹出资料填写窗口
   - 不需要星盘资料的问题，AI直接回答，不触发弹窗
4. **自动获取星盘**：AI也可以通过 `<fetch_chart>` 标签触发星盘数据获取（如果用户资料完整但星盘未获取）
5. **星盘数据传递**：SYSTEM消息携带星盘数据，在发送给AI时转换为带`[星盘数据]`标记的用户消息
6. **灵活对话**：用户可以先咨询一般星座问题，需要时再补充资料获取精准星盘解读
7. **游客模式**：游客用户填写的资料同样会保存到 profile 中（但不会持久化到注册账号）

### 5. 抽牌动画流程

```
1. 初始状态
   [开始洗牌]

2. 点击洗牌
   🎴 旋转
   🎴 旋转移动
   🎴 旋转缩放
   （2秒动画）

3. 洗牌完成
   顶部显示卡槽：
   [位置1] [位置2] [位置3]
   
   底部扇形展开：
        🎴🎴🎴
       🎴    🎴
      🎴      🎴

4. 用户点击选牌
   选中的牌：
   - 放大1.3倍
   - 上移20px
   - 黄色光圈
   
   已选2/3张

5. 选够数量
   显示 [确认抽牌] 按钮

6. 确认抽牌
   选中的牌动画移动到顶部卡槽
   显示正逆位标识
   延迟1.5秒后关闭
```

### 6. 对话退出与笔记保存流程

**触发场景：**
- 用户切换到其他对话
- 用户新建对话
- 用户登出
- 用户关闭/刷新页面

**流程：**
```
前端                         后端                      笔记本服务
 │                            │                           │
 ├─ 检测到对话切换/退出       │                           │
 │  (handleSelectConversation │                           │
 │   handleNewConversation    │                           │
 │   handleLogout             │                           │
 │   beforeunload)            │                           │
 │                            │                           │
 ├─ 调用 exit API ────────────►│                           │
 │  POST /api/conversations/  │                           │
 │       {id}/exit            │                           │
 │                            │                           │
 │                            ├─ 获取对话信息             │
 │                            │                           │
 │                            ├─ 检查触发条件：           │
 │                            │  - 消息数 > 1？           │
 │                            │  - 抽过塔罗牌？           │
 │                            │                           │
 │                            ├─ 满足条件 ────────────────►│
 │                            │                           │
 │                            │                           ├─ 加载现有笔记
 │                            │                           │
 │                            │                           ├─ 生成 AI 摘要
 │                            │                           │  (Gemini-2.5-flash)
 │                            │                           │  - 提取问题
 │                            │                           │  - 提取抽到的牌
 │                            │                           │  - 构建对话内容
 │                            │                           │  - 生成第一人称摘要
 │                            │                           │
 │                            │                           ├─ 更新/创建条目
 │                            │                           │
 │                            │                           ├─ 保存到文件
 │                            │                           │  note_{user_id}.log
 │                            │                           │
 │                            │ ◄─────────────────────────┤
 │                            │                           │
 │ ◄──────────────────────────┤                           │
 │  { notebook_updated: true }│                           │
 │                            │                           │
```

**游客登出特殊处理：**
```
前端                         后端                      笔记本服务
 │                            │                           │
 ├─ 游客登出                  │                           │
 │                            │                           │
 ├─ 1. 先调用 exit API        │                           │
 │    保存当前对话笔记 ────────►│ ──────────────────────────►│
 │                            │                           │
 ├─ 2. 调用 delete user ──────►│                           │
 │    DELETE /api/users/{id}  │                           │
 │                            │                           │
 │                            ├─ 检查用户类型             │
 │                            │  是游客？                 │
 │                            │                           │
 │                            ├─ 删除所有对话             │
 │                            │                           │
 │                            ├─ 删除笔记本 ──────────────►│
 │                            │                           │
 │                            │                           ├─ 删除文件
 │                            │                           │  note_{user_id}.log
 │                            │                           │
 │                            ├─ 删除用户                 │
 │                            │                           │
 │ ◄──────────────────────────┤                           │
 │  成功                      │                           │
 │                            │                           │
```

**设计机制：**
- **自动触发**：前端监听所有对话退出场景，无需用户手动操作
- **条件检查**：后端过滤无效对话（空对话、未抽牌对话），避免无意义记录
- **异步生成**：AI 摘要生成不阻塞用户操作
- **去重机制**：同一对话多次退出只更新同一条记录
- **容错处理**：生成失败使用默认摘要，不影响用户体验
- **页面卸载**：使用 fetch with keepalive 确保在页面关闭前发送请求
- **游客保护**：游客登出时先保存笔记，再删除所有数据

---

## 通用设计机制

### 1. 错误处理机制

**后端：**
- 所有路由使用 try-except 捕获异常
- 业务逻辑错误抛出 ValueError，路由转换为 400/404/401
- 使用 HTTPException 统一错误响应格式
- 未预期错误返回 500 状态码

**前端：**
- API 调用使用 try-catch 捕获异常
- 错误使用 alert 提示用户（后续可改进为 Toast）
- 错误时恢复 UI 状态（取消加载状态等）

### 2. 数据持久化机制

**后端本地存储：**
- 使用 JSON 文件存储用户和对话数据
- 文件路径：`backend/data/users.json`、`backend/data/conversations.json`
- 使用异步文件操作（aiofiles）提高性能
- 数据结构为字典，键为 ID，值为对象

**前端本地存储：**
- 用户信息持久化到 localStorage（使用 Zustand persist）
- 对话列表每次登录后从服务器加载
- 存储键名：`auth-storage`

### 3. 防重复抽牌机制

已删除

### 4. 流式输出机制

**后端：**
- 使用 AsyncGenerator 实现异步生成器
- 使用 StreamingResponse 返回 SSE 格式
- 数据格式：`data: {JSON}\n\n`
- 结束标记：`data: [DONE]\n\n`

**前端：**
- 使用 Fetch API 的 ReadableStream
- 使用 TextDecoder 解码字节流
- 逐行解析 SSE 格式
- 通过回调函数实时更新 UI

### 5. 动画机制

**原则：**
- 所有交互都有反馈动画
- 使用 Framer Motion 统一动画实现
- 常用动画：淡入（fadeIn）、滑入（slideUp）、悬浮（float）

**常见动画：**
- 组件进入：opacity 0→1, y 20→0
- 按钮 hover：scale 1→1.05
- 按钮 tap：scale 1→0.95
- 卡片悬停：scale 1→1.2, z 上升
- 列表项：延迟进入动画（stagger）

### 6. 响应式设计机制

**布局：**
- 使用 Tailwind CSS 的 flex 布局
- 侧边栏固定宽度（256px）
- 主内容区域占满剩余空间
- 聊天消息最大宽度 3xl（768px）

**适配：**
- 当前仅支持桌面端
- 移动端需要增加响应式断点和侧边栏折叠

**问题背景：**
- React 的 `setState` 是异步的，不会立即更新状态
- JavaScript 闭包会捕获定义时的变量值，而非执行时的值
- 组合使用会导致闭包捕获旧的状态值

**错误模式（避免）：**
```typescript
// ❌ 错误：闭包捕获旧状态
const [currentConv, setCurrentConv] = useState(null);

const handleCreate = async () => {
  const newConv = await createConversation();
  setCurrentConv(newConv);  // 异步更新，不会立即生效
  
  // 错误方式1：直接使用状态
  sendMessage(currentConv.id);  // currentConv 仍然是 null！
  
  // 错误方式2：使用 setTimeout
  setTimeout(() => {
    sendMessage(currentConv.id);  // 闭包捕获的仍是旧值 null！
  }, 100);
};
```

**正确模式（推荐）：**
```typescript
// ✅ 正确：直接使用局部变量
const handleCreate = async () => {
  const newConv = await createConversation();
  setCurrentConv(newConv);  // 更新状态（异步）
  
  // 方式1：直接使用局部变量（推荐）
  await sendMessage(newConv.id);  // 使用 newConv，不依赖状态
  
  // 方式2：内联逻辑
  await api.sendMessage(newConv.id, content);  // 不调用依赖状态的函数
};
```

**设计原则：**
1. **优先使用局部变量/函数参数** - 避免依赖 React 状态
2. **内联逻辑而非函数调用** - 减少状态依赖链
3. **使用 useEffect 监听状态变化** - 需要响应状态更新时使用
4. **避免 setTimeout 处理状态问题** - 治标不治本

**适用场景：**
- 创建资源后立即操作该资源
- 状态更新后立即执行依赖该状态的操作
- 表单提交、对话创建等场景

**本项目应用：**
- `handleSelectSession`：创建对话后立即发送消息
- 使用 `newConv.conversation_id` 而非 `currentConversation.conversation_id`
- 避免了闭包捕获 null 值的问题

### 8. 安全机制

**密码安全：**
- 使用 bcrypt 加密密码
- 密码哈希永不返回给前端
- 登录失败统一提示"用户名或密码错误"

**API 安全：**
- 使用 CORS 限制跨域请求
- API Key 通过环境变量配置
- 敏感配置不提交到版本控制

### 9. 性能优化机制

**后端：**
- 使用异步操作（async/await）提高并发性能
- 文件操作使用 aiofiles
- 使用流式输出减少等待时间

**前端：**
- 使用 Zustand 轻量级状态管理
- 按需加载（未实现代码分割）
- 使用 Vite 构建，开发服务器启动快

---

## 数据模型关系图

```
User (用户)
 │
 ├─ user_id: string (PK)
 ├─ user_type: UserType
 ├─ username: string (unique)
 ├─ password_hash: string
 └─ profile: UserProfile
      ├─ nickname: string
      ├─ gender: Gender
      └─ birth_date: ...

Conversation (对话)
 │
 ├─ conversation_id: string (PK)
 ├─ user_id: string (FK → User)
 ├─ session_type: SessionType
 ├─ title: string
 ├─ has_drawn_cards: boolean
 ├─ is_completed: boolean
 └─ messages: Message[]
      │
      ├─ role: MessageRole
      ├─ content: string
      ├─ timestamp: string
      ├─ tarot_cards: TarotCard[]
      │    ├─ card_id: int
      │    ├─ card_name: string
      │    └─ reversed: boolean
      └─ draw_request: DrawCardsRequest
           ├─ spread_type: TarotSpread
           ├─ card_count: int
           └─ positions: string[]
```

---

## 扩展点

### 1. 数据库迁移

当前使用 JSON 文件存储，可以迁移到数据库：

**推荐：**
- SQLite（简单，适合单机）
- PostgreSQL（功能强大，适合生产）
- MongoDB（灵活，适合文档存储）

**改动点：**
- 修改 `storage_service.py` 实现数据库操作
- 其他代码无需修改（依赖抽象）

### 2. 用户认证增强

**可添加：**
- JWT Token 认证
- 刷新 Token 机制
- 邮箱验证
- 密码重置
- OAuth 第三方登录

### 3. 移动端适配

**需要：**
- 响应式布局（Tailwind 断点）
- 侧边栏折叠/抽屉
- 触摸手势支持
- 移动端抽牌交互优化

### 4. 导出功能

**可导出：**
- 对话历史（PDF/Markdown）
- 抽牌结果图片
- 分享到社交媒体

---

## 维护注意事项

### 1. 添加新的会话类型

1. 在 `backend/models.py` 的 `SessionType` 枚举添加新类型
2. 在 `GeminiService` 添加对应的系统提示词
3. 在前端 `types/index.ts` 同步添加枚举
4. 在 `SessionButtons.tsx` 添加按钮配置
5. 在 `App.tsx` 的 `handleSelectSession` 添加逻辑

### 2. 修改塔罗牌数据

1. 修改 `backend/config.py` 的 `TAROT_CARDS` 列表
2. 确保有 78 张牌（或调整 TarotService 的逻辑）
3. 如果牌数变化，修改前端抽牌器的牌数量

### 3. 调整 AI 行为

1. 修改 `backend/services/gemini_service.py` 的 `TAROT_SYSTEM_PROMPT`
2. 调整 `generation_config`（temperature, top_p, max_tokens）
3. 如果修改抽牌指令格式，同步修改前端解析逻辑

### 4. 更换 AI 模型

1. 修改 `backend/config.py` 的 `GEMINI_MODEL`
2. 如果更换 API（如 OpenAI），需重写 `GeminiService`
3. 保持接口一致，其他代码无需修改

### 5. 性能监控

**建议添加：**
- API 响应时间日志
- 错误日志（文件/Sentry）
- 用户行为分析
- 模型调用统计

---

## 总结

### 架构优势

1. **模块化设计**：前后端分离，各层职责清晰
2. **易于扩展**：新增会话类型、AI 模型、数据库都很简单
3. **用户体验**：流式输出、动画效果、实时反馈
4. **数据安全**：密码加密、本地存储、隐私保护

### 技术亮点

1. **流式 AI 对话**：使用 SSE 实现打字机效果
2. **塔罗牌动画**：扇形展开、洗牌、选牌全流程
3. **星盘解读**：集成外部星盘API，智能判断用户资料完整性
4. **状态管理**：Zustand 轻量级且易用
5. **异步架构**：后端全异步，性能优秀
6. **多会话类型**：支持塔罗占卜、星盘解读，易于扩展

### 改进方向

1. **数据持久化**：迁移到数据库
2. **认证系统**：添加 JWT、权限管理
3. **错误处理**：Toast 提示、错误日志
4. **移动端**：响应式布局、触摸优化
5. **测试**：单元测试、集成测试
6. **部署**：Docker化、CI/CD
7. **星盘功能增强**：
   - 扩展城市列表或集成地理编码服务
   - 添加星盘图形化展示（SVG/Canvas）
   - 支持合盘、流年等更多星盘类型
8. **聊愈功能**：添加心理咨询对话模式
