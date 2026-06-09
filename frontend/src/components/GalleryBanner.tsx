import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

// Evocative majors from the classic deck — light .thumb.webp variants.
const PREVIEW = [
  'the-high-priestess',
  'the-moon',
  'wheel-of-fortune',
  'the-star',
  'the-sun',
  'the-world',
].map((id) => `/tarot-images/decks/classic-rws/major/${id}.thumb.webp`);

/** Prominent, high-CTR entry to the tarot gallery (/showcase). */
const GalleryBanner: React.FC = () => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const mid = (PREVIEW.length - 1) / 2;

  return (
    <motion.button
      onClick={() => navigate('/showcase')}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{ y: -3 }}
      className="group relative w-full rounded-2xl overflow-hidden flex items-center gap-5 sm:gap-7 px-5 sm:px-7 py-5 text-left"
      style={{
        background: 'linear-gradient(110deg, rgba(18,18,30,0.7) 0%, rgba(11,11,22,0.5) 100%)',
        border: `1px solid ${hovered ? 'rgba(201,169,110,0.5)' : 'var(--line)'}`,
        boxShadow: hovered ? '0 18px 50px rgba(0,0,0,0.5), 0 0 30px rgba(201,169,110,0.1)' : '0 10px 30px rgba(0,0,0,0.3)',
        transition: 'border-color .4s, box-shadow .4s',
      }}
    >
      {/* fanned card preview */}
      <span className="relative flex-shrink-0 flex items-end h-20" style={{ paddingLeft: 8 }}>
        {PREVIEW.map((src, i) => {
          const offset = i - mid;
          return (
            <motion.span
              key={src}
              className="block w-[44px] h-[72px] rounded-md overflow-hidden"
              style={{
                marginLeft: i ? -22 : 0,
                transformOrigin: 'bottom center',
                border: '1px solid rgba(201,169,110,0.4)',
                boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
                zIndex: 10 - Math.abs(offset),
              }}
              animate={{
                rotate: offset * 7,
                x: hovered ? offset * 9 : 0,
                y: hovered ? -6 : 0,
                scale: hovered ? 1.04 : 1,
              }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}
            >
              <img
                src={src}
                alt=""
                aria-hidden
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { (e.currentTarget.style.opacity = '0'); }}
              />
            </motion.span>
          );
        })}
      </span>

      {/* text */}
      <span className="flex-1 min-w-0">
        <span className="eyebrow block" style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}>
          GALLERY
        </span>
        <span className="block font-display font-semibold text-lg tracking-[0.1em] mt-1" style={{ color: 'var(--ivory)' }}>
          塔罗牌廊
        </span>
        <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--ivory-dim)' }}>
          78 张经典塔罗 · 多套艺术牌组
        </span>
      </span>

      {/* affordance */}
      <span
        className="flex-shrink-0 hidden sm:flex items-center gap-1.5 text-sm tracking-[0.18em] font-display transition-transform duration-300 group-hover:translate-x-1"
        style={{ color: 'var(--gold)' }}
      >
        浏览牌廊 ›
      </span>
    </motion.button>
  );
};

export default GalleryBanner;
