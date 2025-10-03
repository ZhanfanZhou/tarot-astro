# 塔罗占卜 - 玄学心理应用

一个基于 AI 的塔罗牌占卜应用，使用 Google Gemini 2.0 Flash 模型提供专业的塔罗牌解读。

## 功能特性

### 🔮 塔罗牌占卜
- AI 智能引导用户提出问题
- 根据问题智能选择牌阵和牌数
- 精美的抽牌动画和交互
- 专业的塔罗牌解读（支持正逆位）
- 多轮对话深入探讨

### 💬 对话管理
- ChatGPT 风格的对话界面
- 自动保存对话历史
- 支持查看和继续历史占卜
- 一次占卜只能抽一次牌

### 👤 用户管理
- 游客模式：快速开始，不保存历史
- 注册用户：保存所有对话记录
- 支持个人资料（昵称、性别、生日等）
- 本地存储，保护隐私

## 技术栈

### 后端
- **FastAPI** - 现代 Python Web 框架
- **Google Gemini 2.0 Flash** - AI 模型
- **Pydantic** - 数据验证
- **JSON 本地存储** - 用户和对话数据

### 前端
- **React 18** + **TypeScript** - UI 框架
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **Framer Motion** - 动画库
- **Zustand** - 状态管理
- **Axios** - HTTP 客户端

## 快速开始

### 前置要求
- Python 3.10+
- Node.js 18+
- Google Gemini API Key

### 1. 克隆项目
```bash
cd ftarot
```

### 2. 配置环境变量
创建 `.env` 文件：
```bash
GEMINI_API_KEY=your_gemini_api_key_here
SECRET_KEY=your_secret_key_here
```

### 3. 启动后端

#### Windows
```bash
# 激活虚拟环境
.\venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 启动后端服务
python backend/main.py
```

#### macOS/Linux
```bash
# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动后端服务
python backend/main.py
```

后端将在 `http://localhost:8000` 运行

### 4. 启动前端

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端将在 `http://localhost:5173` 运行

### 5. 访问应用

打开浏览器访问 `http://localhost:5173`

## API 文档

后端启动后，访问 `http://localhost:8000/docs` 查看完整的 API 文档（Swagger UI）

## 项目结构

```
ftarot/
├── backend/                # 后端代码
│   ├── routers/           # API 路由
│   ├── services/          # 业务逻辑
│   ├── models.py          # 数据模型
│   ├── config.py          # 配置文件
│   ├── main.py            # 主应用
│   └── data/              # 数据存储
├── frontend/              # 前端代码
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── services/      # API 服务
│   │   ├── stores/        # 状态管理
│   │   ├── types/         # TypeScript 类型
│   │   └── App.tsx        # 主应用
│   └── package.json
├── requirements.txt       # Python 依赖
└── README.md
```

## 使用说明

### 首次使用

1. **选择登录方式**
   - 游客模式：快速体验，不保存历史
   - 注册账号：保存所有占卜记录

2. **填写个人资料（可选）**
   - 昵称：占卜师会用这个称呼你
   - 性别、生日：用于更个性化的解读

3. **开始占卜**
   - 点击"塔罗占卜"按钮
   - AI 会引导你提出问题

### 占卜流程

1. **提出问题**
   - 在输入框输入你想占卜的问题
   - 问题越具体，解读越精准

2. **抽牌**
   - AI 会根据问题选择合适的牌阵
   - 点击"开始洗牌"
   - 从展开的牌中选择指定数量的牌
   - 点击"确认抽牌"

3. **查看解读**
   - AI 会详细解读每张牌的含义
   - 结合正逆位和牌阵位置给出建议

4. **深入探讨**
   - 可以继续提问，深入理解
   - 但不能再次抽牌

### 历史记录

- 所有对话自动保存在左侧边栏
- 点击历史对话可以查看完整记录
- 支持删除不需要的对话

## 开发指南

### 后端开发

```bash
# 激活虚拟环境
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# 安装新依赖
pip install package_name
pip freeze > requirements.txt

# 运行开发服务器（自动重载）
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 前端开发

```bash
cd frontend

# 安装新依赖
npm install package_name

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 注意事项

1. **API Key 安全**
   - 不要将 `.env` 文件提交到版本控制
   - 生产环境使用环境变量

2. **数据存储**
   - 当前使用本地 JSON 文件存储
   - 生产环境建议使用数据库

3. **游客模式**
   - 游客数据不会永久保存
   - 建议重要的占卜使用注册账号

## 常见问题

**Q: 如何获取 Gemini API Key？**
A: 访问 https://makersuite.google.com/app/apikey 创建 API Key

**Q: 为什么抽牌后不能再次抽牌？**
A: 这是塔罗占卜的规则，一次占卜只能抽一次牌，保证占卜的严肃性

**Q: 游客模式和注册用户有什么区别？**
A: 游客模式不保存历史记录，注册用户可以保存和查看所有占卜历史

## 待实现功能

- ⏳ 星盘解读
- ⏳ 聊愈功能
- ⏳ 更多塔罗牌阵
- ⏳ 导出占卜结果

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！




