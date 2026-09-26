import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  animate,
  cancelFrame,
  frame,
  motionValue,
  type AnimationPlaybackControls,
  type MotionValue,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
} from 'framer-motion';
import { X } from 'lucide-react';
import type { DrawCardsRequest, TarotCard } from '@/types';
import { getCardInfo, CARD_BACK_IMAGE, TABLE_BACKGROUND_IMAGE } from '@/config/tarotCards';
import { createShuffleRun, type ShuffleCardConfig, type ShuffleVariant } from './shufflePatterns';
import ArchPortrait from './ui/ArchPortrait';

interface TarotCardDrawerProps {
  isOpen: boolean;
  drawRequest: DrawCardsRequest;
  onClose: () => void;
  onCardsDrawn: (cards: TarotCard[]) => void;
  /** 弹层标题,默认「抽取塔罗牌」(日运场景定制) */
  title?: string;
  /** 标题上方的英文眉题,默认「The Draw」 */
  eyebrow?: string;
  /** 洗牌前副标题,默认「静心凝神，准备开启命运之门」 */
  subtitle?: string;
  /** 固定洗牌花式,只给本地预览页用;正常抽牌不传=随机 */
  shuffleVariant?: ShuffleVariant;
}

// 牌阵位置的序号：槽位里、选中那张牌头上都写它，一眼对上「这张落在哪个位置」
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// 扇形展示配置
const TOTAL_CARDS = 78;
const VISIBLE_CARDS = 22; // 扇形中同时显示的卡片数
const CARD_HALF_WIDTH = 48; // 卡片宽度约96px，记录一半用于水平居中
const CARD_HALF_HEIGHT = 72; // 卡片高 144px（w-24 h-36）
const FAN_RADIUS = 500;
const FAN_VERTICAL_SQUASH = 0.95; // 扇形压缩系数，控制整体高度
const FAN_BASE_Y_OFFSET = 180; // 扇形整体下移偏移量
// 扇形从舞台底部往上真正吃掉的高度：中间那张牌的位移 + 牌高 + 头顶序号徽标
// （= 500*0.95 - 180 + 144 + 32）。舞台矮于这个数，轮盘就会顶进上面的槽位里，
// 所以按舞台实测高度整体缩放，而不是把几何常量写死。
const FAN_DESIGN_HEIGHT = 471;
// 牌桌背景图 table.webp 的宽高比（1024×577）。弹层高 85vh、宽至少 80rem；窗口很高的屏幕（如 2K 显示器）
// 宽度按这个比例放开——只卡 80rem 的话弹层接近正方形，牌桌按 cover 铺满，两边被裁掉一大截
const TABLE_ASPECT = 1024 / 577;

const mod = (n: number, m: number) => ((n % m) + m) % m;
// 旋转量以「张」为单位，拖动时累加，可为负、可超过 78
const normalizeRotation = (rotation: number) => mod(rotation, TOTAL_CARDS);
/** 滑块 ✦ 在滑轨上的位置（%）：旋转量 0 时停在正中 */
const sliderPercentOf = (rotation: number) => ((normalizeRotation(rotation) / TOTAL_CARDS + 0.5) % 1) * 100;
const SLIDER_WIDTH = 210; // 滑轨宽（w-[210px]）
// 拖滑轨时 ✦ 最右停在这里：再往右（旋转量折回 39）✦ 就显示到最左端去了
const SLIDER_MAX_PERCENT = 100 * (1 - 0.51 / TOTAL_CARDS);
// 按在 ✦ 附近（px，滑轨设计尺寸）算抓住 ✦，不让它先跳到手指正下方
const SLIDER_GRAB_RADIUS = 16;

const HALF_VISIBLE = Math.floor(VISIBLE_CARDS / 2);
/** 扇形上第 relativePos 个位置（0 = 正中，负 = 左）上一张牌的姿态 */
const slotPose = (relativePos: number, isSelected: boolean) => {
  const angleSpan = 110;
  const angle = (relativePos / HALF_VISIBLE) * (angleSpan / 2);
  const radius = FAN_RADIUS;

  const distanceFromCenter = Math.abs(relativePos);
  const opacity = 1 - (distanceFromCenter / HALF_VISIBLE) * 0.3;
  const scale = 1 - (distanceFromCenter / HALF_VISIBLE) * 0.1;

  const angleRad = (angle * Math.PI) / 180;
  const rawX = Math.sin(angleRad) * radius;
  const yPosition = -Math.cos(angleRad) * radius * FAN_VERTICAL_SQUASH + FAN_BASE_Y_OFFSET;

  return {
    x: rawX - CARD_HALF_WIDTH,
    y: yPosition + (isSelected ? -30 : 0),
    rotate: angle,
    opacity: isSelected ? 1 : opacity,
    scale: isSelected ? 1.15 : scale,
  };
};
// 扇形展开那一下，所有牌从正中扇出去
const SPREAD_FROM = { x: -CARD_HALF_WIDTH, y: 0, rotate: 0, opacity: 0, scale: 0.5 };

// 扇形上一直挂着 POOL_SIZE 个牌位（正中左右各 HALF_VISIBLE 张）。转动时不增删节点：
// 一张牌从一头转出去，这个牌位就绕到另一头接下一张（同手机列表复用格子）
const POOL_SIZE = 2 * HALF_VISIBLE + 1;
/** 正中是第 center 张时，牌位 slot 上是第几张（两者都不折回 0~77） */
const slotCardOf = (slot: number, center: number) =>
  center - HALF_VISIBLE + mod(slot - (center - HALF_VISIBLE), POOL_SIZE);
// 转动时，离正中超过 HALF_VISIBLE 的那半张距离里淡出：离场的牌在一侧淡出，牌位绕到另一头的那一下看不见。
// 停稳时旋转量是整数，最外面那张正好在 HALF_VISIBLE 上，不受影响
const edgeFade = (relativePos: number) =>
  Math.min(1, Math.max(0, (HALF_VISIBLE + 0.5 - Math.abs(relativePos)) * 2));
