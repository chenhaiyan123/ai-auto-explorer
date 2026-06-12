/**
 * QuestionEvaluator — 问题体检报告组件
 *
 * 包含：
 * - 六边形雷达图（SVG，纯手写，无第三方库依赖）
 * - 各维度得分条
 * - 亮点 + 优化建议
 * - 综合评级 + 积分预估
 * - 操作按钮：优化问题 / 开始探索
 */

import React, { useState, useEffect } from 'react';
import { evaluateQuestion, quickEstimate, QVSReport, QVSDimension } from '../services/qvsService';

// ─── 颜色工具 ────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = {
  S: '#f59e0b',
  A: '#10b981',
  B: '#3b82f6',
  C: '#8b5cf6',
  D: '#ef4444',
};

const LEVEL_COLOR: Record<QVSDimension['level'], string> = {
  excellent: '#10b981',
  good:      '#3b82f6',
  fair:      '#f59e0b',
  weak:      '#ef4444',
};

const LEVEL_LABEL: Record<QVSDimension['level'], string> = {
  excellent: '卓越',
  good:      '良好',
  fair:      '一般',
  weak:      '偏弱',
};

// ─── 六边形雷达图 ─────────────────────────────────────────────

interface RadarChartProps {
  dimensions: QVSDimension[];
}

const RadarChart: React.FC<RadarChartProps> = ({ dimensions }) => {
  const cx = 130;
  const cy = 130;
  const maxR = 90;
  const n = dimensions.length; // 6

  // 计算各顶点坐标（从正上方开始，顺时针）
  const angleOf = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const point = (r: number, i: number): [number, number] => [
    cx + r * Math.cos(angleOf(i)),
    cy + r * Math.sin(angleOf(i)),
  ];

  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';

  // 背景网格（5 层）
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  // 数据多边形
  const dataPoints = dimensions.map((d, i) => point((d.score / 100) * maxR, i));

  // 标签坐标（略微往外偏移）
  const labelOffset = 22;
  const labels = dimensions.map((d, i) => {
    const [lx, ly] = point(maxR + labelOffset, i);
    return { label: d.labelEn, shortLabel: d.label, x: lx, y: ly };
  });

  return (
    <svg width="260" height="260" viewBox="0 0 260 260" style={{ overflow: 'visible' }}>
      {/* 背景网格 */}
      {gridLevels.map((lvl, gi) => {
        const pts = Array.from({ length: n }, (_, i) => point(maxR * lvl, i));
        return (
          <path
            key={gi}
            d={toPath(pts)}
            fill="none"
            stroke="rgba(148,163,184,0.15)"
            strokeWidth="1"
          />
        );
      })}

      {/* 辐射线 */}
      {Array.from({ length: n }, (_, i) => {
        const [ex, ey] = point(maxR, i);
        return (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={ex} y2={ey}
            stroke="rgba(148,163,184,0.12)"
            strokeWidth="1"
          />
        );
      })}

      {/* 数据多边形 - 填充 */}
      <path
        d={toPath(dataPoints)}
        fill="rgba(59,130,246,0.18)"
        stroke="#3b82f6"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* 数据点 */}
      {dataPoints.map(([px, py], i) => (
        <circle
          key={i}
          cx={px} cy={py} r={4}
          fill="#3b82f6"
          stroke="rgba(15,23,42,0.8)"
          strokeWidth="1.5"
        />
      ))}

      {/* 标签 */}
      {labels.map((l, i) => {
        const dim = dimensions[i];
        return (
          <g key={i}>
            <text
              x={l.x} y={l.y - 5}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="#94a3b8"
            >
              {l.shortLabel}
            </text>
            <text
              x={l.x} y={l.y + 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill={LEVEL_COLOR[dim.level]}
            >
              {dim.score}
            </text>
          </g>
        );
      })}

      {/* 中心点 */}
      <circle cx={cx} cy={cy} r={3} fill="rgba(148,163,184,0.3)" />
    </svg>
  );
};

// ─── 维度得分条 ──────────────────────────────────────────────

