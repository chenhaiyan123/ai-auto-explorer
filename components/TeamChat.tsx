import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Project, ProblemNode, ChatMessage, NodeStatus } from '../types';
import { callGemini } from '../services/geminiService';
import { resolveNodeByTitle } from '../services/noteLinks';
import MarkdownView from './MarkdownView';

/**
 * 团队群聊：右侧面板。
 * - 多 Agent 真群聊：项目里被指派的 Agent（+ 总协调）都是群成员，可 @某成员让 ta 单独发言，或「让团队讨论」让大家各抒己见。
 * - @笔记：用 [[标题]] 引用任意笔记，其正文会带进上下文（点「@笔记」按钮插入）。
 * - 一键补充到笔记：任何一条 AI 发言都能追加进某篇笔记。
 */

interface ChatMsg { role: 'user' | 'model'; text: string; agent?: string }

const serialize = (m: ChatMsg): ChatMessage => ({ role: m.role, text: m.role === 'model' && m.agent ? `【${m.agent}】${m.text}` : m.text } as ChatMessage);
const parse = (cm: ChatMessage): ChatMsg => {
  if (cm.role === 'model') { const mt = cm.text.match(/^【(.+?)】([\s\S]*)$/); if (mt) return { role: 'model', agent: mt[1], text: mt[2] }; }
  return { role: cm.role as 'user' | 'model', text: cm.text };
};

const avatarFor = (name: string) => {
  const t = name.toLowerCase();
  if (/负责人|协调|lead|经理/.test(t)) return '🧭';
  if (/工程|开发|全栈|程序|算法/.test(t)) return '💻';
  if (/设计|ui|ux/.test(t)) return '🎨';
  if (/数据|分析|统计/.test(t)) return '📊';
  if (/研究|文献|学术/.test(t)) return '🔬';
  if (/市场|增长|运营|营销/.test(t)) return '📣';
  if (/商业|财务|定价/.test(t)) return '💼';
  if (/法务|合规/.test(t)) return '⚖️';
  if (/实验|测试|硬件/.test(t)) return '🧪';
  if (/内容|文案|写作/.test(t)) return '✍️';
  return '🤖';
};

