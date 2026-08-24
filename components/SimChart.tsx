import React from 'react';
import { SimOutput } from '../services/simSpec';

/**
 * 仿真曲线。首屏预置仿真和 AI 生成的仿真笔记共用同一个。
 *
 * 有意做得很朴素：没有动画、没有 tooltip、没有渐变填充。
 * 一条被包装得越漂亮的曲线，越容易被当成证据看——而它只是一个模型的推测。
 */

const W = 460, H = 150, PAD_L = 34, PAD_R = 8, PAD_T = 10, PAD_B = 20;

const SimChart: React.FC<{ out: SimOutput; height?: number }> = ({ out }) => {
  const all = out.series.flatMap(s => s.points).filter(Number.isFinite);
  if (!all.length) {
    return <div className="text-[11px] text-slate-500 py-6 text-center">这条曲线算不出来</div>;
  }
  const rawMax = Math.max(...all, 0);
  const rawMin = Math.min(...all, 0);
  const span = rawMax - rawMin || 1;
  const max = rawMax + span * 0.08;
  // 全是正数时地板就压在 0——不要为了留白造出一个「-8 个人」的刻度
  const min = rawMin < 0 ? rawMin - span * 0.08 : 0;

  const n = Math.max(1, out.x.length - 1);
  const px = (i: number) => PAD_L + (i / n) * (W - PAD_L - PAD_R);
  const py = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);
  const zeroY = py(0);
  const showZero = rawMin < 0;

  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`);

  return (
    /* 不用 preserveAspectRatio="none"：拉伸会把坐标轴上的字一起拉变形 */
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* 有零线时就不再画中间那条参考线：两条线离得近、标签又不一样，只会让人以为读错了 */}
      {(showZero ? [0, 1] : [0, 0.5, 1]).map(f => {
        const v = min + (max - min) * (1 - f);
        return (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={py(v)} y2={py(v)} stroke="#1e293b" strokeWidth="1" />
            <text x={PAD_L - 5} y={py(v) + 3} textAnchor="end" fontSize="9" fill="#64748b">{fmt(v)}</text>
          </g>
        );
      })}
      {/* 盈亏线用中性色：和曲线同色会让人以为它也是数据 */}
      {showZero && (
        <g>
          <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          <text x={PAD_L - 5} y={zeroY + 3} textAnchor="end" fontSize="9" fill="#94a3b8">0</text>
        </g>
      )}

      {out.series.map(s => (
        <polyline
          key={s.label}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={s.points.filter(Number.isFinite).map((v, i) => `${px(i)},${py(v)}`).join(' ')}
        />
      ))}

      <text x={W - PAD_R} y={H - 5} textAnchor="end" fontSize="9" fill="#64748b">{out.xLabel}</text>
      <text x={PAD_L + 2} y={PAD_T - 2} textAnchor="start" fontSize="9" fill="#64748b">{out.yLabel}</text>
    </svg>
  );
};

/** 参数滑块。带 ? 的是「你其实是猜的」那个数——整个仿真模块的重点。 */
export const SimSlider: React.FC<{
  label: string;
  min: number; max: number; step: number; value: number;
  unit?: string; soft?: boolean; why?: string;
  onChange: (v: number) => void;
}> = ({ label, min, max, step, value, unit, soft, why, onChange }) => (
  <div className="flex items-center gap-2">
    <label className="text-[11px] text-slate-400 w-[92px] flex-shrink-0 flex items-center gap-1" title={why}>
      <span className="truncate">{label}</span>
      {soft && <span className="text-amber-500/80 flex-shrink-0" title={why || '这个数多半是你猜的'}>?</span>}
    </label>
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="flex-1 h-1 accent-blue-500 cursor-pointer min-w-0"
    />
    <span className="text-[11px] font-mono text-slate-200 w-[58px] text-right flex-shrink-0">
      {Math.round(value * 100) / 100}{unit || ''}
    </span>
  </div>
);

export default SimChart;
