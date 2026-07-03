import React, { useState, useEffect, useMemo } from 'react';
import { evaluateQuestion, quickEstimate, QVSReport } from '../services/qvsService';
import { buildSeedQuestions, SEED_CATEGORIES } from '../services/seedQuestions';

/**
 * 有价值问题广场（知乎式）
 * 两个核心机制：
 *  1) 筛选有价值问题：用 QVS（6 维度）给问题打分，按价值排序、可只看高价值。
 *  2) 感兴趣问题：❤ 关注 + 👍 赞（兴趣信号），可只看自己关注的、按热度排序。
 * 有价值的问题可一键「立项」转成一个项目。数据存 localStorage。
 */

interface VQuestion {
  id: string;
  text: string;
  createdAt: number;
  score?: number;       // QVS 总分 0–100
  grade?: string;       // S/A/B/C/D
  reasoning?: string;   // AI 总评
  interested?: boolean; // 我关注
  upvotes?: number;     // 赞（兴趣热度）
  category?: string;    // 领域（种子问题自带）
}

type SortMode = 'value' | 'hot' | 'new';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const gradeColor = (g?: string) =>
  g === 'S' ? 'text-amber-300 bg-amber-900/30 border-amber-500/40'
  : g === 'A' ? 'text-emerald-300 bg-emerald-900/30 border-emerald-500/40'
  : g === 'B' ? 'text-blue-300 bg-blue-900/30 border-blue-500/40'
  : g === 'C' ? 'text-slate-300 bg-slate-700/40 border-slate-600'
  : 'text-slate-500 bg-slate-800 border-slate-700';

