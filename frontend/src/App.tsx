import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from './components/TopBar';
import RecentArc, { RecentArcEdge, ARC_WIDTH, ARC_HEAD_H, useFitArcHeight } from './components/RecentArc';
import ChatMessage from './components/ChatMessage';
import Composer from './components/Composer';
import QuickReplies from './components/QuickReplies';
import SessionButtons from './components/SessionButtons';
import HubStrip from './components/HubStrip';
import DailyOracleModal from './components/daily/DailyOracleModal';
import JourneyChronicle from './components/daily/JourneyChronicle';
import { useDeckWallet } from './stores/useDeckWallet';
import TarotCardDrawer from './components/TarotCardDrawer';
import CardRevealOverlay from './components/CardRevealOverlay';
import AuthModal from './components/AuthModal';
import AstrologyProfileModal from './components/AstrologyProfileModal';
import ConvertToRegisteredModal from './components/ConvertToRegisteredModal';
import MysticBackground from './components/MysticBackground';
import Toaster from './components/ui/Toaster';
import ConfirmDialog from './components/ui/ConfirmDialog';
import { toast } from './stores/useToastStore';
import { confirmDialog } from './stores/useConfirmStore';
import { useAuthStore } from './stores/useAuthStore';
import { useConversationStore } from './stores/useConversationStore';
import { userApi, conversationApi, tarotApi, astrologyApi, dailyApi } from './services/api';
import { getEffectiveDate } from './utils/dailyDate';
import { quotaNotice } from './utils/quota';
import { MessageRole, UserType } from './types';
import type { Conversation, SessionType, DrawCardsRequest, Message, TarotCard, ToolCallRecord, UserProfile, DailyOverview } from './types';

/** 会话末尾是一次还在等用户动手的调用（抽牌 / 补资料）→ 返回它。和后端 tool_turns.pending_interrupt 同一个判据。 */
const INTERRUPT_TOOLS = new Set(['draw_tarot_cards', 'request_user_profile']);
function pendingInterrupt(conv: Conversation): ToolCallRecord | undefined {
  const tail = conv.messages[conv.messages.length - 1];
  const call = tail?.role === 'assistant' ? tail.tool_calls?.[0] : undefined;
  return call && INTERRUPT_TOOLS.has(call.name) ? call : undefined;
}

/** 有开场幕的会话类型：建完会话要去取一句开场白。和后端 context_service.OPENING_PHASE_SESSIONS 同一份名单。 */
const OPENING_PHASE_SESSIONS: SessionType[] = ['tarot' as SessionType, 'astrology' as SessionType];

