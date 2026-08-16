import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, NodeStatus, Evidence, EvidenceLayer, Hypothesis, LAYER_LABEL } from '../types';
import { statEvidence, isContradictedByReality } from '../services/validationTrigger';

/**
 * 「当前赌注」面板：把这个节点在赌什么、凭什么、最大的未知是什么，摆到明面上。
 *
 * 这是整套现实反馈闭环里用户唯一需要动手的地方——AI 负责提出假设并识别
 * 「该去问现实了」，人负责把现实的回答填回来。
 *
 * 有意为之的两点：
 * 1. AI 写进来的证据永远是「语言层」，界面上也如实标出来，不让它冒充现实。
 * 2. 只有人回填的反证能把节点打成「被现实推翻」，AI 不能自己宣布自己错了。
 */

const BELIEF_LABEL: Record<Hypothesis['belief'], string> = { low: '低', medium: '中', high: '高' };
const BELIEF_CLS: Record<Hypothesis['belief'], string> = {
  low: 'text-slate-300 bg-slate-700/50 border-slate-600',
  medium: 'text-amber-300 bg-amber-900/30 border-amber-500/40',
  high: 'text-emerald-300 bg-emerald-900/30 border-emerald-500/40',
};

const LAYERS: EvidenceLayer[] = ['stated', 'behavior', 'outcome', 'environment', 'market'];

const layerCls = (l: EvidenceLayer) =>
  l === 'stated' ? 'text-slate-400 border-slate-600'
  : l === 'behavior' ? 'text-sky-300 border-sky-500/40'
  : l === 'market' ? 'text-emerald-300 border-emerald-500/40'
  : 'text-purple-300 border-purple-500/40';

