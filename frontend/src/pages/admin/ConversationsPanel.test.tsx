import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import type { AdminConvSummary, AdminConversation } from '@/services/adminApi';

// 用户删掉后归档的会话和正常会话混在同一个列表里，只多一个「已归档」标记。
const summary = (id: string, archived_at: string | null): AdminConvSummary => ({
  conversation_id: id, user_id: 'u1', updated_at: '2026-09-20T10:00:00', created_at: '2026-09-20T09:00:00',
  session_type: 'tarot', title: `标题-${id}`, message_count: 2,
  username: 'alice', nickname: null, user_type: 'registered', phase: 'reading', archived_at,
});

const ITEMS = [summary('live', null), summary('gone', '2026-09-21T08:30:00')];

const DETAIL: AdminConversation = {
  conversation_id: 'gone', user_id: 'u1', session_type: 'tarot', title: '标题-gone',
  created_at: '2026-09-20T09:00:00', updated_at: '2026-09-20T10:00:00',
  messages: [{ role: 'user', content: '想问问工作' }], archived_at: '2026-09-21T08:30:00',
};

vi.mock('@/services/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/services/adminApi')>()),
  adminApi: {
    conversations: async () => ({ items: ITEMS, total: ITEMS.length }),
    conversation: async () => DETAIL,
  },
}));

import ConversationsPanel from './ConversationsPanel';

afterEach(cleanup);

describe('ConversationsPanel', () => {
  it('归档的会话留在列表原处，标「已归档」；正常会话不标', async () => {
    const { container, getByText } = render(<ConversationsPanel />);
    await waitFor(() => getByText('标题-gone'));

    const rows = container.querySelectorAll('.admin-conv-list li');
    expect([...rows].map((li) => li.querySelector('.title')?.textContent)).toEqual(['标题-live', '标题-gone']);
    expect(within(rows[0] as HTMLElement).queryByText('已归档')).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText('已归档')).toBeTruthy();
  });

  it('点开归档的会话，详情里写着什么时候被删的，消息照常显示', async () => {
    const { getByText, container } = render(<ConversationsPanel />);
    await waitFor(() => getByText('标题-gone'));
    fireEvent.click(getByText('标题-gone'));

    await waitFor(() => container.querySelector('.admin-conv-detail'));
    const detail = container.querySelector('.admin-conv-detail') as HTMLElement;
    expect(within(detail).getByText('已归档 · 用户于 2026-09-21 08:30 删除')).toBeTruthy();
    expect(within(detail).getByText('想问问工作')).toBeTruthy();
  });
});
