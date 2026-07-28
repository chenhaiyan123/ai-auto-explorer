import React, { useState } from 'react';
import { DecisionRecord, DecisionOption, DecisionTrigger, ProblemNode } from '../types';
import { TRIGGER_LABEL } from '../services/decisionService';

/** 打开决策记录弹窗所需的草稿（快照在打开前捕获） */
export interface DecisionDraft {
  nodeId: string;
  nodeTitle: string;
  trigger: DecisionTrigger;
  snapshot: ProblemNode[];
  presetQuestion?: string;
  presetOptions?: { label: string; chosen: boolean }[];
  /** 关键时机弹出时可跳过（跳过=只执行动作不留记录） */
  skippable?: boolean;
}

// ========== 决策记录弹窗 ==========
export const DecisionRecordModal: React.FC<{
  draft: DecisionDraft;
  onSave: (question: string, options: DecisionOption[]) => void;
  onSkip?: () => void;
  onCancel: () => void;
}> = ({ draft, onSave, onSkip, onCancel }) => {
  const [question, setQuestion] = useState(draft.presetQuestion || `关于「${draft.nodeTitle}」的决策`);
  const [options, setOptions] = useState<DecisionOption[]>(
    draft.presetOptions?.length
      ? draft.presetOptions.map(o => ({ ...o, reason: '' }))
      : [{ label: '', chosen: true, reason: '' }, { label: '', chosen: false, reason: '' }]
  );

  const setOpt = (i: number, u: Partial<DecisionOption>) =>
    setOptions(prev => prev.map((o, j) => (j === i ? { ...o, ...u } : o)));

  const valid = options.some(o => o.label.trim());

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 shadow-2xl max-h-[85vh] overflow-y-auto scroll-hide">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">⚖️ 记录决策</h3>
          <button onClick={onCancel} className="text-slate-500 hover:text-white">✕</button>
        </div>
        <div className="text-[10px] text-slate-500 mb-4">
          节点「{draft.nodeTitle}」 · {TRIGGER_LABEL[draft.trigger]} · 已快照 {draft.snapshot.length} 个节点，之后可随时回来 fork 复刻这条路线
        </div>

        <label className="text-[9px] text-slate-500 font-bold mb-1 block">这个决策要解决什么？</label>
        <input
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-amber-500 mb-4"
          value={question} onChange={e => setQuestion(e.target.value)} placeholder="决策问题 / 背景"
        />

        <div className="text-[9px] text-slate-500 font-bold mb-1.5">候选项（✓选择 / ✗放弃，理由都可以不填）</div>
        <div className="space-y-2 mb-3">
          {options.map((o, i) => (
            <div key={i} className={`border rounded-lg p-2.5 space-y-1.5 ${o.chosen ? 'border-emerald-500/40 bg-emerald-900/10' : 'border-red-500/30 bg-red-900/10'}`}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpt(i, { chosen: !o.chosen })}
                  className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded transition-colors ${o.chosen ? 'bg-emerald-600 text-white' : 'bg-red-900/50 text-red-300'}`}
                  title="点击切换 选择/放弃"
                >{o.chosen ? '✓ 选择' : '✗ 放弃'}</button>
                <input
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200 outline-none"
                  placeholder="选项内容，如：先做市场调研" value={o.label}
                  onChange={e => setOpt(i, { label: e.target.value })}
                />
                {options.length > 1 && (
                  <button onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 text-xs">🗑</button>
                )}
              </div>
              <input
                className="w-full bg-slate-950/60 border border-slate-800 rounded px-2 py-1.5 text-[10px] text-slate-400 outline-none placeholder:text-slate-600"
                placeholder={o.chosen ? '选择理由（可不填）' : '放弃理由（可不填）'}
                value={o.reason || ''} onChange={e => setOpt(i, { reason: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button onClick={() => setOptions(prev => [...prev, { label: '', chosen: false, reason: '' }])}
          className="text-[10px] text-slate-500 hover:text-slate-300 mb-4">＋ 加一个选项</button>

        <div className="flex gap-2">
          <button disabled={!valid} onClick={() => onSave(question, options)}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-colors">保存决策记录</button>
          {draft.skippable && onSkip && (
            <button onClick={onSkip} className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-[11px] transition-colors" title="不记录，直接执行">跳过不记录</button>
          )}
          <button onClick={onCancel} className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-[11px] transition-colors">取消</button>
        </div>
      </div>
    </div>
  );
};

// ========== 决策时间线（项目级） ==========
export const DecisionTimelineModal: React.FC<{
  decisions: DecisionRecord[];
  onFork: (decisionId: string) => void;
  onDelete: (decisionId: string) => void;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
}> = ({ decisions, onFork, onDelete, onNavigate, onClose }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = [...decisions].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">⚖️ 决策时间线<span className="text-[10px] text-slate-500 font-normal">每条决策都带当时快照，可随时 fork 复刻另一条路线</span></h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-hide p-4 space-y-3">
          {sorted.length === 0 && (
            <div className="text-center text-slate-500 text-xs py-10">
              还没有决策记录。<br /><span className="text-slate-600 text-[10px]">在节点右上角 ⚖️ 或右键菜单里「记录决策」；删除/废弃节点时也会提示记录。</span>
            </div>
          )}
          {sorted.map(d => (
            <div key={d.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-slate-100 truncate">{d.question}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">
                    <button onClick={() => { onNavigate(d.nodeId); onClose(); }} className="text-blue-400 hover:underline">「{d.nodeTitle}」</button>
                    {' · '}{TRIGGER_LABEL[d.trigger]} · {new Date(d.createdAt).toLocaleString()} · 快照 {d.snapshot.length} 节点
                    {(d.forks?.length || 0) > 0 && <span className="text-purple-400"> · 已 fork {d.forks!.length} 次</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => onFork(d.id)} className="text-[10px] px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600 border border-purple-500/40 text-purple-300 hover:text-white rounded-full font-bold transition-colors" title="用当时的快照复刻一条新分支">⑂ Fork</button>
                  <button onClick={() => setExpanded(e => (e === d.id ? null : d.id))} className="text-[10px] px-2 py-1 text-slate-500 hover:text-slate-300" title="查看快照">{expanded === d.id ? '收起' : '快照'}</button>
                  <button onClick={() => { if (confirm('删除这条决策记录？（不影响现有节点）')) onDelete(d.id); }} className="text-[10px] px-1.5 py-1 text-slate-600 hover:text-red-400">🗑</button>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {d.options.map((o, i) => (
                  <div key={i} className="text-[10px] leading-relaxed">
                    <span className={o.chosen ? 'text-emerald-400 font-bold' : 'text-red-400/80 line-through'}>{o.chosen ? '✓' : '✗'} {o.label}</span>
                    {o.reason && <span className="text-slate-500"> — {o.reason}</span>}
                  </div>
                ))}
              </div>
              {expanded === d.id && (
                <div className="mt-2 pt-2 border-t border-slate-800 flex flex-wrap gap-1.5">
                  {d.snapshot.map(n => (
                    <span key={n.id} className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">{n.title}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
