**文档版本：** 1.3.0  
**最后更新：** 2025-10-06  
**维护者：** Cursor AI Assistant

# 更新日志

## 2025-10-06 (晚间) - 重构为Function Calling Agent Loop架构

**重大架构升级：**
将AI工具调用从XML标签方式升级为标准的Gemini Function Calling机制。

### 升级内容

**1. 实现Gemini Function Calling工具**
- 定义 `draw_tarot_cards` 工具：为用户抽取塔罗牌
- 定义 `get_astrology_chart` 工具：获取用户本命星盘数据
- 使用 `FunctionDeclaration` 标准化工具定义，符合Gemini API规范

**2. 实现Agent Loop架构**
- AI主动调用工具，路由层执行工具，结果喂回AI继续处理
- 支持多轮交互：AI → 调用工具 → 执行 → 返回结果 → AI处理结果 → 输出
- 新增 `continue_with_function_result` 方法处理函数结果回传

**3. 更新System Prompts**
- 移除XML标签说明（`<draw_cards>`, `<fetch_chart>`, `<need_profile>`）
- 指引AI使用工具函数：`draw_tarot_cards`, `get_astrology_chart`
- 优化提示词，强调工具调用时机和条件

**4. 重构路由层**
- **塔罗路由 (tarot.py)**：
  - 处理 `{"function_call": {...}}` 事件
  - 执行 `draw_tarot_cards` 函数，调用 `TarotService.draw_cards`
  - 构造函数结果，喂回AI继续解读
  - 支持流式输出AI的最终解读
  
- **星座路由 (astrology.py)**：
  - 处理 `{"function_call": {...}}` 事件
  - 执行 `get_astrology_chart` 函数，调用 `AstrologyService.fetch_natal_chart`
  - 检查用户资料完整性，返回错误或星盘数据
  - 格式化星盘数据为文字，保存为SYSTEM消息
  - 构造函数结果，喂回AI继续解读

**5. 删除旧代码**
- 删除 `extract_draw_cards_instruction` 方法
- 删除 `remove_draw_cards_tags` 方法
- 删除 `extract_need_profile_instruction` 方法
- 删除 `extract_fetch_chart_instruction` 方法
- 删除 `remove_special_tags` 方法

### 技术细节

**Agent Loop流程：**
```
1. 用户发送消息
2. AI分析问题，决定是否需要调用工具
3. 如需工具，AI返回 function_call
4. 路由层捕获 function_call 事件
5. 路由层执行对应的服务方法
6. 路由层构造 function_result
7. 路由层调用 continue_with_function_result
8. 将 function_result 以标准格式喂回AI
9. AI基于工具结果继续处理，输出最终回复
10. 保存所有消息到对话历史
```

**Function Calling协议：**
```python
# 工具定义
FunctionDeclaration(
    name="draw_tarot_cards",
    description="...",
    parameters={
        "type": "object",
        "properties": {...},
        "required": [...]
    }
)

# 函数调用事件
{"function_call": {
    "name": "draw_tarot_cards",
    "args": {"spread_type": "three_card", "card_count": 3, ...}
}}

# 函数结果
{"success": True, "cards": [...]}

# 喂回AI
FunctionResponse(
    name="draw_tarot_cards",
    response={"success": True, "cards": [...]}
)
```

### 架构优势

1. **标准化**：使用Gemini官方Function Calling机制，符合API规范
2. **可扩展性**：工具定义与业务逻辑分离，易于添加新工具
3. **多会话支持**：塔罗和星座会话各自配置不同的工具集
4. **错误处理**：函数执行失败时返回错误信息，AI会据此调整回复
5. **完整上下文**：函数调用和结果都保存到对话历史，AI可追溯

### 文件改动

**后端：**
- `backend/services/gemini_service.py` - 重构，添加Function Calling支持
- `backend/routers/tarot.py` - 重构，对接Agent Loop
- `backend/routers/astrology.py` - 重构，对接Agent Loop

