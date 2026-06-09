import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STARDUST_PACKAGES } from '../../data/stardustPackages';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { useAuthStore } from '../../stores/useAuthStore';
import { toast } from '../../stores/useToastStore';
import { storeApi, paymentsApi, type StorePackageDTO, type TopUpResponseDTO } from '../../services/api';

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'pick' | 'paying' | 'success';
type Provider = 'alipay' | 'wechat';

// 后端套餐含人民币价格；后端不可达时退回前端静态套餐（无价格）。
interface PkgView { id: string; stardust: number; bonus: number; tag?: string | null; price_cents?: number; }

const FALLBACK: PkgView[] = STARDUST_PACKAGES.map((p) => ({ ...p }));

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'alipay', label: '支付宝' },
  { id: 'wechat', label: '微信支付' },
];

export default function TopUpModal({ open, onClose }: TopUpModalProps) {
  const userId = useAuthStore((s) => s.user?.user_id);
  const balance = useDeckWallet((s) => s.balance);

  const [pkgs, setPkgs] = useState<PkgView[]>(FALLBACK);
  const [phase, setPhase] = useState<Phase>('pick');
  const [picked, setPicked] = useState('popular');
  const [provider, setProvider] = useState<Provider>('alipay');
  const [order, setOrder] = useState<TopUpResponseDTO | null>(null);
  const [credited, setCredited] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // 打开时回到选择态、拉取后端套餐（权威人民币价格）
  useEffect(() => {
    if (!open) return;
    setPhase('pick');
    setOrder(null);
    storeApi.packages()
      .then((list: StorePackageDTO[]) => { if (mountedRef.current && list.length) setPkgs(list); })
      .catch(() => { /* 退回 FALLBACK */ });
  }, [open]);

  const pkg = pkgs.find((p) => p.id === picked) ?? pkgs[0];
  const total = pkg ? pkg.stardust + pkg.bonus : 0;
  const yuan = (cents?: number) => (typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '');

  const finishPaid = async () => {
    await useDeckWallet.getState().refresh();
    if (!mountedRef.current) return;
    setCredited(total);
    setPhase('success');
  };

  // 轮询订单状态，直到 paid
  useEffect(() => {
    if (phase !== 'paying' || !order) return;
    let active = true;
    const tick = async () => {
      try {
        const o = await paymentsApi.getOrder(order.order_id);
        if (!active) return;
        if (o.status === 'paid') { active = false; finishPaid(); }
        else if (o.status === 'failed' || o.status === 'expired') {
          active = false; setPhase('pick'); toast.error('支付未完成，请重试');
        }
      } catch { /* 瞬时失败，下一轮再试 */ }
    };
    const id = window.setInterval(tick, 1500);
    return () => { active = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, order]);

  const startTopup = async () => {
    if (!userId) { toast.error('请先登录后再充值'); return; }
    if (!pkg) return;
    setPhase('paying');
    try {
      const res = await paymentsApi.topup({ user_id: userId, package_id: pkg.id, provider, method: 'qr' });
      if (!mountedRef.current) return;
      setOrder(res);
      if (res.pay.redirect_url) window.open(res.pay.redirect_url, '_blank', 'noopener');
    } catch {
      if (!mountedRef.current) return;
      setPhase('pick');
      toast.error('下单失败，请重试');
    }
  };

  const doMockPay = async () => {
    if (!order) return;
    try {
      const o = await paymentsApi.mockPay(order.order_id);
      if (o.status === 'paid') finishPaid();
    } catch {
      toast.error('模拟支付失败');
    }
  };

  const closeGuard = phase === 'paying' ? undefined : onClose;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="topup-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { e.stopPropagation(); closeGuard?.(); }}
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
            ) : phase === 'paying' ? (
              <div className="topup-paying">
                <div className="topup-head">
                  <span className="topup-eyebrow">待支付</span>
                  <span className="topup-balance">{order ? yuan(order.amount) : ''}</span>
                </div>
                <p className="topup-paying-note">
                  已创建订单 · {PROVIDERS.find((p) => p.id === provider)?.label}（{order?.provider === 'mock' ? '模拟通道' : '扫码支付'}）
                </p>
                <div className="topup-paying-amount">✦ {total.toLocaleString()} 星尘</div>
                <p className="topup-poll"><span className="topup-spinner" /><span style={{ marginLeft: 8 }}>等待支付结果…</span></p>
                {order?.pay.mock_pay_url && (
                  <button className="topup-confirm" onClick={doMockPay}>模拟支付完成（开发）</button>
                )}
                {order?.pay.redirect_url && (
                  <button className="topup-confirm" onClick={() => window.open(order.pay.redirect_url!, '_blank', 'noopener')}>
                    重新前往支付
                  </button>
                )}
                <button className="topup-cancel" onClick={() => setPhase('pick')}>取消</button>
              </div>
            ) : (
              <>
                <div className="topup-head">
                  <span className="topup-eyebrow">星尘充值</span>
                  <span className="topup-balance">当前 ✦ {balance.toLocaleString()}</span>
                </div>
                <div className="topup-grid">
                  {pkgs.map((p) => (
                    <button
                      key={p.id}
                      className={`topup-pkg ${picked === p.id ? 'active' : ''}`}
                      onClick={() => setPicked(p.id)}
                    >
                      {p.tag && <span className="topup-tag">{p.tag}</span>}
                      <span className="topup-amount">✦ {p.stardust.toLocaleString()}</span>
                      {p.bonus > 0 && <span className="topup-bonus">+{p.bonus.toLocaleString()} 赠</span>}
                      {typeof p.price_cents === 'number' && <span className="topup-price">{yuan(p.price_cents)}</span>}
                    </button>
                  ))}
                </div>

                <div className="topup-pay-label">支付方式</div>
                <div className="topup-providers">
                  {PROVIDERS.map((pv) => (
                    <button
                      key={pv.id}
                      className={`topup-provider ${provider === pv.id ? 'active' : ''}`}
                      onClick={() => setProvider(pv.id)}
                    >
                      {pv.label}
                    </button>
                  ))}
                </div>

                <button className="topup-confirm" onClick={startTopup}>
                  {pkg && typeof pkg.price_cents === 'number' ? `支付 ${yuan(pkg.price_cents)} · 得 ✦ ${total.toLocaleString()}` : `充值 ✦ ${total.toLocaleString()}`}
                </button>
                <button className="topup-cancel" onClick={onClose}>取消</button>
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
              position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
              padding: 16px 12px; border-radius: 12px; cursor: pointer;
              border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03);
              transition: all .2s; font-family: inherit;
            }
            .topup-pkg:hover { border-color: rgba(201,169,110,.45); }
            .topup-pkg.active { border-color: #C9A96E; background: rgba(201,169,110,.1); box-shadow: 0 0 20px rgba(201,169,110,.18); }
            .topup-tag {
              position: absolute; top: -9px; right: 10px;
              font-size: 10px; letter-spacing: .08em; padding: 1px 8px; border-radius: 999px;
              color: #0e0e1a; background: linear-gradient(120deg, #C9A96E, #F0D090);
            }
            .topup-amount { font-family: 'Cinzel', serif; font-size: 18px; color: var(--ivory, #ede6d6); }
            .topup-bonus { font-size: 11px; color: #90BE6D; }
            .topup-price { font-size: 12px; color: rgba(237,230,214,.5); margin-top: 2px; }
            .topup-pay-label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: rgba(237,230,214,.4); }
            .topup-providers { display: flex; gap: 10px; }
            .topup-provider {
              flex: 1; padding: 11px; border-radius: 10px; cursor: pointer; font-size: 13px;
              color: rgba(237,230,214,.7); border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03);
              transition: all .2s; font-family: inherit;
            }
            .topup-provider.active { color: #C9A96E; border-color: #C9A96E; background: rgba(201,169,110,.1); }
            .topup-confirm {
              margin-top: 2px; padding: 14px; border-radius: 12px; cursor: pointer;
              font-family: 'Cinzel', serif; font-size: 14px; letter-spacing: .06em;
              color: #0e0e1a; border: none; min-height: 50px;
              display: flex; align-items: center; justify-content: center;
              background: linear-gradient(120deg, #C9A96E 0%, #fff6e0 140%);
              box-shadow: 0 8px 24px rgba(201,169,110,.3); transition: transform .2s;
            }
            .topup-confirm:hover { transform: translateY(-2px); }
            .topup-cancel { padding: 4px; cursor: pointer; font-size: 12px; color: rgba(237,230,214,.45); background: none; border: none; font-family: inherit; }
            .topup-cancel:hover { color: rgba(237,230,214,.7); }
            .topup-spinner {
              width: 16px; height: 16px; border-radius: 50%;
              border: 2px solid rgba(201,169,110,.25); border-top-color: #C9A96E;
              display: inline-block; animation: topup-spin .7s linear infinite;
            }
            @keyframes topup-spin { to { transform: rotate(360deg); } }
            .topup-paying { display: flex; flex-direction: column; gap: 14px; align-items: stretch; }
            .topup-paying-note { font-size: 12px; color: rgba(237,230,214,.55); }
            .topup-paying-amount { font-family: 'Cinzel', serif; font-size: 22px; color: var(--ivory, #ede6d6); text-align: center; }
            .topup-poll { display: flex; align-items: center; justify-content: center; font-size: 13px; color: rgba(237,230,214,.6); }
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