// 牌位换上的新牌离正中至少这么多张，才算「从一侧补进来」：从自己那个位置的正下方升上来、序号随后弹出。
// 正常转动一帧最多过一两张，新牌都落在最外面这两格；拖滑轨一下跳过好多张时，落在里面的牌直接换，不做动画
const ENTER_FROM_EDGE = HALF_VISIBLE - 1;
// 补牌升起最多铺到扇形上 40% 的牌（在 lab 里比过不限 / 50% / 40% / 30% / 20%）
const RISE_ZONE = 0.4 * POOL_SIZE;
// 补进来的牌，序号过这么多秒弹出（原先 0.5 秒）
const BADGE_DELAY = 0.35;
/**
 * 补进来的牌此刻至少要升到几成（0~1）：从入场那一侧的最外沿（离正中 HALF_VISIBLE + 0.5 张）往里走，
 * 走过 RISE_ZONE 张时必须完全到位。按「从入场那一侧走了多远」算，不按离正中多远——转得很快时一张新牌不到 0.3 秒
 * 就能穿过正中到另一侧，按离正中的距离算会在另一侧又沉下去。转得快时弹簧来不及升完，没升完的牌只会出现在
 * 入场一侧这 RISE_ZONE 张里，不会铺满整个扇形；转得慢时弹簧早就升完了，不受影响
 */
const riseFloor = (relativePos: number, entrySide: number) =>
  Math.min(1, Math.max(0, (HALF_VISIBLE + 0.5 - entrySide * relativePos) / RISE_ZONE));

// 牌底下一道扇形的暖光：和扇形同心（圆心是牌底边那圈椭圆的圆心，在牌位下方 FAN_BASE_Y_OFFSET），
// 贴着牌的底边最亮，往扇形里面渐暗，两头按扇形的张角收掉。它不跟着转——转牌时每张牌各自一层，
// 它不用重画；不用 blur 滤镜，渐变本身就是软的。最亮处的不透明度 0.21 是原先那团圆光（0.14 × 0.75）的两倍
const FAN_GLOW_RX = FAN_RADIUS;
const FAN_GLOW_RY = FAN_RADIUS * FAN_VERTICAL_SQUASH;
const FAN_GLOW_STOPS: [number, number][] = [
  [55, 0], [70, 0.03], [82, 0.08], [92, 0.15], [99, 0.21], [106, 0.12], [115, 0.03], [122, 0],
];
// 从正左边起算的角度：扇形两头的牌在 34° 和 146° 附近
const FAN_GLOW_MASK = 'conic-gradient(from -90deg at 50% 100%, transparent 25deg, #000 50deg, #000 130deg, transparent 155deg)';
const FAN_GLOW_STYLE: React.CSSProperties = {
  left: '50%',
  bottom: -FAN_BASE_Y_OFFSET,
  width: FAN_GLOW_RX * 2.5,
  marginLeft: -FAN_GLOW_RX * 1.25,
  height: FAN_GLOW_RY * 1.25,
  backgroundImage: `radial-gradient(ellipse ${FAN_GLOW_RX}px ${FAN_GLOW_RY}px at 50% 100%, ${FAN_GLOW_STOPS.map(
    ([at, alpha]) => `rgba(255,214,150,${alpha}) ${at}%`
  ).join(', ')})`,
  maskImage: FAN_GLOW_MASK,
  WebkitMaskImage: FAN_GLOW_MASK,
};

// ── 拖动：和刷手机里的列表一样 ────────────────────────────────────────────────
// 手指按着时牌跟着手指走，手指停牌就停；松手后按手指离开屏幕时的速度接着转、慢慢减速，
// 停在某一张上；转着的时候一按就停。
// 正中附近相邻两张牌「牌面中心」的水平距离（设计尺寸，屏幕上再乘扇形缩放）：手指挪这么多，扇形转一张，
// 按住的那张牌一直在手指底下。牌绕底边中点转，牌面中心比底边中点多走一截，所以不能只算底边的距离
const cardFaceCenterX = (relativePos: number) => {
  const { x, rotate, scale } = slotPose(relativePos, false);
  return x + CARD_HALF_WIDTH + CARD_HALF_HEIGHT * scale * Math.sin((rotate * Math.PI) / 180);
};
const CARD_PITCH = cardFaceCenterX(1) - cardFaceCenterX(0);
// 松手后惯性的最高转速（张/秒）：再快就看不清一张张牌经过了
const MAX_SPEED = 20;
// 松手后的惯性：按这个时间常数（秒）减速。同时用作 power，起步速度正好等于离手速度，
// 转出去的总张数 = 离手速度 × FLING_TIME
const FLING_TIME = 0.6;
// 手指挪过 DRAG_SLOP 才带着扇形转（点牌时手抖不带动扇形，同原先 framer 的 3px）；
// 挪过 CLICK_SLOP 这一下就不算点牌——牌跟着手指走，松手时指针底下还是按下的那张，不拦的话拖一下就选中它
const DRAG_SLOP = 3;
const CLICK_SLOP = 8;
// 离手速度：从离手那一点往回，取最后 VELOCITY_WINDOW 毫秒里的平均速度（同原先 framer 的 0.1 秒）
const VELOCITY_WINDOW = 100;
// 同原先 framer 给 drag 元素加的：拖动时不选中文字、iOS 长按不弹菜单
const GESTURE_STYLE: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  touchAction: 'pan-y',
};

type PointerSample = { t: number; x: number };
/**
 * 离手速度（px/秒）。时间用事件自己的时间戳，离手那一点也算进去；
 * 参照点取窗口外最近的一个采样（手指停了一会儿再抬起，速度就是 0 附近），窗口内没有更早的就取按下那一点
 */
const releaseVelocity = (samples: PointerSample[]) => {
  const last = samples[samples.length - 1];
  let ref = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    ref = samples[i];
    if (last.t - ref.t > VELOCITY_WINDOW) break;
  }
  const dt = last.t - ref.t;
  return dt > 0 ? ((last.x - ref.x) / dt) * 1000 : 0;
};

// 展开和选中抬起用的弹簧，同原先每个属性各自的弹簧
const CARD_SPRING = { type: 'spring', stiffness: 150, damping: 20, restDelta: 0.0005 } as const;

