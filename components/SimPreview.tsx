import { t as ui } from '../services/language';
import React, { useMemo, useState } from 'react';
import { SIM_PRESETS, paramValues, SIM_DISCLAIMER } from '../services/simPresets';
import SimChart, { SimSlider } from './SimChart';
import { markMilestone } from '../services/funnel';

/**
 * 首屏的「先动手」区块：三个预置仿真，拖滑块曲线立刻变。
 *
 * 它要在十秒内完成一件事——让访客亲手把一个数字改坏，看见曲线塌下去，
 * 然后读到那句「这个数你其实不知道」。产品的主张不是讲出来的，是让他撞一次。
 *
 * 刻意的取舍：
 * - 预置模型，不现场生成。现场生成要等 AI、要处理失败、还要一整套沙箱；
 *   而首屏要验证的锚点只是「有没有可交互的东西能留住人」，用不着那些。
 * - 没有登录、没有网络请求、纯前端算术，秒开。
 * - 免责声明是写死的常量，不是可选文案——仿真最危险的地方就是它长得像证据。
 */

const SimPreview: React.FC<{
  /** 点「去问现实」时做什么——落地页上是直接进产品 */
  onEnter?: () => void;
  className?: string;
}> = ({ onEnter, className = '' }) => {
  const [idx, setIdx] = useState(0);
  const preset = SIM_PRESETS[idx];
  const [values, setValues] = useState<Record<string, number>>(() => paramValues(SIM_PRESETS[0]));
  const [touched, setTouched] = useState(false);
  const [showCheck, setShowCheck] = useState(false);

  const out = useMemo(() => preset.run(paramValues(preset, values)), [preset, values]);

  const pick = (i: number) => {
    setIdx(i);
    setValues(paramValues(SIM_PRESETS[i]));
    setShowCheck(false);
    markMilestone('funnel_tried_sim');
    setTouched(true);
  };

  const drag = (key: string, v: number) => {
    if (!touched) { markMilestone('funnel_tried_sim'); setTouched(true); }
    setValues(prev => ({ ...prev, [key]: v }));
  };

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[13px] font-bold text-slate-200">先别读，先拖一下 👇</h3>
        <span className="text-[10px] text-slate-600">不用注册</span>
      </div>

      {/* 三个预置实验 */}
      <div className="flex gap-1.5 mb-3">
        {SIM_PRESETS.map((p, i) => (
          <button
            key={p.id}
            onClick={() => pick(i)}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              i === idx ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {p.icon} {p.title}
          </button>
        ))}
      </div>

      <p className="text-[12px] text-slate-400 mb-2.5">{preset.question}</p>

      {/* 结论 + 曲线 */}
      <div className={`rounded-xl border px-3 py-2 mb-2 ${
        out.bad ? 'border-pink-500/30 bg-pink-950/20' : 'border-emerald-500/30 bg-emerald-950/20'
      }`}>
        <div className={`text-[13px] font-bold ${out.bad ? 'text-pink-300' : 'text-emerald-300'}`}>
          {out.headline}
        </div>
      </div>

      <SimChart out={out} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 mt-1">
        {out.readouts.map(r => (
          <div key={r.label} className="text-[11px]">
            <span className="text-slate-500">{r.label} </span>
            <span className={`font-mono font-bold ${r.bad ? 'text-pink-400' : 'text-slate-100'}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* 滑块 */}
      <div className="space-y-2 mb-3">
        {preset.params.map(p => (
          <SimSlider key={p.key} label={p.label} min={p.min} max={p.max} step={p.step}
            unit={p.unit} soft={p.soft} why={p.why}
            value={values[p.key] ?? p.value} onChange={v => drag(p.key, v)} />
        ))}
      </div>

      {/*
        整个区块的重点其实是这里，不是上面的曲线。
        带 ? 的那个参数是你猜的，而结论对它极其敏感——这就是「去问现实」的理由。
      */}
      <button
        onClick={() => setShowCheck(v => !v)}
        className="w-full text-left text-[11px] px-3 py-2 rounded-xl bg-amber-950/30 border border-amber-600/30 text-amber-300 hover:bg-amber-950/50 transition-colors"
      >
        ⚠️ 这个模型哪里靠不住？{showCheck ? ui("收起") : '展开'}
      </button>
      {showCheck && (
        <div className="mt-2 space-y-2 text-[11px] leading-6 text-slate-300 border-l-2 border-amber-600/40 pl-3">
          <p>{preset.realityCheck}</p>
          <p className="text-emerald-300/90"><span className="text-slate-500">怎么验：</span>{preset.probeHint}</p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-slate-500">{SIM_DISCLAIMER}</span>
        {onEnter && (
          <button
            onClick={onEnter}
            className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
          >
            拿我自己的问题试试 →
          </button>
        )}
      </div>
    </div>
  );
};

export default SimPreview;
