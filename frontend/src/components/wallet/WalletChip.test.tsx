import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useDeckWallet } from '../../stores/useDeckWallet';

// 钱包以后端为源；测试里直接把余额写进 store，验证格式化与充值按钮。
beforeEach(() => { useDeckWallet.setState({ balance: 8888 }); });

describe('WalletChip', () => {
  it('shows the formatted stardust balance and a 充值 button', async () => {
    const { default: WalletChip } = await import('./WalletChip');
    const { container, getByText } = render(<WalletChip />);
    expect(container.textContent).toContain('8,888');
    expect(getByText('充值')).toBeInTheDocument();
  });
});
