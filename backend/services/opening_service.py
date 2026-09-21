"""开场幕的 router 侧公共逻辑：开场白生成、上下文拼装、交单落库。

塔罗与占星两个 router 共用，避免复制粘贴。
"""
from typing import Optional, Tuple

import config
from models import Conversation, SessionType, User
from services import context_service, prompt_service, spread_service
from services.storage_service import StorageService


class GreetingUnavailable(RuntimeError):
    """开场白生成失败。调用方负责翻成一个明确的错误响应，让用户重试。

    这里刻意不返回保底文案：开场白之后紧接着的那一轮 Agent Loop 用的是同一个
    provider（gemini_service 里的 get_provider("opening")），provider 挂了就是挂了，
    发一句假问候只会让用户先认真打完一个问题再撞同一堵墙。
    """


def _nickname(user: Optional[User]) -> str:
    if user and user.profile and user.profile.nickname:
        return user.profile.nickname
    return "朋友"


async def prepare_opening_context(
    conversation: Conversation, user: Optional[User]
) -> Tuple[str, str]:
    """开场幕的 router 侧上下文：相位 + <称呼与来访次数> 块。

    塔罗与占星此前各自逐字复制了同一段拼装（还各自内联了第三份昵称逻辑），任何一边
    改漏就是静默分裂 —— 收归此处，两个 router 各一行调用。

    Returns:
        (phase, relationship_block)；解读相位下后者恒为 ""。
    """
    phase = context_service.get_phase(conversation)

    relationship_block = ""
    if phase == context_service.PHASE_OPENING:
        meta = await context_service.build_relationship_meta(
            conversation.user_id, conversation.conversation_id
        )
        meta["nickname"] = _nickname(user)
        relationship_block = context_service.render_relationship_block(meta)

    return phase, relationship_block


async def submit_brief(conversation: Conversation, args: dict) -> dict:
    """交单：按牌阵 ID 展开成完整起手单 → 落库 + 翻相位。返回值就是发回模型的工具结果。

    开场只交一个牌阵 ID（`spread_type`），位置、张数、牌阵名都挂在那个 ID 上，在这里
    从牌阵目录展开一次，之后解读相位读到的就是完整的一单：`render_brief_block` 出名字和
    编好号的位置，`_spread_parts` 按同一个 ID 接上那副阵的解读方法。

    ID 不认识 → 不落库、不翻相位，把可选值回给模型让它重选。schema 里 spread_type 是
    enum，正常走不到这里；真走到了也不该拿一副阵去顶替它选的那副——抽出来的牌会按错的
    位置解读一整场。重选一次便宜得多。
    """
    brief = context_service.expand_brief(args)
    if brief is None:
        print(f"[Opening] ⚠️ 牌阵 ID 不认识: {args.get('spread_type')!r}，退回重选")
        return {"success": False,
                "error": f"spread_type 必须是 <牌阵选择参考> 里的牌阵 ID，"
                         f"只能是这几个之一：{'、'.join(spread_service.SPREAD_IDS)}"}

    await save_strategy(conversation, brief)
    return {"success": True}


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
    print(f"[Opening] 📋 起手单已落库: {strategy.get('route')} / {strategy.get('question')}")
    return conversation


async def _generate_greeting_via_llm(prompt: str) -> str:
    """无工具的轻量调用：只要一两句迎接语。

    必须带超时：这是全 App 的第一印象，provider 挂起时用户只会看到永久转圈。
    """
    from services import llm

    provider = llm.get_provider("opening")
    return await provider.generate_text(
        prompt,
        temperature=1.0,      # 开场白要每次都不一样
        timeout=config.OPENING_GREETING_TIMEOUT_SECONDS,
    )


async def build_greeting(
    user: Optional[User],
    conversation: Conversation,
    session_type: SessionType,
) -> str:
    """开场白：走前置占卜师提示词生成。失败一律抛 GreetingUnavailable。

    不吞异常：关系元数据的 SQL 错、提示词文件缺失、provider 故障，都该原样浮出来，
    而不是被一条看起来正常的问候盖住、让会话带着空的来访信息继续往下走。
    """
    try:
        meta = await context_service.build_relationship_meta(
            conversation.user_id, conversation.conversation_id
        )
        meta["nickname"] = _nickname(user)
        prompt = prompt_service.join(context_service.greeting_prompt_parts(
            context_service.render_relationship_block(meta), session_type))
        text = (await _generate_greeting_via_llm(prompt)).strip()
    except Exception as e:  # noqa: BLE001 —— 统一翻成一个调用方认得的失败
        raise GreetingUnavailable(f"开场白生成失败: {e}") from e

    if not text:
        raise GreetingUnavailable("开场白模型返回空")
    return text
