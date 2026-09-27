import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { conversationApi, GenerationFailed, StreamCut } from './api';
import { attachConversationTurn, runConversationTurn, reconnectConversations } from './conversationTurns';
import { useConversationStore } from '@/stores/useConversationStore';
import type { Conversation, Message } from '@/types';

vi.mock('./api', () => ({
  conversationApi: { live: vi.fn() },
  GenerationFailed: class GenerationFailed extends Error {},
  StreamCut: class StreamCut extends Error {},
}));
const before = { conversation_id: 'a', messages: [{ role: 'assistant', content: '你想问什么？' }] } as Conversation;
const sent = { role: 'user', content: '问题 A', timestamp: 'now' } as Message;
const done = { ...before, messages: [...before.messages, sent, { role: 'assistant', content: '回答' } as Message] };
const state = () => useConversationStore.getState();
const live = vi.mocked(conversationApi.live);
const options = () => ({ sent, onQuota: vi.fn() });
const showSent = () => state().addMessageToCurrentConversation(sent);

beforeEach(() => {
  vi.resetAllMocks();
  useConversationStore.setState({ conversations: [before], currentConversation: before, liveTurns: {}, drafts: {}, turnNotices: {}, handledFailures: {} });
});
afterEach(() => vi.useRealTimers());

describe('对话状态交接', () => {
  it('生成恰好完成时，空闲响应直接替换旧历史', async () => {
    live.mockResolvedValue(done);
    await attachConversationTurn(before);
    expect(state().currentConversation).toEqual(done);
    expect(state().liveTurns).toEqual({});
  });

  it('接回尚未收到响应时切走再切回，只建立一个订阅，正文只出现一份', async () => {
    let finish!: () => void;
    live.mockImplementationOnce(async (_id, onStart, onChunk) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      onStart(2, { ...before, messages: [...before.messages, sent] });
      onChunk('回答');
      expect(state().liveTurns.a).toBe('回答');
      return null;
    }).mockResolvedValue(done);
    const a = attachConversationTurn(before);
    const b = attachConversationTurn(before);
    expect(a).toBe(b);
    await Promise.resolve();
    expect(live).toHaveBeenCalledTimes(1);
    finish();
    await a;
    expect(live).toHaveBeenCalledTimes(2); // 一个流 + 一次最终状态
    expect(state().currentConversation).toEqual(done);
  });

  it('断流时保持等待，有限接回只读状态，不重新提交用户消息', async () => {
    vi.useFakeTimers();
    showSent();
    const start = vi.fn(async (chunk) => { chunk('开头'); throw new StreamCut(); });
    live.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(done);
    const task = runConversationTurn(before, start, options());
    await vi.advanceTimersByTimeAsync(0);
    expect(state().liveTurns.a).toBe('开头');
    expect(state().turnNotices.a.kind).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    await task;
    expect(start).toHaveBeenCalledOnce();
    expect(state().liveTurns).toEqual({});
    expect(state().currentConversation).toEqual(done);
  });

  it('有限接回失败后仍不宣告生成失败，网络恢复继续同一轮', async () => {
    vi.useFakeTimers();
    showSent();
    live.mockRejectedValue(new TypeError('offline'));
    const start = vi.fn(async () => { throw new StreamCut(); });
    const task = runConversationTurn(before, start, options());
    await vi.advanceTimersByTimeAsync(1100);
    await task;
    expect(live).toHaveBeenCalledTimes(3);
    expect(state().turnNotices.a.kind).toBe('offline');
    expect('a' in state().liveTurns).toBe(true);
    expect(state().drafts.a).toBeUndefined();
    live.mockResolvedValue(done);
    reconnectConversations();
    await attachConversationTurn(before);
    expect(state().currentConversation).toEqual(done);
    expect(state().turnNotices).toEqual({});
    expect(start).toHaveBeenCalledOnce();
  });

  it('额度拒收时无须读取后台，消息退回所属会话，切到另一场也不串', async () => {
    showSent();
    const b = { ...before, conversation_id: 'b', messages: [] };
    state().setCurrentConversation(b);
    state().setDraft('b', '另一场的草稿');
    const opt = options();
    await runConversationTurn(before, async () => { throw Object.assign(new Error('额度用完'), { status: 429 }); }, opt);
    expect(live).not.toHaveBeenCalled();
    expect(state().conversations[0].messages).toEqual(before.messages);
    expect(state().currentConversation).toBe(b);
    expect(state().drafts).toEqual({ a: sent.content, b: '另一场的草稿' });
    expect(opt.onQuota).toHaveBeenCalledOnce();
  });

  it('确认生成失败后才退回草稿，失败消息不留在列表，再打开不覆盖用户的新草稿', async () => {
    showSent();
    const failed = { ...before, failed_turn: { id: 'f1', action: 'message' as const, content: sent.content } };
    live.mockResolvedValue(failed);
    await runConversationTurn(before, async () => { throw new GenerationFailed(); }, options());
    expect(state().currentConversation?.messages).toEqual(before.messages);
    expect(state().drafts.a).toBe(sent.content);
    expect(state().liveTurns).toEqual({});
    state().setDraft('a', '换个问题');
    await attachConversationTurn(failed);
    expect(state().drafts.a).toBe('换个问题');
  });

  it('POST 根本没送到后台时，网络恢复确认空闲才退回原输入', async () => {
    vi.useFakeTimers();
    showSent();
    live.mockRejectedValue(new TypeError('offline'));
    const task = runConversationTurn(before, async () => { throw new TypeError('offline'); }, options());
    await vi.advanceTimersByTimeAsync(1100);
    await task;
    live.mockResolvedValue(before);
    await attachConversationTurn(before);
    expect(state().drafts.a).toBe(sent.content);
    expect(state().currentConversation?.messages).toEqual(before.messages);
    expect(state().liveTurns).toEqual({});
  });

  it('开场白/解读的连接断过，但后台实际成功时，不留下失败提示', async () => {
    live.mockResolvedValue(done);
    await runConversationTurn(before, async () => { throw new StreamCut(); }, { onQuota: vi.fn() });
    expect(state().currentConversation).toEqual(done);
    expect(state().turnNotices).toEqual({});
  });
});
