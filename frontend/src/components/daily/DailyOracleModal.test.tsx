import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DailyOracleModal, { DrawingStage } from './DailyOracleModal';

// 弹窗会去取当日解读全文;这里给一段固定的,不走网络
vi.mock('@/services/api', () => ({
  conversationApi: {
    get: vi.fn().mockResolvedValue({ messages: [{ role: 'assistant', content: '今天适合把心放回原处。' }] }),
  },
  dailyApi: { draw: vi.fn(), feedback: vi.fn() },
}));

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

const TODAY = '2026-09-24';
const record = {
  effective_date: TODAY,
  card: { card_id: 17, card_name: '星星', reversed: false },
  conversation_id: 'conv_x',
  drawn_at: `${TODAY}T08:00:00`,
  feedback: {},
};
const overview = {
  today_effective_date: TODAY,
  today_record: record,
  streak: 1,
  history: [{ effective_date: TODAY, record, tagline: '今天适合把心放回原处。', conversation_exists: true }],
  journey_ready: false,
  journey_count: 0,
};

describe('DailyOracleModal 牌面大图', () => {
  it('舞台上的牌面点开看大图', async () => {
    render(
      <DailyOracleModal
        isOpen
        userId="u1"
        overview={overview}
        onClose={() => {}}
        onRefreshOverview={async () => {}}
        onContinueConversation={() => {}}
        onOpenJourney={() => {}}
      />
    );
    await screen.findByText('今天适合把心放回原处。'); // 等解读取回来,状态落定

    fireEvent.click(screen.getByLabelText('查看大图'));
    expect(screen.getByLabelText('关闭预览')).toBeInTheDocument();
    expect(screen.getByText('The Star')).toBeInTheDocument();
  });
});