**文档：**
- `arch.md` - 更新架构说明，添加Function Calling机制说明
- `update_log.md` - 本次更新日志

### 注意事项

- 前端无需改动，SSE事件格式保持兼容
- `draw_cards` 和 `fetch_chart` 手动端点保留，供特殊场景使用
- 旧的XML标签机制已完全移除

---

## 2025-10-06 (下午) - 修复星座功能交互Bug

**Bug修复：**
修复AI获取星盘数据后不能自动继续对话的问题。

### 问题描述

**症状：**
- AI说"让我为您获取星盘数据，稍等片刻..."后停止
- 必须等待用户再次输入才会基于星盘数据回答
- 用户消息显示延迟

**根本原因：**
- `onFetchChart` 回调在流式输出过程中被触发
- 只获取了星盘数据，但没有自动触发AI继续说话
- 类似塔罗抽牌后需要自动触发AI解读，但这里缺少这一步

### 解决方案

**1. 添加状态标志追踪星盘数据获取**
- 新增 `chartJustFetched` 状态
- 在 `onFetchChart` 回调中设置标志为 `true`

**2. 流式完成后自动触发AI继续**
- 检测 `chartJustFetched` 标志
- 如果为 `true`，自动发送触发消息："星盘数据已准备好，请继续解读"
- AI收到触发消息后，基于星盘数据继续解读

**3. 优化用户消息显示**
- 删除流式输出前的对话刷新（减少不必要的重新渲染）
- 在 ChatMessage 组件中隐藏触发消息

**4. 修复路由404错误**
- 为 `/api/astrology/fetch-chart` 路由参数添加 `Query` 类型声明

### 代码改动

**前端 (App.tsx):**
```typescript
// 添加状态标志
const [chartJustFetched, setChartJustFetched] = useState(false);

// onFetchChart 回调中设置标志
await astrologyApi.fetchChart(conversation_id);
setChartJustFetched(true);

// 流式完成后检查标志，自动触发AI继续
if (chartJustFetched) {
  setChartJustFetched(false);
  await astrologyApi.sendMessage(
    conversation_id,
    '星盘数据已准备好，请继续解读',
    // ...
  );
}
```

**前端 (ChatMessage.tsx):**
```typescript
// 隐藏触发消息
if (isUser && (
  message.content === '星盘数据已准备好，请继续解读' ||
  message.content === '我已经填写好出生信息了'
)) {
  return null;
}
```

**后端 (routers/astrology.py):**
```python
# 修复路由参数
@router.post("/fetch-chart")
async def fetch_chart(conversation_id: str = Query(..., description="对话ID")):
```

### 测试流程

修复后的完整流程：
```
1. 用户问：本月运势怎样
2. AI判断需要星盘资料
3. AI返回 <fetch_chart> 标签
4. 前端自动获取星盘数据
5. 流式输出完成后，自动发送触发消息
6. AI基于星盘数据继续解读
```

用户体验：
- ✅ AI获取星盘数据后自动继续对话
- ✅ 无需用户再次输入
- ✅ 触发消息不显示在界面上
- ✅ 流程顺畅自然

---

## 2025-10-06 (上午) - 星座功能全面升级：AI智能判断与主动开场

**功能升级：**
将"星盘解读"升级为"星座"功能，支持星座咨询、运势分析、星盘解读等多种场景，AI能智能判断是否需要星盘资料并按需触发信息收集。

### 核心改进

**1. 按钮文案修改**
- ✅ "星盘解读" → "星座"，扩展功能范围

**2. AI主动开场机制**
- ✅ 删除用户开场白，点击星座按钮后发送空消息触发AI主动说话
- ✅ AI主动欢迎用户："我是你的星座顾问，很高兴为你解答星座、运势、星盘等相关问题"

**3. AI智能判断机制**
- ✅ AI根据问题自动判断是否需要星盘资料
- ✅ 需要星盘：本命盘、上升星座、个人行星落座等
- ✅ 不需要星盘：星座性格、一般运势、星座配对等
- ✅ 通过 `<need_profile>` 和 `<fetch_chart>` 标签触发前端操作

