# 快速启动指南

## 5分钟快速开始

### 步骤1：克隆并进入项目
```bash
cd ftarot
```

### 步骤2：运行自动化设置脚本

#### Windows
```bash
setup.bat
```

#### macOS/Linux
```bash
chmod +x setup.sh
./setup.sh
```

这个脚本会自动：
- 创建/检查 Python 虚拟环境
- 安装后端依赖
- 安装前端依赖
- 创建必要的目录

### 步骤3：配置环境变量

创建 `.env` 文件（根目录）：
```bash
# 复制示例文件
copy .env.example .env  # Windows
cp .env.example .env    # macOS/Linux
```

编辑 `.env` 文件，填入你的 Gemini API Key：
```
GEMINI_API_KEY=your_api_key_here
SECRET_KEY=your_secret_key_here
```

**获取 Gemini API Key：** 访问 https://makersuite.google.com/app/apikey

### 步骤4：启动应用

#### 启动后端（终端1）

**Windows:**
```bash
run_backend.bat
```

**macOS/Linux:**
```bash
chmod +x run_backend.sh
./run_backend.sh
```

后端将在 `http://localhost:8000` 运行

#### 启动前端（终端2）

**Windows:**
```bash
run_frontend.bat
```

**macOS/Linux:**
```bash
chmod +x run_frontend.sh
./run_frontend.sh
```

前端将在 `http://localhost:5173` 运行

### 步骤5：打开浏览器

访问 `http://localhost:5173`

## 首次使用

1. **选择登录方式**
   - 游客模式：快速体验
   - 注册账号：保存历史记录

2. **开始占卜**
   - 点击"塔罗占卜"按钮
   - 输入你的问题
   - 跟随 AI 引导进行抽牌
   - 查看解读结果

## 常见问题

### Q: 如何停止服务？
A: 在终端按 `Ctrl+C` 停止服务

### Q: 端口被占用怎么办？
A: 修改配置文件中的端口号：
- 后端：修改 `backend/main.py` 中的端口
- 前端：修改 `frontend/vite.config.ts` 中的端口

### Q: 如何查看 API 文档？
A: 后端启动后访问 `http://localhost:8000/docs`

### Q: 前端编译错误？
A: 删除 `frontend/node_modules` 和 `frontend/package-lock.json`，重新运行 `npm install`

## 手动安装（不使用脚本）

### 后端
```bash
# 激活虚拟环境
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 运行
python backend/main.py
```

### 前端
```bash
cd frontend
npm install
npm run dev
```

## 开发模式

### 后端热重载
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 前端热重载
前端默认就是热重载模式（Vite HMR）

## 生产构建

### 前端
```bash
cd frontend
npm run build
npm run preview  # 预览构建结果
```

构建产物在 `frontend/dist/` 目录

## 下一步

- 阅读 [README.md](README.md) 了解详细功能
- 查看 [docs/superpowers/specs/](docs/superpowers/specs/) 了解各功能的设计
- 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 参与开发

祝你占卜愉快！🔮✨




