import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore } from './useConversationStore';
import { MessageRole } from '@/types';
import type { Conversation, Message } from '@/types';

// 一轮被后端以额度用完拒收（什么都没落库）：本地撤下先显示出去的那句，其余消息原样不动。
const msg = (role: MessageRole, content: string): Message => ({ role, content, timestamp: '2026-09-22T10:00:00Z' });
const conv = (id: string, messages: Message[]) => ({ conversation_id: id, messages } as unknown as Conversation);

const greeting = msg(MessageRole.ASSISTANT, '你想问什么？');
const earlier = msg(MessageRole.USER, '我该换工作吗？');
const reply = msg(MessageRole.ASSISTANT, '先说说你现在的处境。');

beforeEach(() => {
  const a = conv('a', [greeting, earlier, reply]);
  useConversationStore.setState({ conversations: [a, conv('b', [])], currentConversation: a, liveTurns: {} });
});

/** 照 App.handleSendMessage 的顺序：先显示这句，再开始这一轮 */
const send = (content: string) => {
  const sent = msg(MessageRole.USER, content);
  useConversationStore.getState().addMessageToCurrentConversation(sent);
  useConversationStore.getState().startTurn('a');
  return sent;
};

describe('rejectTurn', () => {
  it('只撤下没发出去的那句，之前的消息还是原来那几条（同一个对象），思考气泡一并收掉', () => {
    const sent = send('那我该什么时候辞职？');
    useConversationStore.getState().rejectTurn('a', sent);

    const s = useConversationStore.getState();
    expect(s.liveTurns).toEqual({});
    for (const c of [s.currentConversation!, s.conversations[0]]) {
      expect(c.messages).toHaveLength(3);
      c.messages.forEach((m, i) => expect(m).toBe([greeting, earlier, reply][i]));
    }
  });

  it('按引用找：之前说过一模一样的话，也只撤这一次', () => {
    const sent = send('我该换工作吗？');
    useConversationStore.getState().rejectTurn('a', sent);

    expect(useConversationStore.getState().currentConversation!.messages).toEqual([greeting, earlier, reply]);
    expect(useConversationStore.getState().currentConversation!.messages[1]).toBe(earlier);
  });

  it('用户中途切到了别的会话：当前那场不动，列表里发这句的那场照样撤下', () => {
    const sent = send('那我该什么时候辞职？');
    const b = useConversationStore.getState().conversations[1];
    useConversationStore.getState().setCurrentConversation(b);
    useConversationStore.getState().rejectTurn('a', sent);

    const s = useConversationStore.getState();
    expect(s.currentConversation).toBe(b);
    expect(s.conversations[0].messages).toHaveLength(3);
    expect(s.conversations[1]).toBe(b);
  });

  it('没有先显示出去的发言（开场白被拒）：只收掉流式状态，会话原样', () => {
    const before = useConversationStore.getState().currentConversation;
    useConversationStore.getState().startTurn('a');
    useConversationStore.getState().rejectTurn('a');

    const s = useConversationStore.getState();
    expect(s.liveTurns).toEqual({});
    expect(s.currentConversation).toBe(before);
  });
});
