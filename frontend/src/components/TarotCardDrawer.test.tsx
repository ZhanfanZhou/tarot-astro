import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import TarotCardDrawer from './TarotCardDrawer';
import type { TarotCard } from '@/types';

// vitest 没开 globals,testing-library 不会自动清场
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// 打开即洗牌;洗完(最长约 4 秒,再加 0.35 秒收尾)才展扇形,牌才点得动
const openSpread = (positions: string[]) => {
  vi.useFakeTimers();
  const onCardsDrawn = vi.fn();
  const onClose = vi.fn();
  render(
    <TarotCardDrawer
      isOpen
      drawRequest={{ spread_type: positions.length === 1 ? 'single' : 'three_card', positions }}
      onClose={onClose}
      onCardsDrawn={onCardsDrawn}
      shuffleVariant={0}
    />
  );
  act(() => vi.advanceTimersByTime(6000));
  return { onCardsDrawn, onClose };
};

// 扇形里第 n 张(alt 从 1 数起,对应 card_id = n - 1)
const pick = (n: number) => fireEvent.click(screen.getByAltText(`塔罗牌 ${n}`));
const drawnIds = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[0][0] as TarotCard[]).map((c) => c.card_id);

describe('TarotCardDrawer', () => {
  it('打开即洗牌:不再有「开始洗牌」按钮,牌背当场就在动', () => {
    render(
      <TarotCardDrawer
        isOpen
        drawRequest={{ spread_type: 'three_card', positions: ['过去', '现在', '未来'] }}
        onClose={() => {}}
        onCardsDrawn={() => {}}
        shuffleVariant={0}
      />
    );

    expect(screen.queryByText('开始洗牌')).toBeNull();
    expect(screen.getAllByAltText('塔罗牌背面').length).toBeGreaterThan(10);
  });

  it('单张:选中后不收场,出「确认抽牌」,点了才交牌', () => {
    const { onCardsDrawn, onClose } = openSpread(['今日指引']);
    pick(1);
    expect(onCardsDrawn).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('牌已选定')).toBeInTheDocument();

    fireEvent.click(screen.getByText('确认抽牌'));
    expect(onCardsDrawn).toHaveBeenCalledTimes(1);
    expect(drawnIds(onCardsDrawn)).toEqual([0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('单张:点另一张直接换过去,交出的是后点的那张', () => {
    const { onCardsDrawn } = openSpread(['今日指引']);
    pick(1);
    pick(2);
    expect(onCardsDrawn).not.toHaveBeenCalled();
    expect(screen.getByText('牌已选定')).toBeInTheDocument();

    fireEvent.click(screen.getByText('确认抽牌'));
    expect(drawnIds(onCardsDrawn)).toEqual([1]);
  });

  it('单张:点已选的那张是取消,确认收起', () => {
    const { onCardsDrawn } = openSpread(['今日指引']);
    pick(1);
    pick(1);
    expect(screen.queryByText('确认抽牌')).toBeNull();
    expect(screen.getByText('凭直觉选出 1 张牌')).toBeInTheDocument();
    expect(onCardsDrawn).not.toHaveBeenCalled();
  });

  it('多张不变:选满才出确认,满了再点别的牌不换', () => {
    const { onCardsDrawn } = openSpread(['过去', '现在', '未来']);
    pick(1);
    pick(2);
    expect(screen.queryByText('确认抽牌')).toBeNull();
    pick(3);
    pick(4); // 已满:不换、不加
    fireEvent.click(screen.getByText('确认抽牌'));
    expect(drawnIds(onCardsDrawn)).toEqual([0, 1, 2]);
  });
});