const TeamChat: React.FC<{
  project: Project | null;
  nodes: ProblemNode[];
  selectedNode: ProblemNode | null;
  onAppendToNote: (nodeId: string, text: string) => void;
  onOpenNode: (nodeId: string) => void;
  chatHistory?: ChatMessage[];
  onUpdateChatHistory?: (messages: ChatMessage[]) => void;
}> = ({ project, nodes, selectedNode, onAppendToNote, onOpenNode, chatHistory, onUpdateChatHistory }) => {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => (chatHistory || []).map(parse));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<null | { mode: 'mention' | 'append'; forMsg?: number }>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 群成员：总协调（项目总览的负责人）+ 各节点被指派的 Agent（去重）
  const lead = useMemo(() => nodes.find(n => n.noteType === 'overview')?.assignedAgent || '项目负责人', [nodes]);
  const members = useMemo(() => {
    const set = new Set<string>([lead]);
    nodes.forEach(n => { if (n.assignedAgent) set.add(n.assignedAgent); });
    return Array.from(set);
  }, [nodes, lead]);

  const mountedRef = useRef(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  // 只在用户真正产生新消息后才回写，避免挂载时用初始值覆盖项目已存的记录
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (onUpdateChatHistory) onUpdateChatHistory(msgs.map(serialize));
  }, [msgs]);

  // 取引用到的笔记（[[标题]]）正文作为上下文
  const refNotesContext = (text: string): string => {
    const titles = Array.from(text.matchAll(/\[\[([^\]\n]+?)\]\]/g)).map(m => m[1].split('|')[0].trim());
    const parts: string[] = [];
    for (const t of titles) {
      const n = resolveNodeByTitle(nodes, t);
      if (n) parts.push(`【笔记：${n.title}】\n${(n.fullNote || n.notes || '').slice(0, 800)}`);
    }
    if (selectedNode && !titles.some(t => t === selectedNode.title)) {
      parts.push(`【当前笔记：${selectedNode.title}】\n${(selectedNode.fullNote || selectedNode.notes || '').slice(0, 600)}`);
    }
    return parts.join('\n\n');
  };

  const projectCtx = () => project ? `项目：${project.name}\n目标：${project.metaProblem || project.name}` : '';

  // 让某个成员发言
  const speak = async (agent: string, userText: string, history: ChatMsg[]): Promise<string> => {
    const sys = `你是 AI 项目团队里的「${agent}」。请以该角色的专业视角，简明但有干货地回应（200-400字，可用要点）。如果信息不足，提出你需要的输入。\n${projectCtx()}`;
    const ctx = refNotesContext(userText);
    const recent = history.slice(-4).map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: (h.agent ? `${h.agent}：` : '') + h.text }));
    return await callGemini([
      { role: 'system', content: sys + (ctx ? `\n\n相关笔记内容：\n${ctx}` : '') },
      ...recent,
      { role: 'user', content: userText }
    ]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const userMsg: ChatMsg = { role: 'user', text };
    const base = [...msgs, userMsg];
    setMsgs(base);
    setBusy(true);
    try {
      // @某成员 → 仅 ta 回应；否则总协调回应
      const mentioned = members.find(m => text.includes('@' + m));
      const responder = mentioned || lead;
      const reply = await speak(responder, text, base);
      setMsgs(prev => [...prev, { role: 'model', agent: responder, text: reply }]);
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'model', agent: lead, text: '（出错了：' + (e?.message || e) + '）请检查右上角模型设置。' }]);
    } finally { setBusy(false); }
  };

  // 让团队讨论：每位成员（最多 4 位）就当前话题各给一段简短看法
  const teamDiscuss = async () => {
    if (busy) return;
    const topic = selectedNode ? `围绕「${selectedNode.title}」这个方向` : `围绕项目「${project?.name || ''}」`;
    const userMsg: ChatMsg = { role: 'user', text: `🗣️ 让团队讨论：${topic}，各位说说你负责部分的看法与下一步。` };
    let cur = [...msgs, userMsg];
    setMsgs(cur);
    setBusy(true);
    try {
      for (const m of members.slice(0, 4)) {
        const reply = await speak(m, `请就${topic}，给出你（${m}）负责部分的看法、关键风险与下一步建议。`, cur);
        const newMsg: ChatMsg = { role: 'model', agent: m, text: reply };
        cur = [...cur, newMsg];
        setMsgs(cur);
      }
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'model', agent: lead, text: '（讨论中断：' + (e?.message || e) + '）' }]);
    } finally { setBusy(false); }
  };

  const insertMention = (name: string) => setInput(v => (v ? v + ' ' : '') + '@' + name + ' ');
  const noteList = useMemo(() => nodes.filter(n => (n.title || '').trim()).slice(0, 200), [nodes]);

  const onPick = (n: ProblemNode) => {
    if (!picker) return;
    if (picker.mode === 'mention') setInput(v => (v ? v + ' ' : '') + `[[${n.title}]] `);
    else if (picker.mode === 'append' && picker.forMsg !== undefined) {
      const m = msgs[picker.forMsg];
      if (m) onAppendToNote(n.id, `\n\n> 来自团队群聊 · ${m.agent || 'AI'}\n${m.text}\n`);
    }
    setPicker(null);
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* 成员条 */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto scroll-hide">
        <span className="text-[9px] text-slate-500 flex-shrink-0">团队</span>
        {members.map(m => (
          <button key={m} onClick={() => insertMention(m)} title={`@${m}`} className="flex-shrink-0 flex items-center gap-1 text-[9px] bg-slate-800 hover:bg-blue-600 hover:text-white border border-slate-700 rounded-full px-2 py-0.5 transition-colors">
            <span>{avatarFor(m)}</span><span className="truncate max-w-[64px]">{m}</span>
          </button>
        ))}
      </div>

      {/* 消息 */}
      <div className="flex-1 overflow-y-auto scroll-hide p-3 space-y-3">
        {msgs.length === 0 && (
          <div className="text-[11px] text-slate-500 leading-relaxed bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            这是项目的<b className="text-slate-300">团队群聊</b>。点上方成员可 @ ta 单独发言；用 <span className="text-purple-400">[[笔记名]]</span> 引用笔记（或下方「@笔记」按钮）；任何回复都能「➕ 补充到笔记」。先点「🗣️ 让团队讨论」试试。
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] ${m.role === 'user' ? '' : 'w-full'}`}>
              {m.role === 'model' && m.agent && (
                <div className="flex items-center gap-1 mb-1 text-[10px] text-blue-300 font-bold"><span>{avatarFor(m.agent)}</span> {m.agent}</div>
              )}
              <div className={`px-3 py-2 rounded-2xl text-[12px] shadow-sm ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none whitespace-pre-wrap' : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'}`}>
                {m.role === 'user' ? m.text : <MarkdownView source={m.text} onWikiLink={(t) => { const n = resolveNodeByTitle(nodes, t); if (n) onOpenNode(n.id); }} linkResolver={(t) => !!resolveNodeByTitle(nodes, t)} />}
              </div>
              {m.role === 'model' && (
                <button onClick={() => setPicker({ mode: 'append', forMsg: i })} className="mt-1 text-[9px] text-slate-500 hover:text-emerald-400 transition-colors">➕ 补充到笔记</button>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-[10px] text-blue-400 animate-pulse">团队成员正在思考…</div>}
        <div ref={endRef} />
      </div>

      {/* 输入 */}
      <div className="border-t border-slate-800 p-2.5 space-y-2">
        <div className="flex gap-1.5">
          <button onClick={() => setPicker({ mode: 'mention' })} className="text-[10px] px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors" title="引用一篇笔记 [[..]]">@笔记</button>
          <button onClick={teamDiscuss} disabled={busy} className="text-[10px] px-2 py-1 bg-violet-600/80 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50">🗣️ 让团队讨论</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="对团队说… @成员 / [[笔记]]" className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2.5 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit" disabled={busy} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-bold transition-colors disabled:opacity-50">发送</button>
        </form>
      </div>

      {/* 笔记选择器 */}
      {picker && (
        <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
            <span className="text-[11px] font-bold text-slate-200">{picker.mode === 'mention' ? '引用一篇笔记' : '把这条补充到哪篇笔记？'}</span>
            <button onClick={() => setPicker(null)} className="text-slate-500 hover:text-white text-sm">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-hide p-2 space-y-1">
            {noteList.length === 0 ? <div className="text-[11px] text-slate-600 text-center py-8">这个项目还没有笔记</div> :
              noteList.map(n => (
                <button key={n.id} onClick={() => onPick(n)} className="w-full text-left px-3 py-2 bg-slate-800/60 hover:bg-slate-700 border border-slate-700/60 rounded-lg text-[11px] text-slate-200 transition-colors truncate">
                  {n.noteType === 'readme' ? '📘' : n.noteType === 'overview' ? '🏠' : '📄'} {n.title}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamChat;
