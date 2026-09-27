"""进行中的生成，按 key 登记（对话的一轮 / 开场白 / 日签解读用 conversation_id，心灵奇旅用人 + 日期）。

生成交给后台任务跑，不跟着 HTTP 请求走：页面关了、刷新了、手机切走把连接断了，任务照样跑完、
逐条落库。发起它的请求和之后重新打开页面再来要的请求，都只是它的观众——先把已经出来的正文
补上，再接着收后面的，直到结束。和 ChatGPT / Claude 网页一样：刷新不等于失败。

线上是单个 uvicorn worker，登记放进程内就够了。进程重启时正在跑的会丢，已经落库的照旧；
失败或丢了的都不计额度（额度在生成成功之后才扣，见各调用方）。
"""
import asyncio
import json
import weakref
from typing import AsyncIterator, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

# 生成失败时告诉用户的话。调用方抛 HTTPException 可以换成自己的说法
FAILED_DETAIL = "占卜师暂时联系不上，请重试"


class LiveTurn:
    """一次进行中的生成：已经出来的正文块 + 结束了没有 + 失败原因。"""

    def __init__(self, base: int):
        # 这一次的输出从会话的第几条记录开始。它之前的记录重新打开页面时照常显示；从它开始的，
        # 正文都在 chunks 里（可能已经落了一部分库），由流式气泡显示，别显示两遍
        self.base = base
        self.chunks: List[str] = []
        self.error: Optional[str] = None
        self.done = asyncio.Event()
        self._wake = asyncio.Event()
        self.task: Optional[asyncio.Task] = None

    def _push(self, chunk: str) -> None:
        self.chunks.append(chunk)
        self._notify()

    def _notify(self) -> None:
        self._wake.set()
        self._wake = asyncio.Event()

    @property
    def text(self) -> str:
        return "".join(self.chunks)

    async def follow(self) -> AsyncIterator[str]:
        """从头给出全部正文块，跟到结束。观众断开只停这一个观众，生成照跑。"""
        i = 0
        while True:
            wake = self._wake  # 先拿住，之后来的新块一定会把它叫醒
            while i < len(self.chunks):
                yield self.chunks[i]
                i += 1
            if self.done.is_set():
                return
            await wake.wait()


_running: Dict[str, LiveTurn] = {}
_locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


def lock(key: str) -> asyncio.Lock:
    """同一个 key 一次只起一个生成：「看库里的状态 → 看有没有在跑 → 起一个」要在这把锁里做完。
    没人再拿着的锁自动从表里消失。"""
    held = _locks.get(key)
    if held is None:
        held = asyncio.Lock()
        _locks[key] = held
    return held


def running(key: str) -> Optional[LiveTurn]:
    return _running.get(key)


def start(key: str, base: int, chunks: AsyncIterator[str]) -> LiveTurn:
    """把一次生成交给后台任务。chunks 边产生正文边自己落库，成功跑完再扣额度；
    抛错就是失败，失败原因记在 turn.error。调用方要先拿着 lock(key)，并确认 running(key) 为空。"""
    assert key not in _running
    turn = LiveTurn(base)
    _running[key] = turn

    async def run():
        try:
            async for chunk in chunks:
                turn._push(chunk)
        except HTTPException as e:
            turn.error = e.detail
        except Exception as e:  # noqa: BLE001 —— 模型 / 网络出错：翻成一个用户看得懂的失败
            print(f"[LiveTurn] ⚠️ {key} 生成失败: {e!r}")
            turn.error = FAILED_DETAIL
        finally:
            _running.pop(key, None)
            turn.done.set()
            turn._notify()

    turn.task = asyncio.create_task(run())
    return turn


def sse(turn: LiveTurn) -> StreamingResponse:
    """把一次生成按 SSE 推给这一个观众。
    先一条 {"start": base}，然后正文块 {"content"}，失败了一条 {"error"}，最后 [DONE]。"""
    async def generate():
        yield f"data: {json.dumps({'start': turn.base})}\n\n"
        async for chunk in turn.follow():
            yield f"data: {json.dumps({'content': chunk})}\n\n"
        if turn.error:
            yield f"data: {json.dumps({'error': turn.error}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
