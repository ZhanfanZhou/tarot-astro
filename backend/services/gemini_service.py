import json
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Tuple
from models import Message, MessageRole, ToolCallRecord, User, SessionType
from services import context_service, tool_turns


# 守卫第 2 层强制调用的工具
FORCED_BRIEF_TOOL = "submit_reading_brief"


def tool_names(session_type: SessionType, *, opening: bool, has_override: bool) -> List[str]:
    """选工具集。优先级与 _build_neutral 的提示词优先级一字不差：
    override > 相位 > 会话类型。override / daily / chat 用 daily 工具集
    （看不见 submit_reading_brief，那份提示词根本不认识它）。"""
    from services.llm import tools as toolspecs

    if has_override or session_type in (SessionType.DAILY, SessionType.CHAT):
        return toolspecs.DAILY_TOOL_NAMES
    if opening:
        return toolspecs.OPENING_TOOL_NAMES
    return toolspecs.READING_TOOL_NAMES


class GeminiService:
    """对话 Agent 服务（Function Calling Agent Loop）。

    不再直连 google.generativeai —— 所有 LLM 往返都走 services.llm 的 provider 抽象：
    前置（开场读人）Agent 用 get_provider("opening")，解读 Agent 用 get_provider("reading")，
    移交时切 provider。工具规格来自 services.llm.tools（中性真源）。
    """

    # Agent Loop 的迭代上限（含移交后的解读轮）。提出来是因为它是个真实的天花板：
    # 移交会多吃一次迭代，测试要按它构造「恰好烧到最后一轮」的边界场景。
    MAX_AGENT_ITERATIONS = 6

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
    ) -> Tuple[str, List[Dict[str, Any]], Tuple[str, Any]]:
        """把消息拆成 provider 中性形状：(system_prompt, history, pending)。

        - system_prompt 按相位拼装（context_service 是相位的唯一权威）：
            · override(daily)：调用方完整渲染，原样透传
            · opening: opening_system.md + 入口偏好 + 用户资料 + 用户画像 + 关系上下文 [+ 守卫指令]
            · reading: 塔罗/占星提示词 + 用户资料 + 用户画像 + 策略单块（策略单可空）
          用户画像每轮无条件带上（注册用户），不再指望模型自己去翻笔记本
        - history：除末尾那条外的全部记录，逐条映射成 NeutralMsg（见 llm.base）
        - pending：末尾那条，就是本轮要发给模型的东西：
            ("user", 文本)                 用户发言
            ("tool", (名字, 结果, id))     resume：用户在界面上做完了动作，结果已落库
        """
        # override(daily/journey)由调用方完整渲染,已含用户资料,不再追加 user_context
        if system_prompt_override is not None:
            system_prompt = system_prompt_override
        elif phase == context_service.PHASE_OPENING:
            system_prompt = context_service.build_opening_prompt(
                relationship_block=relationship_block,
                session_type=session_type,
                force_brief=force_brief,
                user_context=context_service.build_user_context(user),
                portrait_context=context_service.build_portrait_context(user),
            )
        else:
            # 每次请求实时读文件（默认+覆盖双层），管理页改完即生效
            system_prompt = context_service.build_reading_prompt(
                session_type=session_type,
                user_context=context_service.build_user_context(user),
                strategy=strategy,
                portrait_context=context_service.build_portrait_context(user),
            )

        history: List[Dict[str, Any]] = []
        for msg in messages:
            if msg.role == MessageRole.USER:
                history.append({"role": "user", "content": msg.content})
            elif msg.role == MessageRole.ASSISTANT:
                m: Dict[str, Any] = {"role": "assistant", "content": msg.content}
                if msg.tool_calls:
                    m["tool_calls"] = [{"id": c.id, "name": c.name, "args": c.args}
                                       for c in msg.tool_calls]
                if msg.reasoning:
                    m["reasoning"] = msg.reasoning
                history.append(m)
            elif msg.role == MessageRole.TOOL:
                history.append({
                    "role": "tool_result", "id": msg.tool_call_id, "name": msg.tool_name,
                    "result": json.loads(msg.content) if msg.content else {},
                })
            # SYSTEM：旧格式的残留，这种会话在 turn_service 就被挡成只读，走不到这里

        if not history:
            raise ValueError("没有可发送的内容：会话是空的")
        tail = history.pop()
        if tail["role"] == "user":
            pending: Tuple[str, Any] = ("user", tail["content"])
        elif tail["role"] == "tool_result":
            pending = ("tool", (tail["name"], tail["result"], tail["id"]))
        else:
            # 末尾是 assistant = 没有人在等模型说话。以前这里悄悄退化成 send_user(None)，
            # 一路发到 provider 才炸，错误信息和真正的原因隔了三层。
            raise ValueError("没有可发送的内容：历史末尾既不是用户发言也不是工具结果")
        return system_prompt, history, pending

    async def stream_response(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        *,
        function_executor: Callable[[str, dict], Awaitable[dict]],
        session_type: SessionType = SessionType.TAROT,
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
            - content: str - 文本内容（流式推给用户）
            - message: Message - 一条该落库的记录（模型的一轮 / 一个工具结果），按序产生。
              interrupt 式调用（抽牌、补资料）就在这里：界面要不要显示抽牌/补资料按钮，
              前端看会话末尾那条记录的 tool_calls，不另开事件通道
            - done: bool - 是否完成
        """
        from services import llm
        from services.llm import tools as toolspecs

        # override（日运自带完整提示词）优先级高于相位——_build_neutral 就是这么判的。
        # 这里必须同源：override 在场 → 整个开场幕语义（开场工具集、强制交单守卫、同轮移交）
        # 一律不适用，否则提示词与工具集/守卫会分裂。
        has_override = system_prompt_override is not None
        is_opening = (not has_override) and phase == context_service.PHASE_OPENING

        def _tool_specs(for_opening: bool) -> List[Dict]:
            return toolspecs.specs_by_names(
                tool_names(session_type, opening=for_opening, has_override=has_override))

        provider = llm.get_provider("opening" if is_opening else "reading")
        system, history, pending = self._build_neutral(
            messages, user, session_type, system_prompt_override,
            phase=phase, strategy=strategy, relationship_block=relationship_block,
            force_brief=force_brief,
        )
        # 守卫第 2 层：opening 且预算用尽 → 本轮 mode=ANY，模型只能交单（provider 负责编码）
        force = FORCED_BRIEF_TOOL if (is_opening and force_brief) else None
        session = provider.open_session(system, history, _tool_specs(is_opening), force)

        print(f"\n[Agent] 会话类型: {session_type.value} | 相位: {phase}" + (" | 强制交单" if is_opening and force_brief else ""))

        # 本轮产生的记录（模型的每一轮 + 每个工具结果），按发生顺序 yield {"message"} 交给
        # 调用方落库；同轮移交时 messages + turns 就是解读 Agent 该看到的完整历史。
        turns: List[Message] = []

        def _record(msg: Message) -> Dict[str, Any]:
            turns.append(msg)
            return {"message": msg}

        # pending = 下一次要对 session 发的动作。每次 provider 往返都算一轮，
        # 总往返 ≤ MAX_AGENT_ITERATIONS。
        for _ in range(self.MAX_AGENT_ITERATIONS):
            if pending[0] == "user":
                result = await session.send_user(pending[1])
            else:
                name, fn_result, cid = pending[1]
                result = await session.send_tool_result(name, fn_result, cid)

            # 有文本内容 → 立即分块流式输出
            if result.text:
                for i in range(0, len(result.text), 50):
                    yield {"content": result.text[i:i+50]}

            # 只处理第一个调用（provider 层也只回写第一个，保证一次调用对一条结果）
            calls = [ToolCallRecord(name=c.name, args=c.args, id=c.id or tool_turns.new_call_id(c.name))
                     for c in result.tool_calls[:1]]
            if result.text or calls:
                yield _record(tool_turns.assistant_message(result.text, calls, result.reasoning))

            # 没有函数调用 → 对话自然收尾。done 在本方法里必须是唯一出口事件
            # （否则调用方会把同一段回复落库两次）。
            if not calls:
                yield {"done": True}
                return

            call = calls[0]

            # interrupt 式调用：结果要等用户在界面上动手，跨请求产生。这里停住，不编造结果。
            # 调用本身已经落库（上面那条 assistant），结果由 /draw 或 /resume 补上，
            # 下一轮作为 functionResponse 发回，模型接着往下说就是它的默认行为。
            if call.name in toolspecs.INTERRUPT_TOOL_NAMES:
                print(f"[Agent] ⏸ {call.name} interrupt：等用户做完，下一轮带真结果恢复")
                yield {"done": True}
                return

            fn_result = await function_executor(call.name, call.args)
            yield _record(tool_turns.tool_message(call, fn_result))

            # 交单 = 开场结束。接下来按起手单里的 route 分两条路走。
            if (
                is_opening
                and call.name == "submit_reading_brief"
                and fn_result.get("success", True)
            ):
                is_opening = False
                phase = context_service.PHASE_READING
                action, action_args = context_service.first_action(call.args)

                # 塔罗路线：牌阵已经在单子里，harness 替解读 Agent 发起抽牌调用，推抽牌器
                # 给前端，然后收口等用户抽牌。不必为了一句过渡语再叫解读 Agent 出来跑一轮——
                # 那是纯浪费的往返，而且它会自己另选一副牌阵，跟单子上写的对不上。
                # 这次调用照样记成一条 assistant，抽牌结果落库后和它配对。
                if action == "draw_tarot_cards":
                    print(f"[Agent] 🎬 开场收束 → 直接抽牌 {action_args}")
                    # 模型这一轮说了什么，上面已经原样流式输出了——说与不说都由它。
                    # 唯一的例外是守卫第 2 层：force 上膛时它在解码层就发不出文本，
                    # 这时候的沉默不是它的选择，替它说一句，别让抽牌器凭空弹出来。
                    line = ""
                    if force and not (result.text or "").strip():
                        line = context_service.forced_brief_handoff_line()
                        yield {"content": line}
                    draw_call = ToolCallRecord(
                        name=action, args=action_args, id=tool_turns.new_call_id(action))
                    yield _record(tool_turns.assistant_message(line, [draw_call]))
                    yield {"done": True}
                    return

                # 星盘路线：不需要用户动手，同一次回复里换成解读 Agent 续跑，
                # 由它自己调 get_astrology_chart 取盘并开口解读。
                print("[Agent] 🎬 开场收束，移交解读 Agent（星盘路线）")
                provider = llm.get_provider("reading")

                # 解读 Agent 看到的历史 = 落库的 + 本轮刚产生的（交单那一对在内），
                # 和它下一次请求从库里读到的完全一样，不另造移交指令。
                system2, history2, pending2 = self._build_neutral(
                    messages + turns, user, session_type, system_prompt_override,
                    phase=phase, strategy=call.args,
                )
                session = provider.open_session(system2, history2, _tool_specs(False), None)
                pending = pending2
                continue

            # 将函数结果发送回 AI，准备下一轮 loop
            pending = ("tool", (call.name, fn_result, call.id))

        # 走到这里 = 迭代预算烧完仍在调工具，没能自然收尾 —— 兜底收口（唯一的 done）
        print("[Agent] ⚠️ 达到最大迭代次数")
        yield {"done": True}
