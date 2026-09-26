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

  // 牌跟着手指走，拖完松手时指针底下还是按下的那张，浏览器照样发 click
  const mouse = { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0 };
  const dragFrom = (el: Element, fromX: number, toX: number) => {
    fireEvent.pointerDown(el, { ...mouse, clientX: fromX });
    fireEvent.pointerMove(window, { ...mouse, clientX: (fromX + toX) / 2 });
    fireEvent.pointerMove(window, { ...mouse, clientX: toX });
    fireEvent.pointerUp(window, { ...mouse, clientX: toX });
  };

  it('在牌上拖过再松手:松手处那张牌不选中;原地点一下照常选中', () => {
    openSpread(['过去', '现在', '未来']);
    const card = screen.getByAltText('塔罗牌 1');
    dragFrom(card, 200, 160);
    fireEvent.click(card);
    expect(screen.getByText('0 / 3')).toBeInTheDocument();

    fireEvent.pointerDown(card, { ...mouse, clientX: 160 });
    fireEvent.pointerUp(window, { ...mouse, clientX: 160 });
    fireEvent.click(card);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('拖着牌到弹层外松手不关闭;直接点弹层外照常关闭', () => {
    const { onClose } = openSpread(['过去', '现在', '未来']);
    const backdrop = document.querySelector('.fixed.inset-0.z-50')!;
    dragFrom(screen.getByAltText('塔罗牌 1'), 200, 20);
    fireEvent.click(backdrop); // 按下和松手两处的共同祖先
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop, { ...mouse, clientX: 20 });
    fireEvent.pointerUp(window, { ...mouse, clientX: 20 });
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('按在滑轨 3/4 处:整条滑轨是一整圈 78 张,扇形直接转到牌堆的另一段', () => {
    openSpread(['过去', '现在', '未来']);
    const track = document.querySelector('.group\\/slider') as HTMLElement;
    // jsdom 没有布局:滑轨按设计尺寸 210px 宽、左边在 100px
    track.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 210, height: 8, right: 310, bottom: 8, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    expect(screen.getByAltText('塔罗牌 1')).toBeInTheDocument();

    // 3/4 处 = 旋转量 +19.5 张:正中换成第 20 张前后,第 1 张已经不在扇形上
    fireEvent.pointerDown(track, { ...mouse, clientX: 100 + 210 * 0.75 });
    expect(screen.queryByAltText('塔罗牌 1')).toBeNull();
    expect(screen.getByAltText('塔罗牌 21')).toBeInTheDocument();
    fireEvent.pointerUp(window, { ...mouse, clientX: 100 + 210 * 0.75 });
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
