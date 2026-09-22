import { UserType } from '@/types';
import type { Quota } from '@/types';

/**
 * 能量条的百分比：今日还剩多少额度。
 * 只计数不拦的调用（抽牌后的解读、日签、心灵奇旅）用完了也照样计，used 可以超过 limit，按 0 算。
 */
export const energyPercent = ({ used, limit }: Quota): number =>
  Math.round((Math.max(0, limit - used) / limit) * 100);

export interface QuotaNotice {
  title: string;
  message: string;
}

/**
 * 今日额度用完时的弹窗。
 * 游客可以转正（转正当天额度就换成注册用户的，已用的照算）；注册用户只能等明天。
 */
export const quotaNotice = (userType: UserType): QuotaNotice =>
  userType === UserType.GUEST
    ? {
        title: '今日免费次数已用完',
        message: '注册账号可获得更好的占卜体验和更多使用额度，现在注册会保留你的对话，今天就能接着聊。',
      }
    : { title: '今日次数已用完', message: '明天再来吧。' };
