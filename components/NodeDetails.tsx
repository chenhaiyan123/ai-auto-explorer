import React, { useState, useEffect, useMemo } from 'react';
import { ProblemNode, NodeStatus, ChatMessage, AgentResult, DecisionRecord } from '../types';
import { TRIGGER_LABEL } from '../services/decisionService';
import { runAgentTask, identifyNodeTask } from '../services/geminiService';
import MarkdownView from './MarkdownView';
import { getOutgoingLinks, getBacklinks, resolveNodeByTitle } from '../services/noteLinks';
import { downloadNoteMd } from '../services/vault';

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
  /** 所有节点（笔记），用于解析双向链接 */
  allNodes?: ProblemNode[];
  /** 跳转到某个节点（笔记） */
  onNavigate?: (nodeId: string) => void;
  /** 点击 [[标题]]：exists=false 时通常需要创建并关联 */
  onWikiLink?: (target: string, exists: boolean, fromNode: ProblemNode) => void;
  /** 布局变体：panel=右侧滑出（默认），center=作为中间主编辑区铺满 */
  variant?: 'panel' | 'center';
  /** 决策节点持久化：本项目的决策记录（组件内会按当前节点过滤） */
  decisions?: DecisionRecord[];
  /** 打开决策记录弹窗 */
  onRecordDecision?: (nodeId: string) => void;
  /** 从某条决策记录 fork 复刻分支 */
  onForkDecision?: (decisionId: string) => void;
}

const AGENT_MARKETPLACE = [
  { category: '视觉与设计', agents: ['AI 画师', 'UI/UX 设计师', 'Logo 设计专家', '摄影后期'] },
  { category: '编程与开发', agents: ['全栈工程师', 'Python 专家', '算法竞赛选手', '安全审计员'] },
  { category: '多媒体生成', agents: ['视频导演', '配音师 (TTS)', '动效设计师', '编曲专家'] },
  { category: '深度研究', agents: ['行业分析师', '文献综述员', '法律顾问', '风险评估专家'] },
  { category: '数理逻辑', agents: ['数学建模专家', '统计学家', '物理模拟员'] }
];

