import { useEffect, useMemo, useState } from 'react';
import { adminApi, errMsg, isAuthError, type PromptInfo, type PromptStage } from '@/services/adminApi';
import StageView, { useScrollToFile, type FileCtl } from './PromptComposition';

/**
 * 提示词管理：按阶段分组，一个阶段一屏。
 *
 * 只有一个视图——一次模型调用的输入按发送顺序摊开，接到 .md 的地方就是那份文件的编辑框，
 * 不再分「内容 / 组成」两个页签。左栏是这一阶段用到的文件，点了滚到它接进去的位置。
 */
export default function PromptsPanel() {
  const [stages, setStages] = useState<PromptStage[]>([]);
  const [items, setItems] = useState<PromptInfo[]>([]);
  const [stageKey, setStageKey] = useState('');
  const [focus, setFocus] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const byName = useMemo(() => Object.fromEntries(items.map((p) => [p.name, p])), [items]);

  const load = async () => {
    const r = await adminApi.prompts();
    setStages(r.stages);
    setItems(r.items);
    setStageKey((k) => (r.stages.some((s) => s.key === k) ? k : r.stages[0]?.key ?? ''));
  };

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      if (isAuthError(e)) {
        window.location.reload();
        return;
      }
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    run(load);
  }, []);

  useScrollToFile(focus, stageKey);

  const ctl: FileCtl = {
    info: (name) => byName[name],
    draft: (name) => drafts[name] ?? byName[name]?.content ?? '',
    dirty: (name) => name in drafts && drafts[name] !== byName[name]?.content,
    edit: (name, value) => setDrafts((d) => ({ ...d, [name]: value })),
    busy,
    focus,
    save: (name) => {
      const info = byName[name];
      const text = drafts[name];
      if (!info || text === undefined || text === info.content) return;
      if (!window.confirm(`确认保存对「${info.label}（${name}）」的修改？保存后下一次对话立即生效。`)) return;
      setBusy(true);
      run(async () => {
        await adminApi.savePrompt(name, text);
        await load();
        setDrafts(({ [name]: _dropped, ...rest }) => rest);
        setNotice(`已保存 ${name}，即时生效`);
      }).finally(() => setBusy(false));
    },
    reset: (name) => {
      const info = byName[name];
      if (!info) return;
      if (!window.confirm(`确认丢弃线上修改，把「${info.label}（${name}）」恢复为代码默认版？`)) return;
      setBusy(true);
      run(async () => {
        await adminApi.resetPrompt(name);
        await load();
        setDrafts(({ [name]: _dropped, ...rest }) => rest);
        setNotice(`${name} 已恢复为默认版`);
      }).finally(() => setBusy(false));
    },
  };

  const stage = stages.find((s) => s.key === stageKey);

  return (
    <div className="pm">
      <nav className="pm-nav">
        {stages.map((st) => (
          <div key={st.key} className={`pm-group${st.key === stageKey ? ' active' : ''}`}>
            <button
              className="pm-group-head"
              onClick={() => {
                setStageKey(st.key);
                setFocus('');
              }}
            >
              <span>{st.label}</span>
              <span className="admin-dim">{st.sites.length} 次调用</span>
            </button>
            <ul>
              {st.prompts.map((name) => (
                <li key={name}>
                  <button
                    className={st.key === stageKey && focus === name ? 'active' : ''}
                    onClick={() => {
                      setStageKey(st.key);
                      setFocus(name);
                    }}
                  >
                    <span className="pm-file-label">
                      {byName[name]?.label ?? name}
                      {ctl.dirty(name) && <em className="pm-dot" title="有未保存的修改">●</em>}
                      {byName[name]?.overridden && <em className="badge">改</em>}
                    </span>
                    <span className="pm-file-name">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <section className="pm-body">
        {error && <p className="admin-error">{error}</p>}
        {notice && <p className="admin-notice">{notice}</p>}
        {stage && <StageView stage={stage} ctl={ctl} />}
      </section>
    </div>
  );
}
