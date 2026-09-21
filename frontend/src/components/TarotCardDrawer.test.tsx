import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TarotCardDrawer from './TarotCardDrawer';

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
});
