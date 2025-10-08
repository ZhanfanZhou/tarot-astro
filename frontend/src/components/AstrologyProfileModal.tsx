import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, MapPin } from 'lucide-react';
import type { UserProfile, Gender } from '@/types';

interface AstrologyProfileModalProps {
  isOpen: boolean;
  currentProfile?: UserProfile;
  onClose: () => void;
  onSubmit: (profile: UserProfile) => void;
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

  useEffect(() => {
    if (isOpen && currentProfile) {
      setGender(currentProfile.gender);
      setBirthYear(currentProfile.birth_year);
      setBirthMonth(currentProfile.birth_month);
      setBirthDay(currentProfile.birth_day);
      setBirthHour(currentProfile.birth_hour);
      setBirthMinute(currentProfile.birth_minute);
      setBirthCity(currentProfile.birth_city);
    }
  }, [isOpen, currentProfile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证必填字段
    if (!birthYear || !birthMonth || !birthDay || birthHour === undefined || birthMinute === undefined || !birthCity) {
      alert('请填写完整的出生信息');
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

    onSubmit(profile);
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
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-2xl bg-dark-surface rounded-2xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">完善星盘资料</h2>
                <p className="text-gray-400 mt-1">
                  提供准确的出生信息，获取更精准的星盘解读
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-dark-hover rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
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
                      onClick={() => setGender(option.value)}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        gender === option.value
                          ? 'bg-primary text-white'
                          : 'bg-dark-bg hover:bg-dark-hover'
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
                  <Calendar size={18} />
                  出生日期 <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={birthYear || ''}
                    onChange={(e) => setBirthYear(Number(e.target.value))}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                    onChange={(e) => setBirthMonth(Number(e.target.value))}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                    onChange={(e) => setBirthDay(Number(e.target.value))}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                  <Clock size={18} />
                  出生时间 <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={birthHour !== undefined ? birthHour : ''}
                    onChange={(e) => setBirthHour(Number(e.target.value))}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                    onChange={(e) => setBirthMinute(Number(e.target.value))}
                    className="px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                  <MapPin size={18} />
                  出生城市 <span className="text-red-400">*</span>
                </label>
                <select
                  value={birthCity || ''}
                  onChange={(e) => setBirthCity(e.target.value)}
                  className="w-full px-4 py-2 bg-dark-bg rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
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
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-bold hover:scale-105 transition-transform"
                >
                  保存并继续
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="flex-1 px-6 py-3 bg-dark-bg hover:bg-dark-hover rounded-xl font-bold transition-colors"
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


