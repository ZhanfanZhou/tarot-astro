import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DailyOracleModal, { ReadingPending } from './DailyOracleModal';
import { conversationApi, dailyApi } from '@/services/api';
import { toast } from '@/stores/useToastStore';
import type { DailyOverview } from '@/types';

// 往日的解读从对话里取;这里给一段固定的,不走网络
vi.mock('@/services/api', () => ({
  conversationApi: {
    get: vi.fn().mockResolvedValue({ messages: [{ role: 'assistant', content: '今天适合把心放回原处。' }] }),
  },
  dailyApi: { draw: vi.fn(), reading: vi.fn(), feedback: vi.fn() },
}));

// 选牌器换成一个按钮:这里只关心选完之后弹窗里的顺序
vi.mock('../TarotCardDrawer', () => ({
  default: ({ isOpen, onCardsDrawn }: { isOpen: boolean; onCardsDrawn: (cards: unknown[]) => void }) =>
    isOpen ? <button onClick={() => onCardsDrawn([])}>确认抽牌</button> : null,
}));

// 牌翻开之后到解读回来之间:说清楚在做什么、已经等了几秒,等久了换一句
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ReadingPending', () => {
  it('秒数一直在跳,等久了换成「还在写」', () => {
    vi.useFakeTimers();
    render(<ReadingPending startedAt={Date.now()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('正在解读');
    expect(status).toHaveTextContent('占卜师正在为你写下今日的指引 · 0 秒');

    act(() => vi.advanceTimersByTime(3000));
    expect(status).toHaveTextContent('· 3 秒');

    act(() => vi.advanceTimersByTime(12000));
    expect(status).toHaveTextContent('解读还在写，请留在这里稍候 · 15 秒');
  });

  it('关掉弹窗再打开,秒数接着起始时刻算', () => {
    vi.useFakeTimers();
    render(<ReadingPending startedAt={Date.now() - 22000} />);
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
    vi.mocked(dailyApi.reading).mockResolvedValue({ reading: '今天适合把心放回原处。' });
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

describe('DailyOracleModal 抽牌', () => {
  const undrawn: DailyOverview = {
    ...overview,
    today_record: null,
    streak: 0,
    history: [{ effective_date: TODAY, record: null, tagline: null, conversation_exists: false }],
  };
  const drawn: DailyOverview = {
    ...overview,
    history: [{ effective_date: TODAY, record, tagline: null, conversation_exists: true }],
  };

  // 弹窗的 overview 由外面给:抽完牌刷新一次,记录就到了
  const Harness: React.FC = () => {
    const [ov, setOv] = useState<DailyOverview>(undrawn);
    return (
      <DailyOracleModal
        isOpen
        userId="u1"
        overview={ov}
        onClose={() => {}}
        onRefreshOverview={async () => setOv(drawn)}
        onContinueConversation={() => {}}
        onOpenJourney={() => {}}
      />
    );
  };

  const drawOnce = async () => {
    fireEvent.click(screen.getByRole('button', { name: /静心/ }));
    fireEvent.click(screen.getByText('确认抽牌'));
    await screen.findByLabelText('查看大图');
  };

  it('抽完牌先翻开,解读回来再放到牌下面', async () => {
    vi.mocked(dailyApi.draw).mockResolvedValue({ record, conversation_id: 'conv_x' });
    let finish: (value: { reading: string }) => void = () => {};
    vi.mocked(dailyApi.reading).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<Harness />);

    await drawOnce();
    // 牌面和牌名已经在了,解读还在写
    expect(screen.getByText('星星 · 正位')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在解读');
    expect(screen.queryByText('继续这段对话 ›')).not.toBeInTheDocument();
    expect(conversationApi.get).not.toHaveBeenCalled();

    await act(async () => finish({ reading: '今天适合把心放回原处。' }));
    expect(screen.getByText('今天适合把心放回原处。')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('继续这段对话 ›')).toBeInTheDocument();
  });

  it('服务端说写失败了:牌照旧,提示,舞台上可以再要一次', async () => {
    vi.mocked(dailyApi.draw).mockResolvedValue({ record, conversation_id: 'conv_x' });
    vi.mocked(dailyApi.reading).mockRejectedValueOnce({ response: { data: { detail: '占卜师暂时联系不上，请重试' } } });
    const toastError = vi.spyOn(toast, 'error');
    render(<Harness />);

    await drawOnce();
    const retry = await screen.findByText('重新解读');
    expect(toastError).toHaveBeenCalledWith('占卜师暂时联系不上，请重试');
    expect(screen.getByText('星星 · 正位')).toBeInTheDocument();

    vi.mocked(dailyApi.reading).mockResolvedValueOnce({ reading: '星星说,先把心放回原处。' });
    fireEvent.click(retry);
    expect(await screen.findByText('星星说,先把心放回原处。')).toBeInTheDocument();
    expect(dailyApi.reading).toHaveBeenCalledTimes(2);
  });
});

describe('DailyOracleModal 刷新之后', () => {
  const pendingToday: DailyOverview = {
    ...overview,
    history: [{ effective_date: TODAY, record, tagline: null, conversation_exists: true }],
  };
  const props = {
    userId: 'u1',
    onClose: () => {},
    onRefreshOverview: async () => {},
    onContinueConversation: () => {},
    onOpenJourney: () => {},
  };

  it('今天的牌还没有解读:向 /reading 要,等服务端正在写的那一份,不当成失败', async () => {
    let finish: (value: { reading: string }) => void = () => {};
    vi.mocked(dailyApi.reading).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DailyOracleModal isOpen overview={pendingToday} {...props} />);

    expect(await screen.findByRole('status')).toHaveTextContent('正在解读');
    expect(screen.queryByText('重新解读')).not.toBeInTheDocument();
    expect(dailyApi.reading).toHaveBeenCalledWith('u1', TODAY);
    expect(conversationApi.get).not.toHaveBeenCalled();

    await act(async () => finish({ reading: '今天适合把心放回原处。' }));
    expect(screen.getByText('今天适合把心放回原处。')).toBeInTheDocument();
    expect(dailyApi.reading).toHaveBeenCalledTimes(1);
  });

  it('弹窗关着时在后台要解读失败了:不弹提示,打开后舞台上给「重新解读」', async () => {
    vi.mocked(dailyApi.reading).mockRejectedValueOnce({ response: { data: { detail: '占卜师暂时联系不上，请重试' } } });
    const toastError = vi.spyOn(toast, 'error');
    const { rerender } = render(<DailyOracleModal isOpen={false} overview={pendingToday} {...props} />);
    await act(async () => {});
    expect(dailyApi.reading).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();

    rerender(<DailyOracleModal isOpen overview={pendingToday} {...props} />);
    expect(await screen.findByText('重新解读')).toBeInTheDocument();
    expect(dailyApi.reading).toHaveBeenCalledTimes(1); // 失败了不自己反复重来
  });

  it('往日的牌只读对话里的解读,不去写', async () => {
    const YESTERDAY = '2026-09-23';
    const past = { ...record, effective_date: YESTERDAY, conversation_id: 'conv_past' };
    const withPast: DailyOverview = {
      ...overview,
      today_record: null,
      history: [
        { effective_date: YESTERDAY, record: past, tagline: null, conversation_exists: true },
        { effective_date: TODAY, record: null, tagline: null, conversation_exists: false },
      ],
    };
    render(<DailyOracleModal isOpen overview={withPast} {...props} />);

    fireEvent.click(screen.getByLabelText(`${YESTERDAY} 星星`));
    expect(await screen.findByText('今天适合把心放回原处。')).toBeInTheDocument();
    expect(conversationApi.get).toHaveBeenCalledWith('conv_past');
    expect(dailyApi.reading).not.toHaveBeenCalled();
  });
});
