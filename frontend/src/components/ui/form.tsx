import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import ArchPortrait from './ArchPortrait';

/**
 * 登录 / 注册 / 资料这类表单弹窗共用的一套件：外壳、抬头、字段、按钮。
 * 和殿堂同一种写法——发丝金边、拱窗小立绘、Cinzel 眉题；输入框同对话输入坞，
 * 主按钮同抽牌器的「确认抽牌」（暗底金边胶囊），次按钮同顶栏的细边胶囊。
 */

// ── 外壳 ─────────────────────────────────────────────────────────────────────

interface ModalShellProps {
  isOpen: boolean;
  /** 右上角关闭 */
  onClose: () => void;
  /** 点压暗的那一层；不传就不响应（比如登录弹窗不许点外面关掉） */
  onBackdropClick?: () => void;
  /** 层级，默认 z-50 */
  zClass?: string;
  /** 面板宽度，默认 max-w-md */
  widthClass?: string;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  onBackdropClick,
  zClass = 'z-50',
  widthClass = 'max-w-md',
  children,
}) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 ${zClass} flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onBackdropClick?.();
        }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 16 }}
          transition={{ type: 'spring', damping: 24, stiffness: 300 }}
          className={`relative w-full ${widthClass}`}
        >
          <div
            className="relative max-h-[90vh] overflow-y-auto rounded-[24px] px-6 sm:px-8 pt-8 pb-7"
            style={{
              background:
                'radial-gradient(ellipse 70% 38% at 50% 0%, rgba(201,169,110,0.1), transparent 72%), linear-gradient(180deg, rgba(14,14,26,0.97), rgba(8,8,16,0.97))',
              border: '1px solid rgba(201,169,110,0.22)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(240,208,144,0.06)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-white/[0.06]"
              style={{ border: '1px solid var(--line)', color: 'var(--ivory-dim)' }}
              aria-label="关闭"
            >
              <X size={16} />
            </button>
            {children}
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

// ── 抬头：拱窗小立绘 → 眉题 → 金色标题 → 一行说明 → 带 ✦ 的金线 ────────────────

interface ModalHeaderProps {
  portrait: string;
  accent?: 'gold' | 'moon';
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({ portrait, accent = 'gold', eyebrow, title, subtitle }) => (
  <div className="text-center mb-6">
    <ArchPortrait src={portrait} accent={accent} className="mx-auto mt-3 w-11 h-14" />
    <div className="eyebrow mt-4" style={{ fontSize: '9px', letterSpacing: '0.34em', color: 'var(--gold)' }}>
      {eyebrow}
    </div>
    <h2 className="mt-1.5 font-display font-semibold text-[22px] tracking-[0.16em] leading-snug mystic-text">{title}</h2>
    {subtitle && (
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ivory-dim)' }}>
        {subtitle}
      </p>
    )}
    <div aria-hidden className="mt-5 flex items-center gap-2.5">
      <span className="flex-1 h-px bg-gradient-to-r from-transparent to-mystic-gold/35" />
      <span className="text-[8px] leading-none" style={{ color: 'var(--gold)' }}>✦</span>
      <span className="flex-1 h-px bg-gradient-to-l from-transparent to-mystic-gold/35" />
    </div>
  </div>
);

// ── 字段 ─────────────────────────────────────────────────────────────────────

export const FieldLabel: React.FC<{ icon?: React.ReactNode; required?: boolean; children: React.ReactNode }> = ({
  icon,
  required = false,
  children,
}) => (
  <label className="flex items-center gap-2 mb-2 font-display text-[12px] tracking-[0.16em]" style={{ color: 'var(--ivory-dim)' }}>
    {icon && <span style={{ color: 'var(--gold)', opacity: 0.75 }}>{icon}</span>}
    {children}
    {required && <span style={{ color: 'var(--gold)' }}>*</span>}
  </label>
);

export const FormHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-1.5 text-[11px] tracking-[0.04em]" style={{ color: 'var(--ivory-faint)' }}>
    {children}
  </p>
);

export const FormError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="flex items-center gap-2 rounded-xl px-4 py-3 text-[13px]"
    style={{ color: '#E5897E', border: '1px solid rgba(229,137,126,0.35)', background: 'rgba(229,137,126,0.07)' }}
  >
    <AlertCircle size={15} className="flex-shrink-0" />
    <span>{children}</span>
  </div>
);

