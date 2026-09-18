import { useEffect, useState } from 'react';
import type { PromptCallSite, PromptPart, PromptTool } from '@/services/adminApi';

// 默认展开：短文件（接场约束等）和填了变量的模板；长的（塔罗/占星大提示词）默认收起
const AUTO_EXPAND_CHARS = 600;

const trimNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');

// 同一个 .md 的连续段（模板正文 + 夹在中间的变量值）合成一块显示，读起来就是一份填好的模板
type Block = { prompt: string; parts: PromptPart[] };

const toBlocks = (parts: PromptPart[]): Block[] => {
  const blocks: Block[] = [];
  for (const part of parts) {
    const last = blocks[blocks.length - 1];
    if (part.prompt && last?.prompt === part.prompt) last.parts.push(part);
    else if (part.prompt || part.text.trim()) blocks.push({ prompt: part.prompt, parts: [part] });
    // 纯换行的代码分隔段不单独占一行
  }
  return blocks;
};

interface Props {
  sites: PromptCallSite[];
  current: string;
  /** 编辑器里有没保存的修改 */
  stale: boolean;
  onOpen: (name: string) => void;
}

/**
 * 一个提示词用在哪几次模型调用里、前后接了什么（只读）。
 *
 * 数据是后端用示例数据跑运行时拼装函数得到的，这里只负责摊开，不理解任何拼接规则——
 * 拼装改了，这里不用改。
 */
export default function PromptComposition({ sites, current, stale, onOpen }: Props) {
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  return (
    <div className="composition">
      <p className="models-intro">
        这个文件用在下面 {sites.length} 次模型调用里。每处按实际发送顺序列出各段：
        <strong>文件</strong>是可以在这里编辑的提示词，其中高亮的是<strong>模板变量</strong>填进去的值；
        <strong>代码拼接</strong>由程序生成。
      </p>
      <p className="models-warn">
        标着<strong>示例</strong>的内容（用户资料、关系上下文、起手单、牌、笔记正文等）是固定的假数据，
        用的是示例用户「小夏」，不是任何真实用户的资料——只为看清这一段在提示词里的位置和格式。
        线上每次对话由代码按当时的用户和会话现填。
      </p>
      <div className="admin-toolbar">
        <button className="admin-mini" onClick={() => setExpandAll(true)}>展开全部文件</button>
        <button className="admin-mini" onClick={() => setExpandAll(false)}>收起全部文件</button>
      </div>
      {stale && <p className="models-warn">编辑器里有未保存的修改，下面显示的是已保存的版本。</p>}
      {sites.map((site) => (
        <CallSite key={site.title} site={site} current={current} onOpen={onOpen} expandAll={expandAll} />
      ))}
    </div>
  );
}

function CallSite({ site, current, onOpen, expandAll }: {
  site: PromptCallSite; current: string; onOpen: (name: string) => void; expandAll: boolean | null;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(site.parts.map((p) => p.text).join(''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="cs-card">
      <header>
        <h3>{site.title}</h3>
        {site.agent ? (
          <span className="models-tag">
            {site.agent_label?.split('（')[0]} · {site.provider} / {site.model}
          </span>
        ) : (
          <span className="models-tag">不发给模型</span>
        )}
        {site.agent && (
          <button className="admin-mini" onClick={copy}>{copied ? '已复制' : '复制整段'}</button>
        )}
      </header>
      <p className="cs-delivery">{site.delivery}</p>
      <ol className="cs-parts">
        {toBlocks(site.parts).map((block, i) => (
          block.prompt
            ? <FileBlock key={i} block={block} current={current} onOpen={onOpen} expandAll={expandAll} />
            : <CodePart key={i} part={block.parts[0]} />
        ))}
      </ol>
      {site.force_tool && (
        <p className="cs-meta">
          强制调用 <code>{site.force_tool.name}</code>：{site.force_tool.when}
          {!site.force_tool.supported && '（当前模型不支持强制调用，这一层会跳过）'}
        </p>
      )}
      {site.tools.length > 0 && <Tools tools={site.tools} />}
      {site.after && <p className="cs-after">↓ {site.after}</p>}
    </section>
  );
}

function CodePart({ part }: { part: PromptPart }) {
  return (
    <li className="cs-part cs-code">
      <div className="cs-part-head">
        <span className="cs-kind">代码拼接</span>
        <span className="cs-kind cs-sample">示例</span>
        <span className="cs-label">{part.label}</span>
        {part.when && <span className="cs-when">{part.when}</span>}
      </div>
      <pre>{trimNewlines(part.text)}</pre>
    </li>
  );
}

function FileBlock({ block, current, onOpen, expandAll }: {
  block: Block; current: string; onOpen: (name: string) => void; expandAll: boolean | null;
}) {
  const first = block.parts[0];
  const chars = block.parts.reduce((n, p) => n + p.text.length, 0);
  const variables = block.parts.filter((p) => p.variable).length;
  const [open, setOpen] = useState(variables > 0 || chars <= AUTO_EXPAND_CHARS);
  useEffect(() => {
    if (expandAll !== null) setOpen(expandAll);
  }, [expandAll]);

  const isCurrent = block.prompt === current;
  const lastIndex = block.parts.length - 1;
  return (
    <li className={`cs-part cs-file${isCurrent ? ' current' : ''}`}>
      <div className="cs-part-head">
        <span className="cs-kind">文件</span>
        {isCurrent ? (
          <span className="cs-label">{block.prompt}（本文件）</span>
        ) : (
          <button className="cs-link" onClick={() => onOpen(block.prompt)}>{block.prompt}</button>
        )}
        {first.label && !first.variable && <span className="cs-label">{first.label}</span>}
        {variables > 0 && <span className="cs-when">填入 {variables} 个模板变量（示例值）</span>}
        {first.when && <span className="cs-when">{first.when}</span>}
        <button className="cs-toggle" onClick={() => setOpen(!open)}>
          {open ? '收起' : `展开 · ${chars} 字`}
        </button>
      </div>
      {open && (
        <pre>
          {block.parts.map((p, i) => {
            let text = p.text;
            if (i === 0) text = text.replace(/^\n+/, '');
            if (i === lastIndex) text = text.replace(/\n+$/, '');
            return p.variable ? (
              <mark key={i} className="cs-var">
                <span className="cs-var-name">{p.label} · 示例</span>
                {text}
              </mark>
            ) : (
              <span key={i}>{text}</span>
            );
          })}
        </pre>
      )}
    </li>
  );
}

function Tools({ tools }: { tools: PromptTool[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cs-tools">
      <div className="cs-part-head">
        <span className="cs-kind">工具</span>
        <span className="cs-label">{tools.map((t) => t.name).join('、')}</span>
        <button className="cs-toggle" onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开说明'}
        </button>
      </div>
      {open && tools.map((t) => (
        <div key={t.name} className="cs-tool">
          <code>{t.name}</code>
          <pre>{t.description}</pre>
          <pre className="cs-params">{JSON.stringify(t.parameters, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