**4. 按需触发资料收集**
- ✅ 后端检测AI回复中的特殊标签，通过SSE发送给前端
- ✅ 前端自动处理：弹窗收集资料或自动获取星盘
- ✅ 不需要星盘的问题，AI直接回答

**5. Bug修复**
- ✅ 修复 `/api/astrology/fetch-chart` 路由404错误
- ✅ 添加 `Query` 参数明确指定查询参数类型

### 技术实现

**后端：**
- `gemini_service.py`: 更新系统提示词，新增3个标签处理方法
- `routers/astrology.py`: 
  - 支持空消息触发AI开场
  - 检测并发送AI事件（need_profile, fetch_chart）
  - 修复fetch_chart路由参数定义

**前端：**
- `SessionButtons.tsx`: 按钮文案修改
- `api.ts`: 增加onNeedProfile和onFetchChart回调
- `App.tsx`: 简化流程，统一处理AI事件

**文档：**
- `arch.md`: 更新星座功能流程图
- `update_log.md`: 记录本次改动

### 用户体验提升

**改进后：**
```
用户点击星座 → AI主动开场 → 用户提问 → AI智能判断 → 
  需要星盘：自动弹窗收集资料
  不需要星盘：直接回答
```

**优势：**
1. ✨ 更自然：AI主动开场
2. 🧠 更智能：AI自动判断问题类型
3. 🔄 更灵活：用户可先咨询一般问题
4. 😊 更友好：减少操作步骤

---

## 2025-10-04 - 优化星盘解读交互流程

**优化内容：**
调整星盘解读功能的交互流程，使其更符合用户体验和AI引导的设计理念。

### 交互流程改进

**修改前的流程：**
```
点击星盘解读 → 检查用户资料 → 
  - 无资料：弹出填写窗口
  - 有资料：直接获取星盘数据 → AI引导
```

**修改后的流程：**
```
点击星盘解读 → 发送随机开场白 → AI判断用户资料完整性 → 
  - 无资料：AI提示可以补充资料，或直接提问
  - 有资料：AI告知可以获取星盘数据
→ 用户自由选择后续操作
```

### 核心改动

**1. 前端交互流程 (frontend/src/App.tsx)**
- ✅ 修改 `handleSelectSession` - 星盘解读不再预先检查资料
- ✅ 添加5种随机开场白，与塔罗占卜体验一致
- ✅ 开场白后让AI判断资料完整性并引导用户
- ✅ 修改 `handleSendMessage` - 检测用户消息中的关键词
  - 检测"补充资料"等关键词 → 弹出填写窗口
  - 检测"获取星盘"等关键词 → 调用API获取星盘数据
- ✅ 简化 `handleAstrologyProfileSkip` - 用户跳过后可继续自由对话
- ✅ 删除不再需要的 `startAstrologyReading` 函数

**2. AI系统提示词优化 (backend/services/gemini_service.py)**
- ✅ 增强 `ASTROLOGY_SYSTEM_PROMPT`
- ✅ 明确指示AI如何判断用户资料完整性
- ✅ 针对不同情况给出不同的引导话术：
  - 无资料：提示补充资料或直接提问
  - 有资料无数据：引导获取星盘数据
  - 有星盘数据：直接进行解读
- ✅ AI根据用户回复灵活处理

**3. 消息显示优化 (frontend/src/components/ChatMessage.tsx)**
- ✅ 隐藏自动触发的"资料补充好了，我的星盘信息已经准备好了"消息
- ✅ 保持界面简洁，类似塔罗占卜的触发消息处理

### 用户体验提升

**1. 更自然的对话流程**
- 无需预先判断，AI智能引导
- 用户可以自由选择是否补充资料
- 支持直接提问，无需强制填写资料

**2. 灵活的交互方式**
- 关键词检测：用户说"我想补充资料" → 自动弹窗
- 关键词检测：用户说"请获取星盘数据" → 自动获取
- 自由对话：用户可以在任何时候提问

