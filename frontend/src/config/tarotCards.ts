// 塔罗牌配置
// 78张塔罗牌的详细信息

export interface TarotCardInfo {
  id: number;
  name_en: string;
  name_zh: string;
  suit?: 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';
  number?: number;
  imageUrl: string;
}

// 大阿尔卡那（Major Arcana）0-21
export const MAJOR_ARCANA: TarotCardInfo[] = [
  { id: 0, name_en: 'The Fool', name_zh: '愚者', suit: 'major', number: 0, imageUrl: '/tarot-images/decks/classic-rws/major/the-fool.png' },
  { id: 1, name_en: 'The Magician', name_zh: '魔术师', suit: 'major', number: 1, imageUrl: '/tarot-images/decks/classic-rws/major/the-magician.png' },
  { id: 2, name_en: 'The High Priestess', name_zh: '女祭司', suit: 'major', number: 2, imageUrl: '/tarot-images/decks/classic-rws/major/the-high-priestess.png' },
  { id: 3, name_en: 'The Empress', name_zh: '皇后', suit: 'major', number: 3, imageUrl: '/tarot-images/decks/classic-rws/major/the-empress.png' },
  { id: 4, name_en: 'The Emperor', name_zh: '皇帝', suit: 'major', number: 4, imageUrl: '/tarot-images/decks/classic-rws/major/the-emperor.png' },
  { id: 5, name_en: 'The Hierophant', name_zh: '教皇', suit: 'major', number: 5, imageUrl: '/tarot-images/decks/classic-rws/major/the-hierophant.png' },
  { id: 6, name_en: 'The Lovers', name_zh: '恋人', suit: 'major', number: 6, imageUrl: '/tarot-images/decks/classic-rws/major/the-lovers.png' },
  { id: 7, name_en: 'The Chariot', name_zh: '战车', suit: 'major', number: 7, imageUrl: '/tarot-images/decks/classic-rws/major/the-chariot.png' },
  { id: 8, name_en: 'Strength', name_zh: '力量', suit: 'major', number: 8, imageUrl: '/tarot-images/decks/classic-rws/major/strength.png' },
  { id: 9, name_en: 'The Hermit', name_zh: '隐者', suit: 'major', number: 9, imageUrl: '/tarot-images/decks/classic-rws/major/the-hermit.png' },
  { id: 10, name_en: 'Wheel of Fortune', name_zh: '命运之轮', suit: 'major', number: 10, imageUrl: '/tarot-images/decks/classic-rws/major/wheel-of-fortune.png' },
  { id: 11, name_en: 'Justice', name_zh: '正义', suit: 'major', number: 11, imageUrl: '/tarot-images/decks/classic-rws/major/justice.png' },
  { id: 12, name_en: 'The Hanged Man', name_zh: '倒吊人', suit: 'major', number: 12, imageUrl: '/tarot-images/decks/classic-rws/major/the-hanged-man.png' },
  { id: 13, name_en: 'Death', name_zh: '死神', suit: 'major', number: 13, imageUrl: '/tarot-images/decks/classic-rws/major/death.png' },
  { id: 14, name_en: 'Temperance', name_zh: '节制', suit: 'major', number: 14, imageUrl: '/tarot-images/decks/classic-rws/major/temperance.png' },
  { id: 15, name_en: 'The Devil', name_zh: '恶魔', suit: 'major', number: 15, imageUrl: '/tarot-images/decks/classic-rws/major/the-devil.png' },
  { id: 16, name_en: 'The Tower', name_zh: '高塔', suit: 'major', number: 16, imageUrl: '/tarot-images/decks/classic-rws/major/the-tower.png' },
  { id: 17, name_en: 'The Star', name_zh: '星星', suit: 'major', number: 17, imageUrl: '/tarot-images/decks/classic-rws/major/the-star.png' },
  { id: 18, name_en: 'The Moon', name_zh: '月亮', suit: 'major', number: 18, imageUrl: '/tarot-images/decks/classic-rws/major/the-moon.png' },
  { id: 19, name_en: 'The Sun', name_zh: '太阳', suit: 'major', number: 19, imageUrl: '/tarot-images/decks/classic-rws/major/the-sun.png' },
  { id: 20, name_en: 'Judgement', name_zh: '审判', suit: 'major', number: 20, imageUrl: '/tarot-images/decks/classic-rws/major/judgement.png' },
  { id: 21, name_en: 'The World', name_zh: '世界', suit: 'major', number: 21, imageUrl: '/tarot-images/decks/classic-rws/major/the-world.png' },
];

