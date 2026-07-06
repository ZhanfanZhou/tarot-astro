import { useEffect, useState } from 'react';
import { adminApi, errMsg, isAuthError, type AdminStats } from '@/services/adminApi';

export default function OverviewPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.stats().then(setStats).catch((e) => {
      setError(errMsg(e));
      if (isAuthError(e)) window.location.reload();
    });
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!stats) return <p className="admin-dim">加载中…</p>;

  const items: Array<[string, number]> = [
    ['总用户', stats.total_users],
    ['游客', stats.guest_users],
    ['注册用户', stats.registered_users],
    ['总会话', stats.total_conversations],
    ['今日新会话', stats.today_new_conversations],
    ['今日消息', stats.today_messages],
  ];
  return (
    <div className="admin-stats">
      {items.map(([label, value]) => (
        <div key={label} className="admin-stat-card">
          <div className="num">{value}</div>
          <div className="label">{label}</div>
        </div>
      ))}
    </div>
  );
}
