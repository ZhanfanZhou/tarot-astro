import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { toast } from '../../stores/useToastStore';
import TopUpModal from '../wallet/TopUpModal';

interface CheckoutPanelProps {
  deck: StoreDeck;
  onCancel: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

type Phase = 'form' | 'processing' | 'success';

const REASON_MESSAGE: Record<string, string> = {
  insufficient_balance: '星尘余额不足，请先充值',
  not_purchasable: '该牌组暂不可购买',
  no_user: '请先登录后再购买',
};

export default function CheckoutPanel({ deck, onCancel, onEnterDeck }: CheckoutPanelProps) {
  const balance = useDeckWallet((s) => s.balance);
  const purchase = useDeckWallet((s) => s.purchase);
  const [phase, setPhase] = useState<Phase>('form');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const insufficient = balance < deck.price;

  // 处理中途若面板被卸载（如 Esc 退出），避免在已卸载组件上 setState
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const confirm = async () => {
    if (insufficient) { setTopUpOpen(true); return; }
    setPhase('processing');
    try {
      const { success, reason } = await purchase(deck.id);
      if (!mountedRef.current) return;
      if (!success) {
        setPhase('form');
        toast.error((reason && REASON_MESSAGE[reason]) || '解锁失败，请重试');
        return;
      }
      setPhase('success');
    } catch {
      if (!mountedRef.current) return;
      setPhase('form');
      toast.error('网络异常，请重试');
    }
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
              <button className="ds-pay-method active">✦ 星尘余额</button>
              <button className="ds-pay-method" disabled title="敬请期待">
                🪙 金币 · 敬请期待
              </button>
            </div>

            <div className="ds-balance">
              <span>当前余额</span>
              <span className={insufficient ? 'low' : ''}>{balance} ✦</span>
            </div>

            {insufficient && (
              <button className="ds-topup" onClick={() => setTopUpOpen(true)}>
                余额不足 · 去充值
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

      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </motion.div>
  );
}
