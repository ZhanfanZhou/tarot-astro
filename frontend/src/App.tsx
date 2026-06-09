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
import RecentReadings from './components/RecentReadings';
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
  const [showProfileButton, setShowProfileButton] = useState(false); // 是否显示补充资料按钮
  const [pendingProfileRequest, setPendingProfileRequest] = useState<any>(null); // 待处理的资料请求
  const isCreatingSessionRef = useRef(false); // 防止重复创建会话
  const previousConversationIdRef = useRef<string | null>(null); // 追踪上一次的对话ID，用于退出时保存笔记
  // 侧边栏：桌面常驻、移动端抽屉；初始按视口决定
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const closeSidebarOnMobile = () => { if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false); };

  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      toast.error('登录失败，请重试');
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
    closeSidebarOnMobile();

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
              setPendingProfileRequest(instruction);
              setShowProfileButton(true); // 显示补充资料按钮而非立即弹窗
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
          toast.error('初始化失败，请重试');
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
              setPendingProfileRequest(instruction);
              setShowProfileButton(true); // 显示补充资料按钮而非立即弹窗
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
          toast.error('初始化失败，请重试');
        } finally {
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      toast.error('创建对话失败，请重试');
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

      const fullConv = await conversationApi.get(conversation.conversation_id);
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
      setShowProfileButton(false); // 清除补充资料按钮状态
      setPendingProfileRequest(null); // 清除待处理的资料请求
      
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
    setShowProfileButton(false); // 清除补充资料按钮状态
    setPendingProfileRequest(null); // 清除待处理的资料请求
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
            setPendingProfileRequest(instruction);
            setShowProfileButton(true); // 显示补充资料按钮而非立即弹窗
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
            setPendingProfileRequest(instruction);
            setShowProfileButton(true); // 显示补充资料按钮而非立即弹窗
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
      toast.error('发送失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 用户点击"我准备好了"按钮，打开抽牌器
  const handleReadyToDraw = () => {
    setShowDrawButton(false); // 隐藏按钮
    setShowCardDrawer(true); // 显示抽牌器
  };

  // 用户点击"补充资料"按钮，打开资料填写窗口
  const handleReadyToFillProfile = () => {
    setShowProfileButton(false); // 隐藏按钮
    setShowAstrologyProfileModal(true); // 显示资料填写窗口
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
                setPendingProfileRequest(instruction);
                setShowProfileButton(true); // 显示补充资料按钮而非立即弹窗
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
          toast.error('解读失败，请重试');
        } finally {
          setIsLoading(false);
        }
      }, 500);
    } catch (error) {
      console.error('抽牌失败:', error);
      toast.error('抽牌失败，请重试');
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
      const updatedUser = await userApi.convertGuestToRegistered(user.user_id, username, password);
      setUser(updatedUser);
      setShowConvertModal(false);
      toast.success('转换成功！现在您可以随时登录查看历史记录了');
    } catch (error: any) {
      console.error('转换失败:', error);
      toast.error(error.response?.data?.detail || '转换失败，请重试');
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
  const shouldRenderStandaloneProfilePrompt = Boolean(
    currentConversation &&
    showProfileButton &&
    pendingProfileRequest &&
    !hasAssistantMessageAtEnd &&
    streamingMessage.trim().length === 0
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
            <div className="absolute top-4 right-4 z-10">
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
              disabled={isLoading}
            />

            <div className="w-full max-w-2xl mt-12 space-y-6">
              <GalleryBanner />
              <RecentReadings conversations={conversations} onSelect={handleSelectConversation} />
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
                {currentConversation.messages.map((message, idx) => {
                  // 检查是否是最后一条 AI 消息且有待处理的抽牌请求
                  const isLastAssistantMessage = 
                    message.role === 'assistant' && 
                    idx === currentConversation.messages.length - 1;
                  const shouldShowDrawButton = 
                    isLastAssistantMessage && 
                    showDrawButton && 
                    pendingDrawRequest !== null;
                  const shouldShowProfileButton = 
                    isLastAssistantMessage && 
                    showProfileButton && 
                    pendingProfileRequest !== null;
                  
                  return message.role !== 'system' && (
                    <ChatMessage 
                      key={idx} 
                      message={message} 
                      sessionType={currentConversation.session_type}
                      showDrawButton={shouldShowDrawButton}
                      onReadyToDraw={handleReadyToDraw}
                      showProfileButton={shouldShowProfileButton}
                      onReadyToFillProfile={handleReadyToFillProfile}
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
                    isStreaming
                    showDrawButton={showDrawButton}
                    onReadyToDraw={handleReadyToDraw}
                    showProfileButton={showProfileButton}
                    onReadyToFillProfile={handleReadyToFillProfile}
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
                
                {shouldRenderStandaloneProfilePrompt && (
                  <ChatMessage
                    key="profile-button-placeholder"
                    message={{
                      role: MessageRole.ASSISTANT,
                      content: '',
                      timestamp: new Date().toISOString(),
                    }}
                    sessionType={currentConversation.session_type}
                    showProfileButton={true}
                    onReadyToFillProfile={handleReadyToFillProfile}
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

            {/* Composer */}
            <div
              className="px-4 sm:px-6 pt-4 border-t border-mystic-gold/12 bg-gradient-to-b from-dark-bg/30 to-dark-bg/70 backdrop-blur-xl"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <div className="max-w-[720px] mx-auto space-y-3">
                <QuickReplies
                  conversationType={currentConversation.session_type}
                  onReplyClick={handleSendMessage}
                />
                <Composer
                  onSend={handleSendMessage}
                  disabled={isLoading}
                  placeholder={
                    currentConversation.has_drawn_cards
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




