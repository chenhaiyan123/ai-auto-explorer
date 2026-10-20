import React, { useState } from 'react';
import { FeedItem } from '../types';

/**
 * 对话流里的一条：进度行 或 问题卡。
 *
 * 设计取舍（参照 Codex）：
 * - 进度只占一行，灰色小字，有补充说明的点一下才展开；
 * - 问题卡一句话说清要你决定什么，选项最多 4 个，主选项高亮；
 * - 可以不点按钮、直接打一句话回答（等于选了 input.optionId 并带上这句话）；
 * - 答完收成一行「→ 你选了：xxx」，留在记录里，不再占地方。
 */
const FeedCard: React.FC<{
  item: FeedItem;
  onAnswer: (item: FeedItem, optionId: string, text?: string) => void;
  onOpenNode?: (nodeId: string) => void;
  busy?: boolean;
}> = ({ item, onAnswer, onOpenNode, busy }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ask = item.ask;

  const title = (
    <span className={item.nodeId && onOpenNode ? 'cursor-pointer hover:text-blue-300' : ''}
      onClick={() => item.nodeId && onOpenNode?.(item.nodeId)}>{item.text}</span>
  );

  // ── 进度行 ──
  if (!ask) {
    const tone = item.tone === 'warn' ? 'text-amber-300/90' : item.tone === 'good' ? 'text-emerald-300/90' : 'text-slate-400';
    return (
      <div className={`text-[13px] leading-6 ${tone}`}>
        <div className="flex items-start gap-1.5">
          <span className="flex-1 min-w-0">{title}</span>
          {item.detail && (
            <button onClick={() => setOpen(v => !v)} className="text-[12px] text-slate-600 hover:text-slate-300 flex-shrink-0">{open ? '收起' : '详情'}</button>
          )}
        </div>
        {open && item.detail && <div className="mt-0.5 pl-3 border-l border-slate-700 text-slate-500 whitespace-pre-wrap">{item.detail}</div>}
      </div>
    );
  }

  // ── 答过的问题卡：收成一行 ──
  if (ask.answer) {
    return (
      <div className="text-[13px] leading-6 text-slate-500">
        <span className="text-slate-400">{title}</span>
        <span className={ask.answer.auto ? 'text-slate-600' : 'text-blue-300'}> → {ask.answer.auto ? ask.answer.label : `你选了：${ask.answer.label}`}</span>
      </div>
    );
  }

  // ── 待回答的问题卡 ──
  const submitText = () => {
    const t = text.trim();
    if (!t || !ask.input) return;
    setText('');
    onAnswer(item, ask.input.optionId, t);
  };

  return (
    <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-3 space-y-2">
      <div className="text-[14px] font-bold text-slate-200 leading-6">{title}</div>
      {item.detail && <div className="text-[13px] text-slate-400 leading-6">{item.detail}</div>}
      {item.list && item.list.length > 0 && (
        <ol className="space-y-1 text-[13px] leading-6">
          {item.list.map((l, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-slate-500 flex-shrink-0">{i + 1}.</span>
              <span className="min-w-0"><span className="text-slate-200">{l.title}</span>{l.sub && <span className="text-slate-500"> —— {l.sub}</span>}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {ask.options.map(o => (
          <button key={o.id} disabled={busy} onClick={() => onAnswer(item, o.id)}
            className={`px-2.5 py-1.5 rounded-lg text-[13px] transition-colors disabled:opacity-40 ${o.primary ? 'bg-blue-600 hover:bg-blue-500 text-white font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {ask.input && (
        <form onSubmit={e => { e.preventDefault(); submitText(); }} className="flex gap-1.5">
          <input value={text} onChange={e => setText(e.target.value)} placeholder={ask.input.placeholder}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit" disabled={busy || !text.trim()} className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-blue-600 text-[13px] text-white disabled:opacity-40">↵</button>
        </form>
      )}
    </div>
  );
};

export default FeedCard;
