import React, { useState, useEffect } from 'react';
import { ProblemNode, NodeStatus, ChatMessage, AgentResult } from '../types';
import { runAgentTask, identifyNodeTask } from '../services/geminiService';
import MarkdownView from './MarkdownView';

interface NodeDetailsProps {
  node: ProblemNode | null;
  isFocused: boolean;
  isWide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
  onSendMessage: (nodeId: string, text: string) => Promise<void>;
  onUpdateNotes: (nodeId: string, newNotes: string) => void;
  onUpdateNodeData: (id: string, updates: Partial<ProblemNode>) => void;
  onAppendToSummary: (text: string) => void;
  onAddChildNode?: (parentId: string, title: string) => void;
}

const AGENT_MARKETPLACE = [
  { category: '视觉与设计', agents: ['AI 画师', 'UI/UX 设计师', 'Logo 设计专家', '摄影后期'] },
  { category: '编程与开发', agents: ['全栈工程师', 'Python 专家', '算法竞赛选手', '安全审计员'] },
  { category: '多媒体生成', agents: ['视频导演', '配音师 (TTS)', '动效设计师', '编曲专家'] },
  { category: '深度研究', agents: ['行业分析师', '文献综述员', '法律顾问', '风险评估专家'] },
  { category: '数理逻辑', agents: ['数学建模专家', '统计学家', '物理模拟员'] }
];

