import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Lock, AlertCircle } from 'lucide-react';
import type { UserProfile } from '@/types';

interface ConvertToRegisteredModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConvert: (username: string, password: string) => void;
  currentProfile?: UserProfile;
}

const ConvertToRegisteredModal: React.FC<ConvertToRegisteredModalProps> = ({
  isOpen,
  onClose,
  onConvert,
  currentProfile,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  // 用昵称预填用户名
  useEffect(() => {
    if (currentProfile?.nickname && !username) {
      setUsername(currentProfile.nickname);
    }
  }, [currentProfile, username]);

  const handleSubmit = () => {
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }

    if (!password) {
      setError('请输入密码');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要6位');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次密码不一致');
      return;
    }

    onConvert(username.trim(), password);
  };

  const handleClose = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-dark-surface rounded-2xl shadow-2xl p-6"
          >
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-2 hover:bg-dark-hover rounded-lg transition-colors"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold mb-2">转为注册用户</h2>
            <p className="text-sm text-gray-400 mb-6">
              转换后可以保存您的所有对话历史，随时登录查看
            </p>

            <div className="space-y-4">
              {/* 用户名输入 */}
              <div>
                <label className="block text-sm mb-2">
                  用户名 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    className="w-full pl-10 pr-4 py-2 bg-dark-bg rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {currentProfile?.nickname && (
                  <p className="text-xs text-gray-500 mt-1">
                    已自动填充为您的昵称，可修改
                  </p>
                )}
              </div>

              {/* 密码输入 */}
              <div>
                <label className="block text-sm mb-2">
                  密码 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少6位"
                    className="w-full pl-10 pr-4 py-2 bg-dark-bg rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* 确认密码输入 */}
              <div>
                <label className="block text-sm mb-2">
                  确认密码 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    className="w-full pl-10 pr-4 py-2 bg-dark-bg rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* 个人信息提示 */}
              {currentProfile && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <p className="text-sm text-blue-400 mb-2">您的个人信息将会保留：</p>
                  <div className="text-xs text-gray-400 space-y-1">
                    {currentProfile.nickname && <div>• 昵称: {currentProfile.nickname}</div>}
                    {currentProfile.birth_year && (
                      <div>• 出生日期: {currentProfile.birth_year}年{currentProfile.birth_month}月{currentProfile.birth_day}日</div>
                    )}
                    {currentProfile.birth_city && <div>• 出生地: {currentProfile.birth_city}</div>}
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleClose}
                  className="flex-1 px-6 py-3 bg-dark-hover hover:bg-dark-border rounded-xl transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl transition-colors font-semibold"
                >
                  转换为注册用户
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConvertToRegisteredModal;

