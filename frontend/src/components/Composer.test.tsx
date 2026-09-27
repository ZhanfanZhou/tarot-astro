import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Composer from './Composer';
import { useConversationStore } from '@/stores/useConversationStore';

afterEach(cleanup);
beforeEach(() => useConversationStore.setState({ drafts: {} }));

function Input({ id, onSend }: { id: string; onSend: (text: string) => Promise<void> }) {
  const { drafts, setDraft } = useConversationStore();
  return <Composer message={drafts[id] ?? ''} onMessageChange={(text) => setDraft(id, text)} onSend={onSend} />;
}
const typeAndSend = (text: string) => {
  const ta = document.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.keyDown(ta, { key: 'Enter' });
  return ta;
};

describe('Composer 会话草稿', () => {
  it('发送后清空，额度拒收时可退回同一场的输入框', async () => {
    const onSend = vi.fn(async (text) => { useConversationStore.getState().restoreDraft('a', text); });
    render(<Input id="a" onSend={onSend} />);
    const ta = typeAndSend('我该换工作吗？');
    await waitFor(() => expect(ta.value).toBe('我该换工作吗？'));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('等待期间切到另一场：被拒的文字只退回原会话，不覆盖当前草稿', async () => {
    let reject!: () => void;
    const onSend = async (text: string) => {
      await new Promise<void>((resolve) => { reject = resolve; });
      useConversationStore.getState().restoreDraft('a', text);
    };
    const view = render(<Input id="a" onSend={onSend} />);
    typeAndSend('A 的问题');
    view.rerender(<Input id="b" onSend={onSend} />);
    const ta = document.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'B 的草稿' } });
    reject();
    await waitFor(() => expect(useConversationStore.getState().drafts.a).toBe('A 的问题'));
    expect(ta.value).toBe('B 的草稿');
    view.rerender(<Input id="a" onSend={onSend} />);
    expect(ta.value).toBe('A 的问题');
  });
});
