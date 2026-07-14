"""开场幕的 router 侧公共逻辑：开场白生成（含降级）、守卫判定、交单落库。

塔罗与占星两个 router 共用，避免复制粘贴。
"""
import random
from typing import Optional, Tuple

import google.generativeai as genai

import config
from config import GEMINI_MODEL
from models import Conversation, MessageRole, SessionType, User
from services import context_service
from services.storage_service import StorageService

# LLM 失败时的保底模板（正常路径不再使用；口吻已按新开场规范重写，不再是客服体）
FALLBACK_GREETINGS = [
    "{nickname}，坐吧。今天想聊些什么？",
    "{nickname}，我在。慢慢说。",
    "又见面了，{nickname}。这次是什么事？",
]


def _nickname(user: Optional[User]) -> str:
    if user and user.profile and user.profile.nickname:
        return user.profile.nickname
    return "朋友"


def count_user_messages(conversation: Conversation) -> int:
    return sum(1 for m in conversation.messages if m.role == MessageRole.USER)


def should_force_brief(conversation: Conversation) -> bool:
    """守卫第 2 层：开场相位内澄清预算用尽 → 本轮 Gemini 调用带 mode=ANY 强制交单。"""
    if context_service.get_phase(conversation) != context_service.PHASE_OPENING:
        return False
    return count_user_messages(conversation) >= config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS


def should_hard_exit(conversation: Conversation) -> bool:
    """守卫第 3 层：强制交单也失败 → 直接翻 phase，保证不存在卡死在开场幕的会话。"""
    if context_service.get_phase(conversation) != context_service.PHASE_OPENING:
        return False
    return count_user_messages(conversation) >= config.OPENING_HARD_EXIT_AFTER_USER_MSGS


async def hard_exit_to_reading(conversation: Conversation) -> Conversation:
    """兜底出场：只翻 phase，strategy 保持 None——不伪造假策略单污染数据。"""
    conversation.phase = context_service.PHASE_READING
    await StorageService.save_conversation(conversation)
    print(f"[Opening] 🛟 守卫兜底：{conversation.conversation_id} 强制进入解读相位（无策略单）")
    return conversation


async def prepare_opening_context(
    conversation: Conversation, user: Optional[User]
) -> Tuple[str, bool, str]:
    """开场幕的 router 侧上下文，一次算清：守卫兜底 → 相位 → 强制交单 → 关系上下文块。

    塔罗与占星此前各自逐字复制了同一段拼装（还各自内联了第三份昵称逻辑），任何一边
    改漏就是静默分裂 —— 收归此处，两个 router 各一行调用。

    Returns:
        (phase, force_brief, relationship_block)；解读相位下后两者恒为 (False, "")。

    Note:
        守卫第 3 层触发时 `conversation` 会被**就地**改写（phase 翻成 reading 并落库），
        调用方后续从同一个对象取 strategy，无需重新读库。
    """
    # 守卫第 3 层：强制交单也失败 → 兜底翻 phase，保证不存在卡死在开场幕的会话
    if should_hard_exit(conversation):
        await hard_exit_to_reading(conversation)

    phase = context_service.get_phase(conversation)
    force_brief = should_force_brief(conversation)  # 守卫第 2 层

    relationship_block = ""
    if phase == context_service.PHASE_OPENING:
        meta = await context_service.build_relationship_meta(
            conversation.user_id, conversation.conversation_id
        )
        meta["nickname"] = _nickname(user)
        relationship_block = context_service.render_relationship_block(meta)

    return phase, force_brief, relationship_block


async def save_strategy(conversation: Conversation, strategy: dict) -> Conversation:
    """交单落库：写策略单 + 翻相位（改判时 phase 已是 reading，覆盖 strategy 即可）。

    落库走「重新取最新对象再改」，而不是直接存 router 闭包里的旧对象——同一轮 Agent Loop
    里可能已有别的工具（如星盘）往对话追加过消息，用旧对象整存会把它们抹掉。
    """
    conversation.strategy = strategy
    conversation.phase = context_service.PHASE_READING

    target = await StorageService.get_conversation(conversation.conversation_id)
    if target is None:  # 理论上不会（对话刚读过）；兜底存内存对象，不静默丢策略单
        target = conversation
    else:
        target.strategy = strategy
        target.phase = context_service.PHASE_READING

    await StorageService.save_conversation(target)
    print(f"[Opening] 📋 策略单已落库: {strategy.get('user_goal')} / {strategy.get('reading_strategy')}")
    return conversation


async def _generate_greeting_via_llm(prompt: str) -> str:
    """无工具的轻量调用：只要一两句迎接语。

    必须带超时：这是全 App 的第一印象，Gemini 挂起时用户只会看到永久转圈。
    超时抛异常 → build_greeting 的 try/except 接住 → 降级模板。
    """
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config={
            "temperature": 1.0,      # 开场白要每次都不一样
            "top_p": 0.95,
            "max_output_tokens": 200,
        },
    )
    response = await model.generate_content_async(
        prompt,
        request_options={"timeout": config.OPENING_GREETING_TIMEOUT_SECONDS},
    )
    return response.text or ""


async def build_greeting(
    user: Optional[User],
    conversation: Conversation,
    session_type: SessionType,
) -> str:
    """开场白：走前置占卜师提示词生成；任何异常/空输出 → 降级回模板（保底不坏）。"""
    nickname = _nickname(user)
    try:
        meta = await context_service.build_relationship_meta(
            conversation.user_id, conversation.conversation_id
        )
        meta["nickname"] = nickname
        system_prompt = context_service.build_opening_prompt(
            relationship_block=context_service.render_relationship_block(meta),
            session_type=session_type,
            force_brief=False,
        )
        prompt = (
            f"{system_prompt}\n\n"
            "（用户刚刚坐下，还没有开口。说出你的迎接语——只说这一句，"
            "不要提问之外的任何解释，不要调用工具。）"
        )
        text = (await _generate_greeting_via_llm(prompt)).strip()
        if text:
            return text
        print("[Opening] ⚠️ 开场白模型返回空，降级模板")
    except Exception as e:  # noqa: BLE001 —— 开场白绝不能开天窗
        print(f"[Opening] ⚠️ 开场白生成失败({e})，降级模板")

    return random.choice(FALLBACK_GREETINGS).format(nickname=nickname)
