import { describe, expect, it } from 'vitest';
import { MessageRole, SessionType, type Conversation, type Message } from '@/types';
import { canDelete } from './conversation';

const conv = (session_type: SessionType, roles: MessageRole[]): Conversation => ({
  conversation_id: 'c',
  user_id: 'u',
  session_type,
  title: 't',
  messages: roles.map((role) => ({ role, content: '' }) as Message),
  created_at: '2026-09-20T10:00:00',
  updated_at: '2026-09-20T10:00:00',
  is_completed: false,
  has_drawn_cards: true,
});

describe('canDelete', () => {
  it('普通对话都能删', () => {
    expect(canDelete(conv(SessionType.TAROT, [MessageRole.ASSISTANT]))).toBe(true);
    expect(canDelete(conv(SessionType.ASTROLOGY, []))).toBe(true);
  });
  it('只抽了签的日签对话不能删', () => {
    expect(canDelete(conv(SessionType.DAILY, [MessageRole.ASSISTANT]))).toBe(false);
  });
  it('日签接着聊过就能删', () => {
    expect(canDelete(conv(SessionType.DAILY, [MessageRole.ASSISTANT, MessageRole.USER]))).toBe(true);
  });
});
