from dotenv import load_dotenv
load_dotenv()  # 加载.env文件

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from routers import users, conversations, tarot

app = FastAPI(
    title="塔罗占卜API",
    description="玄学&心理应用后端API",
    version="1.0.0"
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




