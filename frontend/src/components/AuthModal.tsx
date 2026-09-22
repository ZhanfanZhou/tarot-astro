import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Lock, ChevronRight } from 'lucide-react';
import { UserProfile } from '../types';
import { ModalShell, ModalHeader, FieldLabel, TextField, FormError, PrimaryButton, GhostButton } from './ui/form';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGuestLogin: (profile?: UserProfile) => void;
  onRegister: (username: string, password: string, profile?: UserProfile) => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
}

const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onGuestLogin,
  onRegister,
  onLogin,
}) => {
  const [mode, setMode] = useState<'choice' | 'guest' | 'register' | 'login'>('choice');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<UserProfile>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // 重置表单状态
  const resetForm = () => {
    setUsername('');
    setPassword('');
    setProfile({});
    setError('');
    setIsLoading(false);
  };

  // 切换模式时重置错误
  const handleModeChange = (newMode: 'choice' | 'guest' | 'register' | 'login') => {
    setMode(newMode);
    setError('');
  };

  const handleGuestSubmit = () => {
    onGuestLogin(Object.keys(profile).length > 0 ? profile : undefined);
    resetForm();
    onClose();
  };

  const handleRegisterSubmit = async () => {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await onRegister(username, password, Object.keys(profile).length > 0 ? profile : undefined);
      // 注册成功后重置表单并关闭弹窗
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err.message || '注册失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async () => {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await onLogin(username, password);
      // 登录成功后重置表单并关闭弹窗
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err.message || '登录失败，请检查用户名和密码');
    } finally {
      setIsLoading(false);
    }
  };

  const header = {
    choice: { eyebrow: 'Welcome', subtitle: '选一种方式入殿' },
    guest: { eyebrow: 'Guest · 游客模式', subtitle: '快速开始，但不保存历史记录' },
    register: { eyebrow: 'Register · 注册账号', subtitle: '更好的占卜体验 · 更多使用额度' },
    login: { eyebrow: 'Sign in · 登录', subtitle: '回到你的占卜记录' },
  }[mode];

  return (
    <ModalShell isOpen={isOpen} onClose={onClose}>
      <ModalHeader portrait="/assets/icon.webp" eyebrow={header.eyebrow} title={'欢迎来到小 x 的秘密圣殿'} subtitle={header.subtitle} />

      {mode === 'choice' && (
        <div className="space-y-3">
          <Door
            en="Guest"
            title="游客模式"
            line="快速开始，但不保存历史记录"
            visual={<GuestGlyph />}
            onClick={() => handleModeChange('guest')}
          />
          <Door
            en="Register"
            title="注册账号"
            line="更好的占卜体验 · 更多使用额度"
            visual={<RegisterGlyph />}
            featured
            onClick={() => handleModeChange('register')}
          />
          <GhostButton onClick={() => handleModeChange('login')} className="w-full !h-11 !text-[13px] !tracking-[0.16em]">
            已有账号？<span style={{ color: 'var(--gold)' }}>立即登录 ›</span>
          </GhostButton>
        </div>
      )}

      {mode === 'guest' && (
        <div className="space-y-5">
          <div>
            <FieldLabel>昵称（可选）</FieldLabel>
            <TextField
              type="text"
              value={profile.nickname || ''}
              onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
              placeholder="希望占卜师如何称呼你"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <GhostButton onClick={() => handleModeChange('choice')} className="flex-1">
              返回
            </GhostButton>
            <PrimaryButton onClick={handleGuestSubmit} className="flex-1">
              开始占卜
            </PrimaryButton>
          </div>
        </div>
      )}

      {(mode === 'register' || mode === 'login') && (
        <div className="space-y-5">
          {error && <FormError>{error}</FormError>}
          <div>
            <FieldLabel>用户名</FieldLabel>
            <TextField
              icon={<User size={17} />}
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              placeholder="输入用户名"
              disabled={isLoading}
            />
          </div>
          <div>
            <FieldLabel>密码</FieldLabel>
            <TextField
              icon={<Lock size={17} />}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="输入密码"
              disabled={isLoading}
            />
          </div>
          {mode === 'register' && (
            <div>
              <FieldLabel>昵称（可选）</FieldLabel>
              <TextField
                type="text"
                value={profile.nickname || ''}
                onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
                placeholder="希望占卜师如何称呼你"
                disabled={isLoading}
              />
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <GhostButton onClick={() => handleModeChange('choice')} disabled={isLoading} className="flex-1">
              返回
            </GhostButton>
            <PrimaryButton
              onClick={mode === 'register' ? handleRegisterSubmit : handleLoginSubmit}
              disabled={!username || !password || isLoading}
              loading={isLoading}
              className="flex-1"
            >
              {isLoading
                ? (mode === 'register' ? '注册中...' : '登录中...')
                : (mode === 'register' ? '注册' : '登录')
              }
            </PrimaryButton>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

/**
 * 入殿的一扇门：左边小图，右边眉题 + 标题 + 一行说明，最右一枚发丝圆里的 ›。
 * 和殿堂那排次级入口、对话里的抽牌邀请同一套写法。featured = 推荐的那一扇，金边更亮。
 */
const Door: React.FC<{
  en: string;
  title: string;
  line: string;
  visual: React.ReactNode;
  featured?: boolean;
  onClick: () => void;
}> = ({ en, title, line, visual, featured = false, onClick }) => (
  <motion.button
    type="button"
    onClick={onClick}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.985 }}
    className="group relative w-full flex items-center gap-4 pl-3 pr-3.5 py-3.5 rounded-2xl text-left"
  >
    <span
      aria-hidden
      className={`absolute left-0 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full blur-2xl pointer-events-none transition-opacity duration-700 ${
        featured ? 'opacity-50' : 'opacity-0'
      } group-hover:opacity-100`}
      style={{ background: 'radial-gradient(closest-side, rgba(201,169,110,0.25), transparent)' }}
    />
    <span
      aria-hidden
      className="absolute inset-0 rounded-2xl pointer-events-none"
      style={
        featured
          ? { border: '1px solid rgba(201,169,110,0.45)', background: 'linear-gradient(100deg, rgba(201,169,110,0.08), rgba(201,169,110,0.015) 60%)' }
          : { border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.015)' }
      }
    />
    <span
      aria-hidden
      className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
      style={{ border: '1px solid rgba(201,169,110,0.7)', boxShadow: '0 0 26px rgba(201,169,110,0.14), inset 0 1px 0 rgba(201,169,110,0.2)' }}
    />
    <span className="relative flex-shrink-0 w-14 h-12 grid place-items-center">{visual}</span>
    <span className="relative flex-1 min-w-0">
      <span className="eyebrow block" style={{ fontSize: '9px', letterSpacing: '0.3em', color: featured ? 'var(--gold)' : 'var(--ivory-faint)' }}>
        {en}
      </span>
      <span className="block font-display text-[15px] tracking-[0.14em] mt-1" style={{ color: 'var(--ivory)' }}>
        {title}
      </span>
      <span className="block text-[11px] mt-0.5 tracking-[0.04em]" style={{ color: 'var(--ivory-faint)' }}>
        {line}
      </span>
    </span>
    <span
      className="relative flex-shrink-0 w-8 h-8 rounded-full grid place-items-center transition-transform duration-300 group-hover:translate-x-0.5"
      style={
        featured
          ? { border: '1px solid rgba(201,169,110,0.45)', color: 'var(--gold)', background: 'rgba(201,169,110,0.06)' }
          : { border: '1px solid var(--line-soft)', color: 'var(--ivory-dim)' }
      }
    >
      <ChevronRight size={15} />
    </span>
  </motion.button>
);

/** 游客：一弯月亮和一颗远星——路过的夜行人 */
const GuestGlyph: React.FC = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
    <path
      d="M24 9a11 11 0 1 0 7.5 18.8A9 9 0 0 1 24 9z"
      stroke="var(--moon)"
      strokeOpacity="0.75"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <circle cx="31" cy="11" r="1.3" fill="var(--moon-bright)" fillOpacity="0.8" />
  </svg>
);

/** 注册：几颗星连成一段路——占卜一场场记下来，串得起来 */
const RegisterGlyph: React.FC = () => (
  <svg width="46" height="30" viewBox="0 0 46 30" fill="none" aria-hidden>
    <path d="M4 22 L16 9 L29 19 L42 6" stroke="var(--gold)" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
    {[
      [4, 22, 1.8],
      [16, 9, 2.6],
      [29, 19, 1.8],
      [42, 6, 2.2],
    ].map(([cx, cy, r], i) => (
      <circle key={i} cx={cx} cy={cy} r={r} fill="var(--gold-bright)" />
    ))}
  </svg>
);

export default AuthModal;
