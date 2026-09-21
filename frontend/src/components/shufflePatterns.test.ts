import { describe, it, expect } from 'vitest';
import { createShuffleRun, SHUFFLE_VARIANTS } from './shufflePatterns';

describe('洗牌花式', () => {
  it.each(SHUFFLE_VARIANTS)('花式 %i 的关键帧对得上,牌数和时长都在谱', (variant) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const run = createShuffleRun(variant);
      expect(run.variant).toBe(variant);
      // 性能红线:同时在动的牌不超过 20 张
      expect(run.cards.length).toBeLessThanOrEqual(20);

      for (const card of run.cards) {
        // 渲染那头把关键帧落点写死成 [0, 0.3, 0.7, 1],四条路径必须都是四帧
        expect([card.pathX, card.pathY, card.rotate, card.scale].map((k) => k.length))
          .toEqual([4, 4, 4, 4]);

        // 洗完必须收回成一叠:扇形是从这一叠里展开的
        expect(card.pathX[3]).toBe(0);
        expect(card.pathY[3]).toBe(0);
        expect(card.scale[3]).toBeCloseTo(1, 1);
        expect(Math.abs(card.rotate[3]) % 360).toBeLessThan(150); // 收回时转满整圈,落定接近正立
      }

      // 整段(最后一张落定 + 0.35 秒收尾)3.2~4 秒左右:太短没仪式感,太长等得烦
      expect(run.settleAt + 0.35).toBeGreaterThan(2.9);
      expect(run.settleAt + 0.35).toBeLessThan(4.4);
      expect(run.settleAt).toBe(Math.max(...run.cards.map((c) => c.delay + c.duration)));

      // 节奏可以有参差但不能散:时长跨度不到 1 秒,错开大体等距(抖动 ±0.1 秒内)
      const durations = run.cards.map((c) => c.duration);
      expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(1);
      const steps = run.cards.slice(1).map((c, i) => c.delay - run.cards[i].delay);
      expect(Math.min(...steps)).toBeGreaterThan(-0.1);
      expect(Math.max(...steps)).toBeLessThan(0.2);
    }
  });

  it('不指定就随机,三种都摇得出来', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createShuffleRun().variant));
    expect([...seen].sort()).toEqual([...SHUFFLE_VARIANTS].sort());
  });
});
