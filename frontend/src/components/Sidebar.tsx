import React from 'react';
import { Plus, MessageSquare, Settings, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Conversation, SessionType } from '@/types';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onNewConversation: () => void;
  onSelectConversation: (conversation: Conversation) => void;
  onDeleteConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  currentConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onOpenSettings,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const getSessionIcon = (sessionType: SessionType) => {
    switch (sessionType) {
      case 'tarot':
        return '/assets/avatar_tarot.png';
      case 'astrology':
        return '/assets/avatar.png';
      default:
        return '/assets/avatar.png';
    }
  };

  return (
    <div className="w-72 h-full glass-morphism flex flex-col border-r border-dark-border/50 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-40 h-40 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header with Logo */}
      <div className="p-6 border-b border-dark-border/50 relative">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-4"
        >
          <motion.div
            className="w-10 h-10 rounded-xl bg-mystic-gradient flex items-center justify-center overflow-hidden"
            animate={{
              boxShadow: [
                '0 0 20px rgba(139, 92, 246, 0.3)',
                '0 0 30px rgba(236, 72, 153, 0.5)',
                '0 0 20px rgba(139, 92, 246, 0.3)',
              ],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
            }}
          >
            <img src="/assets/icon.png" alt="Logo" className="w-full h-full object-cover" />
          </motion.div>
          <div>
            <h1 className="font-display font-bold text-lg mystic-text">小x的秘密圣殿</h1>
            <p className="text-xs text-gray-400">Mystic Oracle</p>
          </div>
        </motion.div>

        <motion.button
          onClick={onNewConversation}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mystic-gradient hover:opacity-90 rounded-xl transition-all shadow-mystic font-medium"
        >
          <Plus size={20} />
          <span>开启新占卜</span>
        </motion.button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-3 relative">
        {conversations.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center text-gray-500 mt-12"
          >
            <motion.div
              animate={{
                y: [0, -10, 0],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <MessageSquare size={48} className="mx-auto mb-4 opacity-30" />
            </motion.div>
            <p className="text-sm font-display">暂无对话历史</p>
            <p className="text-xs text-gray-600 mt-1">点击上方按钮开始占卜</p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {conversations.map((conv, idx) => (
                <motion.div
                  key={conv.conversation_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: idx * 0.05 }}
                  whileHover={{ scale: 1.02, x: 4 }}
                  className={`group relative rounded-xl transition-all cursor-pointer overflow-hidden ${
                    conv.conversation_id === currentConversationId
                      ? 'bg-dark-elevated shadow-mystic border border-primary/30'
                      : 'hover:bg-dark-elevated border border-transparent'
                  }`}
                  onClick={() => onSelectConversation(conv)}
                >
                  {/* 选中状态的光效 */}
                  {conv.conversation_id === currentConversationId && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10"
                      animate={{
                        opacity: [0.3, 0.6, 0.3],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                      }}
                    />
                  )}

                  <div className="relative p-4">
                    <div className="flex items-start gap-3">
                      {/* 类型图标 */}
                      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-lg ${
                        conv.session_type === 'tarot'
                          ? 'bg-gradient-to-br from-purple-500/20 to-pink-500/20'
                          : 'bg-gradient-to-br from-blue-500/20 to-cyan-500/20'
                      }`}>
                        <img src={getSessionIcon(conv.session_type)} alt={conv.session_type} className="w-full h-full object-cover rounded-md" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium truncate font-display">
                          {conv.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-gray-500">
                            {formatDate(conv.updated_at)}
                          </p>
                          {conv.has_drawn_cards && (
                            <span className="text-xs text-mystic-gold">✨</span>
                          )}
                        </div>
                      </div>

                      {/* 删除按钮 */}
                      <motion.button
                        initial={{ opacity: 0 }}
                        whileHover={{ scale: 1.1 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conv.conversation_id);
                        }}
                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 hover:bg-red-500/20 rounded-lg transition-all"
                      >
                        <Trash2 size={14} className="text-red-400" />
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-dark-border/50 relative">
        <motion.button
          onClick={onOpenSettings}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-elevated rounded-xl transition-all group"
        >
          <Settings size={20} className="text-gray-400 group-hover:text-mystic-gold transition-colors" />
          <span className="font-display">设置</span>
        </motion.button>

        {/* 装饰性分割线 */}
        <div className="flex items-center gap-2 mt-4 mb-2">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-dark-border to-transparent" />
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            <svg className="w-3 h-3 text-mystic-gold opacity-50" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" />
            </svg>
          </motion.div>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-dark-border to-transparent" />
        </div>
        
        <p className="text-xs text-center text-gray-600 font-display">
          探索命运的奥秘
        </p>
      </div>
    </div>
  );
};

export default Sidebar;




