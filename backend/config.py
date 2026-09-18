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
# SQLite 主库（用户 + 会话；WAL 模式，替代上面两个 JSON 文件）。
# 测试可用环境变量 TAROT_DB_FILE 覆盖，绝不碰生产库。
DB_FILE = Path(os.getenv("TAROT_DB_FILE", str(DATA_DIR / "app.db")))
# 用量计数（按 token 身份 / 天）
USAGE_FILE = DATA_DIR / "usage.json"
# 牌组商城：钱包（星尘余额/已拥有牌组/当前应用牌组）与支付订单
WALLETS_FILE = DATA_DIR / "wallets.json"
PAYMENT_ORDERS_FILE = DATA_DIR / "payment_orders.json"
# 每日一签:日运记录(牌面/反馈/旅程缓存)
DAILY_DRAWS_FILE = DATA_DIR / "daily_draws.json"
# 提示词模板目录(每次请求实时读取,编辑后无需重启)
PROMPTS_DIR = BASE_DIR / "backend" / "prompts"
# 提示词覆盖目录：管理页在线编辑写这里（gitignored，git pull 不冲掉线上修改）；
# 默认版在 backend/prompts/ 随代码部署。读取时覆盖版优先。
PROMPT_OVERRIDES_DIR = DATA_DIR / "prompts"

# ── 支付配置 ────────────────────────────────────────────────────────────────
# 当真实支付凭证缺失时，是否允许回退到「模拟支付」provider（开发期默认开启）。
# 上线接入真实支付后，把 PAYMENTS_ALLOW_MOCK 设为 false 关闭模拟通道。
PAYMENTS_ALLOW_MOCK = os.getenv("PAYMENTS_ALLOW_MOCK", "true").lower() == "true"
# 后端对外可达地址（支付异步回调 notify_url / 同步跳转拼接用）
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")
# 前端地址（支付完成后同步跳转回前端用）
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")

# 支付宝（开放平台 https://open.alipay.com/）
ALIPAY_APP_ID = os.getenv("ALIPAY_APP_ID", "")
ALIPAY_APP_PRIVATE_KEY = os.getenv("ALIPAY_APP_PRIVATE_KEY", "")  # 应用私钥 PEM
ALIPAY_PUBLIC_KEY = os.getenv("ALIPAY_PUBLIC_KEY", "")            # 支付宝公钥 PEM
ALIPAY_GATEWAY = os.getenv("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")
ALIPAY_NOTIFY_URL = os.getenv("ALIPAY_NOTIFY_URL", f"{PUBLIC_BASE_URL}/api/payments/notify/alipay")
ALIPAY_RETURN_URL = os.getenv("ALIPAY_RETURN_URL", f"{FRONTEND_BASE_URL}/pay/return")

# 微信支付 V3（商户平台 https://pay.weixin.qq.com/）
WECHAT_APP_ID = os.getenv("WECHAT_APP_ID", "")                     # 公众号/开放平台 appid
WECHAT_MCH_ID = os.getenv("WECHAT_MCH_ID", "")                     # 商户号
WECHAT_API_V3_KEY = os.getenv("WECHAT_API_V3_KEY", "")            # APIv3 密钥
WECHAT_CERT_SERIAL = os.getenv("WECHAT_CERT_SERIAL", "")          # 商户证书序列号
WECHAT_MERCHANT_PRIVATE_KEY = os.getenv("WECHAT_MERCHANT_PRIVATE_KEY", "")  # 商户私钥 PEM
WECHAT_NOTIFY_URL = os.getenv("WECHAT_NOTIFY_URL", f"{PUBLIC_BASE_URL}/api/payments/notify/wechat")

# Gemini API配置
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ===== 多 Provider LLM（前置/解读/记忆 三个 Agent 各自独立选 provider+model）=====
# 不配任何一项 → 三个 Agent 全部沿用 Gemini 现状，行为零变化。
# DeepSeek / Kimi 均为 OpenAI 兼容 API，key 按 provider 配一次（同一家不重复填）。
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")

