import { useEffect, useMemo, useState } from 'react';
import type { PromptCallSite, PromptInfo, PromptPart, PromptStage, PromptTool } from '@/services/adminApi';

// 默认展开：短文件（接场约束、画像须知等）。长的（塔罗/占星大提示词）和重复出现的默认收起
const AUTO_EXPAND_CHARS = 700;
// 模板变量的示例值超过这个长度就折起来，免得一段对话稿把拼接顺序冲散
const INLINE_VALUE_CHARS = 60;

const trimNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');

/** 编辑框的状态与动作。同一份文件在页面上出现几次就有几个框，都接这一份状态，改哪个都同步。 */
export interface FileCtl {
  info: (name: string) => PromptInfo | undefined;
  /** 编辑框里当前的文字（未改过就是已保存的内容） */
  draft: (name: string) => string;
  dirty: (name: string) => boolean;
  edit: (name: string, value: string) => void;
  save: (name: string) => void;
  reset: (name: string) => void;
  busy: boolean;
  /** 左栏点中的文件：展开并滚过去 */
  focus: string;
}

// 同一个 .md 的连续段（模板正文 + 夹在中间的变量值）合成一块：一份文件一个编辑框
type Block = { prompt: string; parts: PromptPart[]; repeat: boolean };

type ExpandSignal = [boolean, number] | null;

const toBlocks = (parts: PromptPart[], seen: Set<string>): Block[] => {
  const blocks: Block[] = [];
  for (const part of parts) {
    const last = blocks[blocks.length - 1];
    if (part.prompt && last?.prompt === part.prompt) last.parts.push(part);
    else if (part.prompt || part.text.trim()) {
      blocks.push({ prompt: part.prompt, parts: [part], repeat: part.prompt ? seen.has(part.prompt) : false });
      if (part.prompt) seen.add(part.prompt);
    }
    // 纯换行的代码分隔段不单独占一行
  }
  return blocks;
};

/**
 * 一个阶段里的全部模型调用：每次调用的输入按发送顺序摊开，接到文件的地方就是那个文件的编辑框。
 *
 * 顺序、分段、变量怎么展开都由后端用运行时的拼装函数算好，这里只负责摆出来——
 * 拼装代码改了，这里不用改。
 */
export default function StageView({ stage, ctl }: { stage: PromptStage; ctl: FileCtl }) {
  const [expand, setExpand] = useState<ExpandSignal>(null);

  // 文件在本阶段第几次出现，决定默认展开与「同一份」提示；顺序必须和渲染一致
  const laid = useMemo(() => {
    const seen = new Set<string>();
    return stage.sites.map((site) => ({ site, blocks: toBlocks(site.parts, seen) }));
  }, [stage]);

  return (
    <div className="pm-stage-body">
      <div className="pm-head">
        <h2>{stage.label}</h2>
        <p className="admin-dim">{stage.note}</p>
      </div>
      <div className="admin-toolbar pm-tools">
        <button className="admin-mini" onClick={() => setExpand([true, Date.now()])}>展开全部文件</button>
        <button className="admin-mini" onClick={() => setExpand([false, Date.now()])}>收起全部文件</button>
        <span className="admin-dim">
          标「示例数据」的是假数据（示例用户「小夏」），只为看清它在这段输入里的位置和格式；
          线上每次按当时的用户和会话现填。
        </span>
      </div>
      {laid.map(({ site, blocks }) => (
        <CallSite key={site.title} site={site} blocks={blocks} ctl={ctl} expand={expand} />
      ))}
    </div>
  );
}

function CallSite({ site, blocks, ctl, expand }: {
  site: PromptCallSite; blocks: Block[]; ctl: FileCtl; expand: ExpandSignal;
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
        {blocks.map((block, i) => (
          block.prompt
            ? <FileBlock key={i} block={block} ctl={ctl} expand={expand} />
            : <CodePart key={i} part={block.parts[0]} />
        ))}
      </ol>
      {site.tools.length > 0 && <Tools tools={site.tools} />}
      {site.after && <p className="cs-after">↓ {site.after}</p>}
    </section>
  );
}

/** 代码直接拼进去的一段：写死的文字，或运行时填进来的数据块。 */
function CodePart({ part }: { part: PromptPart }) {
  return (
    <li className={`cs-part cs-code${part.when ? ' has-branch' : ''}`}>
      <div className="cs-part-head">
        <span className="cs-kind">代码</span>
        <span className="cs-label">{part.label}</span>
        <span className={part.sample ? 'cs-kind cs-sample' : 'cs-kind'}>
          {part.sample ? '示例数据' : '写死的文字'}
        </span>
        <Branches part={part} />
      </div>
      <pre>{trimNewlines(part.text)}</pre>
    </li>
  );
}

