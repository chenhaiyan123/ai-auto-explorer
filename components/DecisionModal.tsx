
import React from 'react';
import { DecisionPoint, ProblemNode } from '../types';

interface DecisionModalProps {
  decision: DecisionPoint;
  node: ProblemNode;
  onChoice: (action: 'continue' | 'add_subproblem' | 'terminate', subproblemTitle?: string) => void;
  onClose?: () => void;
}

const DecisionModal: React.FC<DecisionModalProps> = ({ decision, node, onChoice, onClose }) => {
  const [newSubproblem, setNewSubproblem] = React.useState('');

  if (!node) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 relative">
        {onClose && (
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white transition-colors z-10"
            title="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        )}
        
        <div className="bg-blue-600/10 border-b border-blue-600/20 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-blue-400 flex items-center gap-2">
            🧭 方案决策建议
          </h2>
          <div className="text-slate-300 mt-2 text-xs leading-relaxed">
            节点 <strong>{node.title}</strong> 拆解完成，AI 识别到多条路径可能性，请选择您的倾向：
          </div>
          {decision.context && (
            <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-[11px] text-blue-200/90 leading-relaxed italic">
              AI 洞察：{decision.context}
            </div>
          )}
        </div>
        
        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {decision.options.map((opt, i) => (
              opt.action === 'add_subproblem' ? (
                <div key={i} className="p-4 sm:p-5 rounded-xl bg-slate-700/50 border border-slate-600 flex flex-col gap-3">
                  <span className="font-semibold block text-sm">{opt.label}</span>
                  <input 
                    type="text" 
                    value={newSubproblem}
                    onChange={(e) => setNewSubproblem(e.target.value)}
                    placeholder="在此输入确定的新方向/子问题..."
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button 
                    onClick={() => newSubproblem && onChoice('add_subproblem', newSubproblem)}
                    disabled={!newSubproblem}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-xs font-bold shadow-lg shadow-emerald-900/40 active:scale-[0.98] transition-transform"
                  >
                    确认此方向并继续
                  </button>
                </div>
              ) : (
                <button 
                  key={i}
                  onClick={() => onChoice(opt.action)}
                  className={`text-left p-4 sm:p-5 rounded-xl bg-slate-700/50 hover:bg-slate-600 border border-slate-600 transition-all group active:scale-[0.98] ${opt.action === 'terminate' ? 'hover:border-red-500/50' : 'hover:border-blue-500/50'}`}
                >
                  <div className="flex justify-between items-start">
                    <span className={`font-semibold block text-sm ${opt.action === 'terminate' ? 'group-hover:text-red-400' : 'group-hover:text-blue-400'}`}>
                      {opt.label}
                    </span>
                    {opt.label.includes('(推荐)') && (
                      <span className="bg-emerald-600/20 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30">RECOMMENDED</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    {opt.action === 'terminate' ? '若当前路径不符合预期或已完成使命，可安全终止此分支。' : '根据 AI 当前推理的逻辑链路进行下一步拆解。'}
                  </span>
                </button>
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecisionModal;
