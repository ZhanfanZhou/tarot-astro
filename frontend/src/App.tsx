import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import QuickReplies from './components/QuickReplies';
import SessionButtons from './components/SessionButtons';
import TarotCardDrawer from './components/TarotCardDrawer';
import AuthModal from './components/AuthModal';
import AstrologyProfileModal from './components/AstrologyProfileModal';
import ConvertToRegisteredModal from './components/ConvertToRegisteredModal';
import MysticBackground from './components/MysticBackground';
import { useAuthStore } from './stores/useAuthStore';
import { useConversationStore } from './stores/useConversationStore';
import { userApi, conversationApi, tarotApi, astrologyApi } from './services/api';
import { MessageRole } from './types';
import type { SessionType, DrawCardsRequest, Message, UserProfile } from './types';

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
    addMessageToCurrentConversation,
  } = useConversationStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [showCardDrawer, setShowCardDrawer] = useState(false);
  const [pendingDrawRequest, setPendingDrawRequest] = useState<DrawCardsRequest | null>(null);
  const [showDrawButton, setShowDrawButton] = useState(false); // 是否显示抽牌按钮
  const [showAstrologyProfileModal, setShowAstrologyProfileModal] = useState(false);
  const [pendingAstrologyConversation, setPendingAstrologyConversation] = useState<string | null>(null);
  const isCreatingSessionRef = useRef(false); // 防止重复创建会话
  const previousConversationIdRef = useRef<string | null>(null); // 追踪上一次的对话ID，用于退出时保存笔记
  
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

  // 页面卸载时保存笔记
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (currentConversation) {
        // 使用 sendBeacon 确保在页面卸载前发送请求
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const url = `${apiUrl}/api/conversations/${currentConversation.conversation_id}/exit`;
        
        // 使用 fetch with keepalive 而不是 sendBeacon，因为我们需要 POST JSON
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
      setPendingAstrologyConversation(null);
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
      const loggedInUser = await userApi.login(username, password);
      setUser(loggedInUser);
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

    try {
      const newConv = await conversationApi.create(user.user_id, sessionType);
      addConversation(newConv);
      setCurrentConversation(newConv);

      // 处理塔罗占卜
      if (sessionType === 'tarot') {
        setIsLoading(true);
        setStreamingMessage('');

        try {
          // 发送空消息，让后端返回预设开场白
          await tarotApi.sendMessage(
            newConv.conversation_id,
            '', // 空内容，触发后端返回预设开场白
            (chunk) => {
              setStreamingMessage((prev) => prev + chunk);
            },
            (drawRequest) => {
              setPendingDrawRequest(drawRequest);
              setShowDrawButton(true); // 显示抽牌按钮而非立即弹出抽牌器
            },
            (instruction) => {
              // 塔罗AI也可以请求用户资料
              console.log('塔罗AI请求用户资料:', instruction);
              setPendingAstrologyConversation(newConv.conversation_id);
              setShowAstrologyProfileModal(true);
            },
            async (instruction) => {
              // 塔罗AI也可以请求获取星盘数据
              console.log('塔罗AI请求获取星盘:', instruction);
              if (user) {
                try {
                  await astrologyApi.fetchChart(newConv.conversation_id);
                } catch (error) {
                  console.error('获取星盘数据失败:', error);
                }
              }
            }
          );

          const updatedConv = await conversationApi.get(newConv.conversation_id);
          updateConversation(updatedConv);
          setCurrentConversation(updatedConv);
          setStreamingMessage('');
        } catch (error) {
          console.error('塔罗AI开场失败:', error);
          alert('初始化失败，请重试');
        } finally {
          setIsLoading(false);
        }
      }
      // 处理星座咨询
      else if (sessionType === 'astrology') {
        setIsLoading(true);
        setStreamingMessage('');
        setPendingAstrologyConversation(newConv.conversation_id);

        try {
          let chartWasFetched = false; // 追踪当前消息周期中是否获取了星盘
          
          // 发送空消息，让AI主动开场
          await astrologyApi.sendMessage(
            newConv.conversation_id,
            '', // 空内容，触发AI主动说话
            (chunk) => {
              setStreamingMessage((prev) => prev + chunk);
            },
            (instruction) => {
              // AI检测到需要资料
              console.log('星座AI请求用户资料:', instruction);
              setPendingAstrologyConversation(newConv.conversation_id);
              setShowAstrologyProfileModal(true);
            },
            async (instruction) => {
              // AI请求获取星盘数据
              console.log('星座AI请求获取星盘:', instruction);
              if (user) {
                try {
                  await astrologyApi.fetchChart(newConv.conversation_id);
                  chartWasFetched = true; // 标记本次消息周期中获取了星盘
                } catch (error) {
                  console.error('获取星盘数据失败:', error);
                }
              }
            },
            (drawRequest) => {
              // 星座AI也可以抽塔罗牌
              console.log('星座AI请求抽塔罗牌:', drawRequest);
              setPendingDrawRequest(drawRequest);
              setShowDrawButton(true); // 显示抽牌按钮而非立即弹出抽牌器
            }
          );

          const updatedConv = await conversationApi.get(newConv.conversation_id);
          updateConversation(updatedConv);
          setCurrentConversation(updatedConv);
          setStreamingMessage('');
          
          // 如果星盘数据刚被获取，自动触发AI继续解读
          // 使用本地追踪的chartWasFetched而不是React状态，以确保只触发一次
          if (chartWasFetched) {
            setIsLoading(true);
            setStreamingMessage('');
            
            try {
              // 自动发送触发消息让AI基于星盘数据继续
              await astrologyApi.sendMessage(
                newConv.conversation_id,
                '星盘数据已准备好，请继续解读',
                (chunk) => {
                  setStreamingMessage((prev) => prev + chunk);
                }
              );
              
              // 刷新对话
              const finalConv = await conversationApi.get(newConv.conversation_id);
              updateConversation(finalConv);
              setCurrentConversation(finalConv);
              setStreamingMessage('');
            } catch (error) {
              console.error('AI继续解读失败:', error);
            } finally {
              setIsLoading(false);
            }
          }
        } catch (error) {
          console.error('AI开场失败:', error);
          alert('初始化失败，请重试');
        } finally {
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      alert('创建对话失败，请重试');
    } finally {
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
    // 如果有当前对话，先保存笔记
    if (currentConversation) {
      await handleExitConversation(currentConversation.conversation_id);
    }
    setCurrentConversation(null);
    previousConversationIdRef.current = null;
  };

  const handleSelectConversation = async (conversation: any) => {
    try {
      // 如果有当前对话且不是同一个对话，先保存笔记
      if (currentConversation && currentConversation.conversation_id !== conversation.conversation_id) {
        await handleExitConversation(currentConversation.conversation_id);
      }
      
      const fullConv = await conversationApi.get(conversation.conversation_id);
      setCurrentConversation(fullConv);
      previousConversationIdRef.current = fullConv.conversation_id;
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

  const handleAstrologyProfileSubmit = async (profile: UserProfile) => {
    if (!user) return;

    const conversationId = pendingAstrologyConversation;

    try {
      // 更新用户资料
      await userApi.updateProfile(user.user_id, profile);
      
      // 更新本地用户状态
      const updatedUser = await userApi.getUser(user.user_id);
      setUser(updatedUser);

      // 关闭弹窗
      setShowAstrologyProfileModal(false);
      
      // 如果没有挂起的对话，仅保存资料即可
      if (!conversationId) {
        setPendingAstrologyConversation(null);
        return;
      }

      setIsLoading(true);

      // 获取星盘数据
      await astrologyApi.fetchChart(conversationId);
      
      // 发送简单的通知消息，让AI知道资料已补充
      setStreamingMessage('');
      const triggerMessage = '我已经填写好出生信息了';
      
      await astrologyApi.sendMessage(
        conversationId,
        triggerMessage,
        (chunk) => {
          setStreamingMessage((prev) => prev + chunk);
        },
        (instruction) => {
          // 理论上不应该再触发，但保留处理
          console.log('AI再次请求用户资料:', instruction);
        },
        async (instruction) => {
          // 理论上星盘数据已获取，但保留处理
          console.log('AI再次请求获取星盘:', instruction);
        }
      );

      // 刷新对话
      const updatedConv = await conversationApi.get(conversationId);
      updateConversation(updatedConv);
      setCurrentConversation(updatedConv);
      setStreamingMessage('');
      setPendingAstrologyConversation(null);
    } catch (error: any) {
      console.error('更新资料失败:', error);
      const errorMessage = error.response?.data?.detail || error.message || '更新资料失败，请重试';
      throw new Error(errorMessage);
    } finally {
      if (conversationId) {
        setIsLoading(false);
      }
    }
  };

  const handleAstrologyProfileSkip = async () => {
    // 用户跳过填写资料，关闭弹窗，让用户继续自由对话
    setShowAstrologyProfileModal(false);
    // 不清空 pendingAstrologyConversation，以便用户后续想填写时还可以使用
  };

  const handleSendMessage = async (content: string) => {
    if (!currentConversation || isLoading) return;

    setIsLoading(true);
    setStreamingMessage('');

    try {
      let chartWasFetched = false; // 追踪当前消息周期中是否获取了星盘
      
      // 立即将用户消息添加到对话中（无需等待API响应）
      const userMessage: Message = {
        role: 'user' as MessageRole,
        content,
        timestamp: new Date().toISOString(),
      };
      addMessageToCurrentConversation(userMessage);
      
      // 根据会话类型选择API
      if (currentConversation.session_type === 'astrology') {
        await astrologyApi.sendMessage(
          currentConversation.conversation_id,
          content,
          (chunk) => {
            setStreamingMessage((prev) => prev + chunk);
          },
          (instruction) => {
            // AI检测到需要资料
            console.log('星座AI请求用户资料:', instruction);
            setPendingAstrologyConversation(currentConversation.conversation_id);
            setShowAstrologyProfileModal(true);
          },
          async (instruction) => {
            // AI请求获取星盘数据
            console.log('星座AI请求获取星盘:', instruction);
            if (user) {
              try {
                await astrologyApi.fetchChart(currentConversation.conversation_id);
                chartWasFetched = true; // 标记本次消息周期中获取了星盘
              } catch (error) {
                console.error('获取星盘数据失败:', error);
              }
            }
          },
          (drawRequest) => {
            // 星座AI也可以抽塔罗牌（用于辅助解读）
            console.log('星座AI请求抽塔罗牌:', drawRequest);
            console.log('drawRequest.spread_type:', drawRequest.spread_type);
            console.log('drawRequest.card_count:', drawRequest.card_count);
            console.log('drawRequest.positions:', drawRequest.positions);
            setPendingDrawRequest(drawRequest);
            setShowDrawButton(true); // 显示抽牌按钮而非立即弹出抽牌器
          }
        );
      } else {
        await tarotApi.sendMessage(
          currentConversation.conversation_id,
          content,
          (chunk) => {
            setStreamingMessage((prev) => prev + chunk);
          },
          (drawRequest) => {
            console.log('塔罗AI请求抽塔罗牌:', drawRequest);
            console.log('drawRequest.spread_type:', drawRequest.spread_type);
            console.log('drawRequest.card_count:', drawRequest.card_count);
            console.log('drawRequest.positions:', drawRequest.positions);
            setPendingDrawRequest(drawRequest);
            setShowDrawButton(true); // 显示抽牌按钮而非立即弹出抽牌器
          },
          (instruction) => {
            // 塔罗AI也可以请求用户资料（用于结合星盘的深入解读）
            console.log('塔罗AI请求用户资料:', instruction);
            setPendingAstrologyConversation(currentConversation.conversation_id);
            setShowAstrologyProfileModal(true);
          },
          async (instruction) => {
            // 塔罗AI也可以请求获取星盘数据
            console.log('塔罗AI请求获取星盘:', instruction);
            if (user) {
              try {
                await astrologyApi.fetchChart(currentConversation.conversation_id);
                chartWasFetched = true;
              } catch (error) {
                console.error('获取星盘数据失败:', error);
              }
            }
          }
        );
      }

      // 刷新对话
      const finalConv = await conversationApi.get(currentConversation.conversation_id);
      updateConversation(finalConv);
      setCurrentConversation(finalConv);
      setStreamingMessage('');
      
      // 如果星盘数据刚被获取，自动触发AI继续解读（仅在星座AI中）
      // 使用本地追踪的chartWasFetched而不是React状态，以确保只触发一次
      if (chartWasFetched && currentConversation.session_type === 'astrology') {
        setIsLoading(true);
        setStreamingMessage('');
        
        try {
          // 自动发送触发消息让AI基于星盘数据继续
          await astrologyApi.sendMessage(
            currentConversation.conversation_id,
            '星盘数据已准备好，请继续解读',
            (chunk) => {
              setStreamingMessage((prev) => prev + chunk);
            }
          );
          
          // 刷新对话
          const continuedConv = await conversationApi.get(currentConversation.conversation_id);
          updateConversation(continuedConv);
          setCurrentConversation(continuedConv);
          setStreamingMessage('');
        } catch (error) {
          console.error('AI继续解读失败:', error);
        } finally {
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      alert('发送失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 用户点击"我准备好了"按钮，打开抽牌器
  const handleReadyToDraw = () => {
    setShowDrawButton(false); // 隐藏按钮
    setShowCardDrawer(true); // 显示抽牌器
  };

  const handleCardsDrawn = async () => {
    if (!currentConversation || !pendingDrawRequest) return;

    try {
      // 根据会话类型选择正确的API
      if (currentConversation.session_type === 'astrology') {
        await astrologyApi.drawCards(currentConversation.conversation_id, pendingDrawRequest);
      } else {
        await tarotApi.drawCards(currentConversation.conversation_id, pendingDrawRequest);
      }
      
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
          // 根据会话类型选择正确的API
          if (currentConversation.session_type === 'astrology') {
            await astrologyApi.sendMessage(
              currentConversation.conversation_id,
              '请根据抽牌结果进行解读',
              (chunk) => {
                setStreamingMessage((prev) => prev + chunk);
              },
              (instruction) => {
                // AI检测到需要资料
                console.log('星座AI请求用户资料:', instruction);
                setPendingAstrologyConversation(currentConversation.conversation_id);
                setShowAstrologyProfileModal(true);
              },
              async (instruction) => {
                // AI请求获取星盘数据
                console.log('星座AI请求获取星盘:', instruction);
                if (user) {
                  try {
                    await astrologyApi.fetchChart(currentConversation.conversation_id);
                    // 注：在handleCardsDrawn中不需要触发自动回复，解读会在finally中进行
                  } catch (error) {
                    console.error('获取星盘数据失败:', error);
                  }
                }
              },
              () => {
                // 不应该再次触发抽牌，但保留处理以防万一
                console.warn('警告：解读时不应该再次触发抽牌');
              }
            );
          } else {
            await tarotApi.sendMessage(
              currentConversation.conversation_id,
              '请根据抽牌结果进行解读',
              (chunk) => {
                setStreamingMessage((prev) => prev + chunk);
              },
              () => {
                // 不应该再次触发抽牌，但保留处理以防万一
                console.warn('警告：解读时不应该再次触发抽牌');
              }
            );
          }

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

  const handleLogout = async () => {
    if (!user) return;

    // 退出前保存当前对话的笔记
    if (currentConversation) {
      await handleExitConversation(currentConversation.conversation_id);
    }

    // 游客用户特殊处理
    if (user.user_type === 'guest') {
      const choice = window.confirm(
        '您是游客用户，退出后将无法找回对话历史！\n\n' +
        '点击"确定"删除所有数据并退出\n' +
        '点击"取消"返回（您也可以选择转换为注册用户保留数据）'
      );

      if (!choice) return;

      // 用户选择删除数据
      const confirmDelete = window.confirm(
        '是否要删除所有对话记录和个人信息？\n\n' +
        '点击"确定"将永久删除数据\n' +
        '点击"取消"可以转换为注册用户保留数据'
      );

      if (confirmDelete) {
        // 删除用户及其对话
        try {
          await userApi.deleteUser(user.user_id);
          alert('数据已删除');
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
      if (!confirm('确定要退出登录吗？')) {
        return;
      }
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
      const updatedUser = await userApi.convertGuestToRegistered(user.user_id, username, password);
      setUser(updatedUser);
      setShowConvertModal(false);
      alert('转换成功！现在您可以随时登录查看历史记录了');
    } catch (error: any) {
      console.error('转换失败:', error);
      alert(error.response?.data?.detail || '转换失败，请重试');
    }
  };

  const nonSystemMessages = currentConversation?.messages.filter((msg) => msg.role !== MessageRole.SYSTEM) ?? [];
  const lastNonSystemMessage = nonSystemMessages[nonSystemMessages.length - 1];
  const hasAssistantMessageAtEnd = lastNonSystemMessage?.role === MessageRole.ASSISTANT;
  const shouldRenderStandaloneDrawPrompt = Boolean(
    currentConversation &&
    showDrawButton &&
    pendingDrawRequest &&
    !hasAssistantMessageAtEnd &&
    streamingMessage.trim().length === 0
  );

  return (
    <div className="w-full h-full flex relative">
      {/* 神秘背景（包含静态图和动态效果） */}
      <MysticBackground />
      
      {/* 背景装饰层 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-10">
        {/* 浮动的神秘符号 */}
        <motion.div
          className="absolute top-20 left-10 w-20 h-20 opacity-10"
          animate={{
            y: [0, -20, 0],
            rotate: [0, 180, 360],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="2" className="text-mystic-gold" />
            <path d="M50 10 L50 90 M10 50 L90 50" stroke="currentColor" strokeWidth="1" className="text-mystic-gold" />
          </svg>
        </motion.div>
        
        <motion.div
          className="absolute bottom-40 right-20 w-16 h-16 opacity-10"
          animate={{
            y: [0, 20, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="text-secondary">
            <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" />
          </svg>
        </motion.div>
      </div>

      {/* Sidebar */}
      <div className="relative z-20">
        <Sidebar
          conversations={conversations}
          currentConversationId={currentConversation?.conversation_id}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative z-20">
        {!currentConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
            {/* 中心光效 */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.1, 0.2, 0.1],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <div className="w-96 h-96 rounded-full bg-gradient-to-r from-primary/30 to-secondary/30 blur-3xl" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12 relative z-10"
            >
              {/* 神秘符号装饰 */}
              <motion.div
                className="absolute -top-10 left-1/2 -translate-x-1/2 w-20 h-20 opacity-30"
                animate={{ rotate: 360 }}
                transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
              >
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="50" cy="50" r="45" stroke="url(#headerGrad)" strokeWidth="2" />
                  <path d="M50 5 L50 95 M5 50 L95 50" stroke="url(#headerGrad)" strokeWidth="1" />
                  <defs>
                    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFD700" />
                      <stop offset="100%" stopColor="#FFF4A3" />
                    </linearGradient>
                  </defs>
                </svg>
              </motion.div>

              <motion.h1
                className="text-6xl font-display font-bold mb-6 mystic-text"
                animate={{
                  textShadow: [
                    '0 0 20px rgba(255, 215, 0, 0.5)',
                    '0 0 40px rgba(255, 215, 0, 0.8)',
                    '0 0 20px rgba(255, 215, 0, 0.5)',
                  ],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                ✨ 小x的秘密圣殿 ✨
              </motion.h1>
              
              <p className="text-gray-300 text-xl font-display tracking-wide">
              anyway the wind blows
              </p>
              
              {/* 装饰性分割线 */}
              <motion.div
                className="flex items-center justify-center gap-4 mt-8"
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
              >
                <div className="h-px w-20 bg-gradient-to-r from-transparent via-mystic-gold to-transparent" />
                <svg className="w-4 h-4 text-mystic-gold" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" />
                </svg>
                <div className="h-px w-20 bg-gradient-to-r from-transparent via-mystic-gold to-transparent" />
              </motion.div>
            </motion.div>

            <SessionButtons
              onSelectSession={handleSelectSession}
              disabled={isLoading}
            />
          </div>
        ) : (
          <>
            {/* 会话标题栏 */}
            <div className="glass-morphism px-6 py-4 border-b border-dark-border">
              <div className="max-w-4xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {currentConversation.session_type === 'tarot' ? (
                    <div className="w-10 h-10 rounded-xl bg-mystic-gradient flex items-center justify-center overflow-hidden">
                      <img src="/assets/avatar_tarot.png" alt="tarot" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center overflow-hidden">
                      <img src="/assets/avatar.png" alt="astrology" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div>
                    <h2 className="font-display font-semibold text-lg">
                      {currentConversation.title}
                    </h2>
                    <p className="text-xs text-gray-400">
                      {currentConversation.session_type === 'tarot' ? '塔罗占卜' : '占星'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {currentConversation.messages.map((message, idx) => {
                  // 检查是否是最后一条 AI 消息且有待处理的抽牌请求
                  const isLastAssistantMessage = 
                    message.role === 'assistant' && 
                    idx === currentConversation.messages.length - 1;
                  const shouldShowDrawButton = 
                    isLastAssistantMessage && 
                    showDrawButton && 
                    pendingDrawRequest !== null;
                  
                  return message.role !== 'system' && (
                    <ChatMessage 
                      key={idx} 
                      message={message} 
                      sessionType={currentConversation.session_type}
                      showDrawButton={shouldShowDrawButton}
                      onReadyToDraw={handleReadyToDraw}
                    />
                  );
                })}
                
                {streamingMessage && (
                  <ChatMessage
                    message={{
                      role: 'assistant' as MessageRole,
                      content: streamingMessage,
                      timestamp: new Date().toISOString(),
                    }}
                    sessionType={currentConversation.session_type}
                    showDrawButton={showDrawButton}
                    onReadyToDraw={handleReadyToDraw}
                  />
                )}
                
                {shouldRenderStandaloneDrawPrompt && (
                  <ChatMessage
                    key="draw-button-placeholder"
                    message={{
                      role: MessageRole.ASSISTANT,
                      content: '',
                      timestamp: new Date().toISOString(),
                    }}
                    sessionType={currentConversation.session_type}
                    showDrawButton={true}
                    onReadyToDraw={handleReadyToDraw}
                  />
                )}

                {isLoading && !streamingMessage && (
                  <ChatMessage
                    message={{
                      role: 'assistant' as MessageRole,
                      content: '',
                      timestamp: new Date().toISOString(),
                    }}
                    isThinking={true}
                    sessionType={currentConversation.session_type}
                  />
                )}
                
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="glass-morphism p-6 border-t border-dark-border/50">
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Quick Replies */}
                <QuickReplies
                  conversationType={currentConversation.session_type}
                  onReplyClick={handleSendMessage}
                />
                
                {/* Chat Input */}
                <ChatInput
                  onSend={handleSendMessage}
                  disabled={isLoading}
                  placeholder={
                    currentConversation.has_drawn_cards
                      ? '   继续深入探讨，或提出新的疑问...'
                      : '   输入你的问题，开启心灵对话...'
                  }
                />
              </div>
            </div>
          </>
        )}
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

        <TarotCardDrawer
          isOpen={showCardDrawer}
          drawRequest={pendingDrawRequest!}
          onClose={() => {
            setShowCardDrawer(false);
            setPendingDrawRequest(null);
          }}
          onCardsDrawn={handleCardsDrawn}
        />

        <AstrologyProfileModal
          isOpen={showAstrologyProfileModal}
          currentProfile={user?.profile}
          onClose={() => {
            setShowAstrologyProfileModal(false);
            setPendingAstrologyConversation(null);
          }}
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

                {/* 游客用户显示转换按钮 */}
                {user?.user_type === 'guest' && (
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setShowConvertModal(true);
                    }}
                    className="w-full px-6 py-3 bg-primary/20 text-primary hover:bg-primary/30 rounded-xl transition-colors"
                  >
                    转为注册用户
                  </button>
                )}

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

        {/* Convert to Registered Modal */}
        <ConvertToRegisteredModal
          isOpen={showConvertModal}
          onClose={() => setShowConvertModal(false)}
          onConvert={handleConvertToRegistered}
          currentProfile={user?.profile}
        />
      </div>
    </div>
  );
};

export default App;




