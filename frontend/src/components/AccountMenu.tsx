import React, { useEffect, useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, LogOut, UserRoundPlus } from 'lucide-react';
import { UserType } from '@/types';
import type { User } from '@/types';

interface AccountMenuProps {
  user: User;
  /** 能量剩余（今日额度还剩的百分比）；null = 还没查到，不画 */
  energy: number | null;
  onConvert: () => void;
  onLogout: () => void;
}

/** 能量条：一道细金线，长度是剩下的百分比 */
const EnergyBar: React.FC<{ percent: number }> = ({ percent }) => (
  <span className="block h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--line-soft)' }}>
    <span
      className="block h-full rounded-full transition-[width] duration-700"
      style={{
        width: `${percent}%`,
        background: 'linear-gradient(90deg, var(--gold-deep), var(--gold) 60%, var(--gold-bright))',
        boxShadow: '0 0 6px rgba(201,169,110,0.45)',
      }}
    />
  </span>
);

/**
 * 能量环：手机顶栏被殿堂胶囊和钱包胸章占满，没有 88px 横向余地放那条线，
 * 于是同一份读数绕着头像画一圈——剩多少画多少，不占任何额外宽度。
 */
const EnergyRing: React.FC<{ percent: number }> = ({ percent }) => {
  const gid = useId().replace(/:/g, '');
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg className="absolute -inset-[3px] -rotate-90" width="34" height="34" viewBox="0 0 34 34" aria-hidden>
      <defs>
        <linearGradient id={`energy-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--gold-deep)" />
          <stop offset="0.6" stopColor="var(--gold)" />
          <stop offset="1" stopColor="var(--gold-bright)" />
        </linearGradient>
      </defs>
      {/* 底圈用金色发丝线（不是那条线的 --line-soft）：环要先看得出是一圈刻度，空的那段才有意义 */}
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke={`url(#energy-${gid})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(Math.max(percent, 0), 100) / 100)}
        className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        style={{ filter: 'drop-shadow(0 0 4px rgba(201,169,110,0.5))' }}
      />
    </svg>
  );
};

/**
 * 右上角的账户 + 设置：头像、名字、能量剩余和一枚齿轮，点开是原来设置弹窗里的全部内容。
 * 窄屏放不下名字和那条能量线：名字收进面板，能量改成绕着头像的一圈环 + 一个百分数。
 */
const AccountMenu: React.FC<AccountMenuProps> = ({ user, energy, onConvert, onLogout }) => {
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
        <span className="relative block flex-shrink-0 w-7 h-7">
          {/* 窄屏才画环：宽屏右边那块有完整的「能量剩余 / 百分比 / 细线」 */}
          {energy !== null && (
            <span aria-hidden className="sm:hidden">
              <EnergyRing percent={energy} />
            </span>
          )}
          <span
            className="w-full h-full rounded-full grid place-items-center font-display text-[13px]"
            style={{ background: 'rgba(201,169,110,0.1)', color: 'var(--gold)', border: '1px solid rgba(201,169,110,0.35)' }}
          >
            {name.slice(0, 1)}
          </span>
        </span>
        {/* 环旁边的读数：窄屏上没有「能量剩余」四个字的余地，数字跟着环一起看 */}
        {energy !== null && (
          <span
            aria-hidden
            className="sm:hidden flex-shrink-0 whitespace-nowrap font-display text-[11px] tracking-[0.04em]"
            style={{ color: 'var(--gold)' }}
          >
            {energy}%
          </span>
        )}
        <span className="hidden sm:inline max-w-[8rem] truncate font-display text-sm tracking-[0.06em]" style={{ color: 'var(--ivory-dim)' }}>
          {name}
        </span>
        {energy !== null && (
          <span
            aria-hidden
            className="hidden sm:flex flex-col gap-[5px] w-[88px] pl-2.5"
            style={{ borderLeft: '1px solid var(--line-soft)' }}
          >
            <span className="flex items-baseline justify-between leading-none">
              <span className="text-[10px] tracking-[0.14em]" style={{ color: 'var(--ivory-faint)' }}>能量剩余</span>
              <span className="font-display text-[11px]" style={{ color: 'var(--gold)' }}>{energy}%</span>
            </span>
            <EnergyBar percent={energy} />
          </span>
        )}
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
                {energy !== null && (
                  <div
                    role="meter"
                    aria-label="能量剩余"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={energy}
                    className="mt-3"
                  >
                    <div className="flex items-baseline justify-between mb-1.5 leading-none">
                      <span className="text-xs tracking-[0.12em]" style={{ color: 'var(--ivory-dim)' }}>能量剩余</span>
                      <span className="font-display text-sm" style={{ color: 'var(--gold)' }}>{energy}%</span>
                    </div>
                    <EnergyBar percent={energy} />
                  </div>
                )}
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
