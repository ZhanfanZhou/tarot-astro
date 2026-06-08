import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STARDUST_PACKAGES } from '../../data/stardustPackages';
import { useDeckWallet } from '../../stores/useDeckWallet';

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'pick' | 'processing' | 'success';

export default function TopUpModal({ open, onClose }: TopUpModalProps) {
  const balance = useDeckWallet((s) => s.balance);
  const topUp = useDeckWallet((s) => s.topUp);
  const [phase, setPhase] = useState<Phase>('pick');
  const [picked, setPicked] = useState(STARDUST_PACKAGES[2].id); // default 热门
  const [credited, setCredited] = useState(0);
  const timerRef = useRef<number>();

  // 取消未完成的充值计时器（卸载/关闭时）
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  // 每次打开回到选择态
  useEffect(() => { if (open) setPhase('pick'); }, [open]);

  const pkg = STARDUST_PACKAGES.find((p) => p.id === picked) ?? STARDUST_PACKAGES[0];
  const total = pkg.stardust + pkg.bonus;

  const confirm = () => {
    setPhase('processing');
    timerRef.current = window.setTimeout(() => {
      topUp(total);
      setCredited(total);
      setPhase('success');
    }, 1000);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="topup-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={phase === 'processing' ? undefined : onClose}
        >
          <motion.div
            className="topup-modal"
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {phase === 'success' ? (
              <div className="topup-success">
                <motion.div
                  className="topup-mark"
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 200 }}
                >
                  ✦
                </motion.div>
                <h3 className="topup-title">充值成功</h3>
                <p className="topup-sub">+{credited.toLocaleString()} 星尘已到账</p>
                <p className="topup-balance-line">当前余额 ✦ {balance.toLocaleString()}</p>
                <button className="topup-confirm" onClick={onClose}>完成</button>
              </div>
            ) : (
              <>
                <div className="topup-head">
                  <span className="topup-eyebrow">星尘充值</span>
                  <span className="topup-balance">当前 ✦ {balance.toLocaleString()}</span>
                </div>
                <div className="topup-grid">
                  {STARDUST_PACKAGES.map((p) => (
                    <button
                      key={p.id}
                      className={`topup-pkg ${picked === p.id ? 'active' : ''}`}
                      onClick={() => setPicked(p.id)}
                      disabled={phase === 'processing'}
                    >
                      {p.tag && <span className="topup-tag">{p.tag}</span>}
                      <span className="topup-amount">✦ {p.stardust.toLocaleString()}</span>
                      {p.bonus > 0 && <span className="topup-bonus">+{p.bonus.toLocaleString()} 赠</span>}
                    </button>
                  ))}
                </div>
                <button className="topup-confirm" disabled={phase === 'processing'} onClick={confirm}>
                  {phase === 'processing' ? (
                    <><span className="topup-spinner" /><span style={{ marginLeft: 8 }}>充值中…</span></>
                  ) : (
                    `确认充值 · ✦ ${total.toLocaleString()}`
                  )}
                </button>
                <button className="topup-cancel" onClick={onClose} disabled={phase === 'processing'}>取消</button>
              </>
            )}
          </motion.div>

          <style>{`
            .topup-scrim {
              position: fixed; inset: 0; z-index: 1400;
              background: rgba(2,2,8,.74); backdrop-filter: blur(8px);
              display: flex; align-items: flex-end; justify-content: center; padding: 0;
            }
            @media (min-width: 720px) { .topup-scrim { align-items: center; } }
            .topup-modal {
              width: 100%; max-width: 460px; margin: 0 12px;
              background: #0e0e1a; border: 1px solid rgba(201,169,110,.4);
              border-radius: 18px 18px 0 0; padding: 24px 24px 28px;
              box-shadow: 0 -20px 60px rgba(0,0,0,.6);
              display: flex; flex-direction: column; gap: 16px;
            }
            @media (min-width: 720px) { .topup-modal { border-radius: 18px; } }
            .topup-head { display: flex; align-items: baseline; justify-content: space-between; }
            .topup-eyebrow { font-family: 'Cinzel', serif; font-size: 16px; letter-spacing: 3px; color: #C9A96E; text-transform: uppercase; }
            .topup-balance { font-size: 12px; color: rgba(237,230,214,.55); }
            .topup-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
            .topup-pkg {
              position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
              padding: 18px 12px; border-radius: 12px; cursor: pointer;
              border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03);
              transition: all .2s; font-family: inherit;
            }
            .topup-pkg:hover:not(:disabled) { border-color: rgba(201,169,110,.45); }
            .topup-pkg.active {
              border-color: #C9A96E; background: rgba(201,169,110,.1);
              box-shadow: 0 0 20px rgba(201,169,110,.18);
            }
            .topup-pkg:disabled { cursor: default; }
            .topup-tag {
              position: absolute; top: -9px; right: 10px;
              font-size: 10px; letter-spacing: .08em; padding: 1px 8px; border-radius: 999px;
              color: #0e0e1a; background: linear-gradient(120deg, #C9A96E, #F0D090);
            }
            .topup-amount { font-family: 'Cinzel', serif; font-size: 18px; color: var(--ivory, #ede6d6); }
            .topup-bonus { font-size: 11px; color: #90BE6D; }
            .topup-confirm {
              margin-top: 2px; padding: 14px; border-radius: 12px; cursor: pointer;
              font-family: 'Cinzel', serif; font-size: 14px; letter-spacing: .08em;
              color: #0e0e1a; border: none; min-height: 50px;
              display: flex; align-items: center; justify-content: center;
              background: linear-gradient(120deg, #C9A96E 0%, #fff6e0 140%);
              box-shadow: 0 8px 24px rgba(201,169,110,.3); transition: transform .2s;
            }
            .topup-confirm:hover:not(:disabled) { transform: translateY(-2px); }
            .topup-confirm:disabled { cursor: default; opacity: .9; }
            .topup-cancel { padding: 4px; cursor: pointer; font-size: 12px; color: rgba(237,230,214,.45); background: none; border: none; font-family: inherit; }
            .topup-cancel:hover:not(:disabled) { color: rgba(237,230,214,.7); }
            .topup-spinner {
              width: 16px; height: 16px; border-radius: 50%;
              border: 2px solid rgba(14,14,26,.3); border-top-color: #0e0e1a;
              display: inline-block; animation: topup-spin .7s linear infinite;
            }
            @keyframes topup-spin { to { transform: rotate(360deg); } }
            .topup-success { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 14px 0 6px; }
            .topup-mark {
              width: 64px; height: 64px; border-radius: 50%;
              display: flex; align-items: center; justify-content: center; font-size: 30px; color: #0e0e1a;
              background: radial-gradient(circle, #fff6e0 0%, #C9A96E 80%);
              box-shadow: 0 0 36px rgba(201,169,110,.6);
            }
            .topup-title { font-family: 'Cinzel', serif; font-size: 22px; color: var(--ivory, #ede6d6); letter-spacing: 1px; }
            .topup-sub { font-size: 13px; color: #90BE6D; }
            .topup-balance-line { font-size: 12px; color: rgba(237,230,214,.55); margin-bottom: 6px; }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
