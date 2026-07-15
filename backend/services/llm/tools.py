"""中性工具规格：唯一真源。GeminiProvider 转成 FunctionDeclaration，
OpenAICompatProvider 转成 OpenAI tool。描述文案与旧 FunctionDeclaration 逐字一致。"""

DRAW_TAROT_CARDS = {
    "name": "draw_tarot_cards",
    "description": (
        "工具用于抽取塔罗牌。当你认为需要使用这个工具时，不询问用户是否需要抽牌，直接调用即可。"
        "当用户提出需要占卜的问题时，根据问题性质决定使用何种牌阵和抽几张牌。"
        "当塔罗牌作为辅助牌和星座结合时，判断结合的思路，选择适合的抽牌数量和每张牌的意义。"
        "用户追问可以再抽一次牌，以追问抽牌的方式（通常是抽1张），继续解读。"
        "⚠️ 重要：调用此工具后，系统会通知用户准备抽牌，等待用户完成抽牌后，你会收到包含具体塔罗牌的消息，再开始解读。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "spread_type": {
                "type": "string",
                "description": "牌阵类型，你需要根据抽牌的目的，准确判断，选择适合的牌阵",
                # "enum": ["single", "three_card", "celtic_cross", "custom"]
            },
            "card_count": {
                "type": "integer",
                "description": "抽牌数量，必须和牌阵类型相匹配，`positions`参数必须和`card_count`参数相匹配。"
            },
            "positions": {
                "type": "array",
                "description": "牌阵中每个位置的简要含义，或位置简单描述，例如：['过去', '现在', '未来']，如果是日运，则：['运势']",
                "items": {"type": "string"}
            }
        },
        "required": ["spread_type", "card_count"]
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

READ_DIVINATION_NOTEBOOK = {
    "name": "read_divination_notebook",
    "description": (
        "读取用户的占卜笔记本，获取用户之前的占卜记录。"
        "当用户想要回顾之前的占卜、查看历史记录、或者想了解过去的占卜内容时调用此工具。"
        "你也可以主动使用此工具，在解读时结合用户的历史占卜记录，提供更有连续性和深度的解读。"
        "笔记本中记录了用户之前的问题、抽到的牌、以及AI生成的占卜摘要。"
        "通过回顾历史记录，你可以发现用户关注的主题、重复出现的模式、以及问题的演变。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "读取笔记本的原因，说明为什么需要查看历史记录"
            }
        },
        "required": ["reason"]
    },
}

SUBMIT_READING_BRIEF = {
    "name": "submit_reading_brief",
    "description": (
        "开场读人完成时调用，提交本场占卜的策略单。"
        "调用后你的开场工作即结束，占卜正式开始——不要在调用的同时说话，"
        "过渡语由解读阶段负责。"
        "若用户中途更换了完全不同的新问题，可以再次调用以覆盖策略单。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "question_topic": {
                "type": "string",
                "description": "议题：感情 / 事业 / 财务 / 自我成长 / 综合 / 玄学知识",
            },
            "user_goal": {
                "type": "string",
                "description": (
                    "用户想从这次占卜带走什么："
                    "求认同（心里已有答案，来找支持）/ "
                    "辅助决策（有选项，卡在选择）/ "
                    "看清现状（迷雾中，要一张地图）/ "
                    "探索好奇（无急事，向内看）"
                ),
            },
            "emotional_intensity": {
                "type": "string",
                "description": "情绪浓度：低 / 中 / 高",
            },
            "context_summary": {
                "type": "string",
                "description": "2-3 句：用户的叙事背景，发生了什么",
            },
            "desired_takeaway": {
                "type": "string",
                "description": "一句话：用户真正想带走的东西",
            },
            "tool_route": {
                "type": "string",
                "description": "塔罗优先 / 星盘优先 / 结合。默认取用户入口偏好",
            },
            "suggested_spread": {
                "type": "string",
                "description": "塔罗路线时：牌阵名 + 各位置含义，如「三张关系阵（现状/他的态度/流向）」",
            },
            "reading_strategy": {
                "type": "string",
                "description": "验证式（求认同）/ 决策式（辅助决策）/ 探索式（看清现状、探索好奇）",
            },
            "pacing": {
                "type": "string",
                "description": "快（少铺垫，用户想直接看结果）/ 深（愿意慢慢聊）",
            },
        },
        "required": ["question_topic", "user_goal", "emotional_intensity", "reading_strategy"],
    },
}

ALL_TOOL_SPECS = [DRAW_TAROT_CARDS, GET_ASTROLOGY_CHART, REQUEST_USER_PROFILE,
                  READ_DIVINATION_NOTEBOOK, SUBMIT_READING_BRIEF]

# 与 gemini_service._select_tools 现有语义一一对应
DAILY_TOOL_NAMES = ["draw_tarot_cards", "get_astrology_chart",
                    "request_user_profile", "read_divination_notebook"]
READING_TOOL_NAMES = DAILY_TOOL_NAMES + ["submit_reading_brief"]
OPENING_TOOL_NAMES = ["submit_reading_brief"]

_BY_NAME = {t["name"]: t for t in ALL_TOOL_SPECS}

def specs_by_names(names):
    return [_BY_NAME[n] for n in names]
