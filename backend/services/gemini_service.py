from typing import AsyncGenerator, Optional, Dict, List, Any, Tuple
from models import Message, MessageRole, User, SessionType
from services import context_service, prompt_service


class GeminiService:
    """对话 Agent 服务（Function Calling Agent Loop）。

    不再直连 google.generativeai —— 所有 LLM 往返都走 services.llm 的 provider 抽象：
    前置（开场读人）Agent 用 get_provider("opening")，解读 Agent 用 get_provider("reading")，
    移交时切 provider。工具规格来自 services.llm.tools（中性真源）。
    """

    # Agent Loop 的迭代上限（含移交后的解读轮）。提出来是因为它是个真实的天花板：
    # 移交会多吃一次迭代，测试要按它构造「恰好烧到最后一轮」的边界场景。
    MAX_AGENT_ITERATIONS = 6

    def _build_user_context(self, user: Optional[User]) -> str:
        """构建用户上下文信息"""
        if not user or not user.profile:
            return ""

        profile = user.profile
        context_parts = []

        if profile.nickname:
            context_parts.append(f"昵称：{profile.nickname}")
        if profile.gender:
            gender_map = {"male": "男", "female": "女", "other": "其他", "prefer_not_say": "保密"}
            context_parts.append(f"性别：{gender_map.get(profile.gender, '未知')}")
        if all([profile.birth_year, profile.birth_month, profile.birth_day]):
            birth_str = f"{profile.birth_year}年{profile.birth_month}月{profile.birth_day}日"
            if profile.birth_hour is not None and profile.birth_minute is not None:
                birth_str += f" {profile.birth_hour:02d}:{profile.birth_minute:02d}"
            context_parts.append(f"生日：{birth_str}")
        if profile.birth_city:
            context_parts.append(f"出生地点：{profile.birth_city}")

        if context_parts:
            return "\n# <用户资料>\n" + "\n".join(context_parts)
        else:
            return "\n# <用户资料>\n尚未完善（如需星盘分析，请使用 request_user_profile 工具请求用户补充信息）"

    def _build_neutral(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> Tuple[str, List[Dict[str, str]], Optional[str]]:
        """把消息拆成 provider 中性形状：(system_prompt, history, last_user)。

        - system_prompt 按相位拼装（context_service 是相位的唯一权威）：
            · override(daily/journey)：调用方完整渲染，原样透传
            · opening: opening_system.md + 入口偏好 + 关系上下文 [+ 守卫指令]
            · reading: 塔罗/占星提示词 + 用户资料 + 策略单块（策略单可空）
        - history：除最后一条待发 user 外的全部文本轮 [{role: user|assistant, content}]
          （抽牌结果/星盘 SYSTEM 消息 → user 文本 + assistant 确认语两条，与改动前逐字一致）
        - last_user：最后一条 user 文本（末尾若非 user 则 None；发消息时末尾必是 user）
        """
        # override(daily/journey)由调用方完整渲染,已含用户资料,不再追加 user_context
        if system_prompt_override is not None:
            system_prompt = system_prompt_override
        elif phase == context_service.PHASE_OPENING:
            system_prompt = context_service.build_opening_prompt(
                relationship_block=relationship_block,
                session_type=session_type,
                force_brief=force_brief,
            )
        else:
            # 每次请求实时读文件（默认+覆盖双层），管理页改完即生效
            if session_type == SessionType.ASTROLOGY:
                base_prompt = prompt_service.get_prompt("astrology_system.md")
            else:
                base_prompt = prompt_service.get_prompt("tarot_system.md")
            system_prompt = context_service.build_reading_prompt(
                base_prompt=base_prompt,
                user_context=self._build_user_context(user),
                strategy=strategy,
            )

        history: List[Dict[str, str]] = []
        for msg in messages:
            # 处理系统消息（抽牌结果或星盘数据）
            if msg.role == MessageRole.SYSTEM:
                # 处理塔罗抽牌结果
                if msg.tarot_cards:
                    cards_desc = "[抽牌结果]如下：\n"
                    for i, card in enumerate(msg.tarot_cards, 1):
                        position = msg.draw_request.positions[i-1] if msg.draw_request and msg.draw_request.positions else f"第{i}张"
                        reversed_str = "（逆位）" if card.reversed else "（正位）"
                        cards_desc += f"{position}: {card.card_name} {reversed_str}\n"
                    history.append({"role": "user", "content": cards_desc})
                    # 在抽牌结果后添加确认语
                    history.append({"role": "assistant", "content": "我看到了，让我为你解读这些牌。"})
                # 处理星盘数据（内容以[星盘数据]开头）
                elif msg.content.startswith("[星盘数据]"):
                    history.append({"role": "user", "content": msg.content})
                    # 在星盘数据后添加确认语
                    history.append({"role": "assistant", "content": "我看到了你的星盘数据，让我为你解读。"})
                continue

            # 如果是助手消息且有抽牌请求，不再添加抽牌结果（已在SYSTEM消息中处理）
            role = "user" if msg.role == MessageRole.USER else "assistant"
            history.append({"role": role, "content": msg.content})

        last_user: Optional[str] = None
        if history and history[-1]["role"] == "user":
            last_user = history.pop()["content"]
        return system_prompt, history, last_user

    def _format_messages_for_gemini(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> List[Dict]:
        """[保留] 供 prompt_service 接线测试断言系统提示词。

        产出 Gemini 形状（系统提示词 → user 首轮 + model『我明白了。』，其余文本轮按角色）。
        内部委托 _build_neutral（唯一真源），再拼回 Gemini 形状，避免与 provider 路径分裂。
        """
        system, history, last_user = self._build_neutral(
            messages, user, session_type, system_prompt_override,
            phase=phase, strategy=strategy, relationship_block=relationship_block,
            force_brief=force_brief,
        )
        out = [
            {"role": "user", "parts": [{"text": system}]},
            {"role": "model", "parts": [{"text": "我明白了。"}]},
        ]
        for m in history:
            role = "user" if m["role"] == "user" else "model"
            out.append({"role": role, "parts": [{"text": m["content"]}]})
        if last_user is not None:
            out.append({"role": "user", "parts": [{"text": last_user}]})
        return out

    async def stream_response(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        function_executor: Optional[callable] = None,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成回复（支持 Function Calling 的 Agent Loop，走 provider 抽象）。

        Args:
            messages: 消息历史
            user: 用户信息
            session_type: 会话类型
            function_executor: 函数执行器 async callable(func_name, func_args) -> Dict
            phase: 相位（opening=开场读人 / reading=解读），由 context_service 判定
            strategy: 本场策略单（解读相位注入系统提示词；开场相位为 None）
            relationship_block: 关系上下文块（仅开场相位）
            force_brief: 守卫——澄清预算用尽，本轮强制交单（仅开场相位）

        Yields:
            Dict 包含以下可能的键：
            - content: str - 文本内容
            - function_call: Dict - 函数调用请求（提交策略单除外，纯后台工具不推前端）
            - done: bool - 是否完成
        """
        from services import llm
        from services.llm import tools as toolspecs

        # override（日运/心灵奇旅自带完整提示词）优先级高于相位——_build_neutral 就是这么判的。
        # 这里必须同源：override 在场 → 整个开场幕语义（开场工具集、强制交单守卫、同轮移交）
        # 一律不适用，否则提示词与工具集/守卫会分裂。
        has_override = system_prompt_override is not None
        is_opening = (not has_override) and phase == context_service.PHASE_OPENING

        def _tool_specs(for_opening: bool) -> List[Dict]:
            """选工具集。优先级与 _build_neutral 的提示词优先级一字不差：
            override > 相位 > 会话类型。override / daily / chat 用 daily 工具集
            （看不见 submit_reading_brief，那份提示词根本不认识它）。"""
            if has_override or session_type in (SessionType.DAILY, SessionType.CHAT):
                return toolspecs.specs_by_names(toolspecs.DAILY_TOOL_NAMES)
            if for_opening:
                return toolspecs.specs_by_names(toolspecs.OPENING_TOOL_NAMES)
            return toolspecs.specs_by_names(toolspecs.READING_TOOL_NAMES)

        provider = llm.get_provider("opening" if is_opening else "reading")
        system, history, last_user = self._build_neutral(
            messages, user, session_type, system_prompt_override,
            phase=phase, strategy=strategy, relationship_block=relationship_block,
            force_brief=force_brief,
        )
        # 守卫第 2 层：opening 且预算用尽 → 本轮 mode=ANY，模型只能交单（provider 负责编码）
        force = "submit_reading_brief" if (is_opening and force_brief) else None
        session = provider.open_session(system, history, _tool_specs(is_opening), force)

        print(f"\n[Agent] 会话类型: {session_type.value} | 相位: {phase}" + (" | 强制交单" if is_opening and force_brief else ""))

        # pending = 下一次要对 session 发的动作。每次 provider 往返都算一轮，
        # 总往返 ≤ MAX_AGENT_ITERATIONS（与改动前 while iteration<max 的预算一致）。
        pending: Tuple[str, Any] = ("user", last_user)
        for _ in range(self.MAX_AGENT_ITERATIONS):
            if pending[0] == "user":
                result = await session.send_user(pending[1])
            else:
                name, fn_result, cid = pending[1]
                result = await session.send_tool_result(name, fn_result, cid)

            # 有文本内容 → 立即分块流式输出（与改动前 chunk_size=50 一致）
            if result.text:
                for i in range(0, len(result.text), 50):
                    yield {"content": result.text[i:i+50]}

            # 没有函数调用 → 对话自然收尾。done 在本方法里必须是唯一出口事件
            # （否则 router 的 `elif "done" in event` 会把同一段回复 add_message 两次）。
            if not result.tool_calls:
                yield {"done": True}
                return

            # 处理第一个函数调用
            call = result.tool_calls[0]

            if function_executor is None:
                # 没有函数执行器（日运心灵奇旅）：通知外部执行，然后 return。
                # 本轮不算完成，绝不吐 done —— 等外部喂结果后重新进入本方法。
                yield {"function_call": {"name": call.name, "args": call.args}}
                return

            # 通知前端有函数调用（用于显示 UI，如抽牌动画、资料补充按钮）。
            # submit_reading_brief 是纯后台工具（无 UI），不推给前端。
            if call.name != "submit_reading_brief":
                yield {"function_call": {"name": call.name, "args": call.args}}

            fn_result = await function_executor(call.name, call.args)

            # 同轮移交：开场读人完成 → 换 provider(reading) + 解读工具集 + 重建 session，
            # 解读 Agent 在同一次回复内接手（历史全是纯文本，重建无配对问题）。
            # 移交后 is_opening=False，之后的 submit 不再触发移交（中途改判照常喂回）。
            if (
                is_opening
                and call.name == "submit_reading_brief"
                and fn_result.get("success", True)
            ):
                print("[Agent] 🎬 开场幕收束，同轮移交给解读 Agent")
                is_opening = False
                phase = context_service.PHASE_READING
                provider = llm.get_provider("reading")

                system2, history2, last_user2 = self._build_neutral(
                    messages, user, session_type, system_prompt_override,
                    phase=phase, strategy=call.args,
                )
                # 重建的解读 session 必须带上用户最后一句澄清回答（读人素材，丢了就白读）。
                # _build_neutral 把它拆进了 last_user2，这里补回 history 尾部。
                if last_user2 is not None:
                    history2 = history2 + [{"role": "user", "content": last_user2}]
                # 保持角色交替：history2 末尾是用户澄清（user），紧接着要发的移交指令又是 user turn
                # —— 连续两个 user 会让模型可能把移交指令当成用户的话来回应。补一条 assistant
                # 确认语收口（与本文件既有惯例一致：系统提示词后的「我明白了。」等）。
                if history2 and history2[-1]["role"] == "user":
                    history2.append({"role": "assistant", "content": "（策略单已提交。）"})
                session = provider.open_session(system2, history2, _tool_specs(False), None)
                pending = (
                    "user",
                    "（开场读人已完成，策略单已就位。现在以占卜师的身份接续这段对话："
                    "先用一句自然的过渡语收住开场，然后按策略单直接开始工作——"
                    "该抽牌就调用抽牌工具，不要复述策略单，不要向用户解释你的判断，"
                    "不要重新问已经问过的问题。）",
                )
                continue

            # 将函数结果发送回 AI，准备下一轮 loop
            pending = ("tool", (call.name, fn_result, call.id))

        # 走到这里 = 迭代预算烧完仍在调工具，没能自然收尾 —— 兜底收口（唯一的 done）
        print("[Agent] ⚠️ 达到最大迭代次数")
        yield {"done": True}
