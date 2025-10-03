# 贡献指南

感谢你对塔罗占卜项目的关注！

## 开发环境设置

### 前置要求
- Python 3.10+
- Node.js 18+
- Git

### 克隆项目
```bash
git clone <repository-url>
cd ftarot
```

### 安装依赖

#### Windows
```bash
setup.bat
```

#### macOS/Linux
```bash
chmod +x setup.sh
./setup.sh
```

## 开发流程

### 1. 创建分支
```bash
git checkout -b feature/your-feature-name
```

### 2. 开发

#### 后端开发
```bash
# 激活虚拟环境
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# 运行开发服务器
uvicorn backend.main:app --reload
```

#### 前端开发
```bash
cd frontend
npm run dev
```

### 3. 代码规范

#### Python
- 使用 PEP 8 代码风格
- 使用类型提示
- 添加文档字符串

#### TypeScript
- 使用 ESLint 推荐配置
- 使用 TypeScript 严格模式
- 组件使用函数式写法

### 4. 提交代码

```bash
git add .
git commit -m "[Cursor] 简短描述你的改动"
git push origin feature/your-feature-name
```

### 5. 创建 Pull Request

- 在 GitHub/GitLab 上创建 PR
- 标题使用 `[Cursor] 功能描述`
- 详细描述你的改动和原因
- 关联相关的 Issue

## 代码审查标准

- [ ] 代码符合项目风格
- [ ] 添加了必要的注释
- [ ] 更新了 README.md（如果需要）
- [ ] 更新了 arch.md（如果改动了架构）
- [ ] 测试通过（如果有）
- [ ] 没有引入新的警告或错误

## 报告 Bug

请在 Issues 中创建 Bug 报告，包含：

1. **Bug 描述**：简短描述问题
2. **重现步骤**：如何重现这个问题
3. **期望行为**：你期望发生什么
4. **实际行为**：实际发生了什么
5. **环境信息**：操作系统、Python 版本、Node.js 版本等
6. **截图**：如果可能，提供截图

## 功能建议

欢迎提出新功能建议！请在 Issues 中创建 Feature Request，包含：

1. **功能描述**：简短描述功能
2. **使用场景**：这个功能解决什么问题
3. **实现思路**：你的初步想法（可选）
4. **相关资源**：参考资料或类似实现（可选）

## 联系方式

有任何问题，欢迎通过以下方式联系：

- 提交 Issue
- 发送 Pull Request

感谢你的贡献！🎉