const NodeDetails: React.FC<NodeDetailsProps> = ({
  node, isFocused, isWide, onToggleWide, onClose, onSendMessage, onUpdateNotes, onUpdateNodeData, onAppendToSummary, onAddChildNode
}) => {
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [manualInput, setManualInput] = useState(node?.manualResults || '');
  const [editingTitle, setEditingTitle] = useState(node?.title || '');
  const [editingNotes, setEditingNotes] = useState(node?.notes || '');
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [showDelegationModal, setShowDelegationModal] = useState(false);
  // 节点笔记（Markdown）
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(node?.fullNote || '');
  const [tagInput, setTagInput] = useState('');
  const [newDirectionTitle, setNewDirectionTitle] = useState('');
  const [showNewDirection, setShowNewDirection] = useState(false);

  useEffect(() => {
    if (node) {
      if (!node.taskType) {
        identifyNodeTask(node).then(type => {
          onUpdateNodeData(node.id, { taskType: type });
        });
      }
      setManualInput(node.manualResults || '');
      setEditingTitle(node.title);
      setEditingNotes(node.notes);
      setNoteDraft(node.fullNote || '');
      setIsEditingNote(false);
      setShowNewDirection(false);
    }
  }, [node?.id]);

  if (!node) return null;

  const saveNote = () => {
    onUpdateNodeData(node.id, { fullNote: noteDraft, noteUpdatedAt: Date.now() });
    setIsEditingNote(false);
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t) return;
    const tags = node.tags || [];
    if (!tags.includes(t)) onUpdateNodeData(node.id, { tags: [...tags, t] });
    setTagInput('');
  };

  const removeTag = (t: string) => {
    onUpdateNodeData(node.id, { tags: (node.tags || []).filter(x => x !== t) });
  };

  const createNewDirection = () => {
    const title = newDirectionTitle.trim();
    if (!title || !onAddChildNode) return;
    onAddChildNode(node.id, title);
    setNewDirectionTitle('');
    setShowNewDirection(false);
  };

  const handleAgentRun = async (type: string) => {
    setIsAgentRunning(true);
    setShowAgentMenu(false);
    try {
      const output = await runAgentTask(node, type);
      const newResult: AgentResult = { agentType: type, timestamp: Date.now(), output };
      const currentResults = node.agentResults || [];
      onUpdateNodeData(node.id, { agentResults: [newResult, ...currentResults] });
    } finally {
      setIsAgentRunning(false);
    }
  };

  const getRecommendedAgent = () => {
    switch (node.taskType) {
      case 'image': return '视觉设计师';
      case 'code': return '高级开发工程师';
      case 'web': return '全栈架构师';
      case 'research': return '情报分析员';
      default: return '逻辑分析专家';
    }
  };

  const handleScoreResult = (idx: number, score: number) => {
    if (!node.agentResults) return;
    const newResults = [...node.agentResults];
    const item = newResults[idx];
    item.score = score;
    onUpdateNodeData(node.id, { agentResults: newResults });

    if (score > 8) {
      onAppendToSummary(`\n### ${item.agentType} 任务成果 (${new Date(item.timestamp).toLocaleTimeString()})\n${item.output}\n`);
      alert(`评分优秀（${score}分），已自动同步成果至探索笔记。`);
    } else if (score < 5) {
      alert(`当前评分（${score}分）较低。建议更换 Agent（如切换到架构师或调研员）或尝试更多 Agent 选项。`);
    } else if (score < 8) {
      alert(`当前评分（${score}分）不理想，正在尝试重新执行该任务...`);
      handleAgentRun(item.agentType);
    }
  };

  const delegationLink = `${window.location.origin}/#/delegate/${node.id}?task=${encodeURIComponent(node.title)}`;

  const renderAgentOutput = (result: AgentResult, idx: number) => {
    const isCode = result.output.includes('```') || result.agentType.toLowerCase().includes('code') || result.agentType.includes('开发');
    
    return (
      <div key={idx} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3 mb-4 shadow-sm">
        <div className="flex justify-between items-center border-b border-slate-800 pb-2">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{result.agentType} 成果</span>
          <span className="text-[9px] text-slate-500">{new Date(result.timestamp).toLocaleTimeString()}</span>
        </div>
        
        <div className="text-[11px] text-slate-300 leading-relaxed overflow-hidden">
          {isCode ? (
             <div className="bg-black/50 p-2 rounded border border-emerald-900/30 font-mono text-[10px] text-emerald-400 overflow-x-auto whitespace-pre">
               {result.output}
             </div>
          ) : (
             <div className="whitespace-pre-wrap">{result.output}</div>
          )}
        </div>

        <div className="pt-2 border-t border-slate-800 space-y-2">
           <div className="text-[9px] text-slate-500 font-medium">结果评分 (1-10):</div>
           <div className="flex gap-1 flex-wrap">
             {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
               <button 
                 key={s} 
                 onClick={() => handleScoreResult(idx, s)}
                 className={`w-7 h-7 rounded flex items-center justify-center text-[10px] border transition-all ${
                   result.score === s 
                    ? 'bg-blue-600 border-blue-500 text-white font-bold' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                 }`}
               >
                 {s}
               </button>
             ))}
           </div>
           {result.score !== undefined && (
             <div className={`text-[10px] font-bold ${result.score > 8 ? 'text-emerald-400' : result.score < 5 ? 'text-red-400' : 'text-yellow-400'}`}>
                已评分: {result.score} 分 {result.score > 8 ? '(已同步笔记)' : result.score < 5 ? '(表现不佳)' : '(重试中)'}
             </div>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className={`h-full bg-slate-800 border-l border-slate-700 flex flex-col shadow-2xl transition-all duration-300 ${isWide ? 'w-screen md:w-[600px]' : 'w-screen md:w-96'} ${isFocused ? 'ring-2 ring-blue-500/50' : ''}`}>
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <input 
            className="bg-transparent border-none outline-none font-bold text-base sm:text-lg text-blue-100 truncate w-full focus:ring-1 focus:ring-blue-500/50 rounded px-1"
            value={editingTitle}
            onChange={(e) => { setEditingTitle(e.target.value); onUpdateNodeData(node.id, { title: e.target.value }); }}
            placeholder="节点标题"
          />
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button 
            onClick={onToggleWide} 
            className="hidden md:flex p-2 text-slate-400 hover:text-white rounded-lg transition-colors items-center justify-center bg-slate-700/40"
            title={isWide ? "收缩" : "放大"}
          >
            {isWide ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M21 3l-7 7"/></svg>
            )}
          </button>
          <button 
            onClick={onClose} 
            className="p-2.5 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center justify-center bg-slate-700/60 min-w-[36px] min-h-[36px]"
            title="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      
      <div className="p-4 flex-1 overflow-y-auto space-y-6 scroll-hide pb-20 relative">
        {/* ===== 节点笔记（每个节点是一篇可编辑的 Markdown 笔记） ===== */}
        <section className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <label className="text-[10px] uppercase tracking-widest text-purple-400 font-bold">📝 节点笔记</label>
            <div className="flex items-center gap-2">
              {node.noteUpdatedAt && !isEditingNote && (
                <span className="text-[9px] text-slate-600">{new Date(node.noteUpdatedAt).toLocaleString()}</span>
              )}
              {isEditingNote ? (
                <>
                  <button onClick={saveNote} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-bold transition-colors">保存</button>
                  <button onClick={() => { setNoteDraft(node.fullNote || ''); setIsEditingNote(false); }} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-[10px] transition-colors">取消</button>
                </>
              ) : (
                <button onClick={() => setIsEditingNote(true)} className="px-3 py-1 bg-slate-700 hover:bg-purple-600 text-slate-300 hover:text-white rounded text-[10px] font-bold transition-colors">✏️ 编辑</button>
              )}
            </div>
          </div>

          {isEditingNote ? (
            <textarea
              autoFocus
              className="w-full bg-slate-950 border border-purple-500/40 rounded-lg p-3 text-[11px] text-slate-200 font-mono min-h-[180px] outline-none focus:ring-1 focus:ring-purple-500 leading-relaxed"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote(); }}
              placeholder={'支持 Markdown：# 标题、**粗体**、- 列表、```代码```、[[关联节点]]…\n\n把这个节点当作一篇笔记：记录你的思考、补充资料、修正 AI 的结论,或者标记一个新方向。\n\n⌘/Ctrl + Enter 保存'}
            />
          ) : node.fullNote ? (
            <div onDoubleClick={() => setIsEditingNote(true)} title="双击编辑">
              <MarkdownView source={node.fullNote} />
            </div>
          ) : (
            <button onClick={() => setIsEditingNote(true)} className="w-full py-4 border border-dashed border-slate-700 hover:border-purple-500/50 rounded-lg text-[10px] text-slate-500 hover:text-purple-400 transition-colors">
              + 把这个节点写成一篇笔记（Markdown）
            </button>
          )}

          {/* 标签 */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-slate-800">
            {(node.tags || []).map(t => (
              <span key={t} className="group inline-flex items-center gap-1 bg-purple-900/30 border border-purple-500/30 text-purple-300 text-[9px] px-2 py-0.5 rounded-full">
                #{t}
                <button onClick={() => removeTag(t)} className="opacity-0 group-hover:opacity-100 text-purple-400 hover:text-red-400 transition-opacity">×</button>
              </span>
            ))}
            <input
              className="bg-transparent border-none outline-none text-[9px] text-slate-400 w-20 placeholder:text-slate-600"
              placeholder="+ 标签"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              onBlur={addTag}
            />
          </div>

          {/* 从此节点开新方向 */}
          {onAddChildNode && (
            <div className="mt-3">
              {showNewDirection ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="flex-1 bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="新方向的问题是什么？"
                    value={newDirectionTitle}
                    onChange={(e) => setNewDirectionTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createNewDirection(); if (e.key === 'Escape') setShowNewDirection(false); }}
                  />
                  <button onClick={createNewDirection} className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition-colors">创建</button>
                </div>
              ) : (
                <button onClick={() => setShowNewDirection(true)} className="w-full py-2 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-bold transition-colors">
                  🌱 从此节点开一个新方向
                </button>
              )}
            </div>
          )}
        </section>

        {node.agentResults && node.agentResults.length > 0 && (
          <section>
             <label className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-3 block">Agent 执行结果及评分</label>
             <div className="space-y-4">
               {node.agentResults.map((r, i) => renderAgentOutput(r, i))}
             </div>
          </section>
        )}

        <section className={`p-4 rounded-xl border transition-all duration-500 relative ${node.taskType && node.taskType !== 'none' ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-900/50 border-slate-700 opacity-60'}`}>
          <div className="flex justify-between items-center mb-4">
            <label className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">任务执行建议</label>
            {node.taskType && node.taskType !== 'none' && (
              <span className="bg-blue-600 text-white text-[9px] px-2 py-0.5 rounded-full animate-pulse">识别到需求</span>
            )}
          </div>
          
          <div className="flex flex-col gap-3">
             <button 
                disabled={isAgentRunning} 
                onClick={() => handleAgentRun(getRecommendedAgent())} 
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 transition-all flex items-center justify-center gap-2 group"
             >
                <span className="opacity-70 group-hover:scale-110 transition-transform">✨</span>
                AI 推荐：{getRecommendedAgent()}
             </button>
             
             <button 
                onClick={() => setShowAgentMenu(!showAgentMenu)}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition-all"
             >
                浏览更多 Agent 分类...
             </button>

             <button 
                onClick={() => setShowDelegationModal(true)}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 group"
             >
                <span className="text-lg">🤝</span>
                替你安排给人做
             </button>

             {showAgentMenu && (
               <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-20 p-4 max-h-[400px] overflow-y-auto scroll-hide animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700">
                     <span className="text-[10px] font-bold text-slate-500 uppercase">Agent 市场</span>
                     <button onClick={() => setShowAgentMenu(false)} className="text-slate-500 hover:text-white">✕</button>
                  </div>
                  {AGENT_MARKETPLACE.map((cat, i) => (
                    <div key={i} className="mb-4 last:mb-0">
                       <h4 className="text-[10px] text-blue-400 font-bold mb-2">{cat.category}</h4>
                       <div className="grid grid-cols-2 gap-2">
                          {cat.agents.map((agent, j) => (
                            <button 
                               key={j} 
                               onClick={() => handleAgentRun(agent)}
                               className="text-left px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-[10px] hover:bg-blue-600 hover:border-blue-500 transition-colors truncate"
                            >
                               {agent}
                            </button>
                          ))}
                       </div>
                    </div>
                  ))}
               </div>
             )}
          </div>
          {isAgentRunning && <div className="mt-3 text-center text-[10px] text-blue-400 animate-pulse font-medium">Agent 正在全力思考中...</div>}
        </section>

        {showDelegationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="text-lg">🤝</span> 安排外协执行
                </h3>
                <button onClick={() => setShowDelegationModal(false)} className="text-slate-500 hover:text-white">✕</button>
              </div>
              <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
                请将下方链接复制给执行的人。该链接打开后将启动一个 <span className="text-blue-400 font-bold">需求对齐 AI</span>，它会代你向对方讲清楚任务背景、目标与要求，并实时替你监督工作情况同步给你。
              </p>
              <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-4 break-all font-mono text-[10px] text-slate-500">
                {delegationLink}
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(delegationLink);
                  alert('协作链接已复制！快发给执行人员吧。');
                  setShowDelegationModal(false);
                }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                复制链接并关闭
              </button>
            </div>
          </div>
        )}

        <section>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 block">记录成果</label>
          <div className="flex gap-2">
            <input 
              className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="手动记录成果..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
            />
            <button onClick={() => onUpdateNodeData(node.id, { manualResults: manualInput })} className="px-4 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-bold transition-colors">保存</button>
          </div>
        </section>

        <section className="border-t border-slate-700 pt-5 flex flex-col min-h-[200px]">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 block">节点背景笔记 (可实时编辑)</label>
          <textarea 
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-[11px] text-slate-300 min-h-[100px] outline-none focus:ring-1 focus:ring-blue-500 transition-all mb-4"
            value={editingNotes}
            onChange={(e) => { setEditingNotes(e.target.value); onUpdateNotes(node.id, e.target.value); }}
            placeholder="尚未生成背景分析，可手动输入..."
          />
          
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 block">节点咨询对话</label>
          <div className="flex-1 overflow-y-auto bg-slate-900/50 rounded-lg p-3 space-y-4 mb-3 scroll-hide border border-slate-700/50 max-h-[400px]">
            {node.chatHistory?.map((chat, idx) => (
              <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[12px] shadow-sm whitespace-pre-wrap ${chat.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 border border-slate-700 rounded-tl-none'}`}>
                  {chat.text}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={async (e) => { e.preventDefault(); if(!chatInput.trim() || isSending) return; setIsSending(true); const msg = chatInput; setChatInput(''); await onSendMessage(node.id, msg); setIsSending(false); }} className="flex gap-2">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="提问..." className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-4 py-3 text-xs text-white outline-none" />
            <button type="submit" disabled={isSending} className="px-5 py-3 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-bold transition-colors">发送</button>
          </form>
        </section>
      </div>
    </div>
  );
};

export default NodeDetails;