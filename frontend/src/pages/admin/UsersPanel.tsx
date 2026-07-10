import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminApi, displayName, errMsg, isAuthError,
  type AdminUser, type AdminUsage,
} from '@/services/adminApi';

const PAGE = 50;

interface Filters {
  q: string;
  userType: string;   // '' | 'guest' | 'registered'
  from: string;       // YYYY-MM-DD（最后活跃起）
  to: string;         // YYYY-MM-DD（最后活跃止）
}
const EMPTY: Filters = { q: '', userType: '', from: '', to: '' };

export default function UsersPanel() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 输入中的筛选值 vs 已生效(applied)的筛选值——「加载更多」用后者保持一致
  const [q, setQ] = useState('');
  const [userType, setUserType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [resetting, setResetting] = useState('');   // 正在清零额度的 user_id

  const load = useCallback((offset: number, f: Filters) => {
    setLoading(true);
    setError('');
    adminApi.users({
      limit: PAGE, offset,
      q: f.q || undefined,
      user_type: f.userType || undefined,
      active_from: f.from || undefined,
      active_to: f.to || undefined,
    }).then((r) => {
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setTotal(r.total);
    }).catch((e) => {
      if (isAuthError(e)) { window.location.reload(); return; }
      setError(errMsg(e));
    }).finally(() => setLoading(false));
  }, []);

  const loadUsage = useCallback(() => {
    adminApi.usage().then(setUsage).catch((e) => {
      if (isAuthError(e)) { window.location.reload(); return; }
      // 用量拉取失败不阻塞用户列表,静默降级(该列显示 —)
    });
  }, []);

  useEffect(() => {
    load(0, applied);
    loadUsage();
  }, [applied, load, loadUsage]);

  const apply = () => setApplied({ q: q.trim(), userType, from, to });
  const refresh = () => { load(0, applied); loadUsage(); };
  const reset = () => {
    setQ(''); setUserType(''); setFrom(''); setTo('');
    setApplied(EMPTY);
  };

  const usageMap = useMemo(() => {
    const m = new Map<string, number>();
    usage?.entries.forEach((e) => m.set(e.user_id, e.used));
    return m;
  }, [usage]);

  const limitFor = (t: string) =>
    (t === 'guest' ? usage?.guest_daily_limit : usage?.user_daily_limit);

  const resetQuota = async (u: AdminUser) => {
    if (!window.confirm(`确定清零「${displayName(u)}」今日已用次数？(当天恢复满额度)`)) return;
    setResetting(u.user_id);
    setError('');
    try {
      await adminApi.resetUsage(u.user_id);
      loadUsage();   // 拉回最新用量,该行归零
    } catch (e) {
      if (isAuthError(e)) { window.location.reload(); return; }
      setError(errMsg(e));
    } finally {
      setResetting('');
    }
  };

  return (
    <div>
      <div className="admin-toolbar">
        <input
          placeholder="搜索用户名 / 昵称 / ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
        />
        <select value={userType} onChange={(e) => setUserType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="guest">游客</option>
          <option value="registered">注册</option>
        </select>
        <label className="admin-dim">最后活跃</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="admin-dim">—</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={apply} disabled={loading}>查询</button>
        <button onClick={reset} disabled={loading}>重置筛选</button>
        <button onClick={refresh} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
        <span className="admin-dim">{total} 个用户</span>
      </div>
      {usage && (
        <p className="admin-dim">
          今日用量 {usage.date} · 限额：游客 {usage.guest_daily_limit} 次/天，注册 {usage.user_daily_limit} 次/天
        </p>
      )}
      {error && <p className="admin-error">{error}</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>用户</th><th>类型</th><th>会话数</th>
            <th>今日用量</th><th>注册时间</th><th>最后活跃</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const lim = limitFor(u.user_type);
            const used = usageMap.get(u.user_id) ?? 0;
            return (
              <tr key={u.user_id}>
                <td>
                  {displayName(u)}
                  <div className="admin-dim">{u.user_id}</div>
                </td>
                <td>{u.user_type === 'guest' ? '游客' : '注册'}</td>
                <td>{u.conversation_count}</td>
                <td>{usage ? `${used} / ${lim ?? '—'}` : '—'}</td>
                <td>{u.created_at ? u.created_at.slice(0, 10) : ''}</td>
                <td>{u.last_active ? u.last_active.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td>
                  <button
                    className="admin-mini"
                    disabled={!usage || used === 0 || resetting === u.user_id}
                    onClick={() => resetQuota(u)}
                    title={used === 0 ? '今日未使用,无需重置' : '清零今日已用次数'}
                  >
                    {resetting === u.user_id ? '重置中…' : '重置额度'}
                  </button>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && !loading && (
            <tr><td colSpan={7} className="admin-dim">无匹配用户</td></tr>
          )}
        </tbody>
      </table>
      {items.length < total && (
        <button disabled={loading} onClick={() => load(items.length, applied)}>
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </div>
  );
}