**3. 一致的体验设计**
- 与塔罗占卜功能保持一致的交互模式
- 随机开场白增加趣味性
- 隐藏技术细节，保持界面简洁

### 关键词检测

**补充资料关键词：**
- 补充资料、填写资料、提供资料、完善资料
- 我想补充、想要填写

**获取星盘关键词：**
- 获取星盘、查看星盘、生成星盘、星盘数据
- 本命盘、请帮我获取

### 技术要点

1. **AI驱动的流程判断**：将判断逻辑交给AI，前端只负责执行
2. **关键词检测**：使用正则表达式检测用户意图
3. **自动触发机制**：填写资料或获取数据后自动触发AI解读
4. **消息过滤**：隐藏技术性的触发消息，保持界面美观

---

## 2025-10-04 - 扩展星盘数据：添加南北交点和婚神星

**功能扩展：** 在星盘解读中添加南北交点（虚星）和婚神星（小行星）数据

### 修改内容

**1. 添加新的星体ID常量**
```python
# backend/services/astrology_service.py
VIRTUAL_POINTS = [10, 11]  # 北交点、南交点
ASTEROIDS = [3]             # 婚神星
```

**2. 扩展API请求参数**
```python
params = {
    "planets": STANDARD_PLANETS,    # 10个主要行星
    "planet_xs": ASTEROIDS,         # ✅ 小行星
    "virtual": VIRTUAL_POINTS,      # ✅ 虚星
    ...
}
```

**3. 更新数据格式化函数**
- 添加虚星名称映射（北交点、南交点）
- 添加小行星名称映射（婚神星）
- 在行星落座部分包含虚星数据
- 新增【小行星】独立章节

**4. 增强调试日志**
- 打印完整的请求JSON数据（格式化显示）
- 显示各类数据的数量统计（行星、小行星、虚星、宫位）
- 详细列出小行星和虚星的具体信息

---

## 2025-10-04 - 添加星盘数据日志输出 & 修复AI数据传递

**问题1：** 需要在后台打印星盘数据，检查格式化是否正确  
**问题2：** 星盘数据没有正确传递给AI

**解决方案：**

**1. 添加详细的日志输出（3个层级）**

**星盘API调用层：**
```python
# backend/services/astrology_service.py
[星盘API] 正在调用星盘API...
[星盘API] 出生信息: 1999-10-17 21:00:00 @ 北京
[星盘API] ✅ API调用成功
[星盘API] 获取到 10 个行星数据
[星盘API] 获取到 12 个宫位数据
[星盘API] 示例行星数据（前3个）：
  - 太阳: 天秤座，第9宫
  - 月亮: 金牛座，第3宫
  - 水星: 天蝎座，第10宫
```

**数据格式化层：**
```python
# backend/routers/astrology.py
============================================================
【星盘数据获取成功】
============================================================
用户ID: user_xxx
对话ID: conv_xxx
出生信息: 1999-10-17 21:00 @ 北京

格式化后的星盘文本数据：
------------------------------------------------------------
【星盘基本信息】
出生日期：1999年10月17日
出生时间：21:00
出生地点：北京

【行星落座】
太阳：落在天秤座 17°18' (第9宫)
月亮：落在金牛座 25°32' (第3宫)
...
------------------------------------------------------------
```

**AI传递层：**
```python
# backend/services/gemini_service.py
[Gemini] 会话类型: astrology
[Gemini] 消息总数: 5
[Gemini] ✅ 消息 #3 包含星盘数据
[Gemini] 预览: [星盘数据]
【星盘基本信息】
出生日期：1999年10月17日...
```

**2. 修复星盘数据传递给AI的问题**

**原因：**
- SYSTEM消息的处理逻辑只考虑了塔罗牌（`if msg.tarot_cards`）
- 星盘数据也是SYSTEM消息，但内容在`msg.content`中
- 原代码直接跳过（`continue`），导致星盘数据没有传递给AI