// 权杖（Wands）22-35
export const WANDS: TarotCardInfo[] = [
  { id: 22, name_en: 'Ace of Wands', name_zh: '权杖王牌', suit: 'wands', number: 1, imageUrl: '/tarot-images/decks/classic-rws/wands/ace-of-wands.png' },
  { id: 23, name_en: 'Two of Wands', name_zh: '权杖二', suit: 'wands', number: 2, imageUrl: '/tarot-images/decks/classic-rws/wands/two-of-wands.png' },
  { id: 24, name_en: 'Three of Wands', name_zh: '权杖三', suit: 'wands', number: 3, imageUrl: '/tarot-images/decks/classic-rws/wands/three-of-wands.png' },
  { id: 25, name_en: 'Four of Wands', name_zh: '权杖四', suit: 'wands', number: 4, imageUrl: '/tarot-images/decks/classic-rws/wands/four-of-wands.png' },
  { id: 26, name_en: 'Five of Wands', name_zh: '权杖五', suit: 'wands', number: 5, imageUrl: '/tarot-images/decks/classic-rws/wands/five-of-wands.png' },
  { id: 27, name_en: 'Six of Wands', name_zh: '权杖六', suit: 'wands', number: 6, imageUrl: '/tarot-images/decks/classic-rws/wands/six-of-wands.png' },
  { id: 28, name_en: 'Seven of Wands', name_zh: '权杖七', suit: 'wands', number: 7, imageUrl: '/tarot-images/decks/classic-rws/wands/seven-of-wands.png' },
  { id: 29, name_en: 'Eight of Wands', name_zh: '权杖八', suit: 'wands', number: 8, imageUrl: '/tarot-images/decks/classic-rws/wands/eight-of-wands.png' },
  { id: 30, name_en: 'Nine of Wands', name_zh: '权杖九', suit: 'wands', number: 9, imageUrl: '/tarot-images/decks/classic-rws/wands/nine-of-wands.png' },
  { id: 31, name_en: 'Ten of Wands', name_zh: '权杖十', suit: 'wands', number: 10, imageUrl: '/tarot-images/decks/classic-rws/wands/ten-of-wands.png' },
  { id: 32, name_en: 'Page of Wands', name_zh: '权杖侍从', suit: 'wands', imageUrl: '/tarot-images/decks/classic-rws/wands/page-of-wands.png' },
  { id: 33, name_en: 'Knight of Wands', name_zh: '权杖骑士', suit: 'wands', imageUrl: '/tarot-images/decks/classic-rws/wands/knight-of-wands.png' },
  { id: 34, name_en: 'Queen of Wands', name_zh: '权杖王后', suit: 'wands', imageUrl: '/tarot-images/decks/classic-rws/wands/queen-of-wands.png' },
  { id: 35, name_en: 'King of Wands', name_zh: '权杖国王', suit: 'wands', imageUrl: '/tarot-images/decks/classic-rws/wands/king-of-wands.png' },
];

