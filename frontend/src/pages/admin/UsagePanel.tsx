import { useEffect, useState } from 'react';
import { adminApi, displayName, errMsg, isAuthError, type AdminUsage } from '@/services/adminApi';

export default function UsagePanel() {
  const [data, setData] = useState<AdminUsage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.usage().then(setData).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!data) return <p className="admin-dim">加载中…</p>;

  return (
    <div>
      <p className="admin-dim">
        {data.date} · 限额：游客 {data.guest_daily_limit} 次/天，注册 {data.user_daily_limit} 次/天
      </p>
      {data.entries.length === 0 ? (
        <p className="admin-dim">今日暂无调用</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>用户</th><th>类型</th><th>今日已用</th></tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.user_id}>
                <td>
                  {displayName(e)}
                  <div className="admin-dim">{e.user_id}</div>
                </td>
                <td>{e.user_type === 'guest' ? '游客' : e.user_type ? '注册' : '未知'}</td>
                <td>{e.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
