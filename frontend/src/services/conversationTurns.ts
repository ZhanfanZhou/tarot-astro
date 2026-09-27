/** 一场会话只有一个接收者。连接断开只恢复接收，绝不重发生成请求。 */
import { conversationApi, GenerationFailed } from './api';
import { useConversationStore } from '@/stores/useConversationStore';
import type { Conversation, Message } from '@/types';

const active = new Map<string, Promise<void>>();
type Attempt = { before: Conversation; sent?: Message; error?: unknown };
const pendingRequests = new Map<string, Attempt>();
const state = () => useConversationStore.getState();
const reconnectDelay = () => new Promise((resolve) => setTimeout(resolve, 500));

function track(id: string, work: () => Promise<void>): Promise<void> {
  const existing = active.get(id);
  if (existing) return existing;
  // 发请求之前就占住这场会话，快速切走再切回不会多起一个订阅。
  if (!(id in state().liveTurns)) state().startTurn(id);
  const task = Promise.resolve().then(work).finally(() => active.delete(id));
  active.set(id, task);
  return task;
}

function settle(conversation: Conversation) {
  const id = conversation.conversation_id;
  state().finishTurn(id, conversation);
  if (conversation.failed_turn) state().handleFailure(conversation);
  else state().setTurnNotice(id, null);
}

async function follow(
  id: string,
  attempt: Attempt | undefined = pendingRequests.get(id),
): Promise<void> {
  let interruptions = 0;
  while (true) {
    try {
      const snapshot = await conversationApi.live(
        id,
        (base, conversation) => {
          if (conversation) state().updateConversation(conversation);
          else {
            const local = state().conversations.find((c) => c.conversation_id === id);
            if (local) state().updateConversation({ ...local, messages: local.messages.slice(0, base) });
          }
          state().startTurn(id); // 接回是从头回放，用同一气泡替换，不叠加上一次的正文
          state().setTurnNotice(id, null);
        },
        (chunk) => state().appendTurn(id, chunk),
      );
      if (!snapshot) continue; // 流已结束，再取一次带状态的最终会话（代替原来的 GET 会话）
      pendingRequests.delete(id);
      settle(snapshot);
      // POST 没收到响应时，可能压根没送到后端。只在后端确认空闲且未收这句时退回。
      if (attempt?.sent && !snapshot.failed_turn) {
        const received = snapshot.messages.slice(attempt.before.messages.length)
          .some((m) => m.role === 'user' && m.content === attempt.sent!.content);
        if (!received) {
          state().restoreDraft(id, attempt.sent.content);
          state().setTurnNotice(id, { kind: 'failed', text: '消息未送达，已放回输入框。' });
        }
      } else if (attempt?.error && !attempt.sent && !snapshot.failed_turn &&
                 !snapshot.messages.slice(attempt.before.messages.length).some((m) => m.role === 'assistant')) {
        // 例如抽牌请求在进入生成前被拒绝，原抽牌/补资料入口仍由会话历史推导。
        state().setTurnNotice(id, { kind: 'failed', text: '这次未能完成，可以重试。' });
      }
      return;
    } catch (error) {
      if (error instanceof GenerationFailed) continue; // 后台已收口，下一次取回清理后的历史和草稿
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403 || status === 404) {
        pendingRequests.delete(id);
        state().rejectTurn(id, attempt?.sent);
        if (attempt?.sent) state().restoreDraft(id, attempt.sent.content);
        state().setTurnNotice(id, { kind: 'failed', text: (error as Error).message });
        return;
      }
      if (++interruptions > 2) {
        // 不知道后台是否还在跑：保留气泡和发送锁，不把连接中断当生成失败。
        state().setTurnNotice(id, { kind: 'offline', text: '连接暂时中断，恢复后会接着显示。' });
        return;
      }
      state().setTurnNotice(id, { kind: 'reconnecting', text: '正在重新连接…' });
      await reconnectDelay();
    }
  }
}

export function attachConversationTurn(conversation: Conversation): Promise<void> {
  return track(conversation.conversation_id, () => follow(conversation.conversation_id));
}

export function runConversationTurn(
  before: Conversation,
  start: (onChunk: (chunk: string) => void) => Promise<void>,
  options: { sent?: Message; onQuota: () => void },
): Promise<void> {
  const id = before.conversation_id;
  return track(id, async () => {
    state().setTurnNotice(id, null);
    let failure: unknown;
    try {
      await start((chunk) => state().appendTurn(id, chunk));
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 429) {
        // 额度拒收是确定的：后端未写任何消息，不需要再拉一遍历史。
        state().rejectTurn(id, options.sent);
        if (options.sent) state().restoreDraft(id, options.sent.content);
        options.onQuota();
        return;
      }
      failure = error;
      if (status === 409 && options.sent) state().restoreDraft(id, options.sent.content);
    }
    // 成功、断流、模型失败都从同一处核对最终状态；不提前撤气泡或解锁。
    const attempt = { before, sent: options.sent, error: failure };
    pendingRequests.set(id, attempt);
    await follow(id, attempt);
  });
}

/** 网络恢复/回到页面时，只恢复之前没接上的会话，不轮询、不重新调用模型。 */
export function reconnectConversations() {
  for (const [id, notice] of Object.entries(state().turnNotices)) {
    if (notice.kind !== 'offline') continue;
    const conversation = state().conversations.find((c) => c.conversation_id === id)
      ?? (state().currentConversation?.conversation_id === id ? state().currentConversation : null);
    if (conversation) void attachConversationTurn(conversation);
  }
}
