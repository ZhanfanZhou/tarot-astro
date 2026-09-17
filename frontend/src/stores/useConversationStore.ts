import { create } from 'zustand';
import type { Conversation, Message } from '@/types';

interface ConversationState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  /**
   * 进行中的一轮，按会话记：会话 id → 已流式收到的正文。一轮属于发起它的那场会话，
   * 用户中途切到别的会话，流式文字、思考气泡、输入框锁定都不会跟过去。
   */
  liveTurns: Record<string, string>;
  startTurn: (conversationId: string) => void;
  appendTurn: (conversationId: string, chunk: string) => void;
  /** 一轮结束：用刷新后的会话替换旧的，并清掉流式文本——同一次更新，不会两者同时出现在屏幕上 */
  finishTurn: (conversationId: string, refreshed: Conversation | null) => void;
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversation: (conversation: Conversation | null) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (conversation: Conversation) => void;
  removeConversation: (conversationId: string) => void;
  addMessageToCurrentConversation: (message: Message) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: [],
  currentConversation: null,
  liveTurns: {},

  startTurn: (conversationId) =>
    set((state) => ({ liveTurns: { ...state.liveTurns, [conversationId]: '' } })),

  appendTurn: (conversationId, chunk) =>
    set((state) =>
      conversationId in state.liveTurns
        ? { liveTurns: { ...state.liveTurns, [conversationId]: state.liveTurns[conversationId] + chunk } }
        : state
    ),

  finishTurn: (conversationId, refreshed) =>
    set((state) => {
      const liveTurns = { ...state.liveTurns };
      delete liveTurns[conversationId];
      if (!refreshed) return { liveTurns };
      return {
        liveTurns,
        conversations: state.conversations.map((c) =>
          c.conversation_id === refreshed.conversation_id ? refreshed : c
        ),
        currentConversation:
          state.currentConversation?.conversation_id === refreshed.conversation_id
            ? refreshed
            : state.currentConversation,
      };
    }),
  
  setConversations: (conversations) => set({ conversations }),
  
  setCurrentConversation: (conversation) => set({ currentConversation: conversation }),
  
  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),
  
  updateConversation: (conversation) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.conversation_id === conversation.conversation_id ? conversation : c
      ),
      currentConversation:
        state.currentConversation?.conversation_id === conversation.conversation_id
          ? conversation
          : state.currentConversation,
    })),
  
  removeConversation: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.filter(
        (c) => c.conversation_id !== conversationId
      ),
      currentConversation:
        state.currentConversation?.conversation_id === conversationId
          ? null
          : state.currentConversation,
    })),

  addMessageToCurrentConversation: (message) =>
    set((state) => {
      if (!state.currentConversation) return state;
      
      const updatedConversation = {
        ...state.currentConversation,
        messages: [...state.currentConversation.messages, message],
      };

      return {
        conversations: state.conversations.map((c) =>
          c.conversation_id === updatedConversation.conversation_id
            ? updatedConversation
            : c
        ),
        currentConversation: updatedConversation,
      };
    }),
}));




