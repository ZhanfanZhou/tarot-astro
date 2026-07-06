import { useCallback, useEffect, useState } from 'react';
import { adminApi, displayName, errMsg, isAuthError, type AdminUser } from '@/services/adminApi';

const PAGE = 50;

export default function UsersPanel() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback((offset: number) => {
    adminApi.users({ limit: PAGE, offset }).then((r) => {
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setTotal(r.total);
    }).catch((e) => {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    });
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div>
      {error && <p className="admin-error">{error}</p>}
      <table className="admin-table">
        <thead>
          <tr><th>用户</th><th>类型</th><th>会话数</th><th>注册时间</th><th>最后活跃</th></tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.user_id}>
              <td>
                {displayName(u)}
                <div className="admin-dim">{u.user_id}</div>
              </td>
              <td>{u.user_type === 'guest' ? '游客' : '注册'}</td>
              <td>{u.conversation_count}</td>
              <td>{u.created_at ? u.created_at.slice(0, 10) : ''}</td>
              <td>{u.last_active ? u.last_active.slice(0, 16).replace('T', ' ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length < total && <button onClick={() => load(items.length)}>加载更多</button>}
    </div>
  );
}