const HypothesisPanel: React.FC<{
  node: ProblemNode;
  onUpdateNodeData: (id: string, updates: Partial<ProblemNode>) => void;
  /** 打开 🔬 探针面板：让 AI 设计一个低成本的验证方案 */
  onOpenProbes?: () => void;
  /** 假设被现实推翻时通知外面（去开决策记录弹窗留痕） */
  onContradicted?: (nodeId: string) => void;
}> = ({ node, onUpdateNodeData, onOpenProbes, onContradicted }) => {
  const h = node.hypothesis;
  const [adding, setAdding] = useState(false);
  const [stance, setStance] = useState<'support' | 'refute'>('refute');
  const [layer, setLayer] = useState<EvidenceLayer>('behavior');
  const [claim, setClaim] = useState('');
  const [source, setSource] = useState('');

  const awaiting = node.status === NodeStatus.VALIDATING;
  const contradicted = node.status === NodeStatus.CONTRADICTED;
  if (!h && !awaiting && !contradicted) return null;

  const s = statEvidence(h);

  const addEvidence = () => {
    if (!claim.trim() || !h) return;
    const ev: Evidence = {
      id: uuidv4(),
      stance,
      layer,
      claim: claim.trim().slice(0, 200),
      source: source.trim().slice(0, 80) || undefined,
      origin: 'human',        // 人回填的才算现实证据
      createdAt: Date.now(),
    };
    const next: Hypothesis = { ...h, evidence: [...(h.evidence || []), ev], updatedAt: Date.now() };
    // 现实反证压过现实支持 → 直接判定为「被推翻」，该转向了
    const nowContradicted = isContradictedByReality(next);
    onUpdateNodeData(node.id, {
      hypothesis: next,
      status: nowContradicted ? NodeStatus.CONTRADICTED : node.status,
      validationReason: nowContradicted ? '现实证据与假设冲突，需要转向' : node.validationReason,
      noteUpdatedAt: Date.now(),
    });
    setClaim(''); setSource(''); setAdding(false);
    if (nowContradicted) onContradicted?.(node.id);
  };

  const confirmByReality = () => {
    onUpdateNodeData(node.id, {
      status: NodeStatus.SOLVED,
      validationReason: undefined,
      noteUpdatedAt: Date.now(),
    });
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2.5 ${
      contradicted ? 'border-pink-500/40 bg-pink-950/20'
      : awaiting ? 'border-purple-500/40 bg-purple-950/20'
      : 'border-slate-700 bg-slate-900/50'}`}>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-slate-300">
          {contradicted ? '🔴 假设已被现实推翻' : awaiting ? '🟡 等现实验证' : '🎯 当前赌注'}
        </span>
        {h && <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${BELIEF_CLS[h.belief]}`}>信念 {BELIEF_LABEL[h.belief]}</span>}
        <span className="text-[10px] text-slate-500">
          支持 {s.support} · 反对 {s.refute} · 其中现实证据 <span className={s.real ? 'text-emerald-400' : 'text-red-400'}>{s.real}</span> 条
        </span>
      </div>

      {h?.statement && <div className="text-[13px] text-slate-100 leading-relaxed">{h.statement}</div>}

      {node.validationReason && (
        <div className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-600/30 rounded-lg px-2 py-1.5">
          {node.validationReason}
        </div>
      )}

      {h?.unknown && (
        <div className="text-[11px] text-slate-300">
          <span className="text-slate-500">最大未知量：</span>{h.unknown}
        </div>
      )}

      {!!(h?.evidence || []).length && (
        <div className="space-y-1">
          {h!.evidence.map(e => (
            <div key={e.id} className="flex items-start gap-1.5 text-[11px]">
              <span className={e.stance === 'refute' ? 'text-pink-400' : 'text-emerald-400'}>
                {e.stance === 'refute' ? '✗' : '✓'}
              </span>
              <span className={`px-1 rounded border text-[9px] mt-[1px] flex-shrink-0 ${layerCls(e.layer)}`}>
                {LAYER_LABEL[e.layer]}
              </span>
              <span className="text-slate-300 flex-1">
                {e.claim}
                {e.source && <span className="text-slate-600"> · {e.source}</span>}
                {e.origin === 'ai' && <span className="text-slate-600"> · AI 推理</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        {h && (
          <button onClick={() => setAdding(a => !a)}
            className="text-[11px] px-2 py-1 rounded-lg bg-slate-700/60 text-slate-200 hover:bg-slate-600 transition-colors">
            ➕ 回填现实证据
          </button>
        )}
        {(awaiting || contradicted) && onOpenProbes && (
          <button onClick={onOpenProbes}
            className="text-[11px] px-2 py-1 rounded-lg bg-purple-700/40 text-purple-200 hover:bg-purple-600/50 transition-colors">
            🔬 设计一个验证方案
          </button>
        )}
        {awaiting && (
          <button onClick={confirmByReality}
            className="text-[11px] px-2 py-1 rounded-lg bg-emerald-700/50 text-emerald-200 hover:bg-emerald-600/60 transition-colors">
            ✅ 现实已确认 · 标记完成
          </button>
        )}
      </div>

      {adding && h && (
        <div className="space-y-1.5 pt-1 border-t border-slate-700/60">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={stance} onChange={e => setStance(e.target.value as any)}
              className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200">
              <option value="refute">反对</option>
              <option value="support">支持</option>
            </select>
            <select value={layer} onChange={e => setLayer(e.target.value as EvidenceLayer)}
              className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200"
              title="越靠后越接近现实，权重越高">
              {LAYERS.map(l => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}
            </select>
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="来源（访谈/后台数据/实验…）"
              className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200 flex-1 min-w-[120px]" />
          </div>
          <textarea value={claim} onChange={e => setClaim(e.target.value)} rows={2}
            placeholder="现实说了什么？例：20 个用户里 17 个说更想要导航，不是翻译"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[11px] text-slate-200 resize-none" />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="text-[11px] px-2 py-1 text-slate-400 hover:text-white">取消</button>
            <button onClick={addEvidence} disabled={!claim.trim()}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500 transition-colors">
              记录
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HypothesisPanel;