const QuestionBoard: React.FC<{
  userKey: string;
  onClose: () => void;
  onStartProject: (question: string) => void;
}> = ({ userKey, onClose, onStartProject }) => {
  const storageKey = `aae-questions_${userKey}`;
  const seededKey = `aae-questions-seeded_${userKey}`;
  // 用惰性初始化同步读取，避免挂载时先写入空数组覆盖已存数据。
  // 首次打开（从未种子化过且当前为空）时，自动注入精选问题做冷启动。
  const [questions, setQuestions] = useState<VQuestion[]>(() => {
    try {
      const s = localStorage.getItem(storageKey);
      const existing: VQuestion[] = s ? JSON.parse(s) : [];
      if (existing.length === 0 && !localStorage.getItem(seededKey)) {
        const seeds = buildSeedQuestions();
        localStorage.setItem(seededKey, '1');
        return seeds;
      }
      return existing;
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [sort, setSort] = useState<SortMode>('new');
  const [onlyValuable, setOnlyValuable] = useState(false);
  const [onlyInterested, setOnlyInterested] = useState(false);
  const [category, setCategory] = useState<string>('全部');
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);

  // 手动重新载入精选问题库（去重后并入，已删除的不强行恢复）
  const loadSeeds = () => {
    const seeds = buildSeedQuestions();
    setQuestions(prev => {
      const existingTexts = new Set(prev.map(q => q.text.trim()));
      const fresh = seeds.filter(s => !existingTexts.has(s.text.trim()));
      return [...prev, ...fresh];
    });
    try { localStorage.setItem(seededKey, '1'); } catch {}
  };

  // 持久化
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(questions)); } catch {}
  }, [questions, storageKey]);

  const update = (id: string, patch: Partial<VQuestion>) =>
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));

  const addQuestion = () => {
    const text = input.trim();
    if (!text) return;
    setQuestions(prev => [{ id: uid(), text, createdAt: Date.now(), upvotes: 0 }, ...prev]);
    setInput('');
  };

  const evaluate = async (q: VQuestion) => {
    setEvaluatingId(q.id);
    try {
      const r: QVSReport = await evaluateQuestion(q.text);
      update(q.id, { score: r.totalScore, grade: r.grade, reasoning: r.reasoning });
    } catch (e: any) {
      alert('评估失败（可能未配置模型）：' + (e?.message || e) + '\n请在右上角设置里配置模型后再试。');
    } finally {
      setEvaluatingId(null);
    }
  };

  // 当前问题里实际出现过的领域（用于领域筛选条）
  const categories = useMemo(() => {
    const present = new Set(questions.map(q => q.category).filter(Boolean) as string[]);
    return ['全部', ...SEED_CATEGORIES.filter(c => present.has(c))];
  }, [questions]);

  const view = useMemo(() => {
    let list = [...questions];
    if (onlyValuable) list = list.filter(q => (q.score ?? -1) >= 60);
    if (onlyInterested) list = list.filter(q => q.interested);
    if (category !== '全部') list = list.filter(q => q.category === category);
    list.sort((a, b) => {
      if (sort === 'value') return (b.score ?? -1) - (a.score ?? -1) || b.createdAt - a.createdAt;
      if (sort === 'hot') return (b.upvotes || 0) - (a.upvotes || 0) || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [questions, sort, onlyValuable, onlyInterested, category]);

  const est = quickEstimate(input);

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-slate-950/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
        <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2"><span>🔥</span> 问题广场 · 筛选有价值的问题</h3>
        <div className="flex items-center gap-2">
          <button onClick={loadSeeds} className="px-3 py-1.5 bg-amber-900/40 hover:bg-amber-800/50 border border-amber-600/40 text-amber-300 rounded-lg text-[11px] font-medium transition-colors" title="并入平台精选的问题库">✨ 载入精选</button>
          <button onClick={onClose} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors" title="关闭"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
      </div>

      <div className="max-w-3xl w-full mx-auto flex-1 overflow-y-auto scroll-hide p-4 space-y-4">
        {/* 提问框 */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addQuestion(); }}
            placeholder="抛出一个值得长期研究的问题…（⌘/Ctrl+Enter 提交）"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-amber-500 min-h-[72px] resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-slate-500">{est.hint}</span>
            <button onClick={addQuestion} disabled={!input.trim()} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors">＋ 添加问题</button>
          </div>
        </div>

        {/* 排序 / 筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
            {([['value', '💎 价值'], ['hot', '🔥 热度'], ['new', '🕐 最新']] as [SortMode, string][]).map(([m, label]) => (
              <button key={m} onClick={() => setSort(m)} className={`px-3 py-1 text-[11px] rounded-md transition-colors ${sort === m ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
            ))}
          </div>
          <button onClick={() => setOnlyValuable(v => !v)} className={`px-3 py-1.5 text-[11px] rounded-lg border transition-colors ${onlyValuable ? 'bg-emerald-600/80 border-emerald-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}>只看高价值(≥60)</button>
          <button onClick={() => setOnlyInterested(v => !v)} className={`px-3 py-1.5 text-[11px] rounded-lg border transition-colors ${onlyInterested ? 'bg-rose-600/80 border-rose-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}>❤ 只看我关注</button>
          <span className="text-[10px] text-slate-600 ml-auto">{view.length} / {questions.length} 个问题</span>
        </div>

        {/* 领域筛选 */}
        {categories.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${category === c ? 'bg-amber-600/80 border-amber-500 text-white font-bold' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* 列表 */}
        {view.length === 0 ? (
          <div className="text-center text-[12px] text-slate-600 py-16">还没有问题。先抛出一个值得长期研究的问题吧。</div>
        ) : (
          <div className="space-y-2">
            {view.map(q => (
              <div key={q.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex gap-3">
                {/* 价值分 */}
                <div className="flex flex-col items-center flex-shrink-0 w-14">
                  {q.score !== undefined ? (
                    <>
                      <div className="text-xl font-bold text-amber-300">{q.score}</div>
                      <div className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${gradeColor(q.grade)}`}>{q.grade}</div>
                    </>
                  ) : (
                    <div className="text-[9px] text-slate-600 text-center">未评估</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {q.category && <div className="inline-block text-[9px] text-amber-400/80 bg-amber-900/20 border border-amber-500/20 rounded px-1.5 py-0.5 mb-1.5">{q.category}</div>}
                  <div className="text-sm text-slate-200 leading-relaxed">{q.text}</div>
                  {q.reasoning && <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">{q.reasoning}</div>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button onClick={() => update(q.id, { interested: !q.interested })} className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${q.interested ? 'text-rose-300 bg-rose-900/30 border-rose-500/40' : 'text-slate-400 border-slate-700 hover:border-rose-500/40'}`}>{q.interested ? '❤ 已关注' : '♡ 感兴趣'}</button>
                    <button onClick={() => update(q.id, { upvotes: (q.upvotes || 0) + 1 })} className="text-[10px] px-2 py-1 rounded-full border border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-500/40 transition-colors">👍 {q.upvotes || 0}</button>
                    <button onClick={() => evaluate(q)} disabled={evaluatingId === q.id} className="text-[10px] px-2 py-1 rounded-full border border-slate-700 text-blue-400 hover:border-blue-500/40 transition-colors disabled:opacity-50">{evaluatingId === q.id ? '评估中…' : '📊 评估价值'}</button>
                    <button onClick={() => { onStartProject(q.text); onClose(); }} className="text-[10px] px-2 py-1 rounded-full border border-emerald-500/40 text-emerald-400 hover:bg-emerald-900/30 transition-colors">🚀 立项</button>
                    <button onClick={() => setQuestions(prev => prev.filter(x => x.id !== q.id))} className="text-[10px] px-2 py-1 rounded-full border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors ml-auto">删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionBoard;
