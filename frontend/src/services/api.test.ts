import { describe, it, expect, vi, afterEach } from 'vitest';
import { conversationApi, dailyApi, tarotApi, StreamCut } from './api';

// 生成流的读法:{"start"} 起点、{"content"} 正文、{"error"} 失败、[DONE] 结束;没等到 [DONE] 就断了是 StreamCut
const sse = (lines: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } }
  );

const mockFetch = (response: Response) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

afterEach(() => vi.restoreAllMocks());

describe('conversationApi.live', () => {
  it('服务端没有在生成的 → 返回最终会话,什么都不回调', async () => {
    const final = { conversation_id: 'c1', messages: [{ role: 'assistant', content: '已完成' }] };
    mockFetch(Response.json(final));
    const onStart = vi.fn();
    const onChunk = vi.fn();
    expect(await conversationApi.live('c1', onStart, onChunk)).toEqual(final);
    expect(onStart).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('接上:先给起点,再补已经出来的正文、接着收后面的', async () => {
    mockFetch(sse([
      'data: {"start": 2}\n\n',
      'data: {"content": "我先翻翻"}\n\ndata: {"content": "你的笔记。"}\n\n',
      'data: [DONE]\n\n',
    ]));
    const onStart = vi.fn();
    const chunks: string[] = [];
    expect(await conversationApi.live('c1', onStart, (c) => chunks.push(c))).toBeNull();
    expect(onStart).toHaveBeenCalledWith(2, undefined);
    expect(chunks.join('')).toBe('我先翻翻你的笔记。');
  });

  it('生成失败:抛出服务端给的那句话', async () => {
    mockFetch(sse(['data: {"start": 2}\n\n', 'data: {"error": "占卜师暂时联系不上，请重试"}\n\n', 'data: [DONE]\n\n']));
    await expect(conversationApi.live('c1', () => {}, () => {})).rejects.toThrow('占卜师暂时联系不上，请重试');
  });
});

describe('一轮对话的流', () => {
  it('没等到 [DONE] 流就断了 → StreamCut(服务端照样在跑,由调用方接回去)', async () => {
    mockFetch(sse(['data: {"start": 3}\n\n', 'data: {"content": "我看看"}\n\n']));
    const chunks: string[] = [];
    await expect(tarotApi.sendMessage('c1', '在吗', (c) => chunks.push(c))).rejects.toBeInstanceOf(StreamCut);
    expect(chunks).toEqual(['我看看']);
  });

  it('失败的那一轮抛出服务端给的那句话,不是 StreamCut', async () => {
    mockFetch(sse(['data: {"start": 3}\n\n', 'data: {"error": "占卜师暂时联系不上，请重试"}\n\n', 'data: [DONE]\n\n']));
    const err = await tarotApi.resume('c1', () => {}).catch((e) => e);
    expect(err).not.toBeInstanceOf(StreamCut);
    expect(err.message).toBe('占卜师暂时联系不上，请重试');
  });

  it('心灵奇旅同一个形状:回放只有正文', async () => {
    mockFetch(sse(['data: {"content": "你从一张宝剑三出发……"}\n\n', 'data: [DONE]\n\n']));
    const chunks: string[] = [];
    await dailyApi.journey('u', '2026-09-27', (c) => chunks.push(c));
    expect(chunks).toEqual(['你从一张宝剑三出发……']);
  });
});
