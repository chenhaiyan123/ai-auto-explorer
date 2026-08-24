import React, { useMemo, useState } from 'react';
import { SimSpec, runSim, paramValues, sensitivity, topSensitivity, simToProbeDraft, formatReadout } from '../services/simSpec';
import SimChart, { SimSlider } from './SimChart';

/**
 * 仿真笔记的正文视图。
 *
 * 这是一篇**独立的笔记**（noteType==='simulation'），不是挂在别的笔记里的小挂件。
 * 这样做的理由：仿真会被反复回看、被导出成 Obsidian 里的 md 文件、会被 [[双链]] 引用，
 * 它值得有自己的地址。
 *
 * 页面的次序是刻意排的，从上到下就是一次完整的思路：
 *   在验哪句话 → 结论 → 曲线 → 拖参数 → **这条结论最怕你猜错哪个数** → 去问现实
 * 最后那两步才是重点。曲线只是把人留在这一页的钩子。
 */

const SimNote: React.FC<{
  spec: SimSpec;
  /** 用户拖过的参数值（存回节点，下次打开还是这个状态） */
  values?: Record<string, number>;
  onChangeValues?: (v: Record<string, number>) => void;
  /** 「把这个数变成探针」——仿真通向现实的唯一出口 */
  onCreateProbe?: (draft: { hypothesis: string; method: string; expectedSignal: string; effort: string }) => void;
  /** 回到被验证的那个节点 */
  onOpenSource?: () => void;
  sourceTitle?: string;
}> = ({ spec, values, onChangeValues, onCreateProbe, onOpenSource, sourceTitle }) => {
  const [local, setLocal] = useState<Record<string, number>>(() => paramValues(spec, values || {}));
  const [showFormula, setShowFormula] = useState(false);

  const out = useMemo(() => runSim(spec, local), [spec, local]);
  // 敏感度要扫参数区间跑很多遍，只在参数真的变了之后重算
  const sens = useMemo(() => sensitivity(spec, local), [spec, local]);
  const top = topSensitivity(sens);
  const topParam = top && spec.params.find(p => p.key === top.paramKey);

  const set = (key: string, v: number) => {
    const next = { ...local, [key]: v };
    setLocal(next);
    onChangeValues?.(next);
  };

  const reset = () => {
    const next = paramValues(spec, {});
    setLocal(next);
    onChangeValues?.(next);
  };

  const fmt = (v: number) => (top ? formatReadout(spec, top.readoutKey, v) : '—');

  return (
    <div className="space-y-4 text-slate-200">
      {/* 头：这是仿真，不是证据。这句话必须在最上面，不能折叠。 */}
      <div className="rounded-xl border border-amber-600/40 bg-amber-950/25 px-3 py-2.5 text-[11px] leading-6 text-amber-200/90">
        <div className="font-bold text-amber-300 mb-0.5">⚠️ 这是仿真，不是证据</div>
        下面这条曲线是<b>按假设推算</b>出来的，不是观测到的。它不计入任何现实证据，
        也不会让节点离开「等现实验证」。它唯一的用处是告诉你：<b>该去量哪一个数。</b>
      </div>

      <div>
        <h2 className="text-base font-bold text-white">🧪 {spec.title}</h2>
        <p className="text-[12px] text-slate-400 mt-1">{spec.question}</p>
      </div>

      {spec.hypothesis && (
        <div className="text-[12px] leading-6 text-slate-300 border-l-2 border-slate-700 pl-3">
          <span className="text-slate-500">在验这句话：</span>{spec.hypothesis}
          {onOpenSource && (
            <button onClick={onOpenSource} className="ml-2 text-blue-400 hover:text-blue-300">
              ← 回到{sourceTitle ? `「${sourceTitle}」` : '原节点'}
            </button>
          )}
        </div>
      )}

      {/* 结论 */}
      <div className={`rounded-xl border px-3 py-2 ${
        out.bad ? 'border-pink-500/30 bg-pink-950/20' : 'border-emerald-500/30 bg-emerald-950/20'
      }`}>
        <div className={`text-[13px] font-bold ${out.bad ? 'text-pink-300' : 'text-emerald-300'}`}>
          {out.headline}
        </div>
      </div>

      <SimChart out={out} />

      {out.note && (
        <div className="text-[11px] text-amber-300/90 bg-amber-950/25 border border-amber-600/30 rounded-lg px-2 py-1.5">
          {out.note}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {out.readouts.map(r => (
          <div key={r.label} className="text-[11px]">
            <span className="text-slate-500">{r.label} </span>
            <span className={`font-mono font-bold ${r.bad ? 'text-pink-400' : 'text-slate-100'}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* 参数 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400">拖一下试试</span>
          <button onClick={reset} className="text-[10px] text-slate-500 hover:text-slate-300">恢复默认</button>
        </div>
        {spec.params.map(p => (
          <SimSlider key={p.key} label={p.label} min={p.min} max={p.max} step={p.step}
            unit={p.unit} soft={p.soft} why={p.why}
            value={local[p.key] ?? p.value} onChange={v => set(p.key, v)} />
        ))}
      </div>

      {/*
        这一块才是整个仿真模块存在的理由。
        曲线是模型的推测，但「结论对哪个数最敏感」是这条推测自身的客观性质——
        那个数就是值得花一天去量的东西。
      */}
      {top && topParam && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 space-y-2">
          <div className="text-[11px] font-bold text-blue-300">🎯 这条结论最怕你猜错哪个数</div>
          <div className="text-[12px] leading-6 text-slate-200">
            <b>{top.paramLabel}</b>
            {topParam.soft && <span className="text-amber-400 text-[10px] ml-1">（你目前是猜的）</span>}
            ：它从 {topParam.min}{topParam.unit || ''} 到 {topParam.max}{topParam.unit || ''} 扫一遍，
            「{top.readoutLabel}」就在{' '}
            {/* 两端都用中性色：重点是这个跨度有多大，不是哪一端"好" */}
            <span className="font-mono text-slate-100">{fmt(top.low)}</span>
            {' '}和{' '}
            <span className="font-mono text-slate-100">{fmt(top.high)}</span>
            {' '}之间来回。
          </div>
          {topParam.why && <div className="text-[11px] text-slate-400">为什么只能猜：{topParam.why}</div>}
          {onCreateProbe && (
            <button
              onClick={() => { const d = simToProbeDraft(spec, local); if (d) onCreateProbe(d); }}
              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors"
            >
              🔬 去把这个数量出来（生成探针）
            </button>
          )}
        </div>
      )}

      {/* 自曝其短 */}
      <div className="rounded-xl border border-amber-600/30 bg-amber-950/20 p-3 space-y-2 text-[11px] leading-6">
        <div className="font-bold text-amber-300">⚠️ 这个模型哪里靠不住</div>
        <p className="text-slate-300">{spec.realityCheck}</p>
        <p className="text-emerald-300/90"><span className="text-slate-500">怎么验：</span>{spec.probeHint}</p>
      </div>

      {/* 公式摊开给人看 */}
      <div>
        <button
          onClick={() => setShowFormula(v => !v)}
          className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showFormula ? '▾' : '▸'} 这条曲线是怎么算的（{Object.keys(spec.step).length} 个状态变量 · {spec.steps} 步）
        </button>
        {showFormula && (
          <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-[11px] font-mono leading-6 overflow-x-auto">
            <div className="text-slate-500 mb-1">初值</div>
            {Object.entries(spec.init).map(([k, v]) => (
              <div key={k} className="text-slate-300 whitespace-pre">{k} = {v}</div>
            ))}
            <div className="text-slate-500 mt-2 mb-1">每步（{spec.xLabel}）</div>
            {Object.entries(spec.step).map(([k, v]) => (
              <div key={k} className="text-slate-300 whitespace-pre">{k} ← {v}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SimNote;
