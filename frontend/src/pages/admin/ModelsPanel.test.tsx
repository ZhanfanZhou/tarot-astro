import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import type { LlmAgentState, LlmConfig } from '@/services/adminApi';

// 后端返回的形状（agent_config.describe()）：K3、DeepSeek 有三档，Gemini 不能设
const LEVELS = ['low', 'high', 'max'];
const agent = (a: Partial<LlmAgentState>): LlmAgentState => ({
  agent: 'opening', label: '前置（开场）', provider: 'kimi', model: 'kimi-k3',
  reasoning_effort: 'low', source: 'override', env_provider: 'kimi', env_model: 'kimi-k3',
  env_reasoning_effort: 'low', key_ready: true, in_catalog: true, ...a,
});

const CONFIG: LlmConfig = {
  agents: [
    agent({}),
    agent({ agent: 'memory', label: '记忆（写笔记本）', provider: 'gemini', model: 'gemini-3.8-flash',
            reasoning_effort: '', source: 'env', env_provider: 'gemini', env_model: 'gemini-3.8-flash',
            env_reasoning_effort: '' }),
  ],
  providers: [
    { provider: 'gemini', label: 'Gemini', models: [{ id: 'gemini-3.8-flash', label: '3.8 Flash' }] },
    { provider: 'deepseek', label: 'DeepSeek', models: [
      { id: 'deepseek-flash', label: 'Flash', efforts: LEVELS, effort_default: 'high' },
    ] },
    { provider: 'kimi', label: 'Kimi', models: [
      { id: 'kimi-k3', label: 'K3', efforts: LEVELS, effort_default: 'max' },
    ] },
  ],
};

const setLlmAgent = vi.fn(async () => CONFIG);
vi.mock('@/services/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/services/adminApi')>()),
  adminApi: {
    llmConfig: async () => CONFIG,
    setLlmAgent: (...a: [string, string, string, string]) => setLlmAgent(...a),
    resetLlmAgent: vi.fn(),
  },
}));

beforeEach(() => setLlmAgent.mockClear());
afterEach(cleanup);

const card = async (title: string) => {
  const { default: ModelsPanel } = await import('./ModelsPanel');
  const { container } = render(<ModelsPanel />);
  const heading = await within(container).findByText(title);
  return heading.closest('section')!;
};
const selectOf = (section: HTMLElement, label: string) =>
  within(section).getByText(label).parentElement!.querySelector('select')!;

describe('ModelsPanel 思考强度', () => {
  it('只列这个模型认的档位，标出模型默认，改档位带着当前模型发出去', async () => {
    const section = await card('前置（开场）');
    const effort = selectOf(section, '思考强度');
    expect([...effort.options].map((o) => o.textContent)).toEqual(['low', 'high', 'max（模型默认）']);
    expect(effort.value).toBe('low');

    fireEvent.change(effort, { target: { value: 'high' } });
    expect(setLlmAgent).toHaveBeenCalledWith('opening', 'kimi', 'kimi-k3', 'high');
  });

  it('换到没有档位的模型：思考强度清空，不发', async () => {
    const section = await card('前置（开场）');
    fireEvent.change(selectOf(section, 'Provider'), { target: { value: 'gemini' } });
    expect(setLlmAgent).toHaveBeenCalledWith('opening', 'gemini', 'gemini-3.8-flash', '');
  });

  it('换 provider：新模型也认当前档位就留着', async () => {
    const section = await card('前置（开场）');
    fireEvent.change(selectOf(section, 'Provider'), { target: { value: 'deepseek' } });
    expect(setLlmAgent).toHaveBeenCalledWith('opening', 'deepseek', 'deepseek-flash', 'low');
  });

  it('不能设的模型不给下拉，写明原因', async () => {
    const section = await card('记忆（写笔记本）');
    expect(within(section).getByText('这个模型不能设')).toBeInTheDocument();
    expect(within(section).getByText('思考强度').parentElement!.querySelector('select')).toBeNull();
  });
});