/**
 * 扇形上的一个牌位。位置、角度、大小、透明度、层级都不从 React 来：FanCards 按旋转量直接写到这个节点的
 * style 上（见 layout）。React 只管牌位上此刻是哪张牌——序号徽标、选中的样子、点了选谁。
 */
const FanSlot = React.memo(
  React.forwardRef<
    HTMLDivElement,
    {
      cardId: number;
      /** 这个牌位从一侧补进一张新牌时变一次：序号徽标重新挂上，0.5 秒后弹出来 */
      badgeKey: number;
      isSelected: boolean;
      selectionOrder: number;
      onCardClick: (index: number) => void;
    }
  >(({ cardId, badgeKey, isSelected, selectionOrder, onCardClick }, ref) => (
    <div
      ref={ref}
      className="absolute left-1/2 bottom-0 cursor-pointer pointer-events-auto group-data-[moving]/fan:will-change-transform"
      style={{ transformOrigin: 'bottom center' }}
      onClick={() => onCardClick(cardId)}
    >
      <motion.div
        whileHover={{
          scale: 1.15,
          y: -20,
          transition: { type: 'spring', stiffness: 300 },
        }}
        className="relative"
      >
        <motion.div
          key={badgeKey}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: BADGE_DELAY }}
          className={`
            absolute -top-8 left-1/2 -translate-x-1/2 z-20
            w-8 h-8 rounded-full flex items-center justify-center
            font-display text-[11px] tracking-[0.04em]
            ${isSelected
              ? 'bg-gold-gradient text-dark-bg font-semibold shadow-[0_0_14px_rgba(201,169,110,0.65)]'
              : 'bg-[#06060f]/85 text-[color:var(--ivory-dim)] border border-mystic-gold/35 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'}
          `}
        >
          {selectionOrder >= 0 ? ROMAN[selectionOrder] ?? selectionOrder + 1 : cardId + 1}
        </motion.div>

        <motion.div
          className={`
            w-24 h-36 rounded-lg shadow-2xl overflow-hidden
            transition-all duration-300
            ${
              isSelected
                ? 'ring-2 ring-mystic-gold-light'
                : 'ring-1 ring-mystic-gold/30 hover:ring-mystic-gold/70'
            }
          `}
        >
          <img
            src={CARD_BACK_IMAGE}
            alt={`塔罗牌 ${cardId + 1}`}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </motion.div>

        {/* 选中后呼吸的金光：两层固定的光晕交替淡入淡出（index.css 的 fan-glow-*），只动透明度，由 GPU 合成。
            原先是逐帧改 box-shadow，选中一张牌后哪怕什么都不动，这一片每帧都要重画 */}
        {isSelected && (
          <div aria-hidden className="absolute inset-0 pointer-events-none">
            <div className="fan-glow-dim absolute inset-0 rounded-lg" style={{ boxShadow: '0 0 18px rgba(201, 169, 110, 0.5)' }} />
            <div className="fan-glow-bright absolute inset-0 rounded-lg" style={{ boxShadow: '0 0 34px rgba(240, 208, 144, 0.85)' }} />
          </div>
        )}
      </motion.div>
    </div>
  ))
);

/**
 * 扇形里的牌：POOL_SIZE 个牌位一直挂着，每帧按旋转量直接改它们的 style，拖动、惯性都不走 React。
 * React 只在正中那张换了时重渲染一次：有两个牌位换了牌（序号、选中的样子），其余不动。
 * 从一侧补进来的牌从自己那个位置的正下方升上来（每个牌位一个 0→1 的 enter 进度，同原先每张新牌挂上时的进场），
 * 序号随后弹出（徽标重新挂上）；离场的牌在另一侧淡出（edgeFade）。
 * 姿态全是旋转量的连续函数，所以牌就在手指底下、没有延迟。层级按离正中第几张排（整数），
 * 只在正中换人时变——两张牌对称地落在正中两侧时交换，和按连续距离排的顺序一样，但不用每帧改 23 张。
 * （原先每张牌 6 个派生 motion value、层级每帧全改一遍，换一张牌就挂上一张新牌、卸掉一张旧牌；
 * 外层还是 React state 时，拖动每帧整个抽牌器重渲染好几遍。）
 */
