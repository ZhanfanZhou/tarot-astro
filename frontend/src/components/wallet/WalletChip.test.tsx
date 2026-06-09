import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

beforeEach(() => { localStorage.clear(); });

describe('WalletChip', () => {
  it('shows the formatted stardust balance and a 充值 button', async () => {
    // import after clearing storage so the wallet store seeds the default balance
    const { default: WalletChip } = await import('./WalletChip');
    const { container, getByText } = render(<WalletChip />);
    expect(container.textContent).toContain('8,888');
    expect(getByText('充值')).toBeInTheDocument();
  });
});
