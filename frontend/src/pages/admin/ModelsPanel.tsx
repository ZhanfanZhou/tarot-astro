import { useEffect, useState } from 'react';
import {
  adminApi, errMsg, isAuthError,
  type LlmAgentState, type LlmConfig, type LlmModelOption, type LlmProviderOption,
} from '@/services/adminApi';

/**
 * 三个 Agent 各自选 provider + model + 思考强度。
 *
 * 改完下一次对话即生效（后端每次实时读盘），不用重启、也不用再去改 .env。
 * 模型清单和每个模型认哪几档思考强度都由后端给（catalog.py），不在前端写死。
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

  const apply = async (agent: LlmAgentState, provider: string, model: string, effort: string) => {
    if (provider === agent.provider && model === agent.model && effort === agent.reasoning_effort) return;
    setBusy(agent.agent);
    setError('');
    setNotice('');
    try {
      setConfig(await adminApi.setLlmAgent(agent.agent, provider, model, effort));
      const what = effort ? `${model} · 思考强度 ${effort}` : model;
      setNotice(`${agent.label.split('（')[0]} 已切到 ${what}，下一次对话生效`);
    } catch (e) {
      handle(e);
    } finally {
      setBusy('');
    }
  };

  const reset = async (agent: LlmAgentState) => {
    if (!window.confirm(`确认让「${agent.label}」回到 .env 的默认值（${envSummary(agent)}）？`)) return;
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
        <strong>解读</strong>与<strong>前置</strong>都要工具调用，前置还要读得懂一段
        对话该不该交单，模型太小会一直追问。
        思考强度只有部分模型能设，档位越高想得越久、回得越慢。
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

const envSummary = (a: LlmAgentState) =>
  [a.env_provider, a.env_model, a.env_reasoning_effort].filter(Boolean).join(' / ');

/** 换模型时思考强度跟过去：新模型认这一档就留着，不认就清空（不发，用模型默认） */
const carryEffort = (effort: string, model: LlmModelOption | undefined) =>
  model?.efforts?.includes(effort) ? effort : '';

function AgentCard({
  agent, providers, busy, onApply, onReset,
}: {
  agent: LlmAgentState;
  providers: LlmProviderOption[];
  busy: boolean;
  onApply: (a: LlmAgentState, provider: string, model: string, effort: string) => void;
  onReset: (a: LlmAgentState) => void;
}) {
  const current = providers.find((p) => p.provider === agent.provider);
  const currentModel = current?.models.find((m) => m.id === agent.model);
  const efforts = currentModel?.efforts ?? [];

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
            const first = next?.models[0];
            if (next && first) {
              onApply(agent, next.provider, first.id, carryEffort(agent.reasoning_effort, first));
            }
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
          onChange={(e) => {
            const next = current?.models.find((m) => m.id === e.target.value);
            onApply(agent, agent.provider, e.target.value, carryEffort(agent.reasoning_effort, next));
          }}
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

      <label>
        <span>思考强度</span>
        {efforts.length ? (
          <select
            value={agent.reasoning_effort || currentModel?.effort_default}
            disabled={busy}
            onChange={(e) => onApply(agent, agent.provider, agent.model, e.target.value)}
          >
            {efforts.map((level) => (
              <option key={level} value={level}>
                {level}{level === currentModel?.effort_default ? '（模型默认）' : ''}
              </option>
            ))}
          </select>
        ) : (
          <em className="models-na">这个模型不能设</em>
        )}
      </label>

      {!agent.key_ready && (
        <p className="models-warn">该 provider 的 API key 没配，当前对话会直接报错。</p>
      )}

      <footer>
        <span className="models-env">.env：{envSummary(agent)}</span>
        {agent.source === 'override' && (
          <button disabled={busy} onClick={() => onReset(agent)}>恢复默认</button>
        )}
      </footer>
    </section>
  );
}
