import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CardPreview from './CardPreview';

// 这仓库没开 vitest globals(没有自动 cleanup)
afterEach(cleanup);

const star = { card_id: 17, card_name: '星星', reversed: true };

describe('CardPreview', () => {
  it('card 为 null 时什么都不显示', () => {
    render(<CardPreview card={null} onClose={() => {}} />);
    expect(screen.queryByLabelText('关闭预览')).toBeNull();
  });

  it('逆位牌的大图也正着放;带中英文牌名,点 × 关闭', () => {
    const onClose = vi.fn();
    render(<CardPreview card={star} onClose={onClose} />);
    const img = screen.getByAltText('星星');
    expect(img).toHaveAttribute('src', '/tarot-images/decks/classic-rws/major/the-star.png');
    expect(img.style.transform).toBe('');
    expect(screen.getByText('The Star')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭预览'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