const App: React.FC = () => {
  const { user, setUser, setAuth, logout } = useAuthStore();
  const {
    conversations,
    currentConversation,
    setConversations,
    setCurrentConversation,
    addConversation,
    updateConversation,
    removeConversation,
    addMessageToCurrentConversation,
    liveTurns,
    startTurn,
    appendTurn,
    finishTurn,
    rejectTurn,
  } = useConversationStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showCardDrawer, setShowCardDrawer] = useState(false);
  // 揭牌幕：抽牌窗口关掉之后盖在对话上翻牌。cards 为 null = 真牌还在路上
  const [reveal, setReveal] = useState<{ positions: string[]; cards: TarotCard[] | null } | null>(null);
  const [showAstrologyProfileModal, setShowAstrologyProfileModal] = useState(false);
  const isCreatingSessionRef = useRef(false); // 防止重复创建会话
  const [creatingSessionType, setCreatingSessionType] = useState<SessionType | null>(null);
  const previousConversationIdRef = useRef<string | null>(null); // 追踪上一次的对话ID，用于退出时保存笔记
  // 对话页左侧的最近占卜轨迹：量阅读区的实际高度（输入坞上面的快捷回复会折好几行），减去起点那块和上下余量给列表
  const [convPane, setConvPane] = useState<HTMLDivElement | null>(null);
  const convArcHeight = useFitArcHeight(convPane, ARC_HEAD_H + 24);

  // 每日一签:概览(殿堂入口+弹窗共用)
  const [dailyOverview, setDailyOverview] = useState<DailyOverview | null>(null);
  const [showDailyModal, setShowDailyModal] = useState(false);
  const [showJourney, setShowJourney] = useState(false);

  const refreshDailyOverview = React.useCallback(async () => {
    const uid = useAuthStore.getState().user?.user_id;
    if (!uid) return;
    try {
      setDailyOverview(await dailyApi.overview(uid, getEffectiveDate()));
    } catch (error) {
      console.error('[Daily] 加载日运概览失败:', error);
    }
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 旧会话迁移：localStorage 有 user 但无 token（首次部署 JWT 后），静默换取 token
  useEffect(() => {
    const { user: storedUser, token: storedToken } = useAuthStore.getState();
    if (storedUser && !storedToken) {
      userApi.migrateToken(storedUser.user_id)
        .then(({ access_token }) => setAuth(storedUser, access_token))
        .catch(() => { /* 用户不存在则保持原状，等后续 401 自然踢出 */ });
    }
  }, []);

  // 检查用户登录状态
  useEffect(() => {
    if (!user) {
      setShowAuthModal(true);
    } else {
      loadUserConversations();
    }
  }, [user]);

  // 用户就绪后拉取钱包（星尘余额 / 已拥有牌组 / 当前应用牌组）
  useEffect(() => {
    if (user?.user_id) {
      useDeckWallet.getState().load(user.user_id);
    }
  }, [user?.user_id]);

  // 日运概览:用户就绪时加载;窗口聚焦时重算生效日(跨天/跨 18:00 边界)并刷新
  useEffect(() => {
    if (user?.user_id) refreshDailyOverview();
  }, [user?.user_id, refreshDailyOverview]);

  useEffect(() => {
    const onFocus = () => refreshDailyOverview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDailyOverview]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages, currentConversation ? liveTurns[currentConversation.conversation_id] : undefined]);

  // 页面卸载时保存笔记
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (currentConversation) {
        // 使用 sendBeacon 确保在页面卸载前发送请求
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const url = `${apiUrl}/api/conversations/${currentConversation.conversation_id}/exit`;
        
        // 使用 fetch with keepalive 而不是 sendBeacon，因为我们需要 POST JSON
        const token = useAuthStore.getState().token;
        try {
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            keepalive: true,
          });
        } catch (error) {
          console.error('[ConversationExit] 页面卸载时保存笔记失败:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentConversation]);

  const loadUserConversations = async () => {
    if (!user) return;
    try {
      const convs = await conversationApi.getUserConversations(user.user_id);
      setConversations(convs);
    } catch (error) {
      console.error('加载对话失败:', error);
    }
  };

  const handleGuestLogin = async (profile?: any) => {
    try {
      const { user: newUser, access_token } = await userApi.createGuest(profile);
      setAuth(newUser, access_token);
    } catch (error) {
      console.error('创建游客失败:', error);
      toast.error('登录失败，请重试');
    }
  };

  const handleRegister = async (username: string, password: string, profile?: any) => {
    try {
      const { user: newUser, access_token } = await userApi.register(username, password, profile);
      setAuth(newUser, access_token);
      setShowAstrologyProfileModal(true); // Prompt new users to complete their profile
    } catch (error: any) {
      console.error('注册失败:', error);
      // 提取错误信息
      const errorMessage = error.response?.data?.detail || error.message || '注册失败，请重试';
      throw new Error(errorMessage);
    }
  };

  const handleLogin = async (username: string, password: string) => {
    try {
      const { user: loggedInUser, access_token } = await userApi.login(username, password);
      setAuth(loggedInUser, access_token);
    } catch (error: any) {
      console.error('登录失败:', error);
      // 提取错误信息
      const errorMessage = error.response?.data?.detail || error.message || '登录失败，请检查用户名和密码';
      throw new Error(errorMessage);
    }
  };

  const handleSelectSession = async (sessionType: SessionType) => {
    if (!user) return;

    // 防抖：防止重复创建会话
    if (isCreatingSessionRef.current) {
      console.log('[App] 会话正在创建中，忽略重复请求');
      return;
    }
    isCreatingSessionRef.current = true;
    setCreatingSessionType(sessionType);

    let newConv: Conversation;
    try {
      // 新开塔罗/占星，占卜师要先开口：这就算开始对话，先看额度，用完就不建会话
      if (OPENING_PHASE_SESSIONS.includes(sessionType) && !(await ensureQuota())) return;
      newConv = await conversationApi.create(user.user_id, sessionType);
      addConversation(newConv);
      setCurrentConversation(newConv);
    } catch (error: any) {
      console.error('创建对话失败:', error);
      toast.error(error?.response?.data?.detail || '创建对话失败，请重试');
      return;
    } finally {
      setCreatingSessionType(null);
      isCreatingSessionRef.current = false;
    }

    // 建会话是一次很快的写库；真正要等的是开场白那次 LLM 调用。这时用户已经在对话里了，
    // 于是这段等待和等一轮回复走同一条路：思考气泡 → 正文逐块出来。
    if (!OPENING_PHASE_SESSIONS.includes(sessionType)) return;
    await runTurn(
      newConv,
      (onChunk) => conversationApi.greeting(newConv.conversation_id, onChunk),
      '占卜师暂时联系不上，请重试'
    );
  };

  // 处理对话退出（保存笔记）
  const handleExitConversation = async (conversationId: string) => {
    try {
      console.log('[ConversationExit] 对话退出，尝试保存笔记:', conversationId);
      const result = await conversationApi.exit(conversationId);
      if (result.notebook_updated) {
        console.log('[ConversationExit] 笔记已保存');
      }
    } catch (error) {
      console.error('[ConversationExit] 保存笔记失败:', error);
    }
  };

  const handleNewConversation = async () => {
    // 如果有当前对话，先保存笔记
    if (currentConversation) {
      await handleExitConversation(currentConversation.conversation_id);
    }
    setCurrentConversation(null);
    previousConversationIdRef.current = null;
  };

  const handleSelectConversation = async (conversation: Conversation) => {
    try {
      // 如果有当前对话且不是同一个对话，先保存笔记
      if (currentConversation && currentConversation.conversation_id !== conversation.conversation_id) {
        await handleExitConversation(currentConversation.conversation_id);
      }

      // 这场会话还有一轮在跑：服务端可能已经落了这一轮的前半段（先说一句、再调工具接着跑），
      // 而这段话还在流式气泡里。用本地这份（这一轮开始时的样子），这一轮结束时 finishTurn
      // 统一换成服务端的——和一直停在这场会话里看到的一样。
      const fullConv =
        conversation.conversation_id in liveTurns
          ? conversation
          : await conversationApi.get(conversation.conversation_id);
      setCurrentConversation(fullConv);
      previousConversationIdRef.current = fullConv.conversation_id;
    } catch (error) {
      console.error('加载对话失败:', error);
      toast.error('加载对话失败，请重试');
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    const ok = await confirmDialog({
      title: '删除占卜',
      message: '确定要删除这个对话吗？此操作无法撤销。',
      confirmText: '删除',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await conversationApi.delete(conversationId);
      removeConversation(conversationId);
      if (currentConversation?.conversation_id === conversationId) setCurrentConversation(null);
      toast.success('已删除');
    } catch (error) {
      console.error('删除对话失败:', error);
      toast.error('删除失败，请重试');
    }
  };

  // TopBar 操作
  const handleCopyAllReadings = async () => {
    if (!currentConversation) return;
    const text = currentConversation.messages
      .filter((m) => m.role === MessageRole.ASSISTANT && m.content?.trim())
      .map((m) => m.content.trim())
      .join('\n\n— — —\n\n');
    if (!text) { toast.info('暂无可复制的解读'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制全部解读');
    } catch {
      toast.error('复制失败');
    }
  };

  const handleScrollToLatest = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const turnApi = (sessionType: SessionType) => (sessionType === 'astrology' ? astrologyApi : tarotApi);

  /** 今日额度用完的提示：游客可以当场注册（转正，保留对话），注册用户只能等明天 */
  const showQuotaPrompt = async () => {
    if (!user) return;
    const notice = quotaNotice(user.user_type);
    if (user.user_type === UserType.GUEST) {
      if (await confirmDialog({ ...notice, confirmText: '注册账号', cancelText: '明天再来' })) {
        setShowConvertModal(true);
      }
    } else {
      await confirmDialog({ ...notice, confirmText: '知道了', hideCancel: true });
    }
  };

  /**
   * 新开塔罗/占星、从日签接着聊之前先查额度，用完就提示、不进对话。
   * 发消息不预先查：直接发，后端拦下（429）再提示，见 runTurn。
   */
  const ensureQuota = async (): Promise<boolean> => {
    if (!user) return false;
    let quota: { used: number; limit: number };
    try {
      quota = await userApi.getQuota(user.user_id);
    } catch (error) {
      console.error('查询额度失败:', error);
      toast.error('网络异常，请重试');
      return false;
    }
    if (quota.used < quota.limit) return true;
    showQuotaPrompt();
    return false;
  };

  /**
   * 在某场会话里跑一轮：流式正文记在这场会话名下，结束后刷新这场会话。
   * 刷新只在它仍是当前会话时替换当前视图——用户中途切走不会被拽回来。
   * sent = 这一轮开始前先显示出去的那句用户发言（只有发消息有）。
   * 返回 false = 今日额度用完、后端没收这一轮：什么都没落库，库里还是这一轮之前的样子，
   * 所以不再拉会话，只在本地撤下 sent，其余消息原样不动。
   */
  const runTurn = async (
    conv: Conversation,
    start: (onChunk: (chunk: string) => void) => Promise<void>,
    failMessage: string,
    sent?: Message
  ): Promise<boolean> => {
    const id = conv.conversation_id;
    startTurn(id);
    try {
      await start((chunk) => appendTurn(id, chunk));
    } catch (error: any) {
      console.error(failMessage, error);
      if (error?.status === 429) {
        rejectTurn(id, sent);
        showQuotaPrompt();
        return false;
      }
      toast.error(error?.message || failMessage);
    }
    let refreshed: Conversation | null = null;
    try {
      refreshed = await conversationApi.get(id);
    } catch (error) {
      console.error('刷新对话失败:', error);
    }
    finishTurn(id, refreshed);
    return true;
  };

  const handleAstrologyProfileSubmit = async (profile: UserProfile) => {
    if (!user) return;
    try {
      await userApi.updateProfile(user.user_id, profile);
      setUser(await userApi.getUser(user.user_id));
    } catch (error: any) {
      console.error('更新资料失败:', error);
      throw new Error(error.response?.data?.detail || error.message || '更新资料失败，请重试');
    }
    setShowAstrologyProfileModal(false);

    // 当前会话正等着这份资料（末尾是一次 request_user_profile 调用）才接着跑：后端把用户
    // 现在填的资料记成那次调用的结果，模型自己去调 get_astrology_chart。从设置/注册打开的
    // 资料表单，或者当前会话没在等资料，只保存资料。
    const conv = useConversationStore.getState().currentConversation;
    if (!conv || pendingInterrupt(conv)?.name !== 'request_user_profile') return;
    await runTurn(conv, (onChunk) => turnApi(conv.session_type).resume(conv.conversation_id, onChunk), '解读失败，请重试');
  };

  const handleAstrologyProfileSkip = () => {
    // 跳过：关弹窗，按钮还在（模型仍在等）；用户直接发消息时后端会把「没填」记成结果
    setShowAstrologyProfileModal(false);
  };

  /** 返回 false = 今日额度用完、这句没发出去：没落库，从对话里撤下，交回输入框 */
  const handleSendMessage = async (content: string): Promise<boolean | void> => {
    const conv = currentConversation;
    if (!conv || conv.conversation_id in liveTurns) return;

    // 立即将用户消息添加到对话中（无需等待API响应）
    const sent: Message = {
      role: 'user' as MessageRole,
      content,
      timestamp: new Date().toISOString(),
    };
    addMessageToCurrentConversation(sent);
    return runTurn(conv, (onChunk) => turnApi(conv.session_type).sendMessage(conv.conversation_id, content, onChunk), '发送失败，请重试', sent);
  };

  const handleReadyToDraw = () => setShowCardDrawer(true);

  const handleReadyToFillProfile = () => setShowAstrologyProfileModal(true);

  const handleCardsDrawn = async () => {
    // 抽牌器是全屏弹层，走到这里当前会话就是发起抽牌的那一场
    const conv = useConversationStore.getState().currentConversation;
    const call = conv ? pendingInterrupt(conv) : undefined;
    if (!conv || call?.name !== 'draw_tarot_cards') return;
    const api = turnApi(conv.session_type);
    const request = call.args as unknown as DrawCardsRequest;

    // 抽牌窗口就此退场，揭牌幕接着亮起来：牌背先按牌阵落位，等后端把真牌发回来再逐张翻开
    setReveal({ positions: request.positions ?? [], cards: null });

    await runTurn(conv, async (onChunk) => {
      // 真牌由后端生成，作为那次 draw_tarot_cards 调用的结果落库
      let drawn: TarotCard[];
      try {
        drawn = await api.drawCards(conv.conversation_id, request);
      } catch {
        setReveal(null);
        throw new Error('抽牌失败，请重试');
      }
      // 用户中途切走了就别把牌盖在别的会话上
      const stillHere = useConversationStore.getState().currentConversation?.conversation_id === conv.conversation_id;
      setReveal((prev) => (prev && stillHere ? { ...prev, cards: drawn } : null));

      // 牌一到就请模型开口，翻牌那几秒解读已经在跑了，不必等它翻完。
      // 对话里的牌面挂在 tool 记录上，得刷一次会话才有——让它和解读并排跑，别挡在前面。
      // (这一轮结束时 runTurn 还会再刷一次；那次落地之后这条就不该再覆盖回去了)
      conversationApi
        .get(conv.conversation_id)
        .then((refreshed) => {
          if (useConversationStore.getState().liveTurns[conv.conversation_id] !== undefined) {
            updateConversation(refreshed);
          }
        })
        .catch((error) => console.error('刷新对话失败:', error));

      await api.resume(conv.conversation_id, onChunk);
    }, '解读失败，请重试');
  };

  // 「继续这段对话」:关弹窗,把 daily 对话设为当前会话(后续消息走 tarot 链路)
  // continuing = 今天的签接着聊：和新开对话一样先看额度，用完就提示、不进对话。回看往日对话不查
  const handleContinueDailyConversation = async (conversationId: string, continuing: boolean) => {
    if (continuing && !(await ensureQuota())) return;
    setShowDailyModal(false);
    try {
      const conv = await conversationApi.get(conversationId);
      await loadUserConversations(); // 让新建的日运对话出现在最近的占卜里
      setCurrentConversation(conv);
    } catch (error) {
      console.error('[Daily] 打开日运对话失败:', error);
      toast.error('打开对话失败');
    }
  };

  const handleLogout = async () => {
    if (!user) return;

    // 退出前保存当前对话的笔记
    if (currentConversation) {
      await handleExitConversation(currentConversation.conversation_id);
    }

    // 游客用户特殊处理
    if (user.user_type === 'guest') {
      const proceed = await confirmDialog({
        title: '退出登录',
        message: '您是游客用户，退出后将无法找回对话历史。是否继续？\n（也可以转换为注册用户以保留数据）',
        confirmText: '继续退出',
        cancelText: '返回',
        tone: 'danger',
      });
      if (!proceed) return;

      // 是否永久删除数据
      const deleteData = await confirmDialog({
        title: '处理游客数据',
        message: '是否永久删除所有对话记录和个人信息？\n选择「保留并转换」可转为注册用户保留数据。',
        confirmText: '永久删除',
        cancelText: '保留并转换',
        tone: 'danger',
      });

      if (deleteData) {
        // 删除用户及其对话
        try {
          await userApi.deleteUser(user.user_id);
          toast.success('数据已删除');
        } catch (error) {
          console.error('删除数据失败:', error);
        }
      } else {
        // 引导转换为注册用户
        setShowConvertModal(true);
        return;
      }
    } else {
      // 注册用户正常退出
      const ok = await confirmDialog({
        title: '退出登录',
        message: '确定要退出登录吗？',
        confirmText: '退出',
        tone: 'danger',
      });
      if (!ok) return;
    }

    // 清空前端状态
    logout();
    setConversations([]);
    setCurrentConversation(null);
  };

  const handleConvertToRegistered = async (username: string, password: string) => {
    if (!user) return;

    try {
      const { user: updatedUser, access_token } = await userApi.convertGuestToRegistered(user.user_id, username, password);
      setAuth(updatedUser, access_token);
      setShowConvertModal(false);
      toast.success('转换成功！现在您可以随时登录查看历史记录了');
    } catch (error: any) {
      console.error('转换失败:', error);
      toast.error(error.response?.data?.detail || '转换失败，请重试');
    }
  };

  // 当前会话的一切界面状态都从它自己的数据推出来，切换会话不会串台
  const liveText = currentConversation ? liveTurns[currentConversation.conversation_id] : undefined;
  const isTurnRunning = liveText !== undefined;
  const pendingCall = currentConversation && !isTurnRunning ? pendingInterrupt(currentConversation) : undefined;
  const pendingDrawRequest =
    pendingCall?.name === 'draw_tarot_cards' ? (pendingCall.args as unknown as DrawCardsRequest) : null;
  const needsProfile = pendingCall?.name === 'request_user_profile';

  // 可见行：tool 记录和只有调用、没正文的 assistant 记录不渲染；抽牌的牌面跟着抽牌之后
  // 第一条有正文的回复显示（每日一签的解读自己带牌，直接渲染）。还没等到回复的牌
  // （抽完牌、模型还没开口或正在解读）交给流式气泡。
  type Row = { message: Message; idx: number; cards?: Message };
  const visibleRows: Row[] = [];
  let unansweredCards: Message | undefined;
  (currentConversation?.messages ?? []).forEach((message, idx) => {
    if (message.role === 'tool') {
      if (message.tarot_cards?.length) unansweredCards = message;
      return;
    }
    if (message.role === 'system') return;
    if (message.role === 'assistant' && !message.content.trim() && !message.tarot_cards?.length) return;
    const cards = message.role === 'assistant' && !message.tarot_cards?.length ? unansweredCards : undefined;
    if (cards) unansweredCards = undefined;
    visibleRows.push({ message, idx, cards });
  });
  const lastVisibleMessage = visibleRows[visibleRows.length - 1]?.message;
  // 按钮挂在最后一条可见的 AI 回复上；模型没开口就发起了调用（最后一条可见的是用户发言）时单独画一个
  const buttonOnLastRow = lastVisibleMessage?.role === MessageRole.ASSISTANT;
  // 旧版本对话：抽牌结果套在 system 里、没有记录调用，后端拒绝继续，这里只给看
  const isLegacyConversation = Boolean(
    currentConversation?.messages.some((m) => m.role === 'system' || (m.role === 'tool' && !m.tool_call_id))
  );

  // 最近的占卜轨迹：殿堂与对话页共用一份数据和动作
  const arcProps = {
    conversations,
    currentId: currentConversation?.conversation_id,
    onOpen: handleSelectConversation,
    onDelete: handleDeleteConversation,
  };

  return (
    <div className="w-full h-full flex flex-col relative">
      {/* 星象虚空背景（星场 / 星云 / 星轨） */}
      <MysticBackground />

      <TopBar
        conversation={currentConversation}
        user={user}
        onHome={handleNewConversation}
        onCopyAll={handleCopyAllReadings}
        onScrollToLatest={handleScrollToLatest}
        onDelete={() => currentConversation && handleDeleteConversation(currentConversation.conversation_id)}
        onConvertAccount={() => setShowConvertModal(true)}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main className="flex-1 min-h-0 flex flex-col relative z-20">
        <AnimatePresence mode="wait">
        {!currentConversation ? (
          <motion.div
            key="hub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 overflow-y-auto relative"
          >
            {/* 标题 → 三扇拱窗 → 一排次级入口，1440×820 里一屏放下；多出来的高度分给各段之间 */}
            <div className="min-h-full flex flex-col items-center px-5 sm:px-6 pb-3">
            <div className="flex-[1] min-h-0 max-h-12" />
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
              className="text-center relative z-10"
            >
              {/* 仪式性饰纹 */}
              <motion.div
                initial={{ opacity: 0, letterSpacing: '0.1em' }}
                animate={{ opacity: 0.7, letterSpacing: '0.9em' }}
                transition={{ delay: 0.3, duration: 1.2 }}
                className="text-mystic-gold text-xs mb-4"
                style={{ letterSpacing: '0.9em' }}
              >
                ✦&nbsp;&nbsp;✦&nbsp;&nbsp;✦
              </motion.div>

              {/* 手机上收一档，标题不会断成「圣 / 殿」 */}
              <h1 className="text-[2.35rem] sm:text-5xl md:text-6xl font-display font-bold mystic-text mystic-text--shimmer tracking-[0.04em] leading-tight">
                小&thinsp;x&thinsp;的秘密圣殿
              </h1>

              <p className="mt-4 eyebrow" style={{ letterSpacing: '0.42em' }}>
                anyway the wind blows
              </p>
            </motion.div>
            <div className="flex-[1] min-h-10 max-h-16" />

            {/* 拱窗那一行：宽屏（≥1400）时左侧页边放最近的占卜轨迹 */}
            <div className="w-full grid grid-cols-[1fr_minmax(0,900px)_1fr] items-center">
              <div className="hidden min-[1400px]:block relative self-stretch">
                {/* 轨迹比拱窗那一行高，绝对定位不挤下面的入口；离拱窗留 56px，比这一行的中线高 40px，左边不出屏。
                    定位放在外层，framer-motion 会接管内层的 transform */}
                <div
                  className="absolute top-1/2"
                  style={{ left: `max(6px, calc(100% - ${ARC_WIDTH + 56}px))`, transform: 'translateY(calc(-50% - 40px))' }}
                >
                  <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8, duration: 0.8 }}>
                    <RecentArc {...arcProps} height={460} />
                  </motion.div>
                </div>
              </div>
              <div className="col-start-2 flex justify-center">
                <SessionButtons
                  onSelectSession={handleSelectSession}
                  disabled={creatingSessionType !== null}
                  pendingType={creatingSessionType}
                />
              </div>
            </div>

            <div className="flex-[2] min-h-5" />
            <HubStrip
              overview={dailyOverview}
              isGuest={user?.user_type === UserType.GUEST}
              onOpenDaily={() => setShowDailyModal(true)}
              onOpenJourney={() => setShowJourney(true)}
            />
            </div>
            <RecentArcEdge {...arcProps} className="min-[1400px]:hidden" />
          </motion.div>
        ) : (
          <motion.div
            key="conv"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div ref={setConvPane} className="flex-1 min-h-0 relative">
            {/* Messages */}
            <div className="absolute inset-0 overflow-y-auto px-4 sm:px-6 py-6">
              <div className="max-w-[720px] mx-auto space-y-6">
                {visibleRows.map(({ message, idx, cards }) => {
                  const isLast = buttonOnLastRow && message === lastVisibleMessage;
                  return (
                    <ChatMessage
                      key={idx}
                      message={message}
                      drawnCards={cards?.tarot_cards}
                      drawnRequest={cards?.draw_request}
                      sessionType={currentConversation.session_type}
                      showDrawButton={isLast && pendingDrawRequest !== null}
                      drawPositions={pendingDrawRequest?.positions}
                      onReadyToDraw={handleReadyToDraw}
                      showProfileButton={isLast && needsProfile}
                      onReadyToFillProfile={handleReadyToFillProfile}
                    />
                  );
                })}

                {!buttonOnLastRow && (pendingDrawRequest !== null || needsProfile) && (
                  <ChatMessage
                    key="pending-call-prompt"
                    message={{ role: MessageRole.ASSISTANT, content: '', timestamp: new Date().toISOString() }}
                    sessionType={currentConversation.session_type}
                    showDrawButton={pendingDrawRequest !== null}
                    drawPositions={pendingDrawRequest?.positions}
                    onReadyToDraw={handleReadyToDraw}
                    showProfileButton={needsProfile}
                    onReadyToFillProfile={handleReadyToFillProfile}
                  />
                )}

                {(liveText || unansweredCards) && (
                  <ChatMessage
                    message={{ role: MessageRole.ASSISTANT, content: liveText ?? '', timestamp: new Date().toISOString() }}
                    drawnCards={unansweredCards?.tarot_cards}
                    drawnRequest={unansweredCards?.draw_request}
                    sessionType={currentConversation.session_type}
                    isStreaming
                  />
                )}

                {isTurnRunning && !liveText && (
                  <ChatMessage
                    message={{ role: MessageRole.ASSISTANT, content: '', timestamp: new Date().toISOString() }}
                    isThinking={true}
                    sessionType={currentConversation.session_type}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 阅读列左边的页边（≥1280）放最近的占卜轨迹，当前这场停在选中线上；更窄时收成左缘一道小弧 */}
            <div
              className="hidden min-[1280px]:block absolute top-1/2 -translate-y-1/2"
              style={{ left: `max(12px, calc(50% - 360px - 56px - ${ARC_WIDTH}px))` }}
            >
              <RecentArc {...arcProps} height={convArcHeight} />
            </div>
            <RecentArcEdge {...arcProps} className="min-[1280px]:hidden" />
            </div>

            {/* Composer */}
            <div
              className="px-4 sm:px-6 pt-4 border-t border-mystic-gold/[0.12] bg-gradient-to-b from-dark-bg/30 to-dark-bg/70 backdrop-blur-xl"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <div className="max-w-[720px] mx-auto space-y-3">
                {!isLegacyConversation && (
                  <QuickReplies
                    conversationType={currentConversation.session_type}
                    onReplyClick={handleSendMessage}
                  />
                )}
                <Composer
                  onSend={handleSendMessage}
                  disabled={isTurnRunning || isLegacyConversation}
                  placeholder={
                    isLegacyConversation
                      ? '这是旧版本的对话，只能查看；想继续聊请开一场新的'
                      : currentConversation.has_drawn_cards
                        ? '继续深入探讨，或提出新的疑问…'
                        : '输入你的问题，开启心灵对话…'
                  }
                />
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <div className="relative z-50">
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onGuestLogin={handleGuestLogin}
          onRegister={handleRegister}
          onLogin={handleLogin}
        />

        {/* 常驻挂载以保留退场动画；牌阵取自当前会话末尾那次抽牌调用，没有就关着 */}
        <TarotCardDrawer
          isOpen={showCardDrawer && pendingDrawRequest !== null}
          drawRequest={pendingDrawRequest!}
          onClose={() => setShowCardDrawer(false)}
          onCardsDrawn={handleCardsDrawn}
        />

        {/* 揭牌：抽牌窗口之后的一幕，半透明压在对话上逐张翻牌，翻完自己退场 */}
        {reveal && (
          <CardRevealOverlay
            cards={reveal.cards}
            positions={reveal.positions}
            onDone={() => setReveal(null)}
          />
        )}

        {user && (
          <DailyOracleModal
            isOpen={showDailyModal}
            userId={user.user_id}
            overview={dailyOverview}
            onClose={() => setShowDailyModal(false)}
            onRefreshOverview={refreshDailyOverview}
            onContinueConversation={handleContinueDailyConversation}
            onOpenJourney={() => {
              setShowDailyModal(false);
              setShowJourney(true);
            }}
          />
        )}

        {user && (
          <JourneyChronicle
            isOpen={showJourney}
            userId={user.user_id}
            todayDate={dailyOverview?.today_effective_date ?? getEffectiveDate()}
            onClose={() => {
              setShowJourney(false);
              refreshDailyOverview();
            }}
          />
        )}

        <AstrologyProfileModal
          isOpen={showAstrologyProfileModal}
          currentProfile={user?.profile}
          onClose={() => setShowAstrologyProfileModal(false)}
          onSubmit={handleAstrologyProfileSubmit}
          onSkip={handleAstrologyProfileSkip}
        />

        {/* Convert to Registered Modal */}
        <ConvertToRegisteredModal
          isOpen={showConvertModal}
          onClose={() => setShowConvertModal(false)}
          onConvert={handleConvertToRegistered}
          currentProfile={user?.profile}
        />
      </div>

      {/* 全局轻提示 & 确认框（替代原生 alert/confirm） */}
      <Toaster />
      <ConfirmDialog />
    </div>
  );
};

export default App;