// 圣杯（Cups）36-49
export const CUPS: TarotCardInfo[] = [
  { id: 36, name_en: 'Ace of Cups', name_zh: '圣杯王牌', suit: 'cups', number: 1, imageUrl: '/tarot-images/decks/classic-rws/cups/ace-of-cups.png' },
  { id: 37, name_en: 'Two of Cups', name_zh: '圣杯二', suit: 'cups', number: 2, imageUrl: '/tarot-images/decks/classic-rws/cups/two-of-cups.png' },
  { id: 38, name_en: 'Three of Cups', name_zh: '圣杯三', suit: 'cups', number: 3, imageUrl: '/tarot-images/decks/classic-rws/cups/three-of-cups.png' },
  { id: 39, name_en: 'Four of Cups', name_zh: '圣杯四', suit: 'cups', number: 4, imageUrl: '/tarot-images/decks/classic-rws/cups/four-of-cups.png' },
  { id: 40, name_en: 'Five of Cups', name_zh: '圣杯五', suit: 'cups', number: 5, imageUrl: '/tarot-images/decks/classic-rws/cups/five-of-cups.png' },
  { id: 41, name_en: 'Six of Cups', name_zh: '圣杯六', suit: 'cups', number: 6, imageUrl: '/tarot-images/decks/classic-rws/cups/six-of-cups.png' },
  { id: 42, name_en: 'Seven of Cups', name_zh: '圣杯七', suit: 'cups', number: 7, imageUrl: '/tarot-images/decks/classic-rws/cups/seven-of-cups.png' },
  { id: 43, name_en: 'Eight of Cups', name_zh: '圣杯八', suit: 'cups', number: 8, imageUrl: '/tarot-images/decks/classic-rws/cups/eight-of-cups.png' },
  { id: 44, name_en: 'Nine of Cups', name_zh: '圣杯九', suit: 'cups', number: 9, imageUrl: '/tarot-images/decks/classic-rws/cups/nine-of-cups.png' },
  { id: 45, name_en: 'Ten of Cups', name_zh: '圣杯十', suit: 'cups', number: 10, imageUrl: '/tarot-images/decks/classic-rws/cups/ten-of-cups.png' },
  { id: 46, name_en: 'Page of Cups', name_zh: '圣杯侍从', suit: 'cups', imageUrl: '/tarot-images/decks/classic-rws/cups/page-of-cups.png' },
  { id: 47, name_en: 'Knight of Cups', name_zh: '圣杯骑士', suit: 'cups', imageUrl: '/tarot-images/decks/classic-rws/cups/knight-of-cups.png' },
  { id: 48, name_en: 'Queen of Cups', name_zh: '圣杯王后', suit: 'cups', imageUrl: '/tarot-images/decks/classic-rws/cups/queen-of-cups.png' },
  { id: 49, name_en: 'King of Cups', name_zh: '圣杯国王', suit: 'cups', imageUrl: '/tarot-images/decks/classic-rws/cups/king-of-cups.png' },
];

// 宝剑（Swords）50-63
export const SWORDS: TarotCardInfo[] = [
  { id: 50, name_en: 'Ace of Swords', name_zh: '宝剑王牌', suit: 'swords', number: 1, imageUrl: '/tarot-images/decks/classic-rws/swords/ace-of-swords.png' },
  { id: 51, name_en: 'Two of Swords', name_zh: '宝剑二', suit: 'swords', number: 2, imageUrl: '/tarot-images/decks/classic-rws/swords/two-of-swords.png' },
  { id: 52, name_en: 'Three of Swords', name_zh: '宝剑三', suit: 'swords', number: 3, imageUrl: '/tarot-images/decks/classic-rws/swords/three-of-swords.png' },
  { id: 53, name_en: 'Four of Swords', name_zh: '宝剑四', suit: 'swords', number: 4, imageUrl: '/tarot-images/decks/classic-rws/swords/four-of-swords.png' },
  { id: 54, name_en: 'Five of Swords', name_zh: '宝剑五', suit: 'swords', number: 5, imageUrl: '/tarot-images/decks/classic-rws/swords/five-of-swords.png' },
  { id: 55, name_en: 'Six of Swords', name_zh: '宝剑六', suit: 'swords', number: 6, imageUrl: '/tarot-images/decks/classic-rws/swords/six-of-swords.png' },
  { id: 56, name_en: 'Seven of Swords', name_zh: '宝剑七', suit: 'swords', number: 7, imageUrl: '/tarot-images/decks/classic-rws/swords/seven-of-swords.png' },
  { id: 57, name_en: 'Eight of Swords', name_zh: '宝剑八', suit: 'swords', number: 8, imageUrl: '/tarot-images/decks/classic-rws/swords/eight-of-swords.png' },
  { id: 58, name_en: 'Nine of Swords', name_zh: '宝剑九', suit: 'swords', number: 9, imageUrl: '/tarot-images/decks/classic-rws/swords/nine-of-swords.png' },
  { id: 59, name_en: 'Ten of Swords', name_zh: '宝剑十', suit: 'swords', number: 10, imageUrl: '/tarot-images/decks/classic-rws/swords/ten-of-swords.png' },
  { id: 60, name_en: 'Page of Swords', name_zh: '宝剑侍从', suit: 'swords', imageUrl: '/tarot-images/decks/classic-rws/swords/page-of-swords.png' },
  { id: 61, name_en: 'Knight of Swords', name_zh: '宝剑骑士', suit: 'swords', imageUrl: '/tarot-images/decks/classic-rws/swords/knight-of-swords.png' },
  { id: 62, name_en: 'Queen of Swords', name_zh: '宝剑王后', suit: 'swords', imageUrl: '/tarot-images/decks/classic-rws/swords/queen-of-swords.png' },
  { id: 63, name_en: 'King of Swords', name_zh: '宝剑国王', suit: 'swords', imageUrl: '/tarot-images/decks/classic-rws/swords/king-of-swords.png' },
];

