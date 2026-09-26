import React from 'react';

/**
 * 星象虚空背景
 * 深近黑底 + 漂移星场 + 金/银蓝星云 + 星轨环。
 * 纯 CSS，不依赖照片。如需自定义底图，可在 .mystic-background__image
 * 上通过 --backdrop-image / --backdrop-opacity 注入。
 * 星云和星轨环是静止的：它们慢到看不出在动，却会让页面每秒重画 60 帧（手机发烫），
 * 定格的样子见 mystic-background.css。
 */
const MysticBackground: React.FC = () => {
  return (
    <div className="mystic-background">
      {/* 可选自定义底图槽位（默认不显示） */}
      <div className="mystic-background__image" />

      {/* 双层视差星场 */}
      <div className="mystic-background__stars--far" />
      <div className="mystic-background__stars" />

      {/* 星轨环 */}
      <div className="mystic-background__ring" />

      {/* 金色星云（神谕暖光） */}
      <div className="mystic-background__nebula mystic-background__nebula--gold" />

      {/* 月光银蓝星云（问卜冷光） */}
      <div className="mystic-background__nebula mystic-background__nebula--moon" />
    </div>
  );
};

export default MysticBackground;
