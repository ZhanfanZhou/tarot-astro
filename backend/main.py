from dotenv import load_dotenv
load_dotenv()  # 加载.env文件

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from routers import users, conversations, tarot, astrology


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    from services.notebook_task_scheduler import task_scheduler
    
    # 启动时执行
    print("=" * 60)
    print("启动占卜笔记任务调度器")
    print("=" * 60)
    
    # 启动任务调度器
    await task_scheduler.start_worker()
    
    # 显示待处理任务
    pending_tasks = task_scheduler.get_pending_tasks()
    if pending_tasks:
        print(f"恢复 {len(pending_tasks)} 个待处理任务:")
        for task in pending_tasks:
            print(f"  - {task['conversation_id']} (计划时间: {task['scheduled_time']})")
    else:
        print("无待处理任务")
    
    print("=" * 60)
    
    yield  # 应用运行
    
    # 关闭时执行
    print("=" * 60)
    print("停止占卜笔记任务调度器")
    print("=" * 60)
    await task_scheduler.stop_worker()


app = FastAPI(
    title="塔罗占卜API",
    description="玄学&心理应用后端API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(users.router)
app.include_router(conversations.router)
app.include_router(tarot.router)
app.include_router(astrology.router)


@app.get("/")
async def root():
    return {
        "message": "塔罗占卜API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)




