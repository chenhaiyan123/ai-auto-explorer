import React, { useState } from 'react';
import type { KeyInfo } from '../types';
import { TOPIC_LABEL, answerInfo, forget, remember } from '../services/keyInfo';

/**
 * AI 记忆 ·「你交代过的」：AI 项目经理主动问来的关键信息。
 * 写笔记、团队讨论、醒来看一眼都会带上这些；在这里可以改、可以删、可以补。
 */
const Row: React.FC<{ k: KeyInfo; onChange: (fn: (l: KeyInfo[]) => KeyInfo[]) => void }> = ({ k, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(k.answer);
  const save = () => { const t = text.trim(); if (t) onChange(l => answerInfo(l, k.id, t)); setEditing(false); };
  return (
    <li className="text-[12px] leading-5 group">
      <div className="flex items-start gap-1.5">
        <span className="text-[11px] text-slate-500 flex-shrink-0 w-9">{TOPIC_LABEL[k.topic]}</span>
        <div className="min-w-0 flex-1">
          <span className="text-slate-400">{k.question}</span>
          {editing || k.status === 'pending' ? (
            <form onSubmit={e => { e.preventDefault(); save(); }} className="flex gap-1 mt-1">
              <input value={text} onChange={e => setText(e.target.value)} placeholder={k.status === 'pending' ? '还没回答，直接写…' : ''}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[12px] text-slate-200 outline-none focus:ring-1 focus:ring-blue-500" />
              <button type="submit" disabled={!text.trim()} className="px-2 rounded bg-slate-700 hover:bg-blue-600 text-white disabled:opacity-40">记下</button>
            </form>
          ) : k.status === 'skipped' ? (
            <span className="text-amber-300"> → 你说不确定，AI 先按常理假设</span>
          ) : (
            <span className="text-slate-200"> → {k.answer}</span>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0 opacity-60 group-hover:opacity-100">
          {k.status !== 'pending' && !editing && <button onClick={() => { setText(k.answer); setEditing(true); }} className="text-[11px] text-blue-300 hover:underline">{k.status === 'skipped' ? '回答' : '改'}</button>}
          <button onClick={() => onChange(l => forget(l, k.id))} className="text-[11px] text-slate-500 hover:text-slate-300" title="从 AI 记忆里删掉">✕</button>
        </div>
      </div>
    </li>
  );
};

const KeyInfoPanel: React.FC<{ items: KeyInfo[] | undefined; onChange: (fn: (l: KeyInfo[]) => KeyInfo[]) => void }> = ({ items, onChange }) => {
  const [add, setAdd] = useState('');
  const list = items || [];
  const known = list.filter(k => k.status !== 'pending');
  const pending = list.filter(k => k.status === 'pending');
  return (
    <section className="rounded-xl border border-violet-700/40 bg-violet-950/20 p-3 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-slate-200">🧠 AI 记忆 · 你交代过的</span>
        <span className="text-[11px] text-slate-500">AI 项目经理会主动问；做事、团队讨论都按这里来，不会再问一遍</span>
      </div>
      {known.length === 0 && pending.length === 0 && <p className="text-[12px] text-slate-500">还没有。开工时 AI 会先问你几件只有你知道的事（手上有什么、目标是谁、能花多少），答案会记在这里。</p>}
      {known.length > 0 && <ul className="space-y-1.5">{known.map(k => <Row key={k.id} k={k} onChange={onChange} />)}</ul>}
      {pending.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-500">还想问你的（{pending.length}）</div>
          <ul className="space-y-1.5">{pending.map(k => <Row key={k.id} k={k} onChange={onChange} />)}</ul>
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); const t = add.trim(); if (!t) return; onChange(l => remember(l, 'other', '你补充的', t, 'user')); setAdd(''); }} className="flex gap-1">
        <input value={add} onChange={e => setAdd(e.target.value)} placeholder="＋ 主动补一条，比如「不要碰线下渠道」「数据只能用脱敏的」…"
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:ring-1 focus:ring-blue-500" />
        <button type="submit" disabled={!add.trim()} className="px-2 rounded bg-slate-700 hover:bg-blue-600 text-[12px] text-white disabled:opacity-40">记下</button>
      </form>
    </section>
  );
};

export default KeyInfoPanel;