# 每个 Agent 一组 provider + model，成对出现、各自写死默认值。
# provider ∈ {gemini, deepseek, kimi}；model 必须是该 provider 下的模型名。
# 换 provider 就要一起换 model —— 两行是一组，不要只改一行。
# Gemini 备选：gemini-2.5-flash / gemini-3.1-flash-lite / gemini-3-pro
OPENING_PROVIDER = os.getenv("OPENING_PROVIDER", "gemini")
OPENING_MODEL = os.getenv("OPENING_MODEL", "gemini-3.1-flash-lite")
READING_PROVIDER = os.getenv("READING_PROVIDER", "gemini")
READING_MODEL = os.getenv("READING_MODEL", "gemini-3.1-flash-lite")
MEMORY_PROVIDER = os.getenv("MEMORY_PROVIDER", "gemini")
MEMORY_MODEL = os.getenv("MEMORY_MODEL", "gemini-2.5-flash")


# 思考强度：目前只有 Kimi 认（顶层参数 reasoning_effort ∈ low / high / max）。
# K3 的思考关不掉，而默认档就是 max —— 一句问候语它也要想两百多个 token、十几秒才回。
# 留空 = 不发这个参数，用模型自己的默认值；provider 不是 kimi 时这一项不起作用。
def _reasoning_effort(name: str) -> str:
    value = os.getenv(name, "").strip().lower()
    if value not in ("", "low", "high", "max"):
        raise ValueError(f"{name} 只能填 low / high / max（留空=用模型默认），现在是 {value!r}")
    return value


OPENING_REASONING_EFFORT = _reasoning_effort("OPENING_REASONING_EFFORT")
READING_REASONING_EFFORT = _reasoning_effort("READING_REASONING_EFFORT")
MEMORY_REASONING_EFFORT = _reasoning_effort("MEMORY_REASONING_EFFORT")

# 星盘API配置 https://api.xingpan.vip/astrology/Apiinterface.html
# https://docs.qq.com/doc/DQUxhSUpjdkpqYmhH
ASTROLOGY_API_URL = "http://www.xingpan.vip/astrology/chart/natal"
ASTROLOGY_ACCESS_TOKEN = os.getenv("ASTROLOGY_ACCESS_TOKEN", "")  # 需要从环境变量设置

# JWT配置
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
# token 有效期；游客无法重新登录，默认给较长有效期（60 天），可用环境变量覆盖
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 60)))

# ── 用量控制 ────────────────────────────────────────────────────────────────
# 按 token 身份每天可发起的 LLM 调用次数（含开场白——它也是一次真实 LLM 调用）。
# 基于身份计数，不做 IP 限流；游客可清缓存重置额度，故游客额度宜小、并把主要额度
# 绑定到注册账号。游客 10 → 15：补偿开场幕新增的开销（开场白 1 次 + 澄清轮），
# 保证游客仍能完整走完一场占卜。注册用户 50 本就宽松，不动。
GUEST_DAILY_MESSAGE_LIMIT = int(os.getenv("GUEST_DAILY_MESSAGE_LIMIT", "15"))
USER_DAILY_MESSAGE_LIMIT = int(os.getenv("USER_DAILY_MESSAGE_LIMIT", "50"))

# ── 后台管理 ────────────────────────────────────────────────────────────────
# 管理员密码：留空 = 后台功能整体关闭（所有 /api/admin 路由 404）。
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
# admin token 有效期（默认 24 小时）
ADMIN_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", str(24 * 60)))

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


# ============ 前置占卜师 Agent（开场幕）============
# 澄清预算守卫：opening 相位内用户消息数达到该值仍未交单 →
# 该轮 Gemini 调用带 tool_config(mode=ANY) 机械强制提交策略单。
OPENING_FORCE_BRIEF_AFTER_USER_MSGS = int(os.getenv("OPENING_FORCE_BRIEF_AFTER_USER_MSGS", "3"))
# 兜底：用户消息数达到该值仍无策略单（强制交单也失败）→
# harness 直接翻 phase=reading，strategy 保持 None，不伪造假策略单。
OPENING_HARD_EXIT_AFTER_USER_MSGS = int(os.getenv("OPENING_HARD_EXIT_AFTER_USER_MSGS", "5"))

# 开场白 LLM 调用的超时（秒）。开场白是全 App 的第一印象，provider 卡住时宁可
# 快速失败让用户重试，也不让他对着转圈等——超时抛异常，建会话接口返回 503。
OPENING_GREETING_TIMEOUT_SECONDS = int(os.getenv("OPENING_GREETING_TIMEOUT_SECONDS", "8"))


