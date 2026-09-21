import React, { useState, useEffect } from 'react';
import { User, Lock } from 'lucide-react';
import type { UserProfile } from '@/types';
import { ModalShell, ModalHeader, FieldLabel, TextField, FormError, FormHint, PrimaryButton, GhostButton } from './ui/form';

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
    <ModalShell isOpen={isOpen} onClose={handleClose} onBackdropClick={handleClose} zClass="z-[110]">
      <ModalHeader
        portrait="/assets/icon.webp"
        eyebrow="Register · 转为注册"
        title="转为注册用户"
        subtitle="转换后可以保存您的所有对话历史，随时登录查看"
      />

      <div className="space-y-5">
        {/* 用户名输入 */}
        <div>
          <FieldLabel required>用户名</FieldLabel>
          <TextField
            icon={<User size={17} />}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
          />
          {currentProfile?.nickname && <FormHint>已自动填充为您的昵称，可修改</FormHint>}
        </div>

        {/* 密码输入 */}
        <div>
          <FieldLabel required>密码</FieldLabel>
          <TextField
            icon={<Lock size={17} />}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少6位"
          />
        </div>

        {/* 确认密码输入 */}
        <div>
          <FieldLabel required>确认密码</FieldLabel>
          <TextField
            icon={<Lock size={17} />}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入密码"
          />
        </div>

        {/* 错误提示 */}
        {error && <FormError>{error}</FormError>}

        {/* 个人信息提示：月光蓝发丝框，条目用 ✦ 打头 */}
        {currentProfile && (
          <div
            className="rounded-xl px-4 py-3"
            style={{ border: '1px solid rgba(168,216,234,0.28)', background: 'rgba(168,216,234,0.05)' }}
          >
            <p className="font-display text-[12px] tracking-[0.14em] mb-2" style={{ color: 'var(--moon)' }}>
              您的个人信息将会保留：
            </p>
            <div className="text-xs space-y-1" style={{ color: 'var(--ivory-dim)' }}>
              {currentProfile.nickname && <div><span style={{ color: 'var(--moon)' }}>✦</span> 昵称: {currentProfile.nickname}</div>}
              {currentProfile.birth_year && (
                <div>
                  <span style={{ color: 'var(--moon)' }}>✦</span> 出生日期: {currentProfile.birth_year}年{currentProfile.birth_month}月{currentProfile.birth_day}日
                </div>
              )}
              {currentProfile.birth_city && <div><span style={{ color: 'var(--moon)' }}>✦</span> 出生地: {currentProfile.birth_city}</div>}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-1">
          <GhostButton onClick={handleClose} className="flex-1">
            取消
          </GhostButton>
          <PrimaryButton onClick={handleSubmit} className="flex-[1.5] !tracking-[0.12em]">
            转换为注册用户
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
};

export default ConvertToRegisteredModal;
