"""中性工具规格：唯一真源。GeminiProvider 转成 FunctionDeclaration，
OpenAICompatProvider 转成 OpenAI tool。描述文案与旧 FunctionDeclaration 逐字一致。"""

DRAW_TAROT_CARDS = {
    "name": "draw_tarot_cards",
    "description": (
        "工具用于抽取塔罗牌。当你认为需要使用这个工具时，不询问用户是否需要抽牌，直接调用即可。"
        "当用户提出需要占卜的问题时，根据问题性质决定使用何种牌阵和抽几张牌。"
        "当塔罗牌作为辅助牌和星座结合时，判断结合的思路，选择适合的抽牌数量和每张牌的意义。"
        "用户追问可以再抽一次牌，以追问抽牌的方式（通常是抽1张），继续解读。"
        "⚠️ 重要：调用此工具后，系统会通知用户准备抽牌；用户抽完后，这次调用的结果会带着具体的牌回到你这里，那时再开始解读。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "spread_type": {
                "type": "string",
                "description": "牌阵类型，你需要根据抽牌的目的，准确判断，选择适合的牌阵",
                # "enum": ["single", "three_card", "celtic_cross", "custom"]
            },
            "positions": {
                "type": "array",
                "description": (
                    "牌阵中每个位置的简要含义，例如：['过去', '现在', '未来']，如果是日运，则：['运势']。"
                    "抽几张由这里的个数决定，牌阵类型要和它相匹配"
                ),
                "items": {"type": "string"}
            }
        },
        "required": ["spread_type", "positions"]
    },
}

GET_ASTROLOGY_CHART = {
    "name": "get_astrology_chart",
    "description": (
        "获取用户的本命星盘数据（行星落座、宫位状态、四轴点等）。"
        "当需要对用户的本命盘分析时调用：例如本命盘分析/各行星落座/星座解析/上升星座/黄道十二宫状态/宫位状态/以及和用户黄道十二宫相关的问题回答。"
        "在面对泛化问题/通用问题如（星座解析/星座运势等，可以在解析基本星座知识的基础上，再结合用户星盘数据进行更深入的解析。"
        "在抽取塔罗牌后，或用户询问塔罗牌的含义时，可以结合用户星盘数据进行更个性化的解读。"
        "\n**重要提示**：如果调用此工具时返回 success=False，说明用户信息不完整，你必须立即调用 request_user_profile 工具请求用户补充信息。"
        "不要向用户解释错误或询问用户，直接调用 request_user_profile 工具即可。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "调用此工具的原因，说明为什么需要星盘数据"
            }
        },
        "required": ["reason"]
    },
}

REQUEST_USER_PROFILE = {
    "name": "request_user_profile",
    "description": (
        "当需要用户的个人信息（出生日期、出生时间、出生地点）但用户尚未提供时，调用此工具请求用户补充信息。"
        "调用后出现填写资料按钮，点击后会弹出一个表单让用户填写。获取个人信息后，继续调用`get_astrology_chart`获取星盘数据。"
        "用户已填写个人信息时，不调用此工具。"
        "用户主动提出需要补充个人信息时，可以调用"
        "用户拒绝提供个人信息时，只需告知用户可以随时补充，不要反复提醒"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "请求信息的原因，向用户说明为什么需要这些信息"
            },
            "required_fields": {
                "type": "array",
                "description": "需要的字段列表",
                "items": {
                    "type": "string",
                    "enum": ["birth_date", "birth_time", "birth_city", "nickname", "gender"]
                }
            }
        },
        "required": ["reason", "required_fields"]
    },
}

READ_DIVINATION_NOTES = {
    "name": "read_divination_notes",
    "description": (
        "翻出这位用户以前每一场占卜的记录，一场一条，按时间排列，每条含占卜日期、"
        "当时的问题与背景、抽到的牌、解读记录、用户当时的反馈。"
        "用户提起「上次」「之前问过」，或者你想知道某件事后来怎么样了、"
        "他以前问过什么、哪张牌哪个问题反复出现，调这个工具。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "这次要翻记录的原因，说明你想从以前的占卜里看什么"
            }
        },
        "required": ["reason"]
    },
}

SUBMIT_READING_BRIEF = {
    "name": "submit_reading_brief",
    "description": (
        "开场定义完成时调用，提交本场占卜的起手单：问题是什么、用什么起手。"
        "调用后你的开场工作即结束，占卜正式开始。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "一句话、可以直接起卦的具体问题，如「该不该接这个外地的 offer」",
            },
            "context": {
                "type": "string",
                "description": "2-3 句：用户的叙事背景，发生了什么",
            },
            "route": {
                "type": "string",
                "enum": ["tarot", "astrology"],
                "description": "这场占卜用什么起手：tarot=抽牌，astrology=看本命盘。两个都想用就填先做的那个",
            },
            "spread_type": {
                "type": "string",
                "description": "route=tarot 时必填：牌阵名，如 three_card / two_choice / celtic_cross",
            },
            "positions": {
                "type": "array",
                "description": (
                    "route=tarot 时必填：每个位置代表什么，如 ['现状', '阻碍', '流向']。"
                    "抽几张由这里的个数决定，几张都可以"
                ),
                "items": {"type": "string"},
            },
        },
        "required": ["question", "route"],
    },
}

ALL_TOOL_SPECS = [DRAW_TAROT_CARDS, GET_ASTROLOGY_CHART, REQUEST_USER_PROFILE,
                  READ_DIVINATION_NOTES, SUBMIT_READING_BRIEF]

# 与 gemini_service._select_tools 现有语义一一对应
DAILY_TOOL_NAMES = ["draw_tarot_cards", "get_astrology_chart",
                    "request_user_profile", "read_divination_notes"]
# 解读相位不再持有 submit_reading_brief：起手单是「这场怎么开的」的一次性记录，
# 不是可改写的当前状态。解读中要换牌阵/补抽，直接调 draw_tarot_cards 即可。
READING_TOOL_NAMES = list(DAILY_TOOL_NAMES)
# 开场相位要能替星盘路线要出生信息，否则它没法自己判断这条路走不走得通
OPENING_TOOL_NAMES = ["submit_reading_brief", "request_user_profile"]

# interrupt 式工具：调用只是把界面推到用户面前（抽牌器 / 资料表单），结果要等用户动手，
# 跨一次 HTTP 请求才产生。Agent Loop 见到它就收口；结果由 /draw（抽牌）或 /resume
# （资料，从用户当前 profile 取）写成 TOOL 记录，下一轮作为 functionResponse 发回模型。
INTERRUPT_TOOL_NAMES = frozenset({"draw_tarot_cards", "request_user_profile"})

_BY_NAME = {t["name"]: t for t in ALL_TOOL_SPECS}

def specs_by_names(names):
    return [_BY_NAME[n] for n in names]
