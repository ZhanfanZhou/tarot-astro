import { describe, it, expect } from 'vitest';
import { buildArcRows, bucketOf, relTime } from './RecentArc';
import type { Conversation, SessionType } from '@/types';

// 固定「现在」= 本地时间 2026-09-22 00:30，刚过零点——最容易把「今天」算错的时刻
const NOW = new Date(2026, 8, 22, 0, 30).getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600e3).toISOString();

const conv = (id: string, title: string, updated: string): Conversation => ({
  conversation_id: id,
  user_id: 'u',
  session_type: 'tarot' as SessionType,
  title,
  messages: [],
  created_at: updated,
  updated_at: updated,
  is_completed: false,
  has_drawn_cards: false,
});

describe('时间按日历日算', () => {
  it('昨晚 23:30 是「昨天」、分在「本周」，不是 24 小时内就算今天', () => {
    expect(relTime(hoursAgo(1), NOW)).toBe('昨天');
    expect(bucketOf(hoursAgo(1), NOW)).toBe('本周');
  });

  it('今天零点之后是「今天」', () => {
    expect(relTime(hoursAgo(0.25), NOW)).toBe('今天');
    expect(bucketOf(hoursAgo(0.25), NOW)).toBe('今天');
  });

  it('6 个日历日前还在本周，7 个日历日前就是更早', () => {
    const sixDays = new Date(2026, 8, 16, 12).toISOString();
    const sevenDays = new Date(2026, 8, 15, 23).toISOString();
    expect(relTime(sixDays, NOW)).toBe('6天前');
    expect(bucketOf(sixDays, NOW)).toBe('本周');
    expect(bucketOf(sevenDays, NOW)).toBe('更早');
  });
});

describe('buildArcRows', () => {
  const list = [
    conv('old', '新年的整体运势', new Date(2026, 7, 1).toISOString()),
    conv('today', '这段关系还值得继续吗', hoursAgo(0.2)),
    conv('week', '要不要接那份新工作', hoursAgo(50)),
    conv('week2', '要不要养一只猫', hoursAgo(30)),
  ];

  it('按更新时间倒序，每换一个分组插一个标签，末尾是总数', () => {
    const rows = buildArcRows(list, '', NOW);
    expect(rows.map((r) => (r.kind === 'item' ? r.conv.conversation_id : r.kind === 'tag' ? `#${r.label}` : r.text))).toEqual([
      '#今天',
      'today',
      '#本周',
      'week2',
      'week',
      '#更早',
      'old',
      '共 4 场',
    ]);
  });

  it('搜索只筛标题，分组跟着结果重算', () => {
    const rows = buildArcRows(list, '要不要', NOW);
    expect(rows.map((r) => (r.kind === 'item' ? r.conv.conversation_id : r.kind === 'tag' ? `#${r.label}` : r.text))).toEqual([
      '#本周',
      'week2',
      'week',
      '共 2 场',
    ]);
  });

  it('搜不到和一场都没有，末尾那行说的不一样', () => {
    expect(buildArcRows(list, '水逆', NOW)).toEqual([{ kind: 'note', key: 'note', text: '没有匹配的占卜' }]);
    expect(buildArcRows([], '', NOW)).toEqual([{ kind: 'note', key: 'note', text: '还没有占卜记录' }]);
  });
});
