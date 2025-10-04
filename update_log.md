**文档版本：** 1.0.2  
**最后更新：** 2025-10-04  
**维护者：** Cursor AI Assistant

# 更新日志

## 2025-10-04 - 修复开场白显示问题

**问题：** 点击"塔罗占卜"按钮后，对话界面没有出现开场白

**原因分析：**
- React 状态更新是异步的
- `setCurrentConversation(newConv)` 调用后，状态还未立即更新
- `handleSendMessage` 被立即调用时，`currentConversation` 仍然是 null
- 导致 `handleSendMessage` 中的检查 `if (!currentConversation)` 直接返回

**解决方案：**
- 在调用 `handleSendMessage` 前添加 100ms 延迟
- 使用 `setTimeout(() => { handleSendMessage(randomGreeting); }, 100);`
- 确保 React 状态更新完成后再发送消息

**技术细节：**
- 修改文件：`frontend/src/App.tsx`
- 修改方法：`handleSelectSession`
- 这是一个常见的 React 状态更新时序问题

**测试建议：**
- 点击"塔罗占卜"按钮
- 确认自动发送开场白
- 确认 AI 正常回复

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
