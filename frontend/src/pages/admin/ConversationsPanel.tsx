import { useCallback, useEffect, useState } from 'react';
import {
  adminApi, displayName, errMsg, isAuthError,
  type AdminConvSummary, type AdminConversation,
} from '@/services/adminApi';

const PAGE = 20;
const TYPE_LABELS: Record<string, string> = {
  tarot: '塔罗', astrology: '星盘', chat: '聊愈', daily: '每日一签',
};

const fmtTime = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default function ConversationsPanel() {
  const [items, setItems] = useState<AdminConvSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState('');
  const [detail, setDetail] = useState<AdminConversation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (offset: number, sessionType: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await adminApi.conversations({
        limit: PAGE, offset, session_type: sessionType || undefined,
      });
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setTotal(r.total);
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0, type);
  }, [type, load]);

  const open = async (id: string) => {
    setError('');
    try {
      setDetail(await adminApi.conversation(id));
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    }
  };

  return (
    <div className={`admin-conv ${detail ? 'has-detail' : ''}`}>
      <section className="admin-conv-list">
        <div className="admin-toolbar">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <span className="admin-dim">{total} 个会话</span>
        </div>
        {error && <p className="admin-error">{error}</p>}
        <ul>
          {items.map((c) => (
            <li
              key={c.conversation_id}
              className={detail?.conversation_id === c.conversation_id ? 'active' : ''}
              onClick={() => open(c.conversation_id)}
            >
              <div className="row1">
                <span className="title">{c.title}</span>
                <span className="admin-dim">{TYPE_LABELS[c.session_type] || c.session_type}</span>
              </div>
              <div className="row2 admin-dim">
                {displayName(c)}
                {c.user_type === 'guest' ? '（游客）' : ''} · {c.message_count} 条 · {fmtTime(c.updated_at)}
              </div>
            </li>
          ))}
        </ul>
        {items.length < total && (
          <button disabled={loading} onClick={() => load(items.length, type)}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </section>
      {detail && (
        <section className="admin-conv-detail">
          <div className="admin-toolbar">
            <button onClick={() => setDetail(null)}>← 返回</button>
            <span className="title">{detail.title}</span>
            <span className="admin-dim">{fmtTime(detail.created_at)}</span>
          </div>
          <div className="messages">
            {detail.messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}`}>
                <div className="admin-dim">
                  {m.role === 'user' ? '用户' : m.role === 'assistant' ? '占卜师' : '系统'} · {fmtTime(m.timestamp)}
                </div>
                <div className="content">{m.content}</div>
                {m.tarot_cards && m.tarot_cards.length > 0 && (
                  <div className="cards">
                    {m.tarot_cards.map((card, j) => (
                      <span key={j} className="card-chip">
                        {card.card_name}{card.reversed ? '（逆）' : '（正）'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