**修复：**
```python
# backend/services/gemini_service.py
if msg.role == MessageRole.SYSTEM:
    # 处理塔罗抽牌结果
    if msg.tarot_cards:
        # ... 原有逻辑
    # 🆕 处理星盘数据（内容以[星盘数据]开头）
    elif msg.content.startswith("[星盘数据]"):
        gemini_messages.append({
            "role": "user",
            "parts": [{"text": msg.content}]
        })
    continue
```

**修改文件：**
- `backend/services/astrology_service.py` - 添加API调用日志
- `backend/routers/astrology.py` - 添加格式化数据日志
- `backend/services/gemini_service.py` - 修复SYSTEM消息处理 + 添加AI传递日志

**测试结果：**
- ✅ 后台会清晰显示三个层级的日志
- ✅ 星盘数据正确传递给AI
- ✅ AI能够基于星盘数据进行解读
- ✅ 出生地信息已包含在星盘数据中

---

## 2025-10-04 - 修复星盘API调用格式错误

**问题：** 星盘API返回错误："行星请求格式应为json对象，当前请求是string"

**原因：** 
- 使用 `data=params` 发送请求，会以表单数据格式（application/x-www-form-urlencoded）发送
- `planets` 数组参数被转换为字符串，导致API无法识别

**解决方案：**
- 将 `client.post(ASTROLOGY_API_URL, data=params)` 改为 `client.post(ASTROLOGY_API_URL, json=params)`
- 使用JSON格式发送请求体，数组参数会被正确处理

**修改文件：**
- `backend/services/astrology_service.py` - 第89行

**测试结果：**
- ✅ 星盘API现在能正确接收数组参数
- ✅ 能够成功获取星盘数据
- ✅ 星盘解读功能正常工作

---

## 2025-10-04 - 星盘解读功能上线

**功能概述：**
完成了星盘解读功能的完整开发，用户现在可以通过填写出生信息获取个人星盘解读，或者根据当前星座获取总体运势建议。

### 后端变更

**1. 数据模型扩展 (backend/models.py)**
- ✅ 在 `UserProfile` 添加 `birth_city` 字段（出生城市）
- 支持完整的星盘资料存储

**2. 配置更新 (backend/config.py)**
- ✅ 添加 `ASTROLOGY_API_URL` - 星盘API地址
- ✅ 添加 `ASTROLOGY_ACCESS_TOKEN` - 星盘API访问令牌（环境变量）

**3. 新增星盘服务 (backend/services/astrology_service.py)**
- ✅ `fetch_natal_chart()` - 调用外部API获取本命盘数据
- ✅ `format_chart_data_to_text()` - 将星盘数据格式化为文字描述
- ✅ `get_city_coordinates()` - 获取城市经纬度（内置18个主要城市）
- ✅ `get_current_zodiac_sign()` - 获取当前时间对应的星座
- 使用 httpx 异步HTTP客户端
- 支持行星位置、宫位、四轴点数据解析

**4. Gemini服务增强 (backend/services/gemini_service.py)**
- ✅ 添加 `ASTROLOGY_SYSTEM_PROMPT` - 星盘解读专用提示词
- ✅ `_format_messages_for_gemini()` 支持 `session_type` 参数
- ✅ `stream_response()` 根据会话类型选择不同的系统提示词
- AI能够识别 `[星盘数据]` 标记，基于星盘信息解读

**5. 新增星盘路由 (backend/routers/astrology.py)**
- ✅ `POST /api/astrology/message` - 星盘解读消息（流式输出）
- ✅ `POST /api/astrology/fetch-chart` - 获取用户星盘数据
- ✅ `GET /api/astrology/check-profile/{user_id}` - 检查资料完整性
- ✅ `GET /api/astrology/current-zodiac` - 获取当前星座

**6. 主应用更新 (backend/main.py)**
- ✅ 注册星盘路由 `astrology.router`

### 前端变更

**1. 类型定义扩展 (frontend/src/types/index.ts)**
- ✅ `UserProfile` 添加 `birth_city` 字段