/** 这一段的分支：什么条件下才有、有哪几种形态。 */
function Branches({ part }: { part: PromptPart }) {
  if (!part.when && !part.variants) return null;
  return (
    <span className="cs-when">
      {part.when && <span><b>条件</b>{part.when}</span>}
      {part.variants && <span><b>形态</b>{part.variants}</span>}
    </span>
  );
}

/** 一份 .md 接进来的位置：就地编辑这个文件。 */
function FileBlock({ block, ctl, expand }: { block: Block; ctl: FileCtl; expand: ExpandSignal }) {
  const name = block.prompt;
  const info = ctl.info(name);
  const content = info?.content ?? '';
  const text = ctl.draft(name);
  const dirty = ctl.dirty(name);
  const focused = ctl.focus === name && !block.repeat;

  const variables = block.parts.filter((p) => p.variable);
  const used = block.parts.map((p) => p.text).join('');
  // 只取文件里的一节（牌阵详解那几份的文件头是给代码读的，不发给模型），其余整份原样发出去
  const section = !variables.length && used.trim() !== content.trim() ? block.parts[0].label : '';

  const [open, setOpen] = useState(!block.repeat && content.length <= AUTO_EXPAND_CHARS);
  useEffect(() => {
    if (expand) setOpen(expand[0]);
  }, [expand]);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);

  return (
    <li
      id={block.repeat ? undefined : `pm-file-${name}`}
      className={`cs-part cs-file${focused ? ' current' : ''}${block.parts[0].when ? ' has-branch' : ''}`}
    >
      <div className="cs-part-head">
        <span className="cs-kind">文件</span>
        <span className="cs-label">{name}</span>
        <span className="cs-dim">{info?.label}</span>
        {section && <span className="cs-kind cs-sample">本处只取 {section}</span>}
        {variables.length > 0 && <span className="cs-kind cs-sample">模板 · {variables.length} 个变量</span>}
        {info?.overridden && <span className="cs-kind cs-over">已覆盖默认版</span>}
        {dirty && <span className="cs-kind cs-dirty">未保存</span>}
        {block.repeat && <span className="cs-dim">本页上面已有同一份，两处编辑同步</span>}
        <Branches part={block.parts[0]} />
        <button className="cs-toggle" onClick={() => setOpen(!open)}>
          {open ? '收起' : `展开编辑 · ${content.length} 字`}
        </button>
      </div>
      {open && (
        <>
          {section && (
            <div className="cs-section">
              <span className="cs-dim">这一处实际发出去的就是下面这一节：</span>
              <pre>{trimNewlines(used)}</pre>
            </div>
          )}
          <textarea
            className="cs-edit"
            value={text}
            spellCheck={false}
            rows={Math.min(40, Math.max(4, text.split('\n').length + 1))}
            onChange={(e) => ctl.edit(name, e.target.value)}
          />
          <div className="cs-edit-bar">
            <button className="admin-mini" disabled={ctl.busy || !dirty} onClick={() => ctl.save(name)}>
              保存
            </button>
            <button
              className="admin-mini"
              disabled={ctl.busy || !info?.overridden}
              onClick={() => ctl.reset(name)}
            >
              重置为默认
            </button>
            <span className="admin-dim">保存后下一次对话立即生效</span>
          </div>
          {variables.length > 0 && <Variables parts={variables} />}
        </>
      )}
    </li>
  );
}

/** 模板正文里那些 {xxx}，代码运行时填的是什么。 */
function Variables({ parts }: { parts: PromptPart[] }) {
  return (
    <div className="cs-vars">
      <span className="cs-dim">正文里的 {'{…}'} 由代码按位置填入，下面是示例值：</span>
      {parts.map((p, i) => {
        const value = trimNewlines(p.text);
        const short = value.length <= INLINE_VALUE_CHARS && !value.includes('\n');
        return (
          <div key={i} className="cs-var-row">
            <code>{p.label}</code>
            {short ? <span className="cs-var-inline">{value}</span> : (
              <details>
                <summary>{value.length} 字 · 展开</summary>
                <pre>{value}</pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
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

/** 左栏点了文件之后滚到它接进去的那一处。换阶段时 DOM 刚换，等一帧再找。 */
export function useScrollToFile(focus: string, stageKey: string) {
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => {
      document.getElementById(`pm-file-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [focus, stageKey]);
}
