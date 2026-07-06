import { useState } from 'react';
import { adminApi, clearAdminToken, errMsg, getAdminToken, setAdminToken } from '@/services/adminApi';
import OverviewPanel from './OverviewPanel';
import ConversationsPanel from './ConversationsPanel';
import UsersPanel from './UsersPanel';
import PromptsPanel from './PromptsPanel';
import UsagePanel from './UsagePanel';
import './admin.css';

type Tab = 'overview' | 'conversations' | 'users' | 'prompts' | 'usage';
const TABS: Array<[Tab, string]> = [
  ['overview', '概览'],
  ['conversations', '会话'],
  ['users', '用户'],
  ['prompts', 'Prompt'],
  ['usage', '用量'],
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [tab, setTab] = useState<Tab>('conversations');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      setAdminToken(await adminApi.login(password));
      setAuthed(true);
      setPassword('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <div className="admin-login">
        <h1>后台管理</h1>
        <input
          type="password"
          value={password}
          placeholder="管理员密码"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && password && login()}
        />
        <button onClick={login} disabled={busy || !password}>
          {busy ? '登录中…' : '登录'}
        </button>
        {error && <p className="admin-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="admin-root">
      <header className="admin-header">
        <span className="admin-brand">占卜屋 · 后台</span>
        <nav>
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button
          className="admin-logout"
          onClick={() => {
            clearAdminToken();
            setAuthed(false);
          }}
        >
          退出
        </button>
      </header>
      <main className="admin-main">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'conversations' && <ConversationsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'prompts' && <PromptsPanel />}
        {tab === 'usage' && <UsagePanel />}
      </main>
    </div>
  );
}