**2. 新增星盘资料填写弹窗 (frontend/src/components/AstrologyProfileModal.tsx)**
- ✅ 性别选择（可选）
- ✅ 出生日期选择（年月日，1950-2024）
- ✅ 出生时间选择（时分，0-23时，0-59分）
- ✅ 出生城市选择（18个主要城市下拉列表）
- ✅ 表单验证（必填项检查）
- ✅ 支持"保存并继续"和"暂时跳过"两种操作

**3. API服务扩展 (frontend/src/services/api.ts)**
- ✅ `astrologyApi.sendMessage()` - 发送星盘解读消息（流式）
- ✅ `astrologyApi.checkProfile()` - 检查用户资料完整性
- ✅ `astrologyApi.fetchChart()` - 获取星盘数据
- ✅ `astrologyApi.getCurrentZodiac()` - 获取当前星座

**4. 主应用逻辑增强 (frontend/src/App.tsx)**
- ✅ 导入星盘相关组件和API
- ✅ 添加状态：`showAstrologyProfileModal`, `pendingAstrologyConversation`
- ✅ `handleSelectSession()` 支持星盘解读流程
  - 检查用户资料完整性
  - 无资料：弹出填写窗口
  - 已有资料：直接开始解读
- ✅ 新增 `startAstrologyReading()` - 开始星盘解读流程
- ✅ 新增 `handleAstrologyProfileSubmit()` - 处理资料提交
- ✅ 新增 `handleAstrologyProfileSkip()` - 处理跳过填写
- ✅ `handleSendMessage()` 根据会话类型选择对应API

**5. 会话按钮更新 (frontend/src/components/SessionButtons.tsx)**
- ✅ 移除星盘解读的"即将推出"标记
- ✅ 启用星盘解读按钮

### 核心流程

**1. 有完整资料的情况：**
```
点击星盘解读 → 检查资料 → 调用星盘API → 
获取星盘数据 → AI引导 → 用户提问 → AI解读
```

**2. 无资料的情况：**
```
点击星盘解读 → 检查资料 → 弹出填写窗口 → 
用户填写 → 保存资料 → 调用星盘API → 
获取星盘数据 → AI引导 → 用户提问 → AI解读
```

**3. 拒绝填写资料的情况：**
```
点击星盘解读 → 检查资料 → 弹出填写窗口 → 
用户点击"暂时跳过" → AI根据当前星座给出总体运势
```

### 技术亮点

1. **智能资料检查**：自动判断用户资料完整性，提供不同的交互流程
2. **外部API集成**：成功集成星盘API，实现星盘数据获取和解析
3. **灵活的处理机制**：支持有资料、无资料、拒绝填写三种情况
4. **数据格式化**：将复杂的星盘JSON数据转换为易读的文字描述
5. **游客模式支持**：游客用户可以填写资料使用星盘功能，但不保存为用户资料

### 文档更新

- ✅ 更新 `arch.md` - 添加星盘解读功能的完整架构设计
  - 星盘服务层说明
  - 星盘路由说明  
  - 星盘资料填写弹窗组件说明
  - 星盘解读完整流程图
  - 技术亮点和改进方向

### 测试建议

运行前需要设置环境变量：
```bash
export ASTROLOGY_ACCESS_TOKEN="your_token_here"
```

建议测试场景：
1. ✅ 游客用户 → 星盘解读 → 填写资料 → 查看解读
2. ✅ 注册用户 → 星盘解读 → 已有资料 → 直接解读
3. ✅ 用户 → 星盘解读 → 拒绝填写 → 查看总体运势
4. ✅ 星盘解读后继续提问，测试多轮对话

---

## 2025-10-04 - 修复开场白显示问题（最终版）

**问题：** 点击"塔罗占卜"按钮后，对话界面没有出现开场白，AI 没有回复

**根本原因：**
- React 状态更新是异步的
- 使用 setTimeout 延迟仍然无法解决问题
- 闭包捕获了旧的 `currentConversation` 状态（null）
- `handleSendMessage` 中的检查 `if (!currentConversation)` 直接返回