const DimensionBar: React.FC<{ dim: QVSDimension }> = ({ dim }) => {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDisplayScore(dim.score), 80);
    return () => clearTimeout(timer);
  }, [dim.score]);

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 text-right text-xs font-semibold text-slate-400 flex-shrink-0">
        {dim.label}
      </div>
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${displayScore}%`,
            backgroundColor: LEVEL_COLOR[dim.level],
          }}
        />
      </div>
      <div
        className="w-8 text-xs font-bold text-right flex-shrink-0"
        style={{ color: LEVEL_COLOR[dim.level] }}
      >
        {dim.score}
      </div>
      <div
        className="w-8 text-[10px] text-right flex-shrink-0"
        style={{ color: LEVEL_COLOR[dim.level], opacity: 0.8 }}
      >
        {LEVEL_LABEL[dim.level]}
      </div>
      <div className="w-28 text-[10px] text-slate-500 truncate flex-shrink-0">
        {dim.comment}
      </div>
    </div>
  );
};

// ─── 主组件 Props ────────────────────────────────────────────

interface QuestionEvaluatorProps {
  /** 初始问题文本（从父组件传入，可为空） */
  initialQuestion?: string;
  /** 确认开始探索时的回调，传出最终的问题文本 */
  onStartExploration: (question: string, report: QVSReport) => void;
  /** 关闭/取消 */
  onClose: () => void;
}

// ─── 主组件 ────────────────────────────────────────────────────

const QuestionEvaluator: React.FC<QuestionEvaluatorProps> = ({
  initialQuestion = '',
  onStartExploration,
  onClose,
}) => {
  const [question, setQuestion] = useState(initialQuestion);
  const [report, setReport] = useState<QVSReport | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'radar' | 'bars'>('radar');

  const estimate = quickEstimate(question);

  const handleEvaluate = async () => {
    if (!question.trim() || question.trim().length < 8) {
      setError('请先输入有意义的问题（至少 8 个字）');
      return;
    }
    setError('');
    setIsEvaluating(true);
    setReport(null);
    try {
      const r = await evaluateQuestion(question);
      setReport(r);
    } catch (e) {
      setError('评估失败，请检查网络后重试');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleStart = () => {
    if (!report) return;
    onStartExploration(question, report);
  };

  const gradeColor = report ? GRADE_COLOR[report.grade] : '#3b82f6';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl my-auto">
        {/* ── Header ── */}
        <div className="relative px-7 pt-7 pb-5 border-b border-slate-800">
          <div className="absolute top-0 left-0 w-full h-1 rounded-t-2xl bg-gradient-to-r from-blue-600 via-violet-500 to-emerald-500" />
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📊</span>
                <h2 className="text-lg font-bold text-white">问题价值评估</h2>
              </div>
              <p className="text-xs text-slate-500">
                AI 从 6 个维度评估你的问题，决定是否值得投入探索资源
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* ── Question Input ── */}
        <div className="px-7 pt-5 pb-4">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
            你的探索问题
          </label>
          <textarea
            value={question}
            onChange={e => { setQuestion(e.target.value); setReport(null); setError(''); }}
            placeholder="输入你想探索的问题，例如：为什么青少年在使用社交媒体后会感到更孤独？"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all min-h-[80px] leading-relaxed placeholder:text-slate-600"
            rows={3}
          />

          {/* 快速提示 */}
          {question.trim().length > 0 && !report && !isEvaluating && (
            <p className={`mt-2 text-[11px] flex items-center gap-1.5 ${estimate.lengthOk ? 'text-slate-500' : 'text-amber-500'}`}>
              <span>{estimate.lengthOk ? '💡' : '⚠️'}</span>
              {estimate.hint}
            </p>
          )}

          {error && (
            <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1.5">
              <span>⚠️</span>{error}
            </p>
          )}

          <div className="flex justify-end mt-3">
            <button
              onClick={handleEvaluate}
              disabled={isEvaluating || !question.trim()}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center gap-2 ${
                isEvaluating
                  ? 'bg-blue-600/40 text-blue-300 cursor-not-allowed'
                  : question.trim()
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {isEvaluating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                  AI 正在评估...
                </>
              ) : (
                <>📊 立即评估</>
              )}
            </button>
          </div>
        </div>

        {/* ── Report ── */}
        {report && (
          <div className="px-7 pb-7 space-y-5 border-t border-slate-800 pt-5">
            {/* 综合评分卡 */}
            <div className="flex items-center gap-4 bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              {/* 大分数 */}
              <div className="text-center flex-shrink-0">
                <div
                  className="text-4xl font-black tabular-nums"
                  style={{ color: gradeColor }}
                >
                  {report.totalScore}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">/ 100</div>
              </div>

              {/* 等级徽章 */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black flex-shrink-0 border-2"
                style={{
                  color: gradeColor,
                  borderColor: gradeColor,
                  backgroundColor: `${gradeColor}18`,
                }}
              >
                {report.grade}
              </div>

              {/* 描述 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-200">{report.gradeLabel}</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{report.reasoning}</p>
              </div>

              {/* 积分 */}
              <div className="text-center flex-shrink-0">
                <div className="text-lg font-bold text-amber-400">{report.estimatedCredits}</div>
                <div className="text-[10px] text-slate-500">预估积分</div>
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('radar')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'radar' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              >
                雷达图
              </button>
              <button
                onClick={() => setActiveTab('bars')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'bars' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              >
                维度详情
              </button>
            </div>

            {/* 雷达图 */}
            {activeTab === 'radar' && (
              <div className="flex justify-center py-2">
                <RadarChart dimensions={report.dimensions} />
              </div>
            )}

            {/* 维度得分条 */}
            {activeTab === 'bars' && (
              <div className="space-y-2.5 py-1">
                {report.dimensions.map(dim => (
                  <DimensionBar key={dim.key} dim={dim} />
                ))}
              </div>
            )}

            {/* 亮点 */}
            {report.highlights.length > 0 && (
              <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-xl p-4">
                <p className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-1.5">
                  <span>✨</span> 亮点
                </p>
                <ul className="space-y-1">
                  {report.highlights.map((h, i) => (
                    <li key={i} className="text-xs text-emerald-300/80">• {h}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 优化建议 */}
            {report.suggestions.length > 0 && (
              <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5">
                  <span>💡</span> 优化建议
                </p>
                <ul className="space-y-1">
                  {report.suggestions.map((s, i) => (
                    <li key={i} className="text-xs text-amber-300/80">• {s}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-sm transition-all border border-slate-700"
              >
                稍后再说
              </button>
              {report.canStart ? (
                <button
                  onClick={handleStart}
                  className="flex-[2] py-3 font-bold rounded-xl text-sm transition-all shadow-lg text-white flex items-center justify-center gap-2"
                  style={{
                    background: `linear-gradient(135deg, #2563eb, #7c3aed)`,
                    boxShadow: '0 4px 20px rgba(37,99,235,0.3)',
                  }}
                >
                  🚀 开始探索
                  <span className="text-[11px] opacity-70 font-normal">（消耗 {report.estimatedCredits} 积分）</span>
                </button>
              ) : (
                <div className="flex-[2] py-3 bg-slate-800 border border-slate-700 rounded-xl text-center">
                  <p className="text-xs font-bold text-red-400">分数偏低，建议先优化问题</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">参考上方建议修改后重新评估</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 评估中骨架屏 */}
        {isEvaluating && (
          <div className="px-7 pb-7 pt-5 border-t border-slate-800">
            <div className="space-y-3 animate-pulse">
              <div className="h-16 bg-slate-800 rounded-xl" />
              <div className="h-8 bg-slate-800 rounded-lg w-3/4" />
              <div className="h-48 bg-slate-800 rounded-xl" />
              <div className="h-20 bg-slate-800/60 rounded-xl" />
            </div>
            <p className="text-center text-xs text-slate-500 mt-4 animate-pulse">
              AI 正在从 6 个维度分析你的问题...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionEvaluator;
