"""
占卜笔记本定时任务调度器
管理延迟12小时生成笔记的定时任务
"""
import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import threading

from config import DATA_DIR


@dataclass
class NotebookTask:
    """笔记生成任务"""
    conversation_id: str
    user_id: str
    scheduled_time: str  # ISO格式时间字符串
    created_at: str  # 任务创建时间
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> "NotebookTask":
        return cls(**data)


class NotebookTaskScheduler:
    """笔记本任务调度器 - 单例模式"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        # 避免重复初始化
        if hasattr(self, '_initialized'):
            return
        
        self._initialized = True
        self.task_file = Path(DATA_DIR) / "notebook_task_list.json"
        self.tasks: List[NotebookTask] = []
        self.running = False
        self.worker_task: Optional[asyncio.Task] = None
        self._processing_lock = asyncio.Lock()
        
        # 确保数据目录存在
        self.task_file.parent.mkdir(parents=True, exist_ok=True)
        
        # 加载任务列表
        self._load_tasks()
    
    def _load_tasks(self):
        """从文件加载任务列表"""
        if not self.task_file.exists():
            self.tasks = []
            return
        
        try:
            with open(self.task_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.tasks = [NotebookTask.from_dict(task) for task in data]
            print(f"[TaskScheduler] 加载了 {len(self.tasks)} 个待处理任务")
        except Exception as e:
            print(f"[TaskScheduler] 加载任务列表失败: {e}")
            self.tasks = []
    
    def _save_tasks(self):
        """保存任务列表到文件"""
        try:
            with open(self.task_file, 'w', encoding='utf-8') as f:
                json.dump([task.to_dict() for task in self.tasks], f, ensure_ascii=False, indent=2)
            print(f"[TaskScheduler] 任务列表已保存，共 {len(self.tasks)} 个任务")
        except Exception as e:
            print(f"[TaskScheduler] 保存任务列表失败: {e}")
    
    async def add_task(self, conversation_id: str, user_id: str) -> bool:
        """
        添加新任务（如果不存在）
        
        Returns:
            True: 成功添加新任务
            False: 任务已存在
        """
        # 检查是否已存在
        for task in self.tasks:
            if task.conversation_id == conversation_id:
                print(f"[TaskScheduler] 任务已存在，跳过: {conversation_id}")
                return False
        
        # 创建新任务，12小时后执行
        scheduled_time = datetime.utcnow() + timedelta(hours=12)
        new_task = NotebookTask(
            conversation_id=conversation_id,
            user_id=user_id,
            scheduled_time=scheduled_time.isoformat(),
            created_at=datetime.utcnow().isoformat()
        )
        
        self.tasks.append(new_task)
        self._save_tasks()
        
        print(f"[TaskScheduler] 新增任务: {conversation_id}, 计划执行时间: {scheduled_time}")
        
        # 如果worker未运行，启动它
        if not self.running:
            await self.start_worker()
        
        return True
    
    async def remove_task(self, conversation_id: str):
        """移除任务"""
        self.tasks = [t for t in self.tasks if t.conversation_id != conversation_id]
        self._save_tasks()
        print(f"[TaskScheduler] 移除任务: {conversation_id}")
    
    async def start_worker(self):
        """启动后台工作线程"""
        if self.running:
            print("[TaskScheduler] Worker 已在运行")
            return
        
        self.running = True
        
        # 创建异步任务
        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(self._worker_loop())
        
        print("[TaskScheduler] Worker 已启动")
    
    async def stop_worker(self):
        """停止后台工作线程"""
        self.running = False
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass
        print("[TaskScheduler] Worker 已停止")
    
    async def _worker_loop(self):
        """后台工作循环，处理定时任务"""
        print("[TaskScheduler] Worker loop 开始")
        
        while self.running:
            try:
                # 每分钟检查一次
                await asyncio.sleep(60)
                
                if not self.tasks:
                    continue
                
                current_time = datetime.utcnow()
                
                # 查找到期的任务
                due_tasks = [
                    task for task in self.tasks
                    if datetime.fromisoformat(task.scheduled_time) <= current_time
                ]
                
                if due_tasks:
                    print(f"[TaskScheduler] 发现 {len(due_tasks)} 个到期任务")
                    # 顺序执行（使用锁保证不并行）
                    async with self._processing_lock:
                        for task in due_tasks:
                            await self._process_task(task)
                
            except asyncio.CancelledError:
                print("[TaskScheduler] Worker loop 被取消")
                break
            except Exception as e:
                print(f"[TaskScheduler] Worker loop 错误: {e}")
                import traceback
                traceback.print_exc()
    
    async def _process_task(self, task: NotebookTask):
        """处理单个任务"""
        print(f"[TaskScheduler] 开始处理任务: {task.conversation_id}")
        
        try:
            # 获取对话和用户信息
            from services.conversation_service import ConversationService
            from services.storage_service import StorageService
            from services.notebook_service import notebook_service
            
            conversation = await ConversationService.get_conversation(task.conversation_id)
            if not conversation:
                print(f"[TaskScheduler] 对话不存在: {task.conversation_id}")
                await self.remove_task(task.conversation_id)
                return
            
            user = await StorageService.get_user(task.user_id)
            
            # 调用笔记生成服务（不再检查时间条件）
            result = await notebook_service.generate_and_save_entry(
                user_id=task.user_id,
                conversation=conversation,
                user=user
            )
            
            print(f"[TaskScheduler] 任务完成: {task.conversation_id}, 结果: {result}")
            
        except Exception as e:
            print(f"[TaskScheduler] 处理任务失败: {task.conversation_id}, 错误: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # 无论成功失败，都移除任务
            await self.remove_task(task.conversation_id)
    
    def get_pending_tasks(self) -> List[Dict]:
        """获取待处理任务列表（用于调试）"""
        return [task.to_dict() for task in self.tasks]


# 全局单例
task_scheduler = NotebookTaskScheduler()

