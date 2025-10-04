# GitHub 推送指南

## ✅ 已完成的步骤

1. ✅ 移除了 `backend/config.py` 中硬编码的 API Key
2. ✅ 创建了 `.env` 文件（包含你的 API Key）
3. ✅ 初始化了 Git 仓库
4. ✅ 提交了所有代码到本地仓库

## 📝 接下来的步骤

### 方法一：通过 GitHub 网页创建（推荐）

1. **打开浏览器，访问 GitHub**
   - 访问 https://github.com/new

2. **创建新仓库**
   - Repository name: `ftarot`
   - Description: `🔮 塔罗占卜 - 基于 AI 的玄学心理应用`
   - 选择 Public 或 Private
   - **不要**勾选 "Initialize this repository with a README"（因为我们已经有代码了）
   - 点击 "Create repository"

3. **推送代码到 GitHub**
   
   在项目目录运行以下命令（替换 `YOUR_USERNAME` 为你的 GitHub 用户名）：
   
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ftarot.git
   git branch -M main
   git push -u origin main
   ```

### 方法二：通过 GitHub CLI（如果已安装）

```bash
# 登录 GitHub CLI
gh auth login

# 创建仓库并推送
gh repo create ftarot --public --source=. --remote=origin --push
```

## 🔐 安全提示

### ⚠️ 重要：API Key 安全

你的 API Key 已经保存在 `.env` 文件中，该文件**不会**被提交到 GitHub（已在 `.gitignore` 中配置）。

但是，**为了额外的安全**，建议你：

1. **立即在 Google AI Studio 重新生成 API Key**
   - 访问：https://makersuite.google.com/app/apikey
   - 删除旧的 Key：`AIzaSyBk518YOPBWfA68H5PI4k19QeQDgsV0Jes`
   - 创建新的 Key

2. **更新 `.env` 文件中的 Key**
   ```
   GEMINI_API_KEY=你的新API_KEY
   ```

3. **永远不要**将 `.env` 文件提交到 Git

## 📦 项目信息

- **项目名称**: ftarot（塔罗占卜）
- **描述**: 基于 AI 的玄学心理应用，使用 Google Gemini 2.0 Flash 提供专业的塔罗牌解读
- **技术栈**: 
  - 后端: FastAPI + Python
  - 前端: React + TypeScript + Vite
  - AI: Google Gemini 2.0 Flash
- **主要功能**: 
  - 塔罗牌抽牌与 AI 解读
  - 流式对话交互
  - 精美的抽牌动画
  - 用户管理和历史记录

## 📚 文档

推送后，GitHub 会自动识别以下文档：
- `README.md` - 项目主页文档
- `CONTRIBUTING.md` - 贡献指南
- `LICENSE` - 开源协议（如果需要可以添加）

## 🎯 推送后的步骤

1. **添加 GitHub Topics**（标签）
   - 在 GitHub 仓库页面点击 "Add topics"
   - 建议添加: `tarot`, `ai`, `gemini`, `fastapi`, `react`, `typescript`, `divination`

2. **编辑 About 部分**
   - 添加网站链接（如果部署了）
   - 添加描述

3. **（可选）添加 GitHub Actions**
   - 自动化测试
   - 自动部署

4. **（可选）创建 Releases**
   - 标记版本 v1.0.0

## 🔗 有用的链接

- GitHub Docs: https://docs.github.com/
- GitHub CLI: https://cli.github.com/
- Git 基础: https://git-scm.com/book/zh/v2

---

**问题？** 如果遇到任何问题，可以查看 Git 文档或联系我！


