import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// 卷宗只读:写过的篇目按卷排开,没有任何改写入口(一天只写一篇)。
const journeys = vi.fn();
const journey = vi.fn();

vi.mock('@/services/api', () => ({
  dailyApi: {
    journeys: (...args: unknown[]) => journeys(...args),
    journey: (...args: unknown[]) => journey(...args),
  },
  StreamCut: class StreamCut extends Error {},
}));

const TODAY = '2026-09-19';

const entry = (generated_on: string, date_range: string, text: string) => ({
  generated_on, date_range, text, generated_at: `${generated_on}T10:00:00`,
});

beforeEach(() => {
  journeys.mockReset();
  journey.mockReset();
});

describe('JourneyChronicle', () => {
  it('把写过的篇目按卷排开,哪一篇都不能重写', async () => {
    journeys.mockResolvedValue({
      entries: [
        entry(TODAY, '2026-09-05 ~ 2026-09-19', '你从一张宝剑三出发……'),
        entry('2026-09-01', '2026-08-20 ~ 2026-09-01', '更早的那一段。'),
      ],
      ready: false,
      pending_today: false,
    });
    const { default: JourneyChronicle } = await import('./JourneyChronicle');
    render(<JourneyChronicle isOpen userId="u" todayDate={TODAY} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('你从一张宝剑三出发……')).toBeInTheDocument());
    // 最新一篇是卷二(卷号按时间先后给),默认翻在它上面
    expect(screen.getAllByText('卷二').length).toBeGreaterThan(0);
    expect(screen.getByText('卷一')).toBeInTheDocument();
    expect(screen.getAllByText('9月5日 — 9月19日').length).toBeGreaterThan(0);
    // 只读:整个卷宗里没有输入框,今天那一篇也不能重写
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.queryByText('重写今日这一篇')).toBeNull();
  });

  it('今天聊过但还没归档时说明一句', async () => {
    journeys.mockResolvedValue({
      entries: [entry(TODAY, '2026-09-05 ~ 2026-09-19', '你从一张宝剑三出发……')],
      ready: false,
      pending_today: true,
    });
    const { default: JourneyChronicle } = await import('./JourneyChronicle');
    render(<JourneyChronicle isOpen userId="u" todayDate={TODAY} onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/今天的对话还在占卜师案头/)).toBeInTheDocument()
    );
  });

  it('一篇都没有时给出卷宗为空的状态', async () => {
    journeys.mockResolvedValue({ entries: [], ready: false, pending_today: false });
    const { default: JourneyChronicle } = await import('./JourneyChronicle');
    render(<JourneyChronicle isOpen userId="u" todayDate={TODAY} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('卷宗还是空的')).toBeInTheDocument());
    expect(screen.getByText(/再积累几次日签或占卜/)).toBeInTheDocument();
  });

  it('打开卷宗时今天那一篇在服务端正在写(写的时候刷新过页面):自动接上,写完就在卷里', async () => {
    const written = entry(TODAY, '2026-09-05 ~ 2026-09-19', '你从一张宝剑三出发……');
    journeys
      .mockResolvedValueOnce({ entries: [], ready: true, pending_today: false, writing: true })
      .mockResolvedValue({ entries: [written], ready: true, pending_today: false, writing: false });
    let finish: () => void = () => {};
    journey.mockImplementation((_u: string, _d: string, onChunk: (c: string) => void) => {
      onChunk('你从一张宝剑三出发');
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const { default: JourneyChronicle } = await import('./JourneyChronicle');
    const { rerender } = render(<JourneyChronicle isOpen userId="u" todayDate={TODAY} onClose={() => {}} />);

    // 没点「写下这一篇」就接上了,已经写出来的先显示
    await waitFor(() => expect(screen.getByText('正在回望……')).toBeInTheDocument());
    expect(screen.getByText('你从一张宝剑三出发')).toBeInTheDocument();

    // 同一个页面里关了卷宗再打开:接着看这一份,不再接一次
    rerender(<JourneyChronicle isOpen={false} userId="u" todayDate={TODAY} onClose={() => {}} />);
    rerender(<JourneyChronicle isOpen userId="u" todayDate={TODAY} onClose={() => {}} />);
    expect(journey).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(screen.getAllByText('你从一张宝剑三出发……').length).toBeGreaterThan(0));
    expect(screen.queryByText('正在回望……')).not.toBeInTheDocument();
    expect(journey).toHaveBeenCalledTimes(1);
  });
});
