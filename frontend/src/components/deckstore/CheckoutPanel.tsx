import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { toast } from '../../stores/useToastStore';

interface CheckoutPanelProps {
  deck: StoreDeck;
  onCancel: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

type Phase = 'form' | 'processing' | 'success';
type Method = 'stardust' | 'coin';

export default function CheckoutPanel({ deck, onCancel, onEnterDeck }: CheckoutPanelProps) {
  const balance = useDeckWallet((s) => s.balance);
  const purchase = useDeckWallet((s) => s.purchase);
  const topUp = useDeckWallet((s) => s.topUp);
  const [phase, setPhase] = useState<Phase>('form');
  const [method, setMethod] = useState<Method>('stardust');
  const insufficient = balance < deck.price;

  // 取消未完成的结算计时器：若处理中途面板被卸载（如按 Esc 退出），
  // 防止在已卸载组件上 setState，并避免无确认界面地静默扣款。
  const timerRef = useRef<number>();
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const confirm = () => {
    if (insufficient) { toast.error('星尘余额不足'); return; }
    setPhase('processing');
    timerRef.current = window.setTimeout(() => {
      const ok = purchase(deck.id, deck.price);
      if (!ok) { setPhase('form'); toast.error('结算失败，请重试'); return; }
      setPhase('success');
    }, 1200);
  };

  return (
    <motion.div
      className="ds-checkout-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={phase === 'processing' ? undefined : onCancel}
    >
      <motion.div
        className="ds-checkout"
        style={{ '--accent': deck.accent } as React.CSSProperties}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'success' ? (
          <div className="ds-success">
            <motion.div
              className="ds-success-mark"
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 12, stiffness: 200 }}
            >
              ✦
            </motion.div>
            <h3 className="ds-success-title">已收入囊中</h3>
            <p className="ds-success-sub">{deck.name} 已加入你的牌组</p>
            {deck.liveDeckId ? (
              <button className="ds-confirm" onClick={() => onEnterDeck(deck.liveDeckId!)}>进入牌廊 ›</button>
            ) : (
              <button className="ds-confirm" onClick={onCancel}>完成</button>
            )}
          </div>
        ) : (
          <>
            <div className="ds-checkout-head">结算</div>
            <div className="ds-checkout-line">
              <img
                className="ds-checkout-thumb"
                src={deck.previewCards[0]}
                alt=""
                onError={(e) => { e.currentTarget.style.opacity = '0'; }}
              />
              <div className="ds-checkout-meta">
                <span className="ds-checkout-name">{deck.name}</span>
                <span className="ds-checkout-style">{deck.style}</span>
              </div>
              <span className="ds-checkout-price">{deck.price} ✦</span>
            </div>

            <div className="ds-pay-label">支付方式</div>
            <div className="ds-pay-methods">
              <button className={`ds-pay-method ${method === 'stardust' ? 'active' : ''}`} onClick={() => setMethod('stardust')}>
                ✦ 星尘余额
              </button>
              <button className={`ds-pay-method ${method === 'coin' ? 'active' : ''}`} onClick={() => setMethod('coin')}>
                🪙 金币
              </button>
            </div>

            <div className="ds-balance">
              <span>当前余额</span>
              <span className={insufficient ? 'low' : ''}>{balance} ✦</span>
            </div>

            {insufficient && (
              <button className="ds-topup" onClick={() => { topUp(5000); toast.success('已充值 5000 ✦'); }}>
                余额不足 · 充值 5000 ✦
              </button>
            )}

            <button className="ds-confirm" disabled={phase === 'processing'} onClick={confirm}>
              {phase === 'processing' ? (
                <><span className="ds-spinner" /><span style={{ marginLeft: 8 }}>结算中…</span></>
              ) : (
                '确认支付'
              )}
            </button>
            <button className="ds-checkout-cancel" onClick={onCancel} disabled={phase === 'processing'}>取消</button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
