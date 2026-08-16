import React, { useRef, useState } from 'react';
import { ProblemNode, Probe, ProbeResult, EvidenceLayer, LAYER_LABEL, PROBE_COST_LABEL } from '../types';
import { designProbes, applyProbeResult } from '../services/probeService';
import { runDeviceProbe, judgeSamples, summarizeRun, METRIC_LABEL } from '../services/deviceProbe';
import { isEmergencyStopped } from '../services/iotService';
import DeviceProbeForm from './DeviceProbeForm';

/**
 * 🔬 探针面板：AI 设计验证方案，人执行并回填结果。
 *
 * 刻意保留的两个约束：
 * 1. 判定标准（expectedSignal）在执行**前**就写死并一直显示在回填表单旁边，
 *    否则拿到数据后人会顺着自己想要的方向解释，验证等于白做。
 * 2. 回填结果只能选"支持 / 反对 / 没测出来"，不能直接改结论——
 *    结论由 applyProbeResult 按证据重算。
 */

const LAYERS: EvidenceLayer[] = ['stated', 'behavior', 'outcome', 'environment', 'market'];

const costCls = (c: Probe['cost']) =>
  c === 'low' ? 'text-emerald-300 border-emerald-500/40'
  : c === 'high' ? 'text-red-300 border-red-500/40'
  : 'text-amber-300 border-amber-500/40';

