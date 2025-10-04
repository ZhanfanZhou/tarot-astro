import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import SessionButtons from './components/SessionButtons';
import TarotCardDrawer from './components/TarotCardDrawer';
import AuthModal from './components/AuthModal';
import { useAuthStore } from './stores/useAuthStore';
import { useConversationStore } from './stores/useConversationStore';
import { userApi, conversationApi, tarotApi } from './services/api';
import type { SessionType, DrawCardsRequest, Message, MessageRole } from './types';

const App: React.FC = () => {
  const { user, setUser, logout } = useAuthStore();
  const {
    conversations,
    currentConversation,
    setConversations,
    setCurrentConversation,
    addConversation,
    updateConversation,
    removeConversation,
  } = useConversationStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [showCardDrawer, setShowCardDrawer] = useState(false);
  const [pendingDrawRequest, setPendingDrawRequest] = useState<DrawCardsRequest | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 检查用户登录状态
  useEffect(() => {
    if (!user) {
      setShowAuthModal(true);
    } else {
      loadUserConversations();
    }
  }, [user]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages, streamingMessage]);

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
      const newUser = await userApi.createGuest(profile);
      setUser(newUser);
    } catch (error) {
      console.error('创建游客失败:', error);
      alert('登录失败，请重试');
    }
  };

  const handleRegister = async (username: string, password: string, profile?: any) => {
    try {
      const newUser = await userApi.register(username, password, profile);
      setUser(newUser);
    } catch (error) {
      console.error('注册失败:', error);
      alert('注册失败，请重试');
    }
  };

  const handleLogin = async (username: string, password: string) => {
    try {
      const loggedInUser = await userApi.login(username, password);
      setUser(loggedInUser);
    } catch (error) {
      console.error('登录失败:', error);
      alert('登录失败，请检查用户名和密码');
    }
  };

  const handleSelectSession = async (sessionType: SessionType) => {
    if (!user) return;

    try {
      const newConv = await conversationApi.create(user.user_id, sessionType);
      addConversation(newConv);
      setCurrentConversation(newConv);

      // 自动发送初始消息（使用随机开场白）
      if (sessionType === 'tarot') {
        const greetings = [
          '你好，我想进行一次塔罗占卜',
          '晚上好，能帮我看看塔罗牌吗？',
          '我想请教一些问题，可以帮我占卜一下吗？',
          '最近有些迷茫，希望塔罗牌能给我一些指引',
          '你好呀，想通过塔罗牌了解一下自己的运势'
        ];
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
        handleSendMessage(randomGreeting);
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      alert('创建对话失败，请重试');
    }
  };

  const handleNewConversation = () => {
    setCurrentConversation(null);
  };

  const handleSelectConversation = async (conversation: any) => {
    try {
      const fullConv = await conversationApi.get(conversation.conversation_id);
      setCurrentConversation(fullConv);
    } catch (error) {
      console.error('加载对话失败:', error);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!confirm('确定要删除这个对话吗？')) return;

    try {
      await conversationApi.delete(conversationId);
      removeConversation(conversationId);
    } catch (error) {
      console.error('删除对话失败:', error);
      alert('删除失败，请重试');
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!currentConversation || isLoading) return;

    setIsLoading(true);
    setStreamingMessage('');

    try {
      // 立即显示用户消息
      const updatedConv = await conversationApi.get(currentConversation.conversation_id);
      updateConversation(updatedConv);

      await tarotApi.sendMessage(
        currentConversation.conversation_id,
        content,
        (chunk) => {
          setStreamingMessage((prev) => prev + chunk);
        },
        (drawRequest) => {
          setPendingDrawRequest(drawRequest);
          setShowCardDrawer(true);
        }
      );

      // 刷新对话
      const finalConv = await conversationApi.get(currentConversation.conversation_id);
      updateConversation(finalConv);
      setCurrentConversation(finalConv);
      setStreamingMessage('');
    } catch (error) {
      console.error('发送消息失败:', error);
      alert('发送失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCardsDrawn = async (cards: any) => {
    if (!currentConversation || !pendingDrawRequest) return;

    try {
      await tarotApi.drawCards(currentConversation.conversation_id, pendingDrawRequest);
      
      // 刷新对话（包含抽牌结果）
      const updatedConv = await conversationApi.get(currentConversation.conversation_id);
      updateConversation(updatedConv);
      setCurrentConversation(updatedConv);
      
      setPendingDrawRequest(null);
      
      // 自动触发AI解读（不显示用户消息，直接调用AI）
      setIsLoading(true);
      setStreamingMessage('');
      
      setTimeout(async () => {
        try {
          await tarotApi.sendMessage(
            currentConversation.conversation_id,
            '请根据抽牌结果进行解读',
            (chunk) => {
              setStreamingMessage((prev) => prev + chunk);
            },
            (drawRequest) => {
              // 不应该再次触发抽牌，但保留处理以防万一
              console.warn('警告：解读时不应该再次触发抽牌');
            }
          );

          // 刷新对话
          const finalConv = await conversationApi.get(currentConversation.conversation_id);
          updateConversation(finalConv);
          setCurrentConversation(finalConv);
          setStreamingMessage('');
        } catch (error) {
          console.error('AI解读失败:', error);
          alert('解读失败，请重试');
        } finally {
          setIsLoading(false);
        }
      }, 500);
    } catch (error) {
      console.error('抽牌失败:', error);
      alert('抽牌失败，请重试');
    }
  };

  const handleLogout = () => {
    if (confirm('确定要退出登录吗？')) {
      logout();
      setConversations([]);
      setCurrentConversation(null);
      setShowSettings(false);
    }
  };

  return (
    <div className="w-full h-full flex">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversation?.conversation_id}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {!currentConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                欢迎来到塔罗占卜
              </h1>
              <p className="text-gray-400 text-lg">
                选择一种方式，开始你的心灵之旅
              </p>
            </motion.div>

            <SessionButtons
              onSelectSession={handleSelectSession}
              disabled={isLoading}
            />
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {currentConversation.messages.map((message, idx) => (
                message.role !== 'system' && (
                  <ChatMessage key={idx} message={message} />
                )
              ))}
              
              {streamingMessage && (
                <ChatMessage
                  message={{
                    role: 'assistant' as MessageRole,
                    content: streamingMessage,
                    timestamp: new Date().toISOString(),
                  }}
                />
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-6 border-t border-dark-border">
              <div className="max-w-4xl mx-auto">
                <ChatInput
                  onSend={handleSendMessage}
                  disabled={isLoading}
                  placeholder={
                    currentConversation.has_drawn_cards
                      ? '继续深入探讨，或提出新的疑问...'
                      : '输入你的问题...'
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onGuestLogin={handleGuestLogin}
        onRegister={handleRegister}
        onLogin={handleLogin}
      />

      <TarotCardDrawer
        isOpen={showCardDrawer}
        drawRequest={pendingDrawRequest!}
        onClose={() => {
          setShowCardDrawer(false);
          setPendingDrawRequest(null);
        }}
        onCardsDrawn={handleCardsDrawn}
      />

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-dark-surface rounded-2xl shadow-2xl p-6"
            >
              <h2 className="text-2xl font-bold mb-6">设置</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-dark-bg rounded-lg">
                  <div className="text-sm text-gray-400 mb-1">当前用户</div>
                  <div className="font-medium">
                    {user?.username || user?.profile?.nickname || '游客'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {user?.user_type === 'guest' ? '游客模式' : '注册用户'}
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="w-full px-6 py-3 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded-xl transition-colors"
                >
                  退出登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;




