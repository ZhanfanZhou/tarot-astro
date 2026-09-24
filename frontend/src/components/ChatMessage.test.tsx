import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatMessage from './ChatMessage';
import { MessageRole } from '@/types';
import type { Message } from '@/types';

// 这仓库没开 vitest globals(没有自动 cleanup)
afterEach(cleanup);

const reply: Message = { role: MessageRole.ASSISTANT, content: '牌面解读', timestamp: '2026-09-22T01:04:00' };

describe('ChatMessage 赞 / 踩', () => {
  it('没评价过:点赞记 up,点踩记 down', () => {
    const onFeedback = vi.fn();
    render(<ChatMessage message={reply} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByLabelText('赞'));
    fireEvent.click(screen.getByLabelText('踩'));
    expect(onFeedback.mock.calls).toEqual([['up'], ['down']]);
  });

  it('点过的那个亮着,再点一次是取消;点另一个是改主意', () => {
    const onFeedback = vi.fn();
    render(<ChatMessage message={reply} feedback="up" onFeedback={onFeedback} />);
    expect(screen.getByLabelText('赞').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('踩').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByLabelText('赞'));
    fireEvent.click(screen.getByLabelText('踩'));
    expect(onFeedback.mock.calls).toEqual([[null], ['down']]);
  });

  it('流式中的回复、用户发言、没传回调:都不出赞踩', () => {
    const { rerender } = render(<ChatMessage message={reply} isStreaming onFeedback={vi.fn()} />);
    expect(screen.queryByLabelText('赞')).toBeNull();
    rerender(<ChatMessage message={{ ...reply, role: MessageRole.USER }} onFeedback={vi.fn()} />);
    expect(screen.queryByLabelText('赞')).toBeNull();
    rerender(<ChatMessage message={reply} />);
    expect(screen.queryByLabelText('赞')).toBeNull();
    expect(screen.getByLabelText('复制解读')).toBeTruthy();
  });

  it('分享:弹出「还在筹备中」,引一句这条回复,按「好的」关掉', async () => {
    render(<ChatMessage message={reply} onFeedback={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('分享'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('分享功能还在筹备中');
    expect(dialog.textContent).toContain('牌面解读');
    fireEvent.click(screen.getByText('好的'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('ChatMessage 牌面大图', () => {
  it('点牌面打开大图预览', () => {
    const withCard: Message = {
      ...reply,
      tarot_cards: [{ card_id: 17, card_name: '星星', reversed: true }],
      draw_request: { spread_type: 'single', positions: ['今日指引'] },
    };
    render(<ChatMessage message={withCard} />);
    fireEvent.click(screen.getByLabelText('查看大图'));
    expect(screen.getByLabelText('关闭预览')).toBeInTheDocument();
    expect(screen.getByText('The Star')).toBeInTheDocument();
  });
});
