import React from 'react';
import { motion } from 'framer-motion';

/**
 * 星象虚空背景
 * 深近黑底 + 漂移星场 + 缓慢呼吸的金/银蓝星云 + 旋转的星轨环。
 * 纯 CSS/动效，不依赖照片。如需自定义底图，可在 .mystic-background__image
 * 上通过 --backdrop-image / --backdrop-opacity 注入。
 */
const MysticBackground: React.FC = () => {
  return (
    <div className="mystic-background">
      {/* 可选自定义底图槽位（默认不显示） */}
      <div className="mystic-background__image" />

      {/* 双层视差星场 */}
      <div className="mystic-background__stars--far" />
      <div className="mystic-background__stars" />

      {/* 缓慢旋转的星轨环 */}
      <motion.div
        className="mystic-background__ring"
        animate={{ rotate: 360 }}
        transition={{ duration: 240, repeat: Infinity, ease: 'linear' }}
      />

      {/* 金色星云（神谕暖光）— 极缓呼吸 */}
      <motion.div
        className="mystic-background__nebula mystic-background__nebula--gold"
        animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* 月光银蓝星云（问卜冷光） */}
      <motion.div
        className="mystic-background__nebula mystic-background__nebula--moon"
        animate={{ opacity: [0.45, 0.75, 0.45], scale: [1, 1.1, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />
    </div>
  );
};

export default MysticBackground;
