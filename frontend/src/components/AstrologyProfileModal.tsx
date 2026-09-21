import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin } from 'lucide-react';
import type { UserProfile, Gender } from '@/types';
import { ModalShell, ModalHeader, FieldLabel, SelectField, ChoicePill, FormError, FormHint, PrimaryButton, GhostButton } from './ui/form';

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
    <ModalShell isOpen={isOpen} onClose={onClose} onBackdropClick={onClose} widthClass="max-w-2xl">
      <ModalHeader
        portrait="/assets/avatar-astrology.webp"
        accent="moon"
        eyebrow="Astrology · 星盘资料"
        title="完善星盘资料"
        subtitle="提供准确的出生信息，获取更精准的星盘解读"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 错误提示 */}
        {error && <FormError>{error}</FormError>}

        {/* 性别 */}
        <div>
          <FieldLabel>性别</FieldLabel>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: 'male' as Gender, label: '男' },
              { value: 'female' as Gender, label: '女' },
              { value: 'other' as Gender, label: '其他' },
              { value: 'prefer_not_say' as Gender, label: '保密' },
            ].map((option) => (
              <ChoicePill
                key={option.value}
                selected={gender === option.value}
                onClick={() => {
                  setGender(option.value);
                  setError('');
                }}
                disabled={isSubmitting}
              >
                {option.label}
              </ChoicePill>
            ))}
          </div>
        </div>

        {/* 出生日期 */}
        <div>
          <FieldLabel icon={<Calendar size={15} />} required>
            出生日期
          </FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            <SelectField
              value={birthYear || ''}
              onChange={(e) => {
                setBirthYear(Number(e.target.value));
                setError('');
              }}
              disabled={isSubmitting}
              required
            >
              <option value="">年份</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </SelectField>
            <SelectField
              value={birthMonth || ''}
              onChange={(e) => {
                setBirthMonth(Number(e.target.value));
                setError('');
              }}
              disabled={isSubmitting}
              required
            >
              <option value="">月份</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}月
                </option>
              ))}
            </SelectField>
            <SelectField
              value={birthDay || ''}
              onChange={(e) => {
                setBirthDay(Number(e.target.value));
                setError('');
              }}
              disabled={isSubmitting}
              required
            >
              <option value="">日期</option>
              {dayOptions.map((day) => (
                <option key={day} value={day}>
                  {day}日
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        {/* 出生时间 */}
        <div>
          <FieldLabel icon={<Clock size={15} />} required>
            出生时间
          </FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              value={birthHour !== undefined ? birthHour : ''}
              onChange={(e) => {
                setBirthHour(Number(e.target.value));
                setError('');
              }}
              disabled={isSubmitting}
              required
            >
              <option value="">小时</option>
              {hourOptions.map((hour) => (
                <option key={hour} value={hour}>
                  {hour.toString().padStart(2, '0')}时
                </option>
              ))}
            </SelectField>
            <SelectField
              value={birthMinute !== undefined ? birthMinute : ''}
              onChange={(e) => {
                setBirthMinute(Number(e.target.value));
                setError('');
              }}
              disabled={isSubmitting}
              required
            >
              <option value="">分钟</option>
              {minuteOptions.map((minute) => (
                <option key={minute} value={minute}>
                  {minute.toString().padStart(2, '0')}分
                </option>
              ))}
            </SelectField>
          </div>
          <FormHint>准确的出生时间对星盘解读非常重要</FormHint>
        </div>

        {/* 出生城市 */}
        <div>
          <FieldLabel icon={<MapPin size={15} />} required>
            出生城市
          </FieldLabel>
          <SelectField
            value={birthCity || ''}
            onChange={(e) => {
              setBirthCity(e.target.value);
              setError('');
            }}
            disabled={isSubmitting}
            required
          >
            <option value="">请选择城市</option>
            {MAJOR_CITIES.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </SelectField>
          <FormHint>如果您的城市不在列表中，请选择最近的主要城市</FormHint>
        </div>

        {/* 按钮：次要在左、主要在右，和其它弹窗一致 */}
        <div className="flex gap-3 pt-2">
          <GhostButton type="button" onClick={onSkip} disabled={isSubmitting} className="flex-1">
            暂时跳过
          </GhostButton>
          <PrimaryButton type="submit" disabled={isSubmitting} loading={isSubmitting} className="flex-1">
            {isSubmitting ? '保存中...' : '保存并继续'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
};

export default AstrologyProfileModal;
