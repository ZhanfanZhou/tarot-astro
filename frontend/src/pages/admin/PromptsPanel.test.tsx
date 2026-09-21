import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import type { PromptCallSite, PromptInfo, PromptPart, PromptStage } from '@/services/adminApi';

// 后端返回的形状（prompt_assembly.stages()）搭一份最小样本：一个阶段、两次调用、
// 同一份文件出现两次 + 一段代码拼的数据 + 一个有分支条件的段。
const part = (p: Partial<PromptPart>): PromptPart =>
  ({ text: '', prompt: '', variable: false, sample: false, label: '', when: '', variants: '', ...p });

const PERSONA = '你是一位占卜师。\n说话克制。';

const site = (title: string, parts: PromptPart[]): PromptCallSite => ({
  title, stage: 'opening', agent: 'opening', agent_label: '开场 Agent',
  provider: 'gemini', model: 'gemini-x', delivery: '系统提示词',
  parts, tools: [], after: '',
});

const STAGE: PromptStage = {
  key: 'opening', label: '开场幕', note: '前半场',
  prompts: ['opening_persona.md'],
  sites: [
    site('开场白（创建会话那一次）', [part({ text: PERSONA, prompt: 'opening_persona.md' })]),
    site('开场 · 每一轮对话', [
      part({ text: PERSONA, prompt: 'opening_persona.md' }),
      part({ text: '\n\n# <用户画像>\n爱加班', label: '用户画像', sample: true, when: '注册用户才有' }),
    ]),
  ],
};

const ITEMS: PromptInfo[] = [{
  name: 'opening_persona.md', label: '人设与迎接', overridden: false,
  chars: PERSONA.length, updated_at: null, content: PERSONA,
}];

const savePrompt = vi.fn(async () => ITEMS[0]);
vi.mock('@/services/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/services/adminApi')>()),
  adminApi: {
    prompts: async () => ({ items: ITEMS, stages: [STAGE] }),
    savePrompt: (...a: [string, string]) => savePrompt(...a),
    resetPrompt: vi.fn(),
  },
}));

beforeEach(() => savePrompt.mockClear());
// vitest 未开 globals，自动清理不生效——两个用例会叠在同一个 document 里
afterEach(cleanup);

describe('PromptsPanel', () => {
  it('按阶段分组，接到文件的位置就是可编辑的文件框', async () => {
    const { default: PromptsPanel } = await import('./PromptsPanel');
    const { container } = render(<PromptsPanel />);
    const view = within(container);
    await view.findByText('前半场');

    // 左栏按阶段列出这一段用到的文件
    expect(within(container.querySelector('.pm-nav')!).getByText('人设与迎接')).toBeInTheDocument();
    // 这一阶段的两次调用都摊开了
    expect(view.getByText('开场白（创建会话那一次）')).toBeInTheDocument();
    expect(view.getByText('开场 · 每一轮对话')).toBeInTheDocument();

    // 文件接进来的地方就是编辑框；第二次出现折起来，标明与上面同一份
    const boxes = container.querySelectorAll<HTMLTextAreaElement>('textarea.cs-edit');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].value).toBe(PERSONA);
    expect(view.getByText(/两处编辑同步/)).toBeInTheDocument();

    // 代码拼进去的数据段标成示例，条件写在「分支」上
    expect(view.getByText('示例数据')).toBeInTheDocument();
    expect(view.getByText('注册用户才有')).toBeInTheDocument();
  });

  it('两处编辑框共用一份草稿，保存的是编辑后的内容', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { default: PromptsPanel } = await import('./PromptsPanel');
    const { container } = render(<PromptsPanel />);
    const view = within(container);
    await view.findByText('前半场');

    fireEvent.click(view.getByText('展开全部文件'));
    const boxes = () => container.querySelectorAll<HTMLTextAreaElement>('textarea.cs-edit');
    await waitFor(() => expect(boxes()).toHaveLength(2));

    fireEvent.change(boxes()[1], { target: { value: '改过的人设' } });
    expect(boxes()[0].value).toBe('改过的人设');   // 同一份文件，两个框同步

    fireEvent.click(container.querySelectorAll('.cs-edit-bar button')[0]);
    await waitFor(() => expect(savePrompt).toHaveBeenCalledWith('opening_persona.md', '改过的人设'));
  });
});
