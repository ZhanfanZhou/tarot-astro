// 商店目录。仅 `classic-rws` 为真实牌组；其余为占位，复用 classic-rws 缩略图
// 叠加各自 accent 的 duotone 滤镜，读作不同艺术风格，零新增图片资产。
// 将来上线真实牌组：把图片放入 public/tarot-images/decks/<id>/，把对应条目
// 的 state 改为 'available' 并设 liveDeckId 即可。

export type DeckState = 'available' | 'partial' | 'coming-soon';
// 注意：'owned' 不在此枚举内 —— 是否已拥有由 useDeckWallet 派生。

export interface StoreDeck {
  id: string;
  name: string;
  tagline: string;          // 一句诗意短语（陈列文案）
  artist: string;
  style: string;
  description: string;      // detail 视图的叙事文案
  price: number;            // 单位 ✦星尘（模拟货币）
  accent: string;           // hex；驱动该牌组的辉光 / duotone
  state: DeckState;
  completed?: number;       // 仅 partial：已绘制 N（满 78）
  previewCards: string[];   // 预览缩略图 url（.thumb.webp）
  liveDeckId?: string;      // 仅当 manifest 中存在真实牌组时设置
  featured?: boolean;       // Hero 精选位
}

const RWS = (id: string) => `/tarot-images/decks/classic-rws/major/${id}.thumb.webp`;
const PREVIEW_A = ['the-high-priestess', 'the-moon', 'the-star', 'the-sun', 'the-world'].map(RWS);
const PREVIEW_B = ['the-magician', 'the-empress', 'the-emperor', 'the-lovers', 'the-chariot'].map(RWS);
const PREVIEW_C = ['the-hermit', 'death', 'the-tower', 'temperance', 'the-devil'].map(RWS);

export const STORE_DECKS: StoreDeck[] = [
  {
    id: 'classic-rws',
    name: 'Rider–Waite–Smith',
    tagline: '一切塔罗的源头，百年传世的原型。',
    artist: 'Pamela Colman Smith',
    style: 'Classic · 经典原型',
    description:
      '由 Pamela Colman Smith 于 1909 年绘制，定义了现代塔罗的视觉语言。78 张完整牌面，象征体系清晰，是初学与精研皆宜的基石牌组。',
    price: 0,
    accent: '#C9A96E',
    state: 'available',
    previewCards: PREVIEW_A,
    liveDeckId: 'classic-rws',
    featured: true,
  },
  {
    id: 'lunar-mirage',
    name: 'Lunar Mirage',
    tagline: '月光浸染的幻象，冷蓝调的低语。',
    artist: 'Atelier Nocturne',
    style: 'Moonlit · 月光幻境',
    description:
      '以月光银蓝为主调的当代牌组，柔雾质感与星象线条交织，适合直觉式、情感向的解读。',
    price: 1280,
    accent: '#A8D8EA',
    state: 'available',
    previewCards: PREVIEW_B,
  },
  {
    id: 'gilded-ember',
    name: 'Gilded Ember',
    tagline: '余烬与鎏金，热烈而庄重。',
    artist: 'Studio Solis',
    style: 'Golden · 鎏金余烬',
    description:
      '暖金与琥珀色调，笔触如烛火摇曳。目前仍在绘制中，已完成部分大阿卡纳，抢先获取可在后续更新中持续解锁新牌面。',
    price: 980,
    accent: '#F4A261',
    state: 'partial',
    completed: 32,
    previewCards: PREVIEW_C,
  },
  {
    id: 'verdant-oracle',
    name: 'Verdant Oracle',
    tagline: '草木与苔藓的预言，尚未苏醒。',
    artist: '待定',
    style: 'Botanical · 草木神谕',
    description:
      '一套以植物与自然循环为母题的牌组，目前仍处于概念阶段。敬请期待它的苏醒。',
    price: 1180,
    accent: '#90BE6D',
    state: 'coming-soon',
    previewCards: [],
  },
];
