import React from 'react';
import { Plus, MessageSquare, Settings, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
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

  return (
    <div className="w-64 h-full bg-dark-surface flex flex-col border-r border-dark-border">
      {/* Header */}
      <div className="p-4 border-b border-dark-border">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          <Plus size={20} />
          <span className="font-medium">新占卜</span>
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">暂无对话历史</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <motion.div
                key={conv.conversation_id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`group relative rounded-lg transition-colors cursor-pointer ${
                  conv.conversation_id === currentConversationId
                    ? 'bg-dark-hover'
                    : 'hover:bg-dark-hover'
                }`}
                onClick={() => onSelectConversation(conv)}
              >
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium truncate">
                        {conv.title}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(conv.updated_at)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(conv.conversation_id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-opacity"
                    >
                      <Trash2 size={16} className="text-red-500" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-dark-border">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-dark-hover rounded-lg transition-colors"
        >
          <Settings size={20} />
          <span>设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;




