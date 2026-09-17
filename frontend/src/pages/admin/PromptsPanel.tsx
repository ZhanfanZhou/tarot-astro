import { useEffect, useState } from 'react';
import {
  adminApi, errMsg, isAuthError, type PromptDetail, type PromptInfo,
} from '@/services/adminApi';
import PromptComposition from './PromptComposition';

export default function PromptsPanel() {
  const [list, setList] = useState<PromptInfo[]>([]);
  const [current, setCurrent] = useState<PromptDetail | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // 内容 = 编辑 .md；组成 = 它用在哪几次调用里、前后接了什么（切换文件时保持当前视图）
  const [view, setView] = useState<'content' | 'composition'>('content');

  const refresh = () =>
    adminApi.prompts().then((r) => setList(r.items)).catch((e) => {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    });

  useEffect(() => {
    refresh();
  }, []);

  const open = async (name: string) => {
    setError('');
    setNotice('');
    try {
      const d = await adminApi.prompt(name);
      setCurrent(d);
      setText(d.content);
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    }
  };

  const save = async () => {
    if (!current) return;
    if (!window.confirm(`确认保存对「${current.label}」的修改？保存后下一次对话立即生效。`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await adminApi.savePrompt(current.name, text);
      await open(current.name);
      refresh();
      setNotice('已保存，即时生效');
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!current) return;
    if (!window.confirm(`确认丢弃线上修改，恢复「${current.label}」为代码默认版？`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await adminApi.resetPrompt(current.name);
      await open(current.name);
      refresh();
      setNotice('已重置为默认');
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-prompts">
      <ul className="prompt-list">
        {list.map((p) => (
          <li key={p.name} className={current?.name === p.name ? 'active' : ''} onClick={() => open(p.name)}>
            <span>{p.label}</span>
            <span className="admin-dim">
              {p.overridden && <em className="badge">已覆盖</em>}
              {p.chars} 字
            </span>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="prompt-editor">
          <div className="admin-toolbar">
            <span className="title">{current.label}</span>
            <span className="admin-dim">{current.name}</span>
            <button disabled={busy || text === current.content} onClick={save}>保存</button>
            <button disabled={busy || !current.overridden} onClick={reset}>重置为默认</button>
          </div>
          <div className="prompt-views">
            <button className={view === 'content' ? 'active' : ''} onClick={() => setView('content')}>内容</button>
            <button className={view === 'composition' ? 'active' : ''} onClick={() => setView('composition')}>
              组成 · {current.call_sites.length} 处调用
            </button>
          </div>
          {error && <p className="admin-error">{error}</p>}
          {notice && <p className="admin-notice">{notice}</p>}
          {view === 'content' ? (
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          ) : (
            <PromptComposition
              sites={current.call_sites}
              current={current.name}
              stale={text !== current.content}
              onOpen={open}
            />
          )}
        </div>
      ) : (
        <p className="admin-dim">← 选择一个提示词查看/编辑</p>
      )}
    </div>
  );
}
