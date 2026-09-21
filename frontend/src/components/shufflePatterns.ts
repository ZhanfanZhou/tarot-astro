/**
 * 洗牌花式：同一个动作的三套参数，不是三套编舞。
 * 动作只有一个 —— 牌从叠里飞出去、在半空转一圈、落回叠上。三种的差别只在
 * 「往哪散、旋向齐不齐、抬多高、错开多久」这几个参数上。
 * 刻意不给它们起名字：上一版就是被 orbital / cascade / burst 这几个名字带着跑偏的。
 *
 * 性能：同时在动的牌 ≤ 20 张，每张牌只动 transform(x/y/rotate/scale) 和 opacity，
 * 关键帧在洗牌开始时算一次（不是每帧摇随机数）。别在这里引入 filter / box-shadow /
 * 宽高动画，那些每帧都要重新光栅化。
 * 节奏：整段（最后一张落定 + 0.35 秒收尾）3.2~4 秒，比最初那版短 15% 上下。
 * duration 留半秒左右的随机、delay 在等距递增上叠一点抖动：有参差但不散。
 * 改时长时幅度要跟着一起动（半径、抬升、散布、放大按同一比例缩放），
 * 只提速不收幅度就变成十几张牌在那儿乱窜。
 */
export type ShuffleVariant = 0 | 1 | 2;

export const SHUFFLE_VARIANTS: ShuffleVariant[] = [0, 1, 2];

export interface ShuffleCardConfig {
  id: number;
  /** 四条路径逐帧对应，关键帧落点固定在 [0, 0.3, 0.7, 1] */
  pathX: number[];
  pathY: number[];
  rotate: number[];
  scale: number[];
  duration: number;
  delay: number;
  zIndex: number;
}

export interface ShuffleRun {
  variant: ShuffleVariant;
  cards: ShuffleCardConfig[];
  /** 最后一张牌落定的秒数：洗到这里就可以展扇形 */
  settleAt: number;
}

// 花式一：绕着中心转出去再转回来。
// 与原版的唯一区别是旋向改成整场一致（原来每张牌自己摇左右，合起来是一团乱转），
// 于是十几张牌沿同一个方向扫出一道弧，轨道半径也略放大一点。
const createOrbital = (count: number, seed: number): ShuffleCardConfig[] => {
  const direction = Math.random() > 0.5 ? 1 : -1;
  return Array.from({ length: count }, (_, idx) => {
    const orbitRadius = 148 + Math.random() * 104;
    const lift = 122 + Math.random() * 104;
    const entryAngle = seed + (idx / count) * Math.PI * 1.6 * direction;
    const midAngle = entryAngle + direction * (Math.PI / 2 + Math.random() * 0.6);
    const x1 = Math.cos(entryAngle) * orbitRadius;
    const y1 = Math.sin(entryAngle) * orbitRadius * 0.5 - lift;
    const x2 = Math.cos(midAngle) * orbitRadius * 0.65 + direction * (20 + Math.random() * 40);
    const y2 = Math.sin(midAngle) * orbitRadius * 0.35 + (Math.random() - 0.5) * 140;
    const firstSpin = direction * (113 + Math.random() * 61);
    const secondSpin = firstSpin + direction * (139 + Math.random() * 104);
    const finalSpin = direction * 360; // 正好一圈：落回去是正立的一叠
    return {
      id: idx,
      pathX: [0, x1, x2, 0],
      pathY: [0, y1, y2, 0],
      rotate: [0, firstSpin, secondSpin, finalSpin],
      scale: [0.96, 1.2 + Math.random() * 0.1, 1.09 + Math.random() * 0.05, 1.02],
      duration: 2.53 + Math.random() * 0.6,
      delay: idx * 0.034 + Math.random() * 0.05,
      zIndex: 40 + idx,
    };
  });
};

// 花式二：按车道左右分开，抬起再落回。
// 与原版的唯一区别是抬升高度跟着车道走（中间高、两边低），原来是每张牌纯随机，
// 十几张牌各抬各的，看不出形；现在一排牌推成一道拱。
const createCascade = (count: number): ShuffleCardConfig[] =>
  Array.from({ length: count }, (_, idx) => {
    const offsetFromCenter = idx - count / 2;
    const direction = offsetFromCenter >= 0 ? 1 : -1;
    const laneOffset = offsetFromCenter * (26 + Math.random() * 9);
    const centerness = 1 - Math.abs(offsetFromCenter) / (count / 2);
    const peakHeight = 113 + centerness * 113 + Math.random() * 26;
    const x1 = laneOffset * 0.6;
    const x2 = laneOffset * (1 + Math.random() * 0.25);
    const y1 = -peakHeight;
    const y2 = peakHeight * 0.25 * direction;
    const firstSpin = direction * (96 + Math.random() * 52);
    const secondSpin = firstSpin + direction * (148 + Math.random() * 78);
    const finalSpin = direction * 360;
    return {
      id: idx,
      pathX: [0, x1, x2, 0],
      pathY: [0, y1, y2, 0],
      rotate: [0, firstSpin, secondSpin, finalSpin],
      scale: [0.95, 1.17 + Math.random() * 0.1, 1.07 + Math.random() * 0.04, 1.01],
      duration: 2.05 + Math.random() * 0.45,
      delay: idx * 0.042 + Math.random() * 0.05,
      zIndex: 40 + idx,
    };
  });

// 花式三：炸开再收回。三种里最野的一个，所以幅度调大一点、错开压到最小，
// 十几张牌几乎同时向外炸开 —— 原来 delay 带 0.2s 随机，炸得稀稀拉拉。
const createBurst = (count: number): ShuffleCardConfig[] =>
  Array.from({ length: count }, (_, idx) => {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const burstReach = (Math.random() - 0.5) * 365;
    const lift = 122 + Math.random() * 148;
    const rebound = (Math.random() - 0.5) * 157;
    const firstSpin = direction * (130 + Math.random() * 78);
    const secondSpin = firstSpin + direction * (174 + Math.random() * 113);
    const finalSpin = direction * 360;
    return {
      id: idx,
      pathX: [0, burstReach * 0.7, rebound, 0],
      pathY: [0, -lift, lift * 0.3 * (Math.random() - 0.5), 0],
      rotate: [0, firstSpin, secondSpin, finalSpin],
      scale: [0.98, 1.22 + Math.random() * 0.1, 1.1 + Math.random() * 0.07, 1.03],
      duration: 2.12 + Math.random() * 0.5,
      delay: idx * 0.021 + Math.random() * 0.05,
      zIndex: 40 + idx,
    };
  });

/** 摇一次洗牌：不传 variant 就随机取一种（本地预览页会指定） */
export function createShuffleRun(variant?: ShuffleVariant): ShuffleRun {
  const chosen = variant ?? ((Math.floor(Math.random() * 3) as ShuffleVariant));
  const count = 14 + Math.floor(Math.random() * 7); // 14 ~ 20
  const cards =
    chosen === 0
      ? createOrbital(count, Math.random() * Math.PI * 2)
      : chosen === 1
        ? createCascade(count)
        : createBurst(count);
  return {
    variant: chosen,
    cards,
    settleAt: Math.max(...cards.map((card) => card.delay + card.duration)),
  };
}
