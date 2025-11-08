import uuid
from passlib.context import CryptContext
from models import User, UserType, UserProfile, UserRegister
from services.storage_service import StorageService
from services.notebook_service import notebook_service

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserService:
    """用户管理服务"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """密码哈希"""
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """验证密码"""
        return pwd_context.verify(plain_password, hashed_password)
    
    @staticmethod
    async def create_guest_user(profile: UserProfile = None) -> User:
        """创建游客用户"""
        user = User(
            user_id=f"guest_{uuid.uuid4().hex[:12]}",
            user_type=UserType.GUEST,
            profile=profile
        )
        await StorageService.save_user(user)
        return user
    
    @staticmethod
    async def create_registered_user(register_data: UserRegister) -> User:
        """创建注册用户"""
        # 检查用户名是否已存在
        existing_user = await StorageService.get_user_by_username(register_data.username)
        if existing_user:
            raise ValueError("用户名已存在")
        
        user = User(
            user_id=f"user_{uuid.uuid4().hex[:12]}",
            user_type=UserType.REGISTERED,
            username=register_data.username,
            password_hash=UserService.hash_password(register_data.password),
            profile=register_data.profile
        )
        await StorageService.save_user(user)
        return user
    
    @staticmethod
    async def authenticate_user(username: str, password: str) -> User:
        """用户认证"""
        user = await StorageService.get_user_by_username(username)
        if not user or not user.password_hash:
            raise ValueError("用户名或密码错误")
        
        if not UserService.verify_password(password, user.password_hash):
            raise ValueError("用户名或密码错误")
        
        return user
    
    @staticmethod
    async def update_user_profile(user_id: str, profile: UserProfile) -> User:
        """更新用户资料"""
        user = await StorageService.get_user(user_id)
        if not user:
            raise ValueError("用户不存在")
        
        user.profile = profile
        await StorageService.save_user(user)
        return user
    
    @staticmethod
    async def get_user(user_id: str) -> User:
        """获取用户信息"""
        user = await StorageService.get_user(user_id)
        if not user:
            raise ValueError("用户不存在")
        return user
    
    @staticmethod
    async def convert_guest_to_registered(user_id: str, username: str, password: str) -> User:
        """将游客转换为注册用户"""
        # 获取游客用户
        user = await StorageService.get_user(user_id)
        if not user:
            raise ValueError("用户不存在")
        
        if user.user_type != UserType.GUEST:
            raise ValueError("只有游客用户可以转换为注册用户")
        
        # 检查用户名是否已存在
        existing_user = await StorageService.get_user_by_username(username)
        if existing_user:
            raise ValueError("用户名已存在")
        
        # 更新用户信息
        user.user_type = UserType.REGISTERED
        user.username = username
        user.password_hash = UserService.hash_password(password)
        
        await StorageService.save_user(user)
        return user
    
    @staticmethod
    async def delete_user_and_conversations(user_id: str):
        """删除用户及其所有对话"""
        # 获取用户信息
        user = await StorageService.get_user(user_id)
        
        # 删除用户的所有对话
        await StorageService.delete_user_conversations(user_id)
        
        # 如果是游客用户，删除其笔记本
        if user and user.user_type == UserType.GUEST:
            notebook_service.delete_notebook(user_id)
            print(f"[UserService] 已删除游客 {user_id} 的笔记本")
        
        # 删除用户
        await StorageService.delete_user(user_id)



