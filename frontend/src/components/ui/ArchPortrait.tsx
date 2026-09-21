import React from 'react';

/**
 * 一扇小拱窗：殿堂拱窗的缩小版，给弹层抬头当图标用。
 * 立绘下沿溶进底色，金线只描上半、往下淡出，拱顶一颗 ✦（占掉上方约 17px，调用方留出来）。
 */

const DISSOLVE = 'linear-gradient(to bottom, #000 62%, transparent 100%)';
const FRAME_FADE = 'linear-gradient(to bottom, #000 35%, transparent 85%)';

const ACCENT = {
  gold: { line: 'rgba(201,169,110,0.7)', star: 'var(--gold)', glow: 'rgba(201,169,110,0.8)' },
  moon: { line: 'rgba(168,216,234,0.7)', star: 'var(--moon)', glow: 'rgba(168,216,234,0.8)' },
};

interface ArchPortraitProps {
  src: string;
  accent?: keyof typeof ACCENT;
  /** 尺寸，默认 w-11 h-14 */
  className?: string;
}

const ArchPortrait: React.FC<ArchPortraitProps> = ({ src, accent = 'gold', className = 'w-11 h-14' }) => {
  const c = ACCENT[accent];
  return (
    <span aria-hidden className={`relative block shrink-0 ${className}`}>
      <span
        className="absolute left-1/2 -translate-x-1/2 -top-[17px] text-[8px] leading-none"
        style={{ color: c.star, textShadow: `0 0 8px ${c.glow}` }}
      >
        ✦
      </span>
      <span
        className="absolute -inset-1 rounded-t-full border border-b-0"
        style={{ borderColor: c.line, WebkitMaskImage: FRAME_FADE, maskImage: FRAME_FADE }}
      />
      <span
        className="absolute inset-0 rounded-t-full overflow-hidden"
        style={{ WebkitMaskImage: DISSOLVE, maskImage: DISSOLVE }}
      >
        <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
      </span>
    </span>
  );
};

export default ArchPortrait;
