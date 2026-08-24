import React from 'react';
import { ProblemNode, NodeStatus } from '../types';
import { OutlineProgress } from '../services/outline';

/**
 * 一篇写完之后的那个停顿。
 *
 * 这是「一篇一篇写」真正落地的地方：写完一篇，循环**主动停下**，
 * 把刚写的那篇摆到用户面前，问一句「看完了吗，下一篇写什么」。
 *
 * 为什么值得专门做这么一条：
 * 用户跟不上，不是因为笔记写得不好，是因为**没有一个地方让他说「我看完了」**。
 * 没有这个动作，AI 就只能按自己的节奏往下跑，两边的认知就此分叉。
 *
 * 三个动作是有取舍的：
 * - 「看完了，下一篇」是主按钮，因为多数时候就是继续；
 * - 「这篇重写」而不是「编辑」——用户此刻的判断是"方向不对"，不是"错别字"；
 * - 「先停一下」必须一直在，且不带任何劝返文案。
 */

const StepBar: React.FC<{
  /** 刚写完的那一篇 */
  justWrote?: ProblemNode;
  progress: OutlineProgress;
  onNext: () => void;
  onRewrite: () => void;
  onStop: () => void;
  onOpen: (nodeId: string) => void;
  /** 切成一路写到底 */
  onSwitchToAuto?: () => void;
  busy?: boolean;
}> = ({ justWrote, progress, onNext, onRewrite, onStop, onOpen, onSwitchToAuto, busy }) => {
  if (!justWrote) return null;

  const st = justWrote.status;
  const flag =
    st === NodeStatus.CONTRADICTED ? { icon: '🔴', text: '被现实推翻了', cls: 'text-pink-300' }
    : st === NodeStatus.VALIDATING ? { icon: '🟡', text: '写到头了，要问现实', cls: 'text-purple-300' }
    : { icon: '✅', text: '写完了', cls: 'text-emerald-300' };

  // 一句话摘要：给用户一个"要不要点进去细看"的判断依据，而不是逼他每篇都点开
  const gist = (justWrote.hypothesis?.statement || justWrote.notes || '').trim().slice(0, 70);

  return (
    <div className="rounded-2xl border border-blue-500/30 bg-blue-950/20 p-3.5 space-y-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-[12px] font-bold ${flag.cls}`}>{flag.icon} {flag.text}</span>
        <button onClick={() => onOpen(justWrote.id)}
          className="text-[13px] font-bold text-white hover:text-blue-300 transition-colors">
          《{justWrote.title}》
        </button>
        <span className="text-[11px] text-slate-500 ml-auto">
          已写 {progress.written}/{progress.total} 篇
        </span>
      </div>

      {gist && <p className="text-[11px] text-slate-400 leading-6">{gist}{gist.length >= 70 ? '…' : ''}</p>}

      {progress.next ? (
        <div className="text-[11px] text-slate-400 border-l-2 border-slate-700 pl-2.5 leading-6">
          <span className="text-slate-500">下一篇：</span>
          <b className="text-slate-200">{progress.next.title}</b>
          {progress.next.question && <span className="text-slate-500"> —— {progress.next.question}</span>}
        </div>
      ) : (
        <div className="text-[11px] text-emerald-300/90">没有待写的了。</div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {progress.next && (
          <button onClick={onNext} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-bold disabled:opacity-40 transition-colors">
            看完了，写下一篇 →
          </button>
        )}
        <button onClick={onRewrite} disabled={busy}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] disabled:opacity-40 transition-colors">
          ↻ 这篇重写
        </button>
        <button onClick={onStop}
          className="px-2.5 py-1.5 text-slate-500 hover:text-slate-300 text-[11px] transition-colors">
          先停一下
        </button>
        {progress.next && onSwitchToAuto && (
          <button onClick={onSwitchToAuto}
            className="text-[10px] text-slate-600 hover:text-slate-400 ml-auto transition-colors"
            title="不再一篇一停，把剩下的一次写完">
            剩下的一次写完 »
          </button>
        )}
      </div>
    </div>
  );
};

export default StepBar;
