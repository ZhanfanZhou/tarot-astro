import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DrawingStage } from './DailyOracleModal';

// 选完牌到解读回来之间:说清楚在做什么、已经等了几秒,等久了换一句
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DrawingStage', () => {
  it('秒数一直在跳,等久了换成「还在写」', () => {
    vi.useFakeTimers();
    render(<DrawingStage startedAt={Date.now()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('牌已抽出 · 正在解读');
    expect(status).toHaveTextContent('占卜师正在为你写下今日的指引 · 0 秒');

    act(() => vi.advanceTimersByTime(3000));
    expect(status).toHaveTextContent('· 3 秒');

    act(() => vi.advanceTimersByTime(12000));
    expect(status).toHaveTextContent('解读还在写，请留在这里稍候 · 15 秒');
  });

  it('关掉弹窗再打开,秒数接着起始时刻算', () => {
    vi.useFakeTimers();
    render(<DrawingStage startedAt={Date.now() - 22000} />);
    expect(screen.getByRole('status')).toHaveTextContent('解读还在写，请留在这里稍候 · 22 秒');
  });
});
