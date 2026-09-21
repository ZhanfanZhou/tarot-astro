import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CardRevealOverlay from './CardRevealOverlay';

// 这一幕是 portal 进 document.body 的,而且这仓库没开 vitest globals(没有自动 cleanup)
afterEach(cleanup);

describe('CardRevealOverlay', () => {
  it('牌还没回来:按牌阵摆好牌背等着,一个牌名都不写', () => {
    render(<CardRevealOverlay cards={null} positions={['过去', '现在', '未来']} onDone={() => {}} />);

    expect(screen.getByText('牌阵落位')).toBeTruthy();
    expect(screen.getByText('过去')).toBeTruthy();
    expect(document.querySelectorAll('img[src="/tarot-images/card-back.png"]').length).toBe(3);
    expect(screen.queryByText('命运之牌已就位')).toBeNull();
  });

  it('牌到了:每张牌摆上自己的牌面和正逆位', () => {
    const { rerender } = render(
      <CardRevealOverlay cards={null} positions={['过去', '现在', '未来']} onDone={() => {}} />
    );

    rerender(
      <CardRevealOverlay
        cards={[
          { card_id: 0, card_name: '愚者', reversed: false },
          { card_id: 1, card_name: '魔术师', reversed: true },
          { card_id: 2, card_name: '女祭司', reversed: false },
        ]}
        positions={['过去', '现在', '未来']}
        onDone={() => {}}
      />
    );

    expect(screen.getByAltText('愚者')).toBeTruthy();
    expect(screen.getByAltText('魔术师')).toBeTruthy();
    expect(screen.getByText('逆位')).toBeTruthy();
    expect(screen.getAllByText('正位').length).toBe(2);
    expect(screen.getByText('命运之牌已就位')).toBeTruthy();
  });

  it('手机窄屏的三张牌阵:一次只摆一张,翻完一张换下一张', async () => {
    const wide = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      const positions = ['过去', '现在', '未来'];
      const { rerender } = render(
        <CardRevealOverlay cards={null} positions={positions} onDone={() => {}} />
      );
      expect(document.querySelectorAll('img[src="/tarot-images/card-back.png"]').length).toBe(1);

      rerender(
        <CardRevealOverlay
          cards={[
            { card_id: 0, card_name: '愚者', reversed: false },
            { card_id: 1, card_name: '魔术师', reversed: true },
            { card_id: 2, card_name: '女祭司', reversed: false },
          ]}
          positions={positions}
          onDone={() => {}}
        />
      );

      // 牌背先滑走,第一张才滑进来(mode="wait")
      await screen.findByAltText('愚者');
      expect(screen.queryByAltText('魔术师')).toBeNull();
      expect(screen.getByText('过去')).toBeTruthy();
      expect(screen.queryByText('现在')).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: wide, configurable: true });
    }
  });
});