const ProbePanel: React.FC<{
  node: ProblemNode;
  probes: Probe[];
  goal?: string;
  onAddProbes: (probes: Probe[]) => void;
  onUpdateProbe: (probe: Probe) => void;
  onUpdateNodeData: (id: string, updates: Partial<ProblemNode>) => void;
  onContradicted?: (nodeId: string) => void;
}> = ({ node, probes, goal, onAddProbes, onUpdateProbe, onUpdateNodeData, onContradicted }) => {
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 设备实验执行状态
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ i: number; total: number; last?: number; err?: string } | null>(null);
  const abortRef = useRef(false);
  const [stance, setStance] = useState<ProbeResult['stance']>('support');
  const [layer, setLayer] = useState<EvidenceLayer>('behavior');
  const [summary, setSummary] = useState('');

  const design = async () => {
    setDesigning(true); setError('');
    try {
      const list = await designProbes(node, goal);
      if (!list.length) setError('模型没给出可执行的方案，可以换个模型或稍后再试。');
      else onAddProbes(list);
    } catch (e: any) {
      setError(e?.message || '设计失败');
    } finally {
      setDesigning(false);
    }
  };

  /**
   * 跑一次设备实验：采样 → 按事前定死的阈值判定 → 结果直接变成 environment 层证据。
   * 这是整个闭环里唯一不需要人动手的一环。
   */
  const runDevice = async (p: Probe) => {
    if (!p.device || runningId) return;
    if (isEmergencyStopped()) { setError('🛑 急停已启用，先在顶栏解除再跑实验。'); return; }
    setError(''); abortRef.current = false;
    setRunningId(p.id);
    setProgress({ i: 0, total: p.device.samples });
    onUpdateProbe({ ...p, status: 'running' });
    try {
      const outcome = await runDeviceProbe(p.device, {
        onProgress: pr => setProgress({ i: pr.index, total: pr.total, last: pr.sample?.value, err: pr.error }),
        shouldAbort: () => abortRef.current,
      });
      const judged = judgeSamples(outcome.samples, p.device);
      const failed = outcome.errors.length ? `（${outcome.errors.length} 次取数失败：${outcome.errors[0]}）` : '';
      const result: ProbeResult = {
        summary: summarizeRun(p.device, outcome.samples, judged) + failed,
        stance: judged.stance,
        layer: 'environment',            // 实验数据 = 环境层，权重仅次于市场
        at: Date.now(),
        samples: outcome.samples,
        metricValue: judged.metricValue ?? undefined,
      };
      const applied = applyProbeResult(node, { ...p, status: 'running' }, result);
      onUpdateProbe(applied.probe);
      if (Object.keys(applied.updates).length) onUpdateNodeData(node.id, applied.updates);
      if (applied.contradicted) onContradicted?.(node.id);
      if (outcome.aborted && !outcome.samples.length) setError(outcome.errors[0] || '实验被中止');
    } catch (e: any) {
      setError(e?.message || '实验执行失败');
      onUpdateProbe({ ...p, status: 'draft' });
    } finally {
      setRunningId(null);
      setProgress(null);
    }
  };

  const submit = (p: Probe) => {
    if (!summary.trim()) return;
    const { updates, probe, contradicted } = applyProbeResult(node, p, {
      summary: summary.trim(), stance, layer, at: Date.now(),
    });
    onUpdateProbe(probe);
    if (Object.keys(updates).length) onUpdateNodeData(node.id, updates);
    if (contradicted) onContradicted?.(node.id);
    setSummary(''); setFilling(null);
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-slate-500 leading-relaxed">
        AI 设计验证方案；能接设备的自动跑，不能的你去执行再回填。结果都会变成这个节点的证据并重算结论。
      </div>

      <div className="flex gap-1.5">
        <button onClick={design} disabled={designing}
          className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 disabled:opacity-50 transition-colors">
          {designing ? '设计中…' : '🔬 让 AI 设计方案'}
        </button>
        <button onClick={() => setCreating(v => !v)}
          className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 transition-colors"
          title="自己指定设备与阈值">⚙️ 配设备实验</button>
      </div>
      {error && <div className="text-[10px] text-red-400">{error}</div>}

      {creating && (
        <DeviceProbeForm
          node={node}
          onCreate={pr => { onAddProbes([pr]); setCreating(false); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!probes.length && !designing && (
        <div className="text-[10px] text-slate-600 text-center py-2">还没有探针。</div>
      )}

      <div className="space-y-2">
        {probes.map(p => (
          <div key={p.id} className={`rounded-lg border p-2.5 space-y-1.5 ${
            p.status === 'done' ? 'border-slate-700 bg-slate-900/60'
            : p.status === 'skipped' ? 'border-slate-800 bg-slate-900/30 opacity-60'
            : 'border-purple-500/30 bg-purple-950/20'}`}>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`px-1 py-0.5 rounded border text-[9px] ${costCls(p.cost)}`}>成本{PROBE_COST_LABEL[p.cost]}</span>
              {p.effort && <span className="text-[9px] text-slate-500">{p.effort}</span>}
              <span className="text-[9px] text-slate-600 ml-auto">
                {p.status === 'draft' ? '待执行' : p.status === 'running' ? '执行中' : p.status === 'done' ? '已回填' : '已跳过'}
              </span>
            </div>

            <div className="text-[11px] text-slate-200 leading-relaxed">{p.method}</div>

            {p.kind === 'device' && p.device && (
              <div className="text-[10px] text-purple-300/90 flex items-center gap-1 flex-wrap">
                <span className="px-1 rounded border border-purple-500/40">🔌 设备实验</span>
                <span className="text-slate-400">
                  {p.device.deviceName} · {p.device.actionName} · {p.device.samples}×{p.device.intervalSec}s · 取{METRIC_LABEL[p.device.metric]}
                </span>
              </div>
            )}

            <div className="text-[10px] text-slate-400">
              <span className="text-slate-600">判定标准：</span>{p.expectedSignal}
            </div>

            {runningId === p.id && progress && (
              <div className="text-[10px] text-purple-200 bg-purple-950/40 border border-purple-600/40 rounded px-2 py-1 flex items-center gap-2">
                <span className="animate-pulse">采样中 {progress.i}/{progress.total}</span>
                {progress.last !== undefined && <span className="text-slate-300">当前 {progress.last}{p.device?.unit || ''}</span>}
                {progress.err && <span className="text-red-300 truncate">{progress.err}</span>}
                <button onClick={() => { abortRef.current = true; }}
                  className="ml-auto px-1.5 py-0.5 rounded bg-red-900/60 text-red-200 hover:bg-red-700">停止</button>
              </div>
            )}

            {p.result?.samples && p.result.samples.length > 0 && (
              <div className="text-[9px] text-slate-500 font-mono break-all">
                读数：{p.result.samples.map(x => x.value).join(', ')}
                {p.result.metricValue !== undefined && <span className="text-slate-400"> → {METRIC_LABEL[p.device?.metric || 'avg']} {Math.round(p.result.metricValue * 1000) / 1000}{p.device?.unit || ''}</span>}
              </div>
            )}

            {p.result && (
              <div className={`text-[10px] rounded px-2 py-1 border ${
                p.result.stance === 'refute' ? 'text-pink-200 bg-pink-950/30 border-pink-600/30'
                : p.result.stance === 'support' ? 'text-emerald-200 bg-emerald-950/30 border-emerald-600/30'
                : 'text-slate-300 bg-slate-800 border-slate-600'}`}>
                {p.result.stance === 'refute' ? '✗ 反对' : p.result.stance === 'support' ? '✓ 支持' : '· 没测出来'}
                {p.result.stance !== 'unclear' && <span className="opacity-70"> · {LAYER_LABEL[p.result.layer]}层</span>}
                {' · '}{p.result.summary}
              </div>
            )}

            {(p.status === 'draft' || p.status === 'running') && filling !== p.id && runningId !== p.id && (
              <div className="flex gap-1.5 flex-wrap">
                {p.kind === 'device' && p.device && (
                  <button onClick={() => runDevice(p)} disabled={!!runningId}
                    className="text-[10px] px-2 py-1 rounded bg-purple-600/40 text-purple-100 hover:bg-purple-500/60 disabled:opacity-40 font-bold">
                    ▶ 用设备跑实验
                  </button>
                )}
                {p.status === 'draft' && p.kind !== 'device' && (
                  <button onClick={() => onUpdateProbe({ ...p, status: 'running' })}
                    className="text-[10px] px-2 py-1 rounded bg-slate-700/60 text-slate-200 hover:bg-slate-600">▶ 开始执行</button>
                )}
                <button onClick={() => { setFilling(p.id); setSummary(''); setStance('support'); setLayer(p.kind === 'device' ? 'environment' : 'behavior'); }}
                  className="text-[10px] px-2 py-1 rounded bg-blue-600/30 text-blue-200 hover:bg-blue-600/50">✍️ 回填结果</button>
                <button onClick={() => onUpdateProbe({ ...p, status: 'skipped' })}
                  className="text-[10px] px-2 py-1 rounded text-slate-500 hover:text-slate-300 ml-auto">跳过</button>
              </div>
            )}

            {filling === p.id && (
              <div className="space-y-1.5 pt-1 border-t border-slate-700/60">
                <div className="text-[9px] text-amber-400/80">
                  按上面写死的判定标准来判，别临时改标准。
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select value={stance} onChange={e => setStance(e.target.value as any)}
                    className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200">
                    <option value="support">支持假设</option>
                    <option value="refute">反对假设</option>
                    <option value="unclear">没测出来</option>
                  </select>
                  {stance !== 'unclear' && (
                    <select value={layer} onChange={e => setLayer(e.target.value as EvidenceLayer)}
                      className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200"
                      title="拿到的是哪一层信号，越靠后权重越高">
                      {LAYERS.map(l => <option key={l} value={l}>{LAYER_LABEL[l]}层</option>)}
                    </select>
                  )}
                </div>
                <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
                  placeholder="现实回答了什么？例：20 人里 17 人说更想要导航"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[11px] text-slate-200 resize-none" />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setFilling(null)} className="text-[10px] px-2 py-1 text-slate-400 hover:text-white">取消</button>
                  <button onClick={() => submit(p)} disabled={!summary.trim()}
                    className="text-[10px] px-2.5 py-1 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500">记录</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProbePanel;
