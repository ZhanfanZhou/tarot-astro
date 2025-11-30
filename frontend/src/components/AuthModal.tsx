import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Lock, Loader2 } from 'lucide-react';
import { UserProfile } from '../types';

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
                  onClick={() => handleModeChange('guest')}
                  className="w-full px-6 py-4 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors text-left"
                >
                  <div className="font-semibold mb-1">游客模式</div>
                  <div className="text-sm text-gray-400">快速开始，但不保存历史记录</div>
                </button>
                <button
                  onClick={() => handleModeChange('register')}
                  className="w-full px-6 py-4 bg-primary hover:bg-primary/90 rounded-xl transition-colors text-left"
                >
                  <div className="font-semibold mb-1">注册账号</div>
                  <div className="text-sm text-white/80">保存历史记录，随时查看</div>
                </button>
                <button
                  onClick={() => handleModeChange('login')}
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
                    onClick={() => handleModeChange('choice')}
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
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}
                <div>
                  <label className="block text-sm mb-2">用户名</label>
                  <div className="relative">
                    <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setError('');
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                      placeholder="输入用户名"
                      disabled={isLoading}
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
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                      placeholder="输入密码"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                {mode === 'register' && (
                  <div>
                    <label className="block text-sm mb-2">昵称（可选）</label>
                    <input
                      type="text"
                      value={profile.nickname || ''}
                      onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
                      className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary"
                      placeholder="希望占卜师如何称呼你"
                      disabled={isLoading}
                    />
                  </div>
                )}
                <div className="flex gap-4">
                  <button
                    onClick={() => handleModeChange('choice')}
                    disabled={isLoading}
                    className="flex-1 px-6 py-3 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    返回
                  </button>
                  <button
                    onClick={mode === 'register' ? handleRegisterSubmit : handleLoginSubmit}
                    disabled={!username || !password || isLoading}
                    className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isLoading && <Loader2 className="animate-spin" size={18} />}
                    {isLoading 
                      ? (mode === 'register' ? '注册中...' : '登录中...') 
                      : (mode === 'register' ? '注册' : '登录')
                    }
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




