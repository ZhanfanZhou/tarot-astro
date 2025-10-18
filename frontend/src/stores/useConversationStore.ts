import { create } from 'zustand';
import type { Conversation, Message } from '@/types';

interface ConversationState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
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




