import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, MapPin, Loader2 } from 'lucide-react';
import type { UserProfile, Gender } from '@/types';

interface AstrologyProfileModalProps {
  isOpen: boolean;
  currentProfile?: UserProfile;
  onClose: () => void;
  onSubmit: (profile: UserProfile) => Promise<void>;
  onSkip: () => void;
}

// 主要城市列表
const MAJOR_CITIES = [
  '北京', '上海', '广州', '深圳', '成都', '杭州', '重庆', '西安', 
  '武汉', '南京', '天津', '苏州', '郑州', '长沙', '沈阳', '青岛',
  '香港', '台北'
];

const AstrologyProfileModal: React.FC<AstrologyProfileModalProps> = ({
  isOpen,
  currentProfile,
  onClose,
  onSubmit,
  onSkip,
}) => {
  const [gender, setGender] = useState<Gender | undefined>(currentProfile?.gender);
  const [birthYear, setBirthYear] = useState<number | undefined>(currentProfile?.birth_year);
  const [birthMonth, setBirthMonth] = useState<number | undefined>(currentProfile?.birth_month);
  const [birthDay, setBirthDay] = useState<number | undefined>(currentProfile?.birth_day);
  const [birthHour, setBirthHour] = useState<number | undefined>(currentProfile?.birth_hour);
  const [birthMinute, setBirthMinute] = useState<number | undefined>(currentProfile?.birth_minute);
  const [birthCity, setBirthCity] = useState<string | undefined>(currentProfile?.birth_city);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && currentProfile) {
      setGender(currentProfile.gender);
      setBirthYear(currentProfile.birth_year);
      setBirthMonth(currentProfile.birth_month);
      setBirthDay(currentProfile.birth_day);
      setBirthHour(currentProfile.birth_hour);
      setBirthMinute(currentProfile.birth_minute);
      setBirthCity(currentProfile.birth_city);
      setError('');
      setIsSubmitting(false);
    }
  }, [isOpen, currentProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证必填字段
    if (!birthYear || !birthMonth || !birthDay || birthHour === undefined || birthMinute === undefined || !birthCity) {
      setError('请填写完整的出生信息');
      return;
    }

    const profile: UserProfile = {
      ...currentProfile,
      gender,
      birth_year: birthYear,
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_hour: birthHour,
      birth_minute: birthMinute,
      birth_city: birthCity,
    };

    setIsSubmitting(true);
    setError('');

    try {
      await onSubmit(profile);
      // 成功后会由父组件关闭弹窗
    } catch (err: any) {
      setError(err.message || '保存失败，请重试');
      setIsSubmitting(false);
    }
  };

  // 生成年份选项（1950-2024）
  const yearOptions = Array.from({ length: 75 }, (_, i) => 2024 - i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1);
  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="relative w-full max-w-2xl bg-dark-surface border border-mystic-gold/20 rounded-2xl shadow-cosmic p-8 max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="eyebrow mb-1.5" style={{ fontSize: '10px', letterSpacing: '0.28em' }}>ASTROLOGY · 星盘资料</div>
                <h2 className="text-2xl font-display font-semibold mystic-text">完善星盘资料</h2>
                <p className="text-sm mt-1.5" style={{ color: 'var(--ivory-dim)' }}>
                  提供准确的出生信息，获取更精准的星盘解读
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors"
                style={{ color: 'var(--ivory-dim)' }}
              >
                <X size={22} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 错误提示 */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* 性别 */}
              <div>
                <label className="block text-sm font-medium mb-2">性别</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 'male' as Gender, label: '男' },
                    { value: 'female' as Gender, label: '女' },
                    { value: 'other' as Gender, label: '其他' },
                    { value: 'prefer_not_say' as Gender, label: '保密' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setGender(option.value);
                        setError('');
                      }}
                      disabled={isSubmitting}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        gender === option.value
                          ? 'bg-gold-gradient text-dark-bg border-transparent font-medium'
                          : 'bg-white/[0.02] border-mystic-gold/15 hover:border-mystic-gold/40'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 出生日期 */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Calendar size={16} className="text-mystic-gold/70" />
                  出生日期 <span className="text-mystic-gold">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={birthYear || ''}
                    onChange={(e) => {
                      setBirthYear(Number(e.target.value));
                      setError('');
                    }}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">年份</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}年
                      </option>
                    ))}
                  </select>
                  <select
                    value={birthMonth || ''}
                    onChange={(e) => {
                      setBirthMonth(Number(e.target.value));
                      setError('');
                    }}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">月份</option>
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {month}月
                      </option>
                    ))}
                  </select>
                  <select
                    value={birthDay || ''}
                    onChange={(e) => {
                      setBirthDay(Number(e.target.value));
                      setError('');
                    }}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">日期</option>
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>
                        {day}日
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 出生时间 */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Clock size={16} className="text-mystic-gold/70" />
                  出生时间 <span className="text-mystic-gold">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={birthHour !== undefined ? birthHour : ''}
                    onChange={(e) => {
                      setBirthHour(Number(e.target.value));
                      setError('');
                    }}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">小时</option>
                    {hourOptions.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour.toString().padStart(2, '0')}时
                      </option>
                    ))}
                  </select>
                  <select
                    value={birthMinute !== undefined ? birthMinute : ''}
                    onChange={(e) => {
                      setBirthMinute(Number(e.target.value));
                      setError('');
                    }}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">分钟</option>
                    {minuteOptions.map((minute) => (
                      <option key={minute} value={minute}>
                        {minute.toString().padStart(2, '0')}分
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  准确的出生时间对星盘解读非常重要
                </p>
              </div>

              {/* 出生城市 */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-mystic-gold/70" />
                  出生城市 <span className="text-mystic-gold">*</span>
                </label>
                <select
                  value={birthCity || ''}
                  onChange={(e) => {
                    setBirthCity(e.target.value);
                    setError('');
                  }}
                  className="w-full px-4 py-2 bg-dark-bg rounded-lg border border-mystic-gold/15 focus:border-mystic-gold/55 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isSubmitting}
                  required
                >
                  <option value="">请选择城市</option>
                  {MAJOR_CITIES.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  如果您的城市不在列表中，请选择最近的主要城市
                </p>
              </div>

              {/* 按钮 */}
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 bg-gold-gradient text-dark-bg rounded-xl font-semibold tracking-wide hover:scale-[1.03] transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {isSubmitting ? '保存中...' : '保存并继续'}
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 rounded-xl tracking-wide border border-mystic-gold/20 hover:bg-white/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ color: 'var(--ivory-dim)' }}
                >
                  暂时跳过
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AstrologyProfileModal;


