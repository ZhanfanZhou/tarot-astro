import { useState } from 'react';
import { useDeckWallet } from '../../stores/useDeckWallet';
import TopUpModal from './TopUpModal';

interface WalletChipProps {
  className?: string;
}

/** Compact stardust-balance pill with a 充值 button. Self-contained — opens its
 *  own top-up modal. Used on the hub (top-right) and in the store topbar. */
export default function WalletChip({ className = '' }: WalletChipProps) {
  const balance = useDeckWallet((s) => s.balance);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`wallet-chip ${className}`}>
        <span className="wallet-chip-bal">
          <span className="wallet-chip-spark">✦</span>
          {balance.toLocaleString()}
        </span>
        <button className="wallet-chip-topup" onClick={() => setOpen(true)} title="充值星尘">充值</button>
      </div>

      <TopUpModal open={open} onClose={() => setOpen(false)} />

      <style>{`
        .wallet-chip {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 6px 5px 14px; border-radius: 999px;
          border: 1px solid rgba(201,169,110,.4);
          background: linear-gradient(120deg, rgba(201,169,110,.14), rgba(201,169,110,.04));
          box-shadow: 0 0 16px rgba(201,169,110,.1);
          backdrop-filter: blur(8px);
        }
        .wallet-chip-bal {
          display: inline-flex; align-items: center; gap: 5px;
          font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: .04em;
          color: var(--ivory, #ede6d6); white-space: nowrap;
        }
        .wallet-chip-spark { color: #C9A96E; font-size: 12px; }
        .wallet-chip-topup {
          padding: 4px 12px; border-radius: 999px; cursor: pointer;
          font-family: 'Cinzel', serif; font-size: 12px; letter-spacing: .06em;
          color: #0e0e1a; border: none;
          background: linear-gradient(120deg, #C9A96E 0%, #F0D090 130%);
          transition: transform .2s, box-shadow .2s;
        }
        .wallet-chip-topup:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(201,169,110,.35); }
      `}</style>
    </>
  );
}