const FanCards: React.FC<{
  rotation: MotionValue<number>;
  selectedIndices: number[];
  onCardClick: (index: number) => void;
}> = ({ rotation, selectedIndices, onCardClick }) => {
  const [center, setCenter] = useState(() => Math.round(rotation.get()));
  useMotionValueEvent(rotation, 'change', (v) => setCenter(Math.round(v)));

  const slotEls = useRef<(HTMLDivElement | null)[]>([]);
  const slotRefs = useMemo(
    () =>
      Array.from({ length: POOL_SIZE }, (_, slot) => (el: HTMLDivElement | null) => {
        slotEls.current[slot] = el;
      }),
    []
  );
  const selectedRef = useRef(selectedIndices);
  selectedRef.current = selectedIndices;
  // 扇形展开：所有牌从正中扇出去（0→1）
  const spread = useMotionValue(0);
  // 从一侧补进来：每个牌位一个 0→1 的进度；lastCards 记每个牌位上次摆的是第几张（不折回）
  const enters = useMemo(() => Array.from({ length: POOL_SIZE }, () => motionValue(1)), []);
  const lastCards = useRef<(number | null)[]>(Array(POOL_SIZE).fill(null));
  // 补进来的牌从哪一侧进来（+1 右、-1 左），以及按走过的距离至少已经升到几成（只升不降，见 riseFloor）
  const entrySides = useRef<number[]>(Array(POOL_SIZE).fill(1));
  const riseMins = useRef<number[]>(Array(POOL_SIZE).fill(1));
  // 序号徽标：牌位从一侧补进新牌时换 key，徽标重新挂上、重新弹出（渲染时按 center 判定）
  const badgeKeys = useRef<number[]>(Array(POOL_SIZE).fill(0));
  const renderedCards = useRef<(number | null)[]>(Array(POOL_SIZE).fill(null));
  // 选中抬起：每张选过的牌一个 0→1 的进度，和它要去的那一头
  const lifts = useRef(new Map<number, { value: MotionValue<number>; target: number }>());
  const zIndexes = useRef<number[]>([]);

  // 按此刻的旋转量、展开进度、抬起进度摆好每个牌位
  const layout = useRef(() => {
    const r = rotation.get();
    const c = Math.round(r);
    const e = spread.get();
    for (let slot = 0; slot < POOL_SIZE; slot++) {
      const el = slotEls.current[slot];
      if (!el) continue;
      const u = slotCardOf(slot, c);
      const enter = enters[slot];
      const prev = lastCards.current[slot];
      if (prev !== u) {
        lastCards.current[slot] = u;
        if (prev !== null && Math.abs(u - c) >= ENTER_FROM_EDGE) {
          entrySides.current[slot] = Math.sign(u - c);
          riseMins.current[slot] = 0;
          enter.jump(0);
          animate(enter, 1, CARD_SPRING);
        } else {
          riseMins.current[slot] = 1;
          if (enter.get() !== 1) enter.jump(1);
        }
      }
      const cardId = mod(u, TOTAL_CARDS);
      const p = u - r;
      const l = lifts.current.get(cardId)?.value.get() ?? 0;
      // 扇形上的位置 → 按 lift 抬起 → 按 spread 从正中扇出来、按 enter 从正下方升上来（横坐标不动）
      const rest = slotPose(p, false);
      const up = slotPose(p, true);
      const y = rest.y + (up.y - rest.y) * l;
      const opacity = rest.opacity + (up.opacity - rest.opacity) * l;
      const scale = rest.scale + (up.scale - rest.scale) * l;
      const X = SPREAD_FROM.x + (rest.x - SPREAD_FROM.x) * e;
      let rise = enter.get();
      if (rise < 1) {
        const floor = riseFloor(p, entrySides.current[slot]);
        riseMins.current[slot] = Math.max(riseMins.current[slot], floor);
        rise = Math.max(rise, riseMins.current[slot]);
      }
      const f = e * rise;
      const Y = SPREAD_FROM.y + (y - SPREAD_FROM.y) * f;
      const R = SPREAD_FROM.rotate + (rest.rotate - SPREAD_FROM.rotate) * f;
      const O = SPREAD_FROM.opacity + (opacity - SPREAD_FROM.opacity) * f;
      const S = SPREAD_FROM.scale + (scale - SPREAD_FROM.scale) * f;
      el.style.transform = `translateX(${X}px) translateY(${Y}px) scale(${S}) rotate(${R}deg)`;
      el.style.opacity = String(O * edgeFade(p));
      const z = selectedRef.current.includes(cardId) ? 100 : 50 - Math.abs(u - c);
      if (zIndexes.current[slot] !== z) {
        el.style.zIndex = String(z);
        zIndexes.current[slot] = z;
      }
    }
  }).current;

  // 每次渲染后按此刻的旋转量摆一遍（首帧、正中换人、选中变化），在绘制之前
  useLayoutEffect(() => {
    layout();
  });

  // 旋转量、展开进度、补进来的进度一变，就在这一帧的渲染阶段重摆（同一帧里变多次也只摆一次）
  useEffect(() => {
    const schedule = () => frame.render(layout);
    const unsubscribe = [rotation, spread, ...enters].map((value) => value.on('change', schedule));
    const controls = animate(spread, 1, CARD_SPRING);
    return () => {
      unsubscribe.forEach((off) => off());
      controls.stop();
      cancelFrame(layout);
      lifts.current.forEach(({ value }) => value.destroy());
      lifts.current.clear();
      enters.forEach((value) => value.stop());
    };
  }, []);

  // 选中的抬起、取消的放下；只在一张牌要去的那一头变了时才起弹簧
  useEffect(() => {
    const ids = new Set([...selectedIndices, ...lifts.current.keys()]);
    ids.forEach((cardId) => {
      const target = selectedIndices.includes(cardId) ? 1 : 0;
      let lift = lifts.current.get(cardId);
      if (!lift) {
        const value = motionValue(0);
        value.on('change', () => frame.render(layout));
        lift = { value, target: 0 };
        lifts.current.set(cardId, lift);
      }
      if (lift.target !== target) {
        lift.target = target;
        animate(lift.value, target, CARD_SPRING);
      }
    });
  }, [selectedIndices]);

  return (
    <>
      {slotRefs.map((ref, slot) => {
        const u = slotCardOf(slot, center);
        const prev = renderedCards.current[slot];
        if (prev !== u) {
          renderedCards.current[slot] = u;
          if (prev !== null && Math.abs(u - center) >= ENTER_FROM_EDGE) badgeKeys.current[slot] += 1;
        }
        const cardId = mod(u, TOTAL_CARDS);
        return (
          <FanSlot
            key={slot}
            ref={ref}
            cardId={cardId}
            badgeKey={badgeKeys.current[slot]}
            isSelected={selectedIndices.includes(cardId)}
            selectionOrder={selectedIndices.indexOf(cardId)}
            onCardClick={onCardClick}
          />
        );
      })}
    </>
  );
};

