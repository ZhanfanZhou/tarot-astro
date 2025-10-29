import React from 'react';
import { motion } from 'framer-motion';

/**
 * 神秘背景组件
 * 包含静态背景图和动态效果（窗帘飘动、水晶球闪烁、光芒）
 */
const MysticBackground: React.FC = () => {
  return (
    <div className="mystic-background">
      {/* 静态背景图 */}
      <div className="mystic-background__image" />
      
      {/* 窗帘飘动效果 - 左侧 */}
      <motion.div
        className="mystic-background__curtain mystic-background__curtain--left"
        animate={{
          x: [-2, 2, -2],
          scaleX: [1, 1.005, 1],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* 窗帘飘动效果 - 右侧 */}
      <motion.div
        className="mystic-background__curtain mystic-background__curtain--right"
        animate={{
          x: [2, -2, 2],
          scaleX: [1, 1.005, 1],
        }}
        transition={{
          duration: 4.5,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.5,
        }}
      />
      
      {/* 水晶球光芒效果 - 外层光晕 */}
      <motion.div
        className="mystic-background__glow mystic-background__glow--outer"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* 水晶球光芒效果 - 中层光晕 */}
      <motion.div
        className="mystic-background__glow mystic-background__glow--middle"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.4, 0.7, 0.4],
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.3,
        }}
      />
      
      {/* 水晶球闪烁效果 - 内层 */}
      <motion.div
        className="mystic-background__sparkle"
        animate={{
          opacity: [0.5, 1, 0.5],
          scale: [0.9, 1.1, 0.9],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* 随机闪烁的星星效果 */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="mystic-background__star"
          style={{
            left: `${20 + i * 10}%`,
            top: `${15 + (i % 3) * 20}%`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2 + i * 0.3,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.5,
          }}
        />
      ))}
      
      {/* 径向光效 - 从水晶球向外扩散 */}
      <motion.div
        className="mystic-background__radial"
        animate={{
          scale: [0.8, 1.5, 0.8],
          opacity: [0, 0.4, 0],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeOut',
        }}
      />
    </div>
  );
};

export default MysticBackground;

