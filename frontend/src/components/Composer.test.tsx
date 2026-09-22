import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Composer from './Composer';

// 这仓库没开 vitest globals(没有自动 cleanup)
afterEach(cleanup);

const typeAndSend = (text: string) => {
  const ta = document.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.keyDown(ta, { key: 'Enter' });
  return ta;
};

describe('Composer', () => {
  it('发出去了:输入框清空', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<Composer onSend={onSend} />);

    const ta = typeAndSend('我该换工作吗？');
    expect(onSend).toHaveBeenCalledWith('我该换工作吗？');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(ta.value).toBe('');
  });

  it('今日额度用完、后端没收:这句话回到输入框,额度够了直接再发', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<Composer onSend={onSend} />);

    const ta = typeAndSend('我该换工作吗？');
    await waitFor(() => expect(ta.value).toBe('我该换工作吗？'));
  });
});