const TarotCardDrawer: React.FC<TarotCardDrawerProps> = ({
  isOpen,
  drawRequest,
  onClose,
  onCardsDrawn,
  title = '抽取塔罗牌',
  eyebrow = 'The Draw',
  subtitle = '静心凝神，准备开启命运之门',
  shuffleVariant,
}) => {
  const [isShuffling, setIsShuffling] = useState(false);
  const [isSpread, setIsSpread] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  // 旋转偏移量（张）。放在 motion value 里而不是 state：拖动时每帧都在变，
  // 只有扇形里的牌（换到下一张时）和滑块（弹簧直接跟着走）需要知道，外层不重渲染
  const rotation = useMotionValue(0);
  const flingRef = useRef<AnimationPlaybackControls | null>(null); // 松手后的惯性
  const gestureRef = useRef<{ cleanup: () => void } | null>(null); // 正在进行的这一次按下
  // 这一按不算点牌：按下时牌正在转（这一按是为了停住），或者拖过了 CLICK_SLOP
  const swallowClickRef = useRef(false);
  const fanRef = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  // 滑块：同原先 animate left 的弹簧（stiffness 200 / damping 24）。
  // 用 translateX 定位——原先改 left，拖动时每帧都要重新布局
  const sliderTarget = useTransform(rotation, sliderPercentOf);
  const sliderSpring = useSpring(sliderTarget, { stiffness: 200, damping: 24 });
  // ✦ 显示的位置：平时跟着弹簧；拖滑轨时直接放在手指下，不经过弹簧。
  // （拖动时若把弹簧逐个事件 jump 到手指处：framer 按「相邻两次更新的差 ÷ 时间差」算弹簧速度，
  // 它默认一帧只更新一次，而手指事件一帧好几个、间隔不到 1ms，算出的速度大到把 ✦ 甩出去几千万 px）
  const thumbPercent = useMotionValue(sliderSpring.get());
  const scrubbingRef = useRef(false);
  useMotionValueEvent(sliderSpring, 'change', (p) => {
    if (!scrubbingRef.current) thumbPercent.set(p);
  });
  const sliderX = useTransform(thumbPercent, (p) => (p / 100) * SLIDER_WIDTH);
  const [shuffleConfig, setShuffleConfig] = useState<ShuffleCardConfig[]>([]);
  const [shuffleRunId, setShuffleRunId] = useState(0);
  const shuffleTimeoutRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageHeight, setStageHeight] = useState(0);

  // 牌阵位置即槽位，个数即抽牌张数（唯一真源，见 DrawCardsRequest）
  const positions = drawRequest?.positions ?? [];
  const cardCount = positions.length;
  // 张数多时换小槽位：10 张 w-20 会在 max-w-5xl 里换行，两行槽位再次撞上轮盘
  const isCompactSlots = cardCount > 6;
  const fanScale = stageHeight
    ? Math.min(1, Math.max(0.5, stageHeight / FAN_DESIGN_HEIGHT))
    : 1;

  // 打开即洗牌:调用方那一下「抽牌」就是开始洗牌的动作,不再多一颗按钮。
  // startShuffle 自己会把上一轮的选牌/扇形/计时器全部清掉。
  useEffect(() => {
    if (!isOpen) return;
    finishedRef.current = false;
    startShuffle();
  }, [isOpen]);

  // 打开期间给 <html> 挂 data-drawer-open，底下页面的装饰动画停在原地（规则在 index.css）
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    root.dataset.drawerOpen = '';
    return () => {
      delete root.dataset.drawerOpen;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (shuffleTimeoutRef.current) {
        window.clearTimeout(shuffleTimeoutRef.current);
      }
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
      }
      flingRef.current?.stop();
      gestureRef.current?.cleanup();
    };
  }, []);

  // 舞台高度随窗口大小、槽位行的出现/换行而变 —— 实测而非猜测
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, isSpread]);

  const startShuffle = () => {
    const run = createShuffleRun(shuffleVariant);

    setShuffleConfig(run.cards);
    setShuffleRunId((prev) => prev + 1);
    setIsShuffling(true);
    setIsSpread(false);
    setSelectedIndices([]);
    setShowConfirm(false);
    stopFling();
    rotation.set(0);

    if (shuffleTimeoutRef.current) {
      window.clearTimeout(shuffleTimeoutRef.current);
    }

    // 最后一张牌落定 + 一点收尾停顿,然后展扇形
    shuffleTimeoutRef.current = window.setTimeout(() => {
      setIsShuffling(false);
      setIsSpread(true);
    }, (run.settleAt + 0.35) * 1000);
  };

  // 转动期间给每张牌单独一层（will-change: transform）：牌移动时只做合成，不用每帧重画整个扇形
  // （牌的阴影、底下的光晕）。一按下就挂上，第一下拖动时层已经备好；停下、弹簧落定后撤掉——
  // 常驻的话，放大的牌（选中时 1.15 倍）会按放大前的尺寸栅格化，看着发虚。
  const setMoving = (moving: boolean) => {
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const el = fanRef.current;
    if (!el) return;
    if (moving) {
      el.dataset.moving = '';
    } else {
      settleTimerRef.current = window.setTimeout(() => {
        delete el.dataset.moving;
      }, 800);
    }
  };

  const stopFling = () => {
    flingRef.current?.stop();
    flingRef.current = null;
  };

  // 松手：按离手速度（张/秒）接着转，慢慢减速，停在整张上；速度为 0 就近停到整张
  const settle = (releaseSpeed: number) => {
    const velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, releaseSpeed));
    const from = rotation.get();
    // 终点只是告诉 framer「要动」：起点终点相同时它直接判定无需动画（inertia 也一样）。
    // 真正停在哪由 inertia 按速度自己算，再经 modifyTarget 落到整张
    const to = Math.round(from + velocity * FLING_TIME);
    if (to === from) {
      setMoving(false);
      return;
    }
    flingRef.current = animate(rotation, to, {
      type: 'inertia',
      velocity,
      power: FLING_TIME,
      timeConstant: FLING_TIME * 1000,
      modifyTarget: Math.round,
      restDelta: 0.05, // 离终点 0.05 张就算停（滑块差不到 0.1px），指数减速的长尾不再拖几秒
      onComplete: () => {
        flingRef.current = null;
        setMoving(false);
      },
    });
  };

  // 按下扇形。正在转就停住，这一按不算点牌（同手机列表：滑动中点一下是停，不是点开）。之后手指每挪一下，
  // 就按「从按下那一点起挪了多少」直接改旋转量（1:1）；松手按离手速度接着转。
  // 手势直接接 pointer 事件，不用 framer 的 drag：framer 只在动画帧里取样、按帧时间戳算速度，按下那一刻
  // 记的是它上一次跑动画那帧的时间——扇形停了几秒就是几秒前——快速短拨的速度被算成接近 0，松手没有惯性；
  // 离手那一点也不算进去。它的 drag 容器还会跟着手指平移（dragElastic），带着整片扇形和光晕每帧重画
  const beginGesture = (e: React.PointerEvent<HTMLElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    gestureRef.current?.cleanup();
    swallowClickRef.current = Math.abs(rotation.getVelocity()) > 1;
    stopFling();
    setMoving(true);

    const el = e.currentTarget;
    const { pointerId } = e;
    const startX = e.clientX;
    const anchor = rotation.get();
    const pxPerCard = CARD_PITCH * fanScale; // 手指挪多少 px 转一张
    const samples: PointerSample[] = [{ t: e.timeStamp, x: startX }];
    let dragging = false;
    const follow = (x: number) => rotation.set(anchor - (x - startX) / pxPerCard); // 手指往右，牌往右走

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const points = ev.getCoalescedEvents?.() ?? [];
      for (const pt of points.length ? points : [ev]) samples.push({ t: pt.timeStamp, x: pt.clientX });
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_SLOP) return;
        dragging = true;
        el.dataset.dragging = '';
      }
      if (Math.abs(dx) > CLICK_SLOP) swallowClickRef.current = true;
      follow(ev.clientX);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      let speed = 0;
      if (dragging && ev.type === 'pointerup') {
        samples.push({ t: ev.timeStamp, x: ev.clientX });
        follow(ev.clientX);
        speed = -releaseVelocity(samples) / pxPerCard;
      }
      settle(speed);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      delete el.dataset.dragging;
      gestureRef.current = null;
    };
    gestureRef.current = { cleanup };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  // 按下滑轨：✦ 跟着手指走（按在 ✦ 上就抓住它，按在滑轨别处 ✦ 先跳到手指下），整条滑轨是一整圈 78 张，
  // 扇形跟着转——手指挪 2.7px 转一张，用来快速翻到牌堆的另一段。拖动时 ✦ 不走弹簧，就在手指底下；
  // 拖到两端就停在端点。松手不带惯性，就近停到整张
  const beginScrub = (e: React.PointerEvent<HTMLElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation(); // 滑轨在扇形的手势区里，按在滑轨上不再算扇形那一份
    gestureRef.current?.cleanup();
    stopFling();
    setMoving(true);

    const el = e.currentTarget;
    const { pointerId } = e;
    const rect = el.getBoundingClientRect(); // 含扇形缩放、悬停放大
    const pxPerDesignPx = rect.width / SLIDER_WIDTH;
    const r0 = rotation.get();
    const p0 = sliderPercentOf(r0);
    const thumbX = rect.left + (thumbPercent.get() / 100) * rect.width;
    const grab = Math.abs(e.clientX - thumbX) <= SLIDER_GRAB_RADIUS * pxPerDesignPx ? e.clientX - thumbX : 0;
    const scrubTo = (x: number) => {
      const p = Math.min(SLIDER_MAX_PERCENT, Math.max(0, ((x - grab - rect.left) / rect.width) * 100));
      rotation.set(r0 + ((p - p0) / 100) * TOTAL_CARDS);
      thumbPercent.set(p);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) scrubTo(ev.clientX);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      settle(0);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      delete el.dataset.active;
      // 松手：弹簧从 ✦ 此刻的位置接上（一次 jump，速度从 0 起），之后 ✦ 重新跟着弹簧走
      sliderSpring.jump(thumbPercent.get());
      scrubbingRef.current = false;
      gestureRef.current = null;
    };
    scrubbingRef.current = true;
    el.dataset.active = '';
    scrubTo(e.clientX);
    gestureRef.current = { cleanup };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const handleCardClick = (index: number) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
    if (!isSpread || isShuffling) return;

    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter((i) => i !== index));
      setShowConfirm(false);
    } else if (cardCount === 1) {
      // 单张:点哪张就换成哪张,不用先取消;和多张一样,点「确认抽牌」才收场
      setSelectedIndices([index]);
      setShowConfirm(true);
    } else if (selectedIndices.length < cardCount) {
      const newSelected = [...selectedIndices, index];
      setSelectedIndices(newSelected);
      if (newSelected.length === cardCount) {
        setShowConfirm(true);
      }
    }
  };

  const finishSelection = (indices: number[]) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // 模拟抽牌结果(仪式用;线上真实牌面由服务端决定)
    const drawnCards: TarotCard[] = indices.map((idx) => {
      const cardInfo = getCardInfo(idx);
      return {
        card_id: idx,
        card_name: cardInfo?.name_zh || `塔罗牌 ${idx}`,
        reversed: Math.random() < 0.3,
      };
    });

    // 选完就收场:揭牌是抽牌之后的另一幕,由调用方在对话界面上演(CardRevealOverlay)
    onCardsDrawn(drawnCards);
    onClose();
  };

  const handleConfirm = () => finishSelection(selectedIndices);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // touch-none：弹层上的手势全交给选牌器，页面不跟着拖动、缩放
          className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-6 bg-black/95 isolate touch-none"
          // 每一次按下先清掉上一次的「不算点击」，按在扇形 / 滑轨上时 beginGesture 再按这一次的情况重设
          onPointerDownCapture={() => {
            swallowClickRef.current = false;
          }}
          onClick={(e) => {
            // 拖着牌松手在弹层外面：浏览器把 click 发给按下和松手两处的共同祖先，也就是这一层，不算点外面关闭
            if (e.target === e.currentTarget && !isShuffling && !swallowClickRef.current) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative w-full h-[85vh] rounded-[28px] overflow-hidden flex flex-col"
            style={{
              maxWidth: `max(80rem, calc(85vh * ${TABLE_ASPECT}))`,
              background: 'var(--void)',
              border: '1px solid rgba(201,169,110,0.24)',
              boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
            }}
          >
            {/* 牌桌：铺满整个弹层，压暗后四周往底色收（同殿堂拱窗的暗角），z-0 垫底 */}
            <div className="absolute inset-0 z-0 pointer-events-none">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${TABLE_BACKGROUND_IMAGE})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'brightness(0.88)',
                }}
              />
              <div className="absolute inset-0 bg-[#06060f]/78" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,228,185,0.18),transparent_78%)] mix-blend-screen" />
              <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(ellipse 85% 80% at 50% 58%, transparent 52%, rgba(6,6,15,0.82) 100%)' }}
              />
              <div className="absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-[#06060f]/75 to-transparent" />
              {/* 离外沿 10px 再描一圈淡金发丝，像画框里的衬边 */}
              <div className="absolute inset-2.5 rounded-[20px]" style={{ border: '1px solid var(--line)' }} />
            </div>

            {/* 头部：拱窗小立绘 + 眉题 / 标题 / 进度，居中；关闭在右上 */}
            <div className="relative z-20 shrink-0 px-6 pt-6 pb-3 flex justify-center">
              <div className="flex items-center gap-4">
                <ArchPortrait src="/assets/avatar-tarot.webp" className="w-10 h-[50px]" />
                <div className="min-w-0">
                  <div className="eyebrow" style={{ fontSize: '9px', letterSpacing: '0.34em', color: 'var(--gold)' }}>
                    {eyebrow}
                  </div>
                  <h2 className="mt-1 font-display font-semibold text-[22px] sm:text-2xl tracking-[0.2em] leading-tight mystic-text">
                    {title}
                  </h2>
                  <p className="mt-1.5 text-[12px] sm:text-[13px] tracking-[0.14em] font-display" style={{ color: 'var(--ivory-dim)' }}>
                    {isSpread ? (
                      <>
                        {selectedIndices.length < cardCount ? `凭直觉选出 ${cardCount} 张牌` : '牌已选定'}
                        <span className="ml-2.5 tracking-[0.2em]" style={{ color: 'var(--gold)' }}>
                          {selectedIndices.length} / {cardCount}
                        </span>
                      </>
                    ) : (
                      subtitle
                    )}
                  </p>
                </div>
              </div>
              <motion.button
                onClick={onClose}
                disabled={isShuffling}
                whileTap={{ scale: 0.92 }}
                className="absolute top-5 right-5 w-10 h-10 rounded-full grid place-items-center transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                style={{ border: '1px solid var(--line)', background: 'rgba(6,6,15,0.55)', color: 'var(--ivory-dim)' }}
                aria-label="关闭"
              >
                <X size={17} />
              </motion.button>
            </div>

            {/* 槽位：牌阵的每个位置一格，在扇形牌阵正上方。位置名写在格子上面——
                选中的牌抬起来会顶进这一行的下沿，写在下面会被牌面压住 */}
            {isSpread && (
              <div className="relative z-20 shrink-0 px-4 sm:px-6 pb-2">
                <div className={`flex ${isCompactSlots ? 'gap-x-1.5 gap-y-2' : 'gap-x-2 gap-y-3'} justify-center flex-wrap max-w-5xl mx-auto`}>
                  {positions.map((position, idx) => {
                    const filled = selectedIndices[idx] !== undefined;
                    const isNext = idx === selectedIndices.length; // 下一张牌落在这一格
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                        className={`flex flex-col items-center justify-end ${isCompactSlots ? 'w-14' : 'w-[84px]'}`}
                      >
                        <span
                          className={`mb-1.5 w-full text-center font-display leading-snug line-clamp-2 transition-colors duration-500 ${
                            isCompactSlots ? 'text-[9px] tracking-[0.04em]' : 'text-[11px] tracking-[0.1em]'
                          }`}
                          style={{ color: filled ? 'var(--ivory)' : isNext ? 'var(--gold)' : 'var(--ivory-faint)' }}
                        >
                          {position}
                        </span>
                        <div className={`relative ${isCompactSlots ? 'w-12 h-[84px]' : 'w-16 h-28'}`}>
                          {/* 空位：一方暗色的牌位，发丝金边 + 内框，正中写序号；下一张要落的那一格亮着 */}
                          <div
                            className="absolute inset-0 rounded-lg transition-[border-color,box-shadow] duration-500"
                            style={{
                              background: 'rgba(6,6,15,0.6)',
                              border: `1px solid ${isNext ? 'rgba(201,169,110,0.65)' : 'rgba(201,169,110,0.24)'}`,
                              boxShadow: isNext ? '0 0 18px rgba(201,169,110,0.25), inset 0 0 14px rgba(201,169,110,0.1)' : 'none',
                            }}
                          />
                          <div className="absolute inset-[5px] rounded-[5px]" style={{ border: '1px solid rgba(201,169,110,0.12)' }} />
                          <span
                            className={`absolute inset-0 grid place-items-center font-display tracking-[0.08em] transition-colors duration-500 ${
                              isCompactSlots ? 'text-[11px]' : 'text-[13px]'
                            }`}
                            style={{ color: isNext ? 'var(--gold)' : 'rgba(201,169,110,0.38)' }}
                          >
                            {ROMAN[idx] ?? idx + 1}
                          </span>

                          {/* 选中：一张牌背落进这一格 */}
                          <AnimatePresence>
                            {filled && (
                              <motion.div
                                key="card"
                                initial={{ opacity: 0, y: -16, scale: 1.1 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 1.05 }}
                                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                                className="absolute inset-0 rounded-lg overflow-hidden"
                                style={{
                                  border: '1px solid rgba(240,208,144,0.75)',
                                  boxShadow: '0 0 16px rgba(201,169,110,0.4), 0 8px 18px rgba(0,0,0,0.5)',
                                }}
                              >
                                <img src={CARD_BACK_IMAGE} alt="" aria-hidden className="w-full h-full object-cover" draggable={false} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cards Display */}
            <motion.div className="relative flex-1 min-h-0 w-full flex items-center justify-center px-6 pb-4">
              <div ref={stageRef} className="relative z-10 w-full h-full flex items-center justify-center">
                {/* 洗牌动画 */}
                {isShuffling && (
                  <div className="relative w-full max-w-4xl h-[360px] flex items-center justify-center">
                    <motion.div
                      key={shuffleRunId}
                      initial={{ opacity: 0, scale: 1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative w-full h-full flex items-center justify-center"
                    >
                      <motion.div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%] pointer-events-none"
                        style={{
                          width: 'min(90vw, 760px)',
                          height: 'min(90vw, 760px)',
                          maxWidth: '800px',
                          maxHeight: '800px',
                        }}
                        initial={{ scaleX: 1.1, scaleY: 0.62, rotate: 0, opacity: 0.4 }}
                        animate={{
                          scaleX: [1.1, 1.2, 1.05, 1.1],
                          scaleY: [0.62, 0.7, 0.58, 0.62],
                          opacity: [0.38, 0.46, 0.42, 0.38],
                          rotate: [0, 4, -3, 0],
                        }}
                        transition={{ duration: 9, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }}
                      >
                        <div className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(253,244,215,0.25),rgba(168,216,234,0.08)_58%,transparent_85%)] blur-[56px] mix-blend-screen" />
                        <motion.div
                          className="absolute inset-[18%] rounded-full bg-[conic-gradient(from_0deg,rgba(254,240,199,0.22),rgba(168,216,234,0.07),rgba(254,240,199,0.22))] opacity-60 blur-[44px] mix-blend-screen"
                          animate={{ rotate: [0, 360] }}
                          transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
                        />
                        <motion.div
                          className="absolute inset-[32%] rounded-full border border-mystic-gold/15 opacity-40"
                          animate={{ rotate: [0, -360] }}
                          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
                        />
                      </motion.div>
                      {shuffleConfig.map((card) => (
                        <motion.div
                          key={`${shuffleRunId}-${card.id}`}
                          className="absolute w-28 h-44 rounded-xl overflow-hidden shadow-[0_16px_44px_rgba(225,196,142,0.26)] border border-mystic-gold/30"
                          style={{ zIndex: card.zIndex }}
                          initial={{
                            opacity: 0,
                            scale: card.scale[0],
                            rotate: card.rotate[0],
                          }}
                          animate={{
                            opacity: [0, 0.9, 1, 0.82],
                            x: card.pathX,
                            y: card.pathY,
                            rotate: card.rotate,
                            scale: card.scale,
                          }}
                          transition={{
                            duration: card.duration,
                            ease: 'easeInOut',
                            times: [0, 0.3, 0.7, 1],
                            delay: card.delay,
                          }}
                        >
                          <img
                            src={CARD_BACK_IMAGE}
                            alt="塔罗牌背面"
                            className="w-full h-full object-cover select-none pointer-events-none"
                            draggable={false}
                          />
                          <div className="absolute inset-0 bg-white/8 mix-blend-screen" />
                        </motion.div>
                      ))}
                    </motion.div>
                  </div>
                )}

                {/* 展开的扇形牌阵 - 可拖动扇形展开，使用绝对定位直接贴底 */}
                {isSpread && (
                  <div
                    className="absolute bottom-0 left-0 right-0"
                    style={{ transform: `scale(${fanScale})`, transformOrigin: 'bottom center' }}
                  >
                    <div
                      className="relative w-full cursor-grab data-[dragging]:cursor-grabbing"
                      style={GESTURE_STYLE}
                      draggable={false}
                      onPointerDown={beginGesture}
                    >
                      <div className="relative h-[280px] flex items-end justify-center pointer-events-none">
                        <div ref={fanRef} className="group/fan relative w-full max-w-5xl">
                          <div aria-hidden className="absolute pointer-events-none" style={FAN_GLOW_STYLE} />
                          <FanCards rotation={rotation} selectedIndices={selectedIndices} onCardClick={handleCardClick} />
                        </div>
                      </div>

                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1 }}
                        className="absolute top-[160px] inset-x-0 flex justify-center z-50"
                      >
                        <motion.div
                          onPointerDown={beginScrub}
                          whileHover={{ scale: 1.03 }}
                          style={GESTURE_STYLE}
                          draggable={false}
                          className="group/slider relative w-[210px] h-2 rounded-full bg-[#06060f]/60 cursor-grab data-[active]:cursor-grabbing"
                        >
                          {/* 可按的范围上下各放宽 20px：滑轨本身只有 8px 高，手机上很难按中 */}
                          <div aria-hidden className="absolute -inset-x-3 -inset-y-5" />
                          {/* 一道发丝金线当轨道，两端淡出 */}
                          <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-mystic-gold/60 to-transparent pointer-events-none" />

                          <motion.div className="absolute top-1/2 left-0 pointer-events-none" style={{ x: sliderX }}>
                            {/* 滑块：同「最近的占卜」起点那枚节点——暗底、金发丝圈、正中一颗 ✦ */}
                            <div
                              className="-translate-x-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full grid place-items-center text-[9px] leading-none transition-transform duration-150 group-data-[active]/slider:scale-[1.45]"
                              style={{
                                background: 'var(--void)',
                                border: '1px solid rgba(201,169,110,0.75)',
                                boxShadow: '0 0 14px rgba(201,169,110,0.45)',
                                color: 'var(--gold)',
                              }}
                            >
                              ✦
                            </div>
                          </motion.div>
                        </motion.div>
                      </motion.div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* 确认：暗底发丝金边的胶囊，背后一团慢慢呼吸的金光；悬停时框线亮起、底色透出一层金 */}
            {showConfirm && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute bottom-8 left-0 right-0 flex justify-center z-20 pointer-events-none"
              >
                <div className="relative pointer-events-auto">
                  <motion.span
                    aria-hidden
                    className="absolute -inset-5 rounded-full blur-2xl pointer-events-none"
                    style={{ background: 'radial-gradient(closest-side, rgba(201,169,110,0.55), transparent)' }}
                    animate={{ opacity: [0.45, 0.95, 0.45] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.button
                    onClick={handleConfirm}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className="group relative flex items-center gap-4 h-14 px-9 rounded-full font-display text-base tracking-[0.36em]"
                    style={{
                      color: 'var(--gold-bright)',
                      background: 'rgba(6,6,15,0.8)',
                      border: '1px solid rgba(201,169,110,0.7)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                    }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'linear-gradient(120deg, rgba(201,169,110,0.2), rgba(240,208,144,0.1))',
                        boxShadow: 'inset 0 0 0 1px rgba(240,208,144,0.85), 0 0 26px rgba(201,169,110,0.35)',
                      }}
                    />
                    <span aria-hidden className="relative text-[10px]">✦</span>
                    <span className="relative pl-[0.36em]">确认抽牌</span>
                    <span aria-hidden className="relative text-[10px]">✦</span>
                  </motion.button>
                </div>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TarotCardDrawer;