// 输入框同对话输入坞：淡金发丝边，聚焦时边线变亮、外面晕一圈金
const FIELD =
  'w-full h-11 rounded-xl bg-white/[0.025] border border-mystic-gold/[0.18] text-[15px] outline-none ' +
  'transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[color:var(--ivory-faint)] ' +
  'hover:border-mystic-gold/30 focus:border-mystic-gold/60 focus:bg-white/[0.04] ' +
  'focus:shadow-[0_0_0_3px_rgba(201,169,110,0.08),0_0_20px_rgba(201,169,110,0.1)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export const TextField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }> = ({
  icon,
  className = '',
  ...rest
}) => (
  <div className="relative">
    {icon && (
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--gold)', opacity: 0.6 }}>
        {icon}
      </span>
    )}
    <input {...rest} className={`${FIELD} ${icon ? 'pl-10' : 'pl-4'} pr-4 ${className}`} style={{ color: 'var(--ivory)' }} />
  </div>
);

/** 下拉：去掉系统箭头换成一枚金色折角；没选的时候字是淡的，和占位一样 */
export const SelectField: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', children, ...rest }) => (
  <div className="relative">
    <select
      {...rest}
      className={`${FIELD} appearance-none pl-4 pr-9 cursor-pointer ${className}`}
      style={{ color: rest.value === '' || rest.value === undefined ? 'var(--ivory-faint)' : 'var(--ivory)', colorScheme: 'dark' }}
    >
      {children}
    </select>
    <ChevronDown
      size={15}
      className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
      style={{ color: 'var(--gold)', opacity: 0.7 }}
    />
  </div>
);

/** 单选的一枚胶囊（性别之类）：选中 = 金边亮起 + 淡金底，不整块涂满 */
export const ChoicePill: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }> = ({
  selected,
  className = '',
  children,
  ...rest
}) => (
  <button
    type="button"
    {...rest}
    className={`h-10 rounded-full border font-display text-[13px] tracking-[0.14em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
      selected
        ? 'border-mystic-gold/70 bg-mystic-gold/10 text-[color:var(--gold-bright)] shadow-[0_0_16px_rgba(201,169,110,0.16)]'
        : 'border-white/[0.08] bg-white/[0.02] text-[color:var(--ivory-dim)] hover:border-mystic-gold/40 hover:text-[color:var(--ivory)]'
    } ${className}`}
  >
    {children}
  </button>
);

// ── 按钮 ─────────────────────────────────────────────────────────────────────

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** 主按钮：暗底金边胶囊，淡淡一层金；悬停时金边变亮、外面晕开 */
export const PrimaryButton: React.FC<ButtonProps & { loading?: boolean }> = ({
  loading = false,
  className = '',
  children,
  ...rest
}) => (
  <button
    {...rest}
    className={`h-12 px-4 sm:px-6 rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap font-display text-[14px] tracking-[0.22em]
      border border-mystic-gold/70 bg-[linear-gradient(120deg,rgba(201,169,110,0.2),rgba(240,208,144,0.07))] text-[color:var(--gold-bright)]
      transition-[border-color,box-shadow,transform] duration-300
      hover:border-mystic-gold-light hover:shadow-[0_0_24px_rgba(201,169,110,0.28)] hover:-translate-y-px active:translate-y-0
      disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0 disabled:hover:border-mystic-gold/70
      ${className}`}
  >
    {loading && <Loader2 size={16} className="animate-spin" />}
    {children}
  </button>
);

/** 次按钮：细边胶囊，同顶栏的「殿堂」 */
export const GhostButton: React.FC<ButtonProps> = ({ className = '', children, ...rest }) => (
  <button
    {...rest}
    className={`h-12 px-4 sm:px-6 rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap font-display text-[14px] tracking-[0.2em]
      border border-white/[0.09] text-[color:var(--ivory-dim)] transition-colors duration-200
      hover:bg-white/[0.04] hover:border-white/[0.16] hover:text-[color:var(--ivory)]
      disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent
      ${className}`}
  >
    {children}
  </button>
);