**正确的解决方案：**
- ❌ ~~使用 setTimeout 延迟~~（无效，闭包问题）
- ✅ **直接使用 `newConv.conversation_id` 发送消息**
- 不依赖 React 状态更新，直接使用创建后的对话对象
- 将消息发送逻辑内联到 `handleSelectSession` 中

**代码变更：**
```typescript
// 之前：依赖状态 + setTimeout（无效）
setCurrentConversation(newConv);
setTimeout(() => handleSendMessage(randomGreeting), 100);

// 现在：直接使用 newConv
const newConv = await conversationApi.create(...);
await tarotApi.sendMessage(
  newConv.conversation_id,  // 直接使用，不依赖状态
  randomGreeting,
  ...
);
```

**技术细节：**
- 修改文件：`frontend/src/App.tsx`
- 修改方法：`handleSelectSession`
- 避免 JavaScript 闭包捕获旧状态的问题
- 这是处理 React 异步状态更新的正确方式

**测试结果：**
- ✅ 点击"塔罗占卜"按钮
- ✅ 立即发送随机开场白
- ✅ AI 正常响应欢迎消息
- ✅ 流式输出正常显示

---

## 2025-10-03 - macOS 启动修复

**问题：** 在 macOS 上启动后端时出现模块导入错误
```
ModuleNotFoundError: No module named 'backend'
```

**解决方案：** 修复所有 Python 模块的导入路径
- 将 `from backend.xxx import xxx` 改为 `from xxx import xxx`
- 影响文件：`main.py`, `services/*.py`, `routers/*.py`
- 原因：在 macOS 上运行 Python 时，当前工作目录是项目根目录，不需要 `backend.` 前缀

**测试结果：**
- ✅ 后端成功启动在 http://localhost:8000
- ✅ 前端成功启动在 http://localhost:5173  
- ✅ API 健康检查通过
- ✅ 用户创建 API 测试通过

**技术细节：**
- 使用 `source venv/bin/activate` 激活虚拟环境
- 使用 `python backend/main.py` 启动后端
- 使用 `npm run dev` 启动前端
- 端口占用问题通过 `lsof -ti:8000 | xargs kill -9` 解决
 ---

## 2025-10-03 - 抽牌流程优化

**问题：** 抽牌交互流程不正确，重复抽牌，不解读
修复了抽牌交互逻辑的问题。让我总结一下所做的修改：

**解决方案：**
1. 系统提示词优化 (backend/services/gemini_service.py)
明确告诉 AI 只能抽牌一次
使用 [抽牌结果] 特殊标记让 AI 识别已完成抽牌
强调看到抽牌结果后直接解读，不要再次返回抽牌指令
2. 消息格式化修改 (backend/services/gemini_service.py)
将 SYSTEM 消息（抽牌结果）转换为带 [抽牌结果] 标记的 USER 消息
让 AI 能够"看到"抽牌结果，而不是忽略它
格式：[抽牌结果] 用户已完成抽牌，抽到的牌如下：...
3. 前端自动触发解读 (frontend/src/App.tsx)
抽牌完成后自动发送"请根据抽牌结果进行解读"
这条消息会触发 AI 开始解读
不需要用户手动发送消息
4. 隐藏触发消息 (frontend/src/components/ChatMessage.tsx)
过滤掉"请根据抽牌结果进行解读"这条消息
用户界面不显示这条自动触发的消息
保持界面简洁自然
5. 允许继续对话 (frontend/src/App.tsx)
移除抽牌后禁用输入框的限制
用户可以在解读完成后继续提问和深入探讨
占位符提示"继续深入探讨，或提出新的疑问..."
6. 三层防重复抽牌机制
后端 API 层：has_drawn_cards 标记阻止重复 API 调用
AI 提示层：系统提示词和抽牌结果标记引导 AI 行为
前端逻辑层：console.warn 检测异常情况
