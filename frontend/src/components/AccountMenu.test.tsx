import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import AccountMenu from './AccountMenu';
import { UserType } from '@/types';
import type { User } from '@/types';

// 这仓库没开 vitest globals(没有自动 cleanup)
afterEach(cleanup);

const user: User = {
  user_id: 'u1',
  user_type: UserType.GUEST,
  profile: { nickname: '小x' },
  created_at: '2026-09-22T00:00:00',
};

const renderMenu = (energy: number | null) =>
  render(<AccountMenu user={user} energy={energy} onConvert={vi.fn()} onLogout={vi.fn()} />);

describe('AccountMenu 能量剩余', () => {
  it('shows the remaining percentage on the account button', () => {
    renderMenu(80);
    const button = screen.getByRole('button', { name: '设置' });
    expect(button).toHaveTextContent('能量剩余');
    expect(button).toHaveTextContent('80%');
  });

  it('shows a meter in the settings panel', () => {
    renderMenu(80);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const meter = screen.getByRole('meter', { name: '能量剩余' });
    expect(meter).toHaveAttribute('aria-valuenow', '80');
    expect(meter).toHaveTextContent('80%');
  });

  it('draws nothing until the quota has been fetched', () => {
    renderMenu(null);
    expect(screen.queryByText('能量剩余')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