// 星币（Pentacles）64-77
export const PENTACLES: TarotCardInfo[] = [
  { id: 64, name_en: 'Ace of Pentacles', name_zh: '星币王牌', suit: 'pentacles', number: 1, imageUrl: '/tarot-images/decks/classic-rws/pentacles/ace-of-pentacles.png' },
  { id: 65, name_en: 'Two of Pentacles', name_zh: '星币二', suit: 'pentacles', number: 2, imageUrl: '/tarot-images/decks/classic-rws/pentacles/two-of-pentacles.png' },
  { id: 66, name_en: 'Three of Pentacles', name_zh: '星币三', suit: 'pentacles', number: 3, imageUrl: '/tarot-images/decks/classic-rws/pentacles/three-of-pentacles.png' },
  { id: 67, name_en: 'Four of Pentacles', name_zh: '星币四', suit: 'pentacles', number: 4, imageUrl: '/tarot-images/decks/classic-rws/pentacles/four-of-pentacles.png' },
  { id: 68, name_en: 'Five of Pentacles', name_zh: '星币五', suit: 'pentacles', number: 5, imageUrl: '/tarot-images/decks/classic-rws/pentacles/five-of-pentacles.png' },
  { id: 69, name_en: 'Six of Pentacles', name_zh: '星币六', suit: 'pentacles', number: 6, imageUrl: '/tarot-images/decks/classic-rws/pentacles/six-of-pentacles.png' },
  { id: 70, name_en: 'Seven of Pentacles', name_zh: '星币七', suit: 'pentacles', number: 7, imageUrl: '/tarot-images/decks/classic-rws/pentacles/seven-of-pentacles.png' },
  { id: 71, name_en: 'Eight of Pentacles', name_zh: '星币八', suit: 'pentacles', number: 8, imageUrl: '/tarot-images/decks/classic-rws/pentacles/eight-of-pentacles.png' },
  { id: 72, name_en: 'Nine of Pentacles', name_zh: '星币九', suit: 'pentacles', number: 9, imageUrl: '/tarot-images/decks/classic-rws/pentacles/nine-of-pentacles.png' },
  { id: 73, name_en: 'Ten of Pentacles', name_zh: '星币十', suit: 'pentacles', number: 10, imageUrl: '/tarot-images/decks/classic-rws/pentacles/ten-of-pentacles.png' },
  { id: 74, name_en: 'Page of Pentacles', name_zh: '星币侍从', suit: 'pentacles', imageUrl: '/tarot-images/decks/classic-rws/pentacles/page-of-pentacles.png' },
  { id: 75, name_en: 'Knight of Pentacles', name_zh: '星币骑士', suit: 'pentacles', imageUrl: '/tarot-images/decks/classic-rws/pentacles/knight-of-pentacles.png' },
  { id: 76, name_en: 'Queen of Pentacles', name_zh: '星币王后', suit: 'pentacles', imageUrl: '/tarot-images/decks/classic-rws/pentacles/queen-of-pentacles.png' },
  { id: 77, name_en: 'King of Pentacles', name_zh: '星币国王', suit: 'pentacles', imageUrl: '/tarot-images/decks/classic-rws/pentacles/king-of-pentacles.png' },
];

// 所有78张牌
export const ALL_CARDS: TarotCardInfo[] = [
  ...MAJOR_ARCANA,
  ...WANDS,
  ...CUPS,
  ...SWORDS,
  ...PENTACLES,
];

// 根据ID获取卡牌信息
export const getCardInfo = (cardId: number): TarotCardInfo | undefined => {
  return ALL_CARDS.find(card => card.id === cardId);
};

// 卡背图片
export const CARD_BACK_IMAGE = '/tarot-images/card-back.png';

// 抽牌台面背景
export const TABLE_BACKGROUND_IMAGE = '/assets/table.png';

// 默认占位图片（当真实图片不存在时使用）
export const CARD_PLACEHOLDER_IMAGE = '/tarot-images/placeholder.jpg';

