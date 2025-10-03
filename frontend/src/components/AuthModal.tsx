import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Lock } from 'lucide-react';
import type { UserProfile, Gender } from '@/types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGuestLogin: (profile?: UserProfile) => void;
  onRegister: (username: string, password: string, profile?: UserProfile) => void;
  onLogin: (username: string, password: string) => void;
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

  const handleGuestSubmit = () => {
    onGuestLogin(Object.keys(profile).length > 0 ? profile : undefined);
    onClose();
  };

  const handleRegisterSubmit = () => {
    if (username && password) {
      onRegister(username, password, Object.keys(profile).length > 0 ? profile : undefined);
      onClose();
    }
  };

  const handleLoginSubmit = () => {
    if (username && password) {
      onLogin(username, password);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-md bg-dark-surface rounded-2xl shadow-2xl p-6"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 hover:bg-dark-hover rounded-lg transition-colors"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold mb-6">欢迎来到塔罗占卜</h2>

            {mode === 'choice' && (
              <div className="space-y-4">
                <button
                  onClick={() => setMode('guest')}
                  className="w-full px-6 py-4 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors text-left"
                >
                  <div className="font-semibold mb-1">游客模式</div>
                  <div className="text-sm text-gray-400">快速开始，但不保存历史记录</div>
                </button>
                <button
                  onClick={() => setMode('register')}
                  className="w-full px-6 py-4 bg-primary hover:bg-primary/90 rounded-xl transition-colors text-left"
                >
                  <div className="font-semibold mb-1">注册账号</div>
                  <div className="text-sm text-white/80">保存历史记录，随时查看</div>
                </button>
                <button
                  onClick={() => setMode('login')}
                  className="w-full px-6 py-4 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors"
                >
                  已有账号？立即登录
                </button>
              </div>
            )}

            {mode === 'guest' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2">昵称（可选）</label>
                  <input
                    type="text"
                    value={profile.nickname || ''}
                    onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                    placeholder="希望占卜师如何称呼你"
                  />
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setMode('choice')}
                    className="flex-1 px-6 py-3 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors"
                  >
                    返回
                  </button>
                  <button
                    onClick={handleGuestSubmit}
                    className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl transition-colors"
                  >
                    开始占卜
                  </button>
                </div>
              </div>
            )}

            {(mode === 'register' || mode === 'login') && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2">用户名</label>
                  <div className="relative">
                    <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                      placeholder="输入用户名"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-2">密码</label>
                  <div className="relative">
                    <Lock size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                      placeholder="输入密码"
                    />
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setMode('choice')}
                    className="flex-1 px-6 py-3 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors"
                  >
                    返回
                  </button>
                  <button
                    onClick={mode === 'register' ? handleRegisterSubmit : handleLoginSubmit}
                    disabled={!username || !password}
                    className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mode === 'register' ? '注册' : '登录'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;