const NodeDetails: React.FC<NodeDetailsProps> = ({
  node, isFocused, isWide, onToggleWide, onClose, onSendMessage, onUpdateNotes, onUpdateNodeData, onAppendToSummary, onAddChildNode,
  allNodes = [], onNavigate, onWikiLink, variant = 'panel',
  decisions = [], onRecordDecision, onForkDecision
}) => {
  const isCenter = variant === 'center';
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
  const [folderInput, setFolderInput] = useState(node?.folder || '');
  const [agentInput, setAgentInput] = useState(node?.assignedAgent || '');
  // 笔记属性/功能模块：默认不展开任何模块，正常只看笔记本身
  const [activeModule, setActiveModule] = useState<null | 'links' | 'task' | 'results' | 'chat' | 'props' | 'decision'>(null);

  // 当前节点的决策记录（决策节点持久化）
  const nodeDecisions = useMemo(
    () => decisions.filter(d => d.nodeId === node?.id).sort((a, b) => b.createdAt - a.createdAt),
    [decisions, node?.id]
  );

  // ===== 双向链接（Obsidian 式）=====
  const outgoingLinks = useMemo(
    () => (node ? getOutgoingLinks(node, allNodes) : []),
    [node, allNodes]
  );
  const backlinks = useMemo(
    () => (node ? getBacklinks(node, allNodes) : []),
    [node, allNodes]
  );
  const linkResolver = useMemo(
    () => (target: string) => !!resolveNodeByTitle(allNodes, target),
    [allNodes]
  );

  // ===== 项目概览（总览笔记上的实时仪表盘，从全部节点算出） =====
  const overviewData = useMemo(() => {
    if (!node || node.noteType !== 'overview') return null;
    const isDir = (n: ProblemNode) => n.noteType === 'direction' || !n.noteType;
    const dirs = allNodes.filter(isDir);
    const byId = new Map(allNodes.map(n => [n.id, n]));
    const parentOf = (n: ProblemNode) => (n.dependencies || []).map(d => byId.get(d)).find(p => p && isDir(p));
    const main = dirs.filter(n => !parentOf(n));
    return {
      total: dirs.length,
      solved: dirs.filter(n => n.status === NodeStatus.SOLVED).length,
      exploring: dirs.filter(n => n.status === NodeStatus.EXPLORING).length,
      unexplored: dirs.filter(n => n.status === NodeStatus.UNEXPLORED).length,
      problems: dirs.filter(n => n.status === NodeStatus.NEEDS_REVIEW || n.status === NodeStatus.INVALID),
      main,
      dirs,
    };
  }, [node, allNodes]);

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
      setNoteDraft(node.fullNote || node.notes || '');
      setIsEditingNote(false);
      setShowNewDirection(false);
      setFolderInput(node.folder || '');
      setAgentInput(node.assignedAgent || '');
      setActiveModule(null); // 切换笔记时收起所有模块
    }
  }, [node?.id]);

  const saveAgent = () => {
    if (!node) return;
    const v = agentInput.trim();
    if (v !== (node.assignedAgent || '')) onUpdateNodeData(node.id, { assignedAgent: v || undefined });
  };

  const toggleVerify = () => {
    if (!node) return;
    onUpdateNodeData(node.id, node.verified ? { verified: false, verifiedAt: undefined } : { verified: true, verifiedAt: Date.now() });
  };

  // 不同类型笔记的起始模板（给空笔记一个结构）
  const starterTemplate = () => {
    const t = node?.title || '';
    if (node?.noteType === 'readme') return `# ${t}\n\n> 项目说明（README）\n\n## 这个项目要解决什么\n\n## 项目类型\n代码 / 研究 / 产品 / 其它\n\n## 关键方向（子节点，5–10 个以内）\n- [[方向一]] — 负责 Agent：\n`;
    if (node?.noteType === 'overview') return `# ${t}\n\n## 现状\n\n## 关键方向与负责 Agent\n| 方向 | 负责 Agent | 状态 |\n| --- | --- | --- |\n|  |  |  |\n\n## 下一步\n- \n`;
    return `# ${t}\n\n## 探索现状\n（这个关键方向目前了解到什么、做到哪一步）\n\n## 后续探索方向\n- \n\n## 负责 Agent\n`;
  };

  const saveFolder = () => {
    if (!node) return;
    const v = folderInput.trim().replace(/^\/+|\/+$/g, '');
    if (v !== (node.folder || '')) onUpdateNodeData(node.id, { folder: v || undefined });
  };

  if (!node) return null;

  const saveNote = () => {
    // 用户手动保存后，标记 autoNote=false：AI 的「总览自动刷新」不再覆盖你的编辑
    onUpdateNodeData(node.id, { fullNote: noteDraft, noteUpdatedAt: Date.now(), autoNote: false });
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

  // 各功能模块的内容（在右上角图标触发的弹出面板里渲染）
  const renderModuleBody = () => {
    switch (activeModule) {
      case 'links':
        return (
          <div>
            <div className="mb-3">
              <div className="text-[9px] text-slate-500 font-bold mb-1.5 flex items-center gap-1"><span className="text-purple-400">→</span> 链接到（{outgoingLinks.length}）</div>
              {outgoingLinks.length === 0 ? (
                <div className="text-[10px] text-slate-600 italic">暂无出链 · 在正文用 [[标题]] 建立连接</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {outgoingLinks.map((l, i) => (
                    <button key={i} onClick={() => { if (l.node) onNavigate && onNavigate(l.node.id); else onWikiLink && onWikiLink(l.title, false, node); setActiveModule(null); }}
                      className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${l.unresolved ? 'border-slate-600 text-slate-500 hover:text-purple-300 hover:border-purple-500/50 italic' : 'bg-purple-900/30 border-purple-500/30 text-purple-300 hover:bg-purple-800/40'}`}
                      title={l.unresolved ? '点击创建并关联' : '打开'}>{l.unresolved && <span>＋</span>}[[{l.title}]]</button>
                  ))}
                </div>
              )}
            </div>
            <div className="pt-3 border-t border-slate-800">
              <div className="text-[9px] text-slate-500 font-bold mb-1.5 flex items-center gap-1"><span className="text-emerald-400">←</span> 反向链接（{backlinks.length}）</div>
              {backlinks.length === 0 ? (
                <div className="text-[10px] text-slate-600 italic">还没有其它笔记链接到这里</div>
              ) : (
                <div className="space-y-1.5">
                  {backlinks.map((b, i) => (
                    <button key={i} onClick={() => { onNavigate && onNavigate(b.node.id); setActiveModule(null); }} className="w-full text-left bg-slate-950/60 hover:bg-slate-800 border border-slate-700/60 hover:border-emerald-500/40 rounded-lg px-3 py-2 transition-colors group">
                      <div className="text-[10px] font-bold text-emerald-300 group-hover:text-emerald-200 truncate">{b.node.title}</div>
                      {b.snippet && <div className="text-[9px] text-slate-500 truncate mt-0.5">{b.snippet}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case 'task':
        return (
          <div>
            <div className="flex flex-col gap-3 relative">
              {node.taskType && node.taskType !== 'none' && <div className="text-[9px] text-blue-400 font-medium">已识别到需求类型：{node.taskType}</div>}
              <button disabled={isAgentRunning} onClick={() => handleAgentRun(getRecommendedAgent())} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 transition-all flex items-center justify-center gap-2 group"><span className="opacity-70 group-hover:scale-110 transition-transform">✨</span> AI 推荐：{getRecommendedAgent()}</button>
              <button onClick={() => setShowAgentMenu(!showAgentMenu)} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition-all">浏览更多 Agent 分类...</button>
              <button onClick={() => setShowDelegationModal(true)} className="w-full py-3 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"><span className="text-lg">🤝</span> 替你安排给人做</button>
              {showAgentMenu && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 max-h-[300px] overflow-y-auto scroll-hide">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700"><span className="text-[10px] font-bold text-slate-500 uppercase">Agent 市场</span><button onClick={() => setShowAgentMenu(false)} className="text-slate-500 hover:text-white">✕</button></div>
                  {AGENT_MARKETPLACE.map((cat, i) => (
                    <div key={i} className="mb-4 last:mb-0">
                      <h4 className="text-[10px] text-blue-400 font-bold mb-2">{cat.category}</h4>
                      <div className="grid grid-cols-2 gap-2">{cat.agents.map((agent, j) => (<button key={j} onClick={() => handleAgentRun(agent)} className="text-left px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-[10px] hover:bg-blue-600 hover:border-blue-500 transition-colors truncate">{agent}</button>))}</div>
                    </div>
                  ))}
                </div>
              )}
              {isAgentRunning && <div className="text-center text-[10px] text-blue-400 animate-pulse font-medium">Agent 正在全力思考中...</div>}
            </div>
            {node.agentResults && node.agentResults.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="text-[9px] text-slate-500 font-bold mb-2">执行结果及评分</div>
                <div className="space-y-4">{node.agentResults.map((r, i) => renderAgentOutput(r, i))}</div>
              </div>
            )}
          </div>
        );
      case 'results':
        return (
          <div className="space-y-4">
            <div>
              <label className="text-[9px] text-slate-500 font-bold mb-1.5 block">成果速记</label>
              <div className="flex gap-2">
                <input className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-blue-500" placeholder="手动记录成果..." value={manualInput} onChange={(e) => setManualInput(e.target.value)} />
                <button onClick={() => onUpdateNodeData(node.id, { manualResults: manualInput })} className="px-4 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-bold transition-colors">保存</button>
              </div>
            </div>
            <div>
              <label className="text-[9px] text-slate-500 font-bold mb-1.5 block">背景笔记（可实时编辑）</label>
              <textarea className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-[11px] text-slate-300 min-h-[120px] outline-none focus:ring-1 focus:ring-blue-500 transition-all" value={editingNotes} onChange={(e) => { setEditingNotes(e.target.value); onUpdateNotes(node.id, e.target.value); }} placeholder="尚未生成背景分析，可手动输入..." />
            </div>
          </div>
        );
      case 'chat':
        return (
          <div className="flex flex-col">
            <div className="overflow-y-auto bg-slate-900/50 rounded-lg p-3 space-y-4 mb-3 scroll-hide border border-slate-700/50 max-h-[360px] min-h-[120px]">
              {(node.chatHistory && node.chatHistory.length > 0) ? node.chatHistory.map((chat, idx) => (
                <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[12px] shadow-sm whitespace-pre-wrap ${chat.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 border border-slate-700 rounded-tl-none'}`}>{chat.text}</div>
                </div>
              )) : <div className="text-[10px] text-slate-600 italic text-center py-6">就这篇笔记向 AI 提问</div>}
            </div>
            <form onSubmit={async (e) => { e.preventDefault(); if(!chatInput.trim() || isSending) return; setIsSending(true); const msg = chatInput; setChatInput(''); await onSendMessage(node.id, msg); setIsSending(false); }} className="flex gap-2">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="提问..." className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-4 py-3 text-xs text-white outline-none" />
              <button type="submit" disabled={isSending} className="px-5 py-3 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-bold transition-colors">发送</button>
            </form>
          </div>
        );
      case 'decision':
        return (
          <div className="space-y-3">
            {onRecordDecision && (
              <button onClick={() => { onRecordDecision(node.id); setActiveModule(null); }}
                className="w-full py-2.5 bg-amber-600/20 hover:bg-amber-600 border border-amber-500/40 text-amber-300 hover:text-white rounded-xl text-[11px] font-bold transition-colors">
                ⚖️ 记录一个决策（选了什么 / 放弃了什么 / 为什么）
              </button>
            )}
            {nodeDecisions.length === 0 ? (
              <div className="text-[10px] text-slate-600 italic text-center py-3">这个节点还没有决策记录。每条记录会保存当时的子树快照，之后可随时 fork 复刻。</div>
            ) : nodeDecisions.map(d => (
              <div key={d.id} className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[11px] font-bold text-slate-200">{d.question}</div>
                  {onForkDecision && (
                    <button onClick={() => onForkDecision(d.id)} className="flex-shrink-0 text-[9px] px-2 py-0.5 bg-purple-600/20 hover:bg-purple-600 border border-purple-500/40 text-purple-300 hover:text-white rounded-full font-bold transition-colors" title="用当时的快照复刻一条新分支">⑂ Fork</button>
                  )}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5 mb-1.5">{TRIGGER_LABEL[d.trigger]} · {new Date(d.createdAt).toLocaleString()} · 快照 {d.snapshot.length} 节点{(d.forks?.length || 0) > 0 ? ` · 已 fork ${d.forks!.length} 次` : ''}</div>
                {d.options.map((o, i) => (
                  <div key={i} className="text-[10px] leading-relaxed">
                    <span className={o.chosen ? 'text-emerald-400 font-bold' : 'text-red-400/80 line-through'}>{o.chosen ? '✓' : '✗'} {o.label}</span>
                    {o.reason && <span className="text-slate-500"> — {o.reason}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      case 'props':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 flex-shrink-0">🤖 负责 Agent</span>
              <input className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-600" placeholder="指派一个 Agent 负责这个方向（子任务）" value={agentInput} onChange={(e) => setAgentInput(e.target.value)} onBlur={saveAgent} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAgent(); } }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 flex-shrink-0">📁 文件夹</span>
              <input className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:ring-1 focus:ring-purple-500 placeholder:text-slate-600" placeholder="如 研究方向/材料（用 / 分层）" value={folderInput} onChange={(e) => setFolderInput(e.target.value)} onBlur={saveFolder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveFolder(); } }} />
              <button onClick={() => downloadNoteMd(node)} className="flex-shrink-0 text-[10px] px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors" title="导出为 .md 文件">⬇ .md</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(node.tags || []).map(t => (
                <span key={t} className="group inline-flex items-center gap-1 bg-purple-900/30 border border-purple-500/30 text-purple-300 text-[9px] px-2 py-0.5 rounded-full">#{t}<button onClick={() => removeTag(t)} className="opacity-0 group-hover:opacity-100 text-purple-400 hover:text-red-400 transition-opacity">×</button></span>
              ))}
              <input className="bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none text-[9px] text-slate-300 w-24 placeholder:text-slate-600" placeholder="+ 添加标签" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} />
            </div>
            {onAddChildNode && (showNewDirection ? (
              <div className="flex gap-2">
                <input autoFocus className="flex-1 bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-emerald-500" placeholder="新方向的问题是什么？" value={newDirectionTitle} onChange={(e) => setNewDirectionTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createNewDirection(); if (e.key === 'Escape') setShowNewDirection(false); }} />
                <button onClick={createNewDirection} className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition-colors">创建</button>
              </div>
            ) : (
              <button onClick={() => setShowNewDirection(true)} className="w-full py-2 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-bold transition-colors">🌱 从此节点开一个新方向</button>
            ))}
          </div>
        );
      default: return null;
    }
  };

  const moduleTitle: Record<string, string> = { links: '🔗 关联笔记', task: '🤖 任务执行建议', results: '📊 记录成果', chat: '💬 咨询对话', props: 'ℹ️ 属性 · 负责Agent / 文件夹 / 标签 / 导出', decision: '⚖️ 决策记录 · 可 fork 复刻' };

  const statusInfo: Record<string, { label: string; cls: string }> = {
    unexplored: { label: '待探索', cls: 'text-slate-400 bg-slate-700/40 border-slate-600' },
    exploring: { label: '探索中', cls: 'text-amber-400 bg-amber-900/30 border-amber-500/40' },
    solved: { label: '已完成', cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-500/40' },
    invalid: { label: '已失效', cls: 'text-red-400 bg-red-900/30 border-red-500/40' },
    needs_review: { label: '待决策', cls: 'text-red-400 bg-red-900/30 border-red-500/40' },
  };
  const st = statusInfo[node.status] || statusInfo.unexplored;
  const typeLabel = node.noteType === 'readme' ? 'README' : node.noteType === 'overview' ? '项目总览' : '关键方向';
  // 笔记正文：优先用户写的 fullNote；没有就回退到探索/背景笔记 notes，避免主页面空白
  const noteBody = node.fullNote || node.notes || '';
  // 核验/溯源：有 AI 探索内容的方向节点，未核验前明确标注「AI 自动生成·未核验」
  const canVerify = node.noteType === 'direction' || !node.noteType;
  const isExplored = !!((node.notes && node.notes.trim()) || (node.agentResults && node.agentResults.length) || node.status === NodeStatus.SOLVED);

  return (
    <div className={isCenter
      ? 'h-full w-full bg-slate-800 flex flex-col relative'
      : `h-full bg-slate-800 border-l border-slate-700 flex flex-col shadow-2xl transition-all duration-300 relative ${isWide ? 'w-screen md:w-[600px]' : 'w-screen md:w-96'} ${isFocused ? 'ring-2 ring-blue-500/50' : ''}`}>
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <input
            className={`bg-transparent border-none outline-none font-bold text-blue-100 truncate w-full focus:ring-1 focus:ring-blue-500/50 rounded px-1 ${isCenter ? 'text-xl sm:text-2xl' : 'text-base sm:text-lg'}`}
            value={editingTitle}
            onChange={(e) => { setEditingTitle(e.target.value); onUpdateNodeData(node.id, { title: e.target.value }); }}
            placeholder="节点标题"
          />
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          {/* 笔记属性 / 功能模块图标栏（类似 Obsidian 的属性/工具） */}
          <div className="flex items-center gap-0.5 mr-1">
            {[
              { key: 'links' as const, icon: '🔗', label: '关联笔记', badge: outgoingLinks.length + backlinks.length },
              { key: 'task' as const, icon: '🤖', label: '任务执行建议', badge: (node.agentResults || []).length },
              { key: 'results' as const, icon: '📊', label: '记录成果', badge: node.manualResults ? 1 : 0 },
              { key: 'chat' as const, icon: '💬', label: '咨询对话', badge: (node.chatHistory || []).length },
              { key: 'decision' as const, icon: '⚖️', label: '决策记录（可 fork 复刻）', badge: nodeDecisions.length },
              { key: 'props' as const, icon: 'ℹ️', label: '属性 · 文件夹 / 标签 / 导出', badge: 0 },
            ].map(m => (
              <button key={m.key} onClick={() => setActiveModule(a => a === m.key ? null : m.key)} title={m.label}
                className={`relative p-2 rounded-lg transition-colors flex items-center justify-center ${activeModule === m.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/60'}`}>
                <span className="text-[14px] leading-none">{m.icon}</span>
                {m.badge > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 bg-purple-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold">{m.badge}</span>}
              </button>
            ))}
          </div>
          <button
            onClick={onToggleWide}
            className={`${isCenter ? 'hidden' : 'hidden md:flex'} p-2 text-slate-400 hover:text-white rounded-lg transition-colors items-center justify-center bg-slate-700/40`}
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

      {/* 笔记属性 / 功能模块弹出面板 */}
      {activeModule && (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setActiveModule(null)} />
          <div className="absolute right-3 top-[68px] z-40 w-[400px] max-w-[calc(100%-24px)] max-h-[72vh] overflow-y-auto scroll-hide bg-slate-800 border border-slate-700 rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
              <span className="text-[11px] font-bold text-slate-200">{moduleTitle[activeModule]}</span>
              <button onClick={() => setActiveModule(null)} className="text-slate-500 hover:text-white text-sm">✕</button>
            </div>
            <div className="p-4">{renderModuleBody()}</div>
          </div>
        </>
      )}

      <div className={`flex-1 overflow-y-auto space-y-6 scroll-hide pb-20 relative ${isCenter ? 'max-w-4xl w-full mx-auto px-5 md:px-8 pt-5' : 'p-4'}`}>
        {/* ===== 节点信息总览：把这个节点相关的关键信息都摆在主页面上 ===== */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {(node.noteType === 'direction' || !node.noteType) && <span className={`px-2 py-0.5 rounded-full border font-bold ${st.cls}`}>{st.label}</span>}
          <span className={`px-2 py-0.5 rounded-full border ${node.noteType === 'readme' ? 'text-purple-400 border-purple-500/30' : node.noteType === 'overview' ? 'text-blue-400 border-blue-500/30' : 'border-slate-700 text-slate-500'}`}>{typeLabel}</span>
          {(node.assignedAgent || node.noteType === 'direction' || !node.noteType) && <button onClick={() => setActiveModule('props')} className={`px-2 py-0.5 rounded-full border transition-colors ${node.assignedAgent ? 'text-blue-400 bg-blue-900/30 border-blue-500/30' : 'text-slate-500 border-slate-700 hover:border-blue-500/40'}`} title="负责 Agent">🤖 {node.assignedAgent || '未指派'}</button>}
          <button onClick={() => setActiveModule('links')} className="px-2 py-0.5 rounded-full border border-slate-700 text-slate-400 hover:border-purple-500/40 transition-colors" title="关联笔记">🔗 出{outgoingLinks.length} 入{backlinks.length}</button>
          {(node.agentResults || []).length > 0 && <button onClick={() => setActiveModule('task')} className="px-2 py-0.5 rounded-full border border-slate-700 text-emerald-400 hover:border-emerald-500/40 transition-colors" title="任务成果">📊 成果{node.agentResults!.length}</button>}
          {(node.chatHistory || []).length > 0 && <button onClick={() => setActiveModule('chat')} className="px-2 py-0.5 rounded-full border border-slate-700 text-sky-400 hover:border-sky-500/40 transition-colors" title="咨询对话">💬 {node.chatHistory!.length}</button>}
          {node.forkOfDecisionId && <button onClick={() => setActiveModule('decision')} className="px-2 py-0.5 rounded-full border border-purple-500/40 text-purple-300 bg-purple-900/20" title="这是从一条决策记录 fork 出来的分支">⑂ fork 分支</button>}
          {nodeDecisions.length > 0 && <button onClick={() => setActiveModule('decision')} className="px-2 py-0.5 rounded-full border border-slate-700 text-amber-400 hover:border-amber-500/40 transition-colors" title="决策记录">⚖️ {nodeDecisions.length}</button>}
          {node.folder && <span className="px-2 py-0.5 text-slate-500">📁 {node.folder}</span>}
          {(node.tags || []).map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-purple-900/30 border border-purple-500/30 text-purple-300">#{t}</span>)}
          {node.noteUpdatedAt && <span className="px-2 py-0.5 text-slate-600 ml-auto">更新于 {new Date(node.noteUpdatedAt).toLocaleString()}</span>}
        </div>

        {/* ===== 项目概览仪表盘（仅总览笔记，实时汇总） ===== */}
        {overviewData && (
          <section className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">📊 项目概览（自动汇总）</div>

            {/* 探索进度 */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                <span>探索进度</span>
                <span>{overviewData.solved}/{overviewData.total} 完成 · {overviewData.unexplored} 待探索{overviewData.problems.length ? ` · ${overviewData.problems.length} 待复核` : ''}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${overviewData.total ? Math.round((overviewData.solved / overviewData.total) * 100) : 0}%` }} />
              </div>
            </div>

            {/* 主要探索方向 */}
            <div className="pt-2 border-t border-slate-800">
              <div className="text-[9px] text-slate-500 font-bold mb-1.5">主要探索方向（{overviewData.main.length}）</div>
              {overviewData.main.length === 0 ? (
                <div className="text-[10px] text-slate-600 italic">还没有方向。点项目的 🤝 让 AI 拆解，或 ＋ 手动加。</div>
              ) : (
                <div className="space-y-1">
                  {overviewData.main.map(n => {
                    const s = statusInfo[n.status] || statusInfo.unexplored;
                    return (
                      <button key={n.id} onClick={() => onNavigate && onNavigate(n.id)} className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 transition-colors">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${s.cls}`}>{s.label}</span>
                        <span className="text-[11px] text-slate-200 truncate">{n.title}</span>
                        {n.assignedAgent && <span className="text-[8px] text-blue-400 flex-shrink-0">🤖 {n.assignedAgent}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 遇到的主要问题 / 待复核 */}
            {overviewData.problems.length > 0 && (
              <div className="pt-2 border-t border-slate-800">
                <div className="text-[9px] text-red-400 font-bold mb-1.5">⚠ 待解决 / 待复核（{overviewData.problems.length}）</div>
                <div className="space-y-1">
                  {overviewData.problems.slice(0, 8).map(n => (
                    <button key={n.id} onClick={() => onNavigate && onNavigate(n.id)} className="w-full text-left text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 truncate transition-colors">· {n.title}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 相关笔记链接 */}
            <div className="pt-2 border-t border-slate-800">
              <div className="text-[9px] text-slate-500 font-bold mb-1.5">相关笔记（{overviewData.dirs.length}）</div>
              <div className="flex flex-wrap gap-1.5">
                {overviewData.dirs.map(n => (
                  <button key={n.id} onClick={() => onNavigate && onNavigate(n.id)} className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors truncate max-w-[140px]">{n.title}</button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ===== 节点笔记：描述这个关键节点的探索现状与后续方向 ===== */}
        <section className={isCenter ? '' : 'bg-slate-900/60 border border-slate-700 rounded-xl p-4'}>
          <div className="flex justify-between items-center mb-3">
            <label className="text-[10px] uppercase tracking-widest text-purple-400 font-bold">📝 探索笔记</label>
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
                <button onClick={() => { setNoteDraft(node.fullNote || node.notes || ''); setIsEditingNote(true); }} className="px-3 py-1 bg-slate-700 hover:bg-purple-600 text-slate-300 hover:text-white rounded text-[10px] font-bold transition-colors">✏️ 编辑</button>
              )}
            </div>
          </div>

          {isEditingNote ? (
            <textarea
              autoFocus
              className={`w-full bg-slate-950 border border-purple-500/40 rounded-lg p-3 text-slate-200 font-mono outline-none focus:ring-1 focus:ring-purple-500 leading-relaxed ${isCenter ? 'text-sm min-h-[320px]' : 'text-[11px] min-h-[180px]'}`}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote(); }}
              placeholder={'支持 Markdown：# 标题、**粗体**、- 列表、```代码```、[[关联节点]]…\n\n把这个节点当作一篇笔记：记录你的思考、补充资料、修正 AI 的结论,或者标记一个新方向。\n\n⌘/Ctrl + Enter 保存'}
            />
          ) : noteBody ? (
            <div onDoubleClick={() => { setNoteDraft(noteBody); setIsEditingNote(true); }} title="双击编辑">
              <MarkdownView
                source={noteBody}
                large={isCenter}
                linkResolver={linkResolver}
                onWikiLink={(target, exists) => onWikiLink && onWikiLink(target, exists, node)}
              />
              {!node.fullNote && node.notes && (
                <div className="text-[9px] text-slate-600 italic mt-2">（以上为探索/背景笔记，点「✏️ 编辑」可整理成正式笔记）</div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button onClick={() => { setNoteDraft(starterTemplate()); setIsEditingNote(true); }} className="w-full py-3 border border-dashed border-purple-500/40 hover:border-purple-500 rounded-lg text-[11px] text-purple-400 hover:text-purple-300 transition-colors font-bold">
                📝 用模板开始这篇笔记
              </button>
              <button onClick={() => setIsEditingNote(true)} className="w-full py-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
                或从空白开始
              </button>
            </div>
          )}

          {/* 摘要信息：负责 Agent + 文件夹 + 标签（只读速览，编辑在右上「属性」里） */}
          {(node.assignedAgent || node.folder || (node.tags && node.tags.length > 0)) && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-800">
              {node.assignedAgent && <span className="text-[9px] text-blue-400 bg-blue-900/30 border border-blue-500/30 rounded-full px-2 py-0.5">🤖 {node.assignedAgent}</span>}
              {node.folder && <span className="text-[9px] text-slate-500">📁 {node.folder}</span>}
              {(node.tags || []).map(t => (
                <span key={t} className="bg-purple-900/30 border border-purple-500/30 text-purple-300 text-[9px] px-2 py-0.5 rounded-full">#{t}</span>
              ))}
            </div>
          )}
        </section>

        {/* 功能模块（关联/任务/成果/对话/属性）已移至右上角图标栏，按需弹出，正常只看笔记本身 */}

        {showDelegationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><span className="text-lg">🤝</span> 安排外协执行</h3>
                <button onClick={() => setShowDelegationModal(false)} className="text-slate-500 hover:text-white">✕</button>
              </div>
              <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">请将下方链接复制给执行的人。该链接打开后将启动一个 <span className="text-blue-400 font-bold">需求对齐 AI</span>，它会代你向对方讲清楚任务背景、目标与要求，并实时替你监督工作情况同步给你。</p>
              <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-4 break-all font-mono text-[10px] text-slate-500">{delegationLink}</div>
              <button onClick={() => { navigator.clipboard.writeText(delegationLink); alert('协作链接已复制！快发给执行人员吧。'); setShowDelegationModal(false); }} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all">复制链接并关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeDetails;