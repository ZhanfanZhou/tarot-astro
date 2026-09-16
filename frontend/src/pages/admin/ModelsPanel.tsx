import { useEffect, useState } from 'react';
import {
  adminApi, errMsg, isAuthError,
  type LlmAgentState, type LlmConfig, type LlmProviderOption,
} from '@/services/adminApi';

/**
 * 三个 Agent 各自选 provider + model。
 *
 * 改完下一次对话即生效（后端每次实时读盘），不用重启、也不用再去改 .env。
 * 模型清单由后端给，不在前端写死——「能不能强制交单」这类能力标注和后端是同一份数据。
 */
export default function ModelsPanel() {
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const handle = (e: unknown) => {
    if (isAuthError(e)) {
      window.location.reload();
      return;
    }
    setError(errMsg(e));
  };

  useEffect(() => {
    adminApi.llmConfig().then(setConfig).catch(handle);
  }, []);

  const apply = async (agent: LlmAgentState, provider: string, model: string) => {
    if (provider === agent.provider && model === agent.model) return;
    setBusy(agent.agent);
    setError('');
    setNotice('');
    try {
      setConfig(await adminApi.setLlmAgent(agent.agent, provider, model));
      setNotice(`${agent.label.split('（')[0]} 已切到 ${model}，下一次对话生效`);
    } catch (e) {
      handle(e);
    } finally {
      setBusy('');
    }
  };

  const reset = async (agent: LlmAgentState) => {
    if (!window.confirm(`确认让「${agent.label}」回到 .env 的默认值（${agent.env_provider} / ${agent.env_model}）？`)) return;
    setBusy(agent.agent);
    setError('');
    setNotice('');
    try {
      setConfig(await adminApi.resetLlmAgent(agent.agent));
      setNotice('已恢复 .env 默认');
    } catch (e) {
      handle(e);
    } finally {
      setBusy('');
    }
  };

  if (error && !config) return <p className="admin-error">{error}</p>;
  if (!config) return <p className="admin-dim">加载中…</p>;

  return (
    <div>
      {error && <div className="admin-error">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      <p className="models-intro">
        每个 Agent 独立选模型。<strong>记忆</strong>只产 JSON、不调工具，挑便宜的即可；
        <strong>解读</strong>要工具调用；<strong>前置</strong>额外需要「强制交单」能力，
        不支持的模型会自动跳过这一层守卫（至多多两轮追问，不影响主流程）。
      </p>

      <div className="models-grid">
        {config.agents.map((agent) => (
          <AgentCard
            key={agent.agent}
            agent={agent}
            providers={config.providers}
            busy={busy === agent.agent}
            onApply={apply}
            onReset={reset}
          />
        ))}
      </div>
    </div>
  );
}

function AgentCard({
  agent, providers, busy, onApply, onReset,
}: {
  agent: LlmAgentState;
  providers: LlmProviderOption[];
  busy: boolean;
  onApply: (a: LlmAgentState, provider: string, model: string) => void;
  onReset: (a: LlmAgentState) => void;
}) {
  const current = providers.find((p) => p.provider === agent.provider);
  const needsForcedTool = agent.agent === 'opening';

  return (
    <section className="models-card">
      <header>
        <h3>{agent.label}</h3>
        <span className={agent.source === 'override' ? 'models-tag override' : 'models-tag'}>
          {agent.source === 'override' ? '管理页已覆盖' : '跟随 .env'}
        </span>
      </header>

      <label>
        <span>Provider</span>
        <select
          value={agent.provider}
          disabled={busy}
          onChange={(e) => {
            const next = providers.find((p) => p.provider === e.target.value);
            if (next?.models.length) onApply(agent, next.provider, next.models[0].id);
          }}
        >
          {providers.map((p) => (
            <option key={p.provider} value={p.provider}>{p.label}</option>
          ))}
          {!current && <option value={agent.provider}>{agent.provider}（清单外）</option>}
        </select>
      </label>

      <label>
        <span>模型</span>
        <select
          value={agent.model}
          disabled={busy || !current}
          onChange={(e) => onApply(agent, agent.provider, e.target.value)}
        >
          {current?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} · {m.label}
            </option>
          ))}
          {!agent.in_catalog && (
            <option value={agent.model}>{agent.model}（清单外，来自 .env）</option>
          )}
        </select>
      </label>

      {needsForcedTool && !agent.forced_tool && (
        <p className="models-warn">
          这个模型不支持强制交单（Kimi 全系如此），守卫第 2 层自动降级。开场追问最多到
          第 5 句会由守卫第 3 层强制进入解读，不会卡住——代价至多多两轮追问。
        </p>
      )}
      {!agent.key_ready && (
        <p className="models-warn">该 provider 的 API key 没配，当前对话会直接报错。</p>
      )}

      <footer>
        <span className="models-env">.env：{agent.env_provider} / {agent.env_model}</span>
        {agent.source === 'override' && (
          <button disabled={busy} onClick={() => onReset(agent)}>恢复默认</button>
        )}
      </footer>
    </section>
  );
}
