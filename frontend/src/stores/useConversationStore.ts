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
  drafts: Record<string, string>;
  turnNotices: Record<string, { kind: 'reconnecting' | 'offline' | 'failed'; text: string }>;
  handledFailures: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
  restoreDraft: (conversationId: string, text: string) => void;
  setTurnNotice: (conversationId: string, notice: ConversationState['turnNotices'][string] | null) => void;
  handleFailure: (conversation: Conversation) => void;
  startTurn: (conversationId: string) => void;
  appendTurn: (conversationId: string, chunk: string) => void;
  /** 一轮结束：用刷新后的会话替换旧的，并清掉流式文本——同一次更新，不会两者同时出现在屏幕上 */
  finishTurn: (conversationId: string, refreshed: Conversation | null) => void;
  /**
   * 一轮被后端拒收（今日额度用完，什么都没落库）：清掉流式文本，撤下先显示出去的那句 sent（按引用找）。
   * 库里的会话就是这一轮之前的样子，本地撤掉这一句就和它一致，其余消息原样不动——同一次更新。
   */
  rejectTurn: (conversationId: string, sent?: Message) => void;
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
  drafts: {},
  turnNotices: {},
  handledFailures: {},

  setDraft: (id, text) => set((s) => ({ drafts: { ...s.drafts, [id]: text } })),
  restoreDraft: (id, text) => set((s) => ({ drafts: { ...s.drafts, [id]: s.drafts[id] || text } })),
  setTurnNotice: (id, notice) => set((s) => {
    const turnNotices = { ...s.turnNotices };
    if (notice) turnNotices[id] = notice;
    else delete turnNotices[id];
    return { turnNotices };
  }),
  handleFailure: (conversation) => set((s) => {
    const failure = conversation.failed_turn;
    const id = conversation.conversation_id;
    if (!failure || s.handledFailures[id] === failure.id) return s;
    return {
      handledFailures: { ...s.handledFailures, [id]: failure.id },
      drafts: { ...s.drafts, [id]: s.drafts[id] || failure.content || '' },
      turnNotices: { ...s.turnNotices, [id]: {
        kind: 'failed',
        text: failure.action === 'message'
          ? '这次没能回复，问题已放回输入框，可以重发或修改。'
          : '这次没能回复，可以重试或直接继续说。',
      } },
    };
  }),

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
  
  rejectTurn: (conversationId, sent) =>
    set((state) => {
      const liveTurns = { ...state.liveTurns };
      delete liveTurns[conversationId];
      if (!sent) return { liveTurns };
      const drop = (c: Conversation) =>
        c.conversation_id === conversationId ? { ...c, messages: c.messages.filter((m) => m !== sent) } : c;
      return {
        liveTurns,
        conversations: state.conversations.map(drop),
        currentConversation: state.currentConversation && drop(state.currentConversation),
      };
    }),

  setConversations: (conversations) => set((state) => ({
    // 刷新列表时，进行中的会话仍用流开始前的快照，不能把后台已落库的半段再显示一次。
    // 也保留乐观消息的引用，额度拒收时 rejectTurn 能准确撤回它。
    conversations: conversations.map((conversation) =>
      conversation.conversation_id in state.liveTurns
        ? state.conversations.find((c) => c.conversation_id === conversation.conversation_id) ?? conversation
        : conversation
    ),
  })),
  
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


