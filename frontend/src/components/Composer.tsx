import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';

interface ComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_HEIGHT = 168; // ~6 lines, then internal scroll

/** Auto-growing textarea composer. Enter = send, Shift+Enter = newline; IME-safe. */
const Composer: React.FC<ComposerProps> = ({ onSend, disabled = false, placeholder = '输入你的问题...' }) => {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const composingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && message.trim().length > 0;

  // auto-resize
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  }, [message]);

  const send = () => {
    if (!canSend) return;
    onSend(message.trim());
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Don't send while an IME composition is active (Chinese/Japanese/etc.)
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="relative">
      {isFocused && (
        <div
          className="absolute -inset-px rounded-2xl blur-md pointer-events-none"
          style={{ background: 'radial-gradient(120% 140% at 50% 100%, rgba(201,169,110,0.22), transparent 70%)' }}
        />
      )}

      <div
        className="relative flex items-end gap-2 rounded-2xl transition-all duration-300"
        style={{
          background: 'rgba(10,10,20,0.7)',
          backdropFilter: 'blur(18px)',
          border: `1px solid ${isFocused ? 'rgba(201,169,110,0.6)' : 'var(--line)'}`,
          boxShadow: isFocused ? '0 0 24px rgba(201,169,110,0.13), inset 0 1px 0 rgba(255,255,255,0.03)' : 'none',
          padding: '8px 8px 8px 14px',
        }}
      >
        <span className="pb-2 text-sm pointer-events-none select-none" style={{ color: 'var(--gold)', opacity: isFocused ? 0.85 : 0.4 }}>
          ✦
        </span>

        <textarea
          ref={taRef}
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent outline-none py-2 text-[15px] tracking-wide leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ color: 'var(--ivory)', fontFamily: "'Noto Serif SC', serif", maxHeight: MAX_HEIGHT }}
        />

        <motion.button
          type="button"
          onClick={send}
          disabled={!canSend}
          whileHover={canSend ? { scale: 1.06 } : {}}
          whileTap={canSend ? { scale: 0.92 } : {}}
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300"
          style={
            canSend
              ? { background: 'linear-gradient(135deg, #8A6D3B, #C9A96E 55%, #F0D090)', boxShadow: '0 4px 16px rgba(201,169,110,0.3)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)' }
          }
          aria-label="发送"
        >
          <ArrowUp size={18} style={{ color: canSend ? '#1a1407' : 'var(--ivory-faint)' }} strokeWidth={2.4} />
        </motion.button>
      </div>

      <div className="h-4 mt-1 px-2 flex justify-between items-center">
        <span className="text-[10px] tracking-wider" style={{ color: 'var(--ivory-faint)' }}>
          {isFocused ? 'Enter 发送 · Shift+Enter 换行' : ''}
        </span>
        {message.length > 0 && (
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--ivory-faint)' }}>{message.length} 字</span>
        )}
      </div>
    </div>
  );
};

export default Composer;
