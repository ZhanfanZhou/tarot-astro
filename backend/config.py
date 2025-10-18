import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parent.parent

# 数据存储目录
DATA_DIR = BASE_DIR / "backend" / "data"
DATA_DIR.mkdir(exist_ok=True)

# 数据文件路径
USERS_FILE = DATA_DIR / "users.json"
CONVERSATIONS_FILE = DATA_DIR / "conversations.json"

# Gemini API配置
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# GEMINI_MODEL = "gemini-2.0-flash-exp"  # 使用Gemini 2.0 Flash
GEMINI_MODEL = "gemini-2.5-pro"  # 使用Gemini 2.0 Flash

# 星盘API配置
ASTROLOGY_API_URL = "http://www.xingpan.vip/astrology/chart/natal"
ASTROLOGY_ACCESS_TOKEN = os.getenv("ASTROLOGY_ACCESS_TOKEN", "")  # 需要从环境变量设置

# JWT配置
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# CORS配置
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

# 塔罗牌数据
TAROT_CARDS = [
    # 大阿尔卡纳 (0-21)
    "愚者 (The Fool)", "魔术师 (The Magician)", "女祭司 (The High Priestess)",
    "皇后 (The Empress)", "皇帝 (The Emperor)", "教皇 (The Hierophant)",
    "恋人 (The Lovers)", "战车 (The Chariot)", "力量 (Strength)",
    "隐者 (The Hermit)", "命运之轮 (Wheel of Fortune)", "正义 (Justice)",
    "倒吊人 (The Hanged Man)", "死神 (Death)", "节制 (Temperance)",
    "恶魔 (The Devil)", "塔 (The Tower)", "星星 (The Star)",
    "月亮 (The Moon)", "太阳 (The Sun)", "审判 (Judgement)",
    "世界 (The World)",
    
    # 权杖牌组 (22-35)
    "权杖王牌", "权杖二", "权杖三", "权杖四", "权杖五", "权杖六",
    "权杖七", "权杖八", "权杖九", "权杖十",
    "权杖侍从", "权杖骑士", "权杖王后", "权杖国王",
    
    # 圣杯牌组 (36-49)
    "圣杯王牌", "圣杯二", "圣杯三", "圣杯四", "圣杯五", "圣杯六",
    "圣杯七", "圣杯八", "圣杯九", "圣杯十",
    "圣杯侍从", "圣杯骑士", "圣杯王后", "圣杯国王",
    
    # 宝剑牌组 (50-63)
    "宝剑王牌", "宝剑二", "宝剑三", "宝剑四", "宝剑五", "宝剑六",
    "宝剑七", "宝剑八", "宝剑九", "宝剑十",
    "宝剑侍从", "宝剑骑士", "宝剑王后", "宝剑国王",
    
    # 星币牌组 (64-77)
    "星币王牌", "星币二", "星币三", "星币四", "星币五", "星币六",
    "星币七", "星币八", "星币九", "星币十",
    "星币侍从", "星币骑士", "星币王后", "星币国王",
]



