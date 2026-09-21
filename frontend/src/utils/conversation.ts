import { MessageRole, SessionType, type Conversation } from '@/types';

/**
 * 每日一签的对话不能删；接着聊过（用户发过言）就是普通对话了，可以删。
 * 删掉的只是对话，那天的日运记录照样留着。规则和后端 ConversationService.deletable 同一条。
 */
export const canDelete = (conversation: Conversation): boolean =>
  conversation.session_type !== SessionType.DAILY ||
  conversation.messages.some((m) => m.role === MessageRole.USER);
