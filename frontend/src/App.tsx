import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ChatMessage from './components/ChatMessage';
import Composer from './components/Composer';
import QuickReplies from './components/QuickReplies';
import SessionButtons from './components/SessionButtons';
import GalleryBanner from './components/GalleryBanner';
import DailyOracleBanner from './components/daily/DailyOracleBanner';
import DailyOracleModal from './components/daily/DailyOracleModal';
import WalletChip from './components/wallet/WalletChip';
import { useDeckWallet } from './stores/useDeckWallet';
import TarotCardDrawer from './components/TarotCardDrawer';
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
import { MessageRole } from './types';
import type { Conversation, SessionType, DrawCardsRequest, Message, ToolCallRecord, UserProfile, DailyOverview } from './types';

/** 会话末尾是一次还在等用户动手的调用（抽牌 / 补资料）→ 返回它。和后端 tool_turns.pending_interrupt 同一个判据。 */
const INTERRUPT_TOOLS = new Set(['draw_tarot_cards', 'request_user_profile']);
function pendingInterrupt(conv: Conversation): ToolCallRecord | undefined {
  const tail = conv.messages[conv.messages.length - 1];
  const call = tail?.role === 'assistant' ? tail.tool_calls?.[0] : undefined;
  return call && INTERRUPT_TOOLS.has(call.name) ? call : undefined;
}

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
  } = useConversationStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showCardDrawer, setShowCardDrawer] = useState(false);
  const [showAstrologyProfileModal, setShowAstrologyProfileModal] = useState(false);
  const isCreatingSessionRef = useRef(false); // 防止重复创建会话
  const [creatingSessionType, setCreatingSessionType] = useState<SessionType | null>(null);
  const previousConversationIdRef = useRef<string | null>(null); // 追踪上一次的对话ID，用于退出时保存笔记
  // 侧边栏：桌面常驻、移动端抽屉；初始按视口决定
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const closeSidebarOnMobile = () => { if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false); };

  // 每日一签:概览(横幅+弹窗共用)
  const [dailyOverview, setDailyOverview] = useState<DailyOverview | null>(null);
  const [showDailyModal, setShowDailyModal] = useState(false);

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
    closeSidebarOnMobile();

    // 防抖：防止重复创建会话
    if (isCreatingSessionRef.current) {
      console.log('[App] 会话正在创建中，忽略重复请求');
      return;
    }
    isCreatingSessionRef.current = true;
    setCreatingSessionType(sessionType);

    try {
      // 塔罗/占星的开场白由后端在建会话时生成，随响应一起回来（会阻塞几秒）——
      // 前端不需要再发一条消息去把占卜师叫醒。
      const newConv = await conversationApi.create(user.user_id, sessionType);
      addConversation(newConv);
      setCurrentConversation(newConv);
    } catch (error: any) {
      console.error('创建对话失败:', error);
      toast.error(error?.response?.data?.detail || '创建对话失败，请重试');
    } finally {
      setCreatingSessionType(null);
      isCreatingSessionRef.current = false;
    }
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
    closeSidebarOnMobile();
    // 如果有当前对话，先保存笔记
    if (currentConversation) {
      await handleExitConversation(currentConversation.conversation_id);
    }
    setCurrentConversation(null);
    previousConversationIdRef.current = null;
  };

  const handleSelectConversation = async (conversation: any) => {
    closeSidebarOnMobile();
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

  /**
   * 在某场会话里跑一轮：流式正文记在这场会话名下，结束后刷新这场会话。
   * 刷新只在它仍是当前会话时替换当前视图——用户中途切走不会被拽回来。
   */
  const runTurn = async (
    conv: Conversation,
    start: (onChunk: (chunk: string) => void) => Promise<void>,
    failMessage: string
  ) => {
    const id = conv.conversation_id;
    startTurn(id);
    try {
      await start((chunk) => appendTurn(id, chunk));
    } catch (error: any) {
      console.error(failMessage, error);
      toast.error(error?.message || failMessage);
    }
    let refreshed: Conversation | null = null;
    try {
      refreshed = await conversationApi.get(id);
    } catch (error) {
      console.error('刷新对话失败:', error);
    }
    finishTurn(id, refreshed);
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

  const handleSendMessage = async (content: string) => {
    const conv = currentConversation;
    if (!conv || conv.conversation_id in liveTurns) return;

    // 立即将用户消息添加到对话中（无需等待API响应）
    addMessageToCurrentConversation({
      role: 'user' as MessageRole,
      content,
      timestamp: new Date().toISOString(),
    });
    await runTurn(conv, (onChunk) => turnApi(conv.session_type).sendMessage(conv.conversation_id, content, onChunk), '发送失败，请重试');
  };

  const handleReadyToDraw = () => setShowCardDrawer(true);

  const handleReadyToFillProfile = () => setShowAstrologyProfileModal(true);

  const handleCardsDrawn = async () => {
    // 抽牌器是全屏弹层，走到这里当前会话就是发起抽牌的那一场
    const conv = useConversationStore.getState().currentConversation;
    const call = conv ? pendingInterrupt(conv) : undefined;
    if (!conv || call?.name !== 'draw_tarot_cards') return;
    const api = turnApi(conv.session_type);

    await runTurn(conv, async (onChunk) => {
      // 真牌由后端生成，作为那次 draw_tarot_cards 调用的结果落库；先刷新让牌面出来，再请模型解读
      try {
        await api.drawCards(conv.conversation_id, call.args as unknown as DrawCardsRequest);
      } catch {
        throw new Error('抽牌失败，请重试');
      }
      updateConversation(await conversationApi.get(conv.conversation_id));
      await api.resume(conv.conversation_id, onChunk);
    }, '解读失败，请重试');
  };

  // 「继续这段对话」:关弹窗,把 daily 对话设为当前会话(后续消息走 tarot 链路)
  const handleContinueDailyConversation = async (conversationId: string) => {
    setShowDailyModal(false);
    try {
      const conv = await conversationApi.get(conversationId);
      await loadUserConversations(); // 让新建的日运对话出现在侧边栏
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
        setShowSettings(false);
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
    setShowSettings(false);
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

  return (
    <div className="w-full h-full flex relative">
      {/* 星象虚空背景（星场 / 星云 / 星轨） */}
      <MysticBackground />

      {/* Sidebar — 桌面常驻可折叠 / 移动端覆盖抽屉 */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 h-full flex-shrink-0 transition-[transform,width] duration-300 ease-out lg:overflow-hidden ${
          sidebarOpen ? 'translate-x-0 w-72 lg:w-72' : '-translate-x-full w-72 lg:translate-x-0 lg:w-0'
        }`}
      >
        <Sidebar
          conversations={conversations}
          currentConversationId={currentConversation?.conversation_id}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenSettings={() => setShowSettings(true)}
          onClose={() => setSidebarOpen(false)}
          isHome={!currentConversation}
        />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative z-20 min-w-0">
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
            <button
              onClick={() => setSidebarOpen(true)}
              className={`absolute top-4 left-4 z-10 p-2 rounded-lg hover:bg-white/[0.05] transition-colors ${sidebarOpen ? 'lg:hidden' : ''}`}
              style={{ color: 'var(--ivory-dim)' }}
              aria-label="打开侧边栏"
            >
              <Menu size={20} />
            </button>
            <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
              {user && (
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 font-display text-sm tracking-[0.08em]"
                  style={{ color: 'var(--ivory-dim)' }}
                  title="当前用户"
                >
                  <span style={{ color: 'var(--gold)', fontSize: '11px' }}>❖</span>
                  {user.profile?.nickname || user.username || '访客'}
                </span>
              )}
              <WalletChip />
            </div>
            <div className="min-h-full flex flex-col items-center justify-center px-6 py-14">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
              className="text-center mb-14 relative z-10"
            >
              {/* 仪式性饰纹 */}
              <motion.div
                initial={{ opacity: 0, letterSpacing: '0.1em' }}
                animate={{ opacity: 0.7, letterSpacing: '0.9em' }}
                transition={{ delay: 0.3, duration: 1.2 }}
                className="text-mystic-gold text-xs mb-6"
                style={{ letterSpacing: '0.9em' }}
              >
                ✦&nbsp;&nbsp;✦&nbsp;&nbsp;✦
              </motion.div>

              <h1 className="text-5xl md:text-6xl font-display font-bold mystic-text mystic-text--shimmer tracking-[0.04em] leading-tight">
                小&thinsp;x&thinsp;的秘密圣殿
              </h1>

              <p className="mt-6 eyebrow" style={{ letterSpacing: '0.42em' }}>
                anyway the wind blows
              </p>

              {/* 分割饰线 */}
              <motion.div
                className="flex items-center justify-center gap-4 mt-9"
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ delay: 0.55, duration: 0.9 }}
              >
                <div className="h-px w-16 bg-gradient-to-r from-transparent to-mystic-gold/60" />
                <span className="text-mystic-gold/80 text-sm">✦</span>
                <div className="h-px w-16 bg-gradient-to-l from-transparent to-mystic-gold/60" />
              </motion.div>
            </motion.div>

            <SessionButtons
              onSelectSession={handleSelectSession}
              disabled={creatingSessionType !== null}
              pendingType={creatingSessionType}
            />

            <div className="w-full max-w-2xl mt-12 space-y-6">
              <GalleryBanner />
              <DailyOracleBanner overview={dailyOverview} onOpen={() => setShowDailyModal(true)} />
            </div>
            </div>
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
            <TopBar
              conversation={currentConversation}
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
              onCopyAll={handleCopyAllReadings}
              onScrollToLatest={handleScrollToLatest}
              onDelete={() => handleDeleteConversation(currentConversation.conversation_id)}
            />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
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

            {/* Composer */}
            <div
              className="px-4 sm:px-6 pt-4 border-t border-mystic-gold/12 bg-gradient-to-b from-dark-bg/30 to-dark-bg/70 backdrop-blur-xl"
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
      </div>

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

        {user && (
          <DailyOracleModal
            isOpen={showDailyModal}
            userId={user.user_id}
            overview={dailyOverview}
            onClose={() => setShowDailyModal(false)}
            onRefreshOverview={refreshDailyOverview}
            onContinueConversation={handleContinueDailyConversation}
          />
        )}

        <AstrologyProfileModal
          isOpen={showAstrologyProfileModal}
          currentProfile={user?.profile}
          onClose={() => setShowAstrologyProfileModal(false)}
          onSubmit={handleAstrologyProfileSubmit}
          onSkip={handleAstrologyProfileSkip}
        />

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-7 bg-dark-surface border border-mystic-gold/20 shadow-cosmic"
            >
              <div className="eyebrow mb-2">Settings</div>
              <h2 className="text-2xl font-display font-semibold mb-6 mystic-text">设置</h2>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-mystic-gold/10">
                  <div className="eyebrow mb-2" style={{ fontSize: '10px', letterSpacing: '0.24em' }}>当前用户</div>
                  <div className="font-medium text-ivory" style={{ color: 'var(--ivory)' }}>
                    {user?.username || user?.profile?.nickname || '游客'}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--ivory-faint)' }}>
                    {user?.user_type === 'guest' ? '游客模式' : '注册用户'}
                  </div>
                </div>

                {/* 游客用户显示转换按钮 */}
                {user?.user_type === 'guest' && (
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setShowConvertModal(true);
                    }}
                    className="w-full px-6 py-3 rounded-xl border border-mystic-gold/40 text-mystic-gold hover:bg-mystic-gold/10 transition-colors tracking-wide"
                  >
                    转为注册用户
                  </button>
                )}

                <button
                  onClick={handleLogout}
                  className="w-full px-6 py-3 rounded-xl border border-red-400/30 text-red-300/90 hover:bg-red-500/15 transition-colors tracking-wide"
                >
                  退出登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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




