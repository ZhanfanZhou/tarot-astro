import React, { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = '输入你的问题...',
}) => {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      {/* 聚焦时的装饰效果 */}
      <AnimatePresence>
        {isFocused && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute -inset-1 bg-mystic-gradient rounded-3xl blur-md opacity-30"
          />
        )}
      </AnimatePresence>

      <div className="relative flex items-center">
        {/* 输入框 */}
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full py-4 pr-24 pl-10 
            glass-morphism border-2 rounded-2xl 
            font-display text-base
            focus:outline-none transition-all duration-300
            disabled:opacity-50 disabled:cursor-not-allowed
            placeholder:text-gray-500
            ${
              isFocused
                ? 'border-mystic-gold shadow-mystic'
                : 'border-dark-border/50'
            }
          `}
        />

        {/* 装饰性图标 */}
        <motion.div
          className="absolute left-4 pointer-events-none"
          animate={{
            rotate: isFocused ? [0, 10, -10, 0] : 0,
            scale: isFocused ? [1, 1.1, 1] : 1,
          }}
          transition={{
            duration: 2,
            repeat: isFocused ? Infinity : 0,
          }}
        >
          <Sparkles size={18} className="text-mystic-gold opacity-40" />
        </motion.div>

        {/* 发送按钮 */}
        <motion.button
          type="submit"
          disabled={disabled || !message.trim()}
          whileHover={!disabled && message.trim() ? { scale: 1.05 } : {}}
          whileTap={!disabled && message.trim() ? { scale: 0.95 } : {}}
          className={`
            absolute right-2 p-3 rounded-xl 
            transition-all duration-300
            ${
              disabled || !message.trim()
                ? 'bg-dark-elevated opacity-40 cursor-not-allowed'
                : 'bg-mystic-gradient hover:shadow-mystic shadow-lg'
            }
          `}
        >
          <motion.div
            animate={
              !disabled && message.trim()
                ? {
                    rotate: [0, 10, -10, 0],
                  }
                : {}
            }
            transition={{
              duration: 0.5,
              repeat: Infinity,
              repeatDelay: 2,
            }}
          >
            <Send size={20} className="text-white" />
          </motion.div>
        </motion.button>

        {/* 字符计数 */}
        <AnimatePresence>
          {message.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute -bottom-6 right-2 text-xs text-gray-500 font-display"
            >
              {message.length} 字
            </motion.div>
          )}
        </AnimatePresence>
      </div>


    </form>
  );
};

export default ChatInput;




