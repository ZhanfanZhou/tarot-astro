import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, LogOut, UserRoundPlus } from 'lucide-react';
import { UserType } from '@/types';
import type { User } from '@/types';

interface AccountMenuProps {
  user: User;
  onConvert: () => void;
  onLogout: () => void;
}

/** 右上角的账户 + 设置：头像、名字和一枚齿轮，点开是原来设置弹窗里的全部内容 */
const AccountMenu: React.FC<AccountMenuProps> = ({ user, onConvert, onLogout }) => {
  const [open, setOpen] = useState(false);
  const name = user.profile?.nickname || user.username || '访客';
  const isGuest = user.user_type === UserType.GUEST;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 pl-1 pr-2 py-1 rounded-full transition-colors hover:bg-white/[0.04]"
        style={{ border: '1px solid var(--line-soft)' }}
        aria-label="设置"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="w-7 h-7 rounded-full grid place-items-center font-display text-[13px]"
          style={{ background: 'rgba(201,169,110,0.1)', color: 'var(--gold)', border: '1px solid rgba(201,169,110,0.35)' }}
        >
          {name.slice(0, 1)}
        </span>
        <span className="hidden sm:inline max-w-[8rem] truncate font-display text-sm tracking-[0.06em]" style={{ color: 'var(--ivory-dim)' }}>
          {name}
        </span>
        <span className="grid place-items-center w-6 h-6" style={{ color: 'var(--ivory-dim)' }}>
          <Settings size={15} className="transition-transform duration-500 group-hover:rotate-45" />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 mt-2 w-56 z-50 rounded-xl overflow-hidden py-1.5"
              style={{ background: 'rgba(11,11,22,0.96)', border: '1px solid var(--line)', boxShadow: '0 18px 44px rgba(0,0,0,0.55)' }}
            >
              <div className="px-4 pt-2.5 pb-3 mb-1" style={{ borderBottom: '1px solid var(--line-soft)' }}>
                <div className="eyebrow mb-1.5" style={{ fontSize: '9px', letterSpacing: '0.26em' }}>Settings · 设置</div>
                <div className="font-display truncate" style={{ color: 'var(--ivory)' }}>{name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--ivory-faint)' }}>{isGuest ? '游客模式' : '注册用户'}</div>
              </div>
              {isGuest && (
                <button
                  role="menuitem"
                  onClick={pick(onConvert)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05]"
                  style={{ color: 'var(--gold)' }}
                >
                  <UserRoundPlus size={15} /> 转为注册用户
                </button>
              )}
              <button
                role="menuitem"
                onClick={pick(onLogout)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05]"
                style={{ color: '#E5897E' }}
              >
                <LogOut size={15} /> 退出登录
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AccountMenu;
