import { t as ui } from '../services/language';
import React, { useMemo, useState } from 'react';
import type { Project, ProblemNode } from '../types';
import { PROJECT_PAGES, type ProjectPage } from '../services/projectWorktree';

// 项目只有一个总览入口；旧说明笔记保留 ID，统一导向总览。
const ProjectNotesTree: React.FC<{
  projects: Project[];
  currentProjectId: string | null;
  selectedNodeId: string | null;
  search: string;
  onSearch: (s: string) => void;
  onOpenNode: (projectId: string, nodeId: string) => void;
  onCreateProject: () => void;
  onCreateDirection: (projectId: string, title?: string) => void;
  onAddChild: (projectId: string, parentId: string) => void;
  onBuildTeam: (projectId: string) => void;
  onOpenPage: (projectId: string, scopeId: string, page: ProjectPage) => void;
  selectedPage?: { scopeId: string; page: ProjectPage };
  onCleanup: (projectId: string) => void;
  onImport?: () => void;
  onExportVault?: () => void;
  onSaveToFolder?: () => void;
}> = ({ projects, currentProjectId, selectedNodeId, search, onSearch, onOpenNode, onCreateProject, onCreateDirection, onAddChild, onBuildTeam, onCleanup, onImport, onExportVault, onSaveToFolder, onOpenPage, selectedPage }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set()); // 节点子项默认收起，只有手动展开的才显示子节点
  const toggleNode = (id: string) => setExpandedNodes(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const q = search.trim().toLowerCase();

  // 节点排序：README → 总览 → 子节点（按方向/链接热度）
  const typeRank = (n: ProblemNode) => n.noteType === 'readme' ? 0 : n.noteType === 'overview' ? 1 : 2;
  const sortNotes = (list: ProblemNode[]) => [...list].sort((a, b) =>
    typeRank(a) - typeRank(b) || (b.noteUpdatedAt || 0) - (a.noteUpdatedAt || 0));

  const allNodes = useMemo(() => projects.flatMap(p => (p.nodes || []).map(n => ({ n, p }))), [projects]);
  const searchResults = useMemo(() => {
    if (!q) return [] as { n: ProblemNode; p: Project }[];
    return allNodes.filter(({ n, p }) =>
      n.title.toLowerCase().includes(q) ||
      (n.fullNote || '').toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q)));
  }, [allNodes, q]);

  const toggleProject = (id: string) => setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const noteIcon = (n: ProblemNode) => n.noteType === 'readme' ? '📘' : n.noteType === 'overview' ? '🏠' : '📄';

  const PageRows = (projectId: string, scopeId: string, depth: number) => (
    <div style={{ paddingLeft: 28 + depth * 16 }} className="space-y-0.5 my-1">
      {(Object.keys(PROJECT_PAGES) as ProjectPage[]).filter(page => scopeId === 'root' || page !== 'worktree').map(page => (
        <button key={page} onClick={() => onOpenPage(projectId, scopeId, page)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${currentProjectId === projectId && !selectedNodeId && selectedPage?.scopeId === scopeId && selectedPage.page === page ? 'bg-violet-600/20 text-violet-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
          <span>{PROJECT_PAGES[page].icon}</span>{page === 'research' && scopeId !== 'root' ? ui("想法总览") : ui(PROJECT_PAGES[page].label)}
        </button>
      ))}
      {scopeId !== 'root' && <button onClick={() => onOpenNode(projectId, scopeId)} className="w-full text-left rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800">{ui("📄 正文笔记")}</button>}
    </div>
  );

  // 一行笔记。childCount>0 时显示折叠箭头（默认收起）。canAddChild: 二级节点可加三级详情。
  const NoteRow = (projectId: string, n: ProblemNode, depth: number, opts?: { showProject?: string; canAddChild?: boolean; childCount?: number; expanded?: boolean }) => (
    <div key={n.id} className="flex items-center group/row" style={{ paddingLeft: 16 + depth * 16 }}>
      {opts?.childCount ? (
        <button onClick={() => toggleNode(n.id)} className="px-1 py-1.5 text-slate-500 hover:text-slate-300 flex-shrink-0" title={opts.expanded ? ui("收起") : `展开 ${opts.childCount} 个子项`}>
          <span className={`text-[9px] inline-block transition-transform ${opts.expanded ? 'rotate-90' : ''}`}>▶</span>
        </button>
      ) : <span className="w-[16px] flex-shrink-0" />}
      <button
        onClick={() => (n.noteType === 'readme' || n.noteType === 'overview') ? onOpenPage(projectId, 'root', 'research') : (opts?.showProject || n.noteType === 'simulation') ? onOpenNode(projectId, n.id) : onOpenPage(projectId, n.id, 'research')}
        className={`flex-1 text-left pr-2 py-1.5 rounded-lg border transition-colors min-w-0 ${
          selectedNodeId === n.id ? 'bg-purple-600/15 border-purple-500/50' : 'bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px]">{noteIcon(n)}</span>
            <span className={`text-[11px] font-semibold truncate ${selectedNodeId === n.id ? 'text-purple-200' : 'text-slate-200'}`}>{n.title || ui("未命名")}</span>
            {!opts?.expanded && opts?.childCount ? <span className="flex-shrink-0 text-[9px] text-slate-600">{opts.childCount}</span> : null}
          </span>
          {n.assignedAgent && <span className="flex-shrink-0 text-[8px] text-blue-400 bg-blue-900/30 border border-blue-500/30 rounded-full px-1.5 py-0.5 truncate max-w-[72px]">🤖 {n.assignedAgent}</span>}
        </div>
        {opts?.showProject && <div className="text-[9px] text-slate-600 truncate mt-0.5 ml-5">📁 {opts.showProject}</div>}
      </button>
      {opts?.canAddChild && <button onClick={() => onAddChild(projectId, n.id)} className="opacity-0 group-hover/row:opacity-100 px-1.5 text-slate-500 hover:text-emerald-400 text-sm flex-shrink-0" title={ui("在这个节点下加一条三级详情")}>＋</button>}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-slate-800 space-y-2">
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={ui("🔍 搜索 / 新建项目名…")}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-purple-500"
        />
        <button onClick={() => onCreateProject()} className="w-full py-2 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg text-[11px] font-bold transition-colors">{ui("＋ 新建项目")}{q ? `「${search.trim()}」` : ''}
        </button>
        {(onImport || onExportVault || onSaveToFolder) && (
          <div className="flex gap-1">
            {onImport && <button onClick={onImport} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title={ui("导入 .md 文件")}>{ui("⬆ 导入")}</button>}
            {onExportVault && <button onClick={onExportVault} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title={ui("导出当前项目为 Markdown(.zip，项目即文件夹)")}>{ui("⬇ 导出")}</button>}
            {onSaveToFolder && <button onClick={onSaveToFolder} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title={ui("保存到本地文件夹(Vault)")}>{ui("💾 本地库")}</button>}
          </div>
        )}
        <div className="text-[9px] text-slate-600 flex justify-between">
          <span>{projects.length}{ui("个项目")}</span>
          <span>{ui("项目 › 节点 › 详情（3 级）")}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-hide p-2 space-y-0.5">
        {q ? (
          searchResults.length === 0
            ? <div className="text-center text-[11px] text-slate-600 py-8">{ui("没有匹配的笔记")}</div>
            : searchResults.map(({ n, p }) => NoteRow(p.id, n, 0, { showProject: p.name }))
        ) : projects.length === 0 ? (
          <div className="text-center text-[11px] text-slate-600 py-8">{ui("还没有项目，点上方新建")}</div>
        ) : (
          projects.map(p => {
            const isOpen = !collapsed.has(p.id);
            const pn = p.nodes || [];
            const byId = new Map(pn.map(n => [n.id, n]));
            const isDir = (n?: ProblemNode) => !!n && (n.noteType === 'direction' || !n.noteType);
            // 结构父级 = 依赖里那个「方向」节点（README/总览 不作为嵌套父级）
            const parentOf = (n: ProblemNode) => (n.dependencies || []).map(d => byId.get(d)).find(pp => isDir(pp));
            const level2 = sortNotes(pn.filter(n => isDir(n) && !parentOf(n)));
            const childrenOf = (id: string) => sortNotes(pn.filter(n => isDir(n) && parentOf(n)?.id === id));
            // 二级节点可按 folder 字段归到「工作板块」文件夹下（按成员分工）
            const fname = (n: ProblemNode) => (n.folder || '').trim();
            const grouped = new Map<string, ProblemNode[]>();
            const ungrouped: ProblemNode[] = [];
            for (const n of level2) { const f = fname(n); if (f) { if (!grouped.has(f)) grouped.set(f, []); grouped.get(f)!.push(n); } else ungrouped.push(n); }
            // 递归渲染节点（子项默认收起；seen 防止依赖成环时无限递归）
            const renderNode = (n: ProblemNode, depth: number, seen: Set<string>): React.ReactNode => {
              if (seen.has(n.id)) return null;
              const nextSeen = new Set(seen); nextSeen.add(n.id);
              const kids = childrenOf(n.id).filter(c => !nextSeen.has(c.id));
              const expanded = expandedNodes.has(n.id);
              return (
                <div key={n.id}>
                  {NoteRow(p.id, n, depth, { canAddChild: !parentOf(n), childCount: kids.length + 4, expanded })}
                  {expanded && <>{PageRows(p.id, n.id, depth + 1)}{kids.map(c => renderNode(c, Math.min(depth + 1, 3), nextSeen))}</>}
                </div>
              );
            };
            return (
              <div key={p.id}>
                <div className={`flex items-center group rounded-lg ${p.id === currentProjectId ? 'bg-slate-800/40' : ''}`}>
                  <button onClick={() => toggleProject(p.id)} className="px-1 py-2 text-slate-500 text-[9px]" title={isOpen ? ui("收起项目") : ui("展开项目")}>{isOpen ? "▼" : "▶"}</button>
                  <button onClick={() => onOpenPage(p.id, 'root', 'research')} className="flex-1 flex items-center gap-1.5 py-2 px-1 text-left min-w-0">
                    <span className="text-[12px]">{isOpen ? '📂' : '📁'}</span>
                    <span className={`text-[11px] font-bold truncate ${p.id === currentProjectId ? 'text-purple-300' : 'text-slate-200'}`}>{p.name}</span>
                    <span className="text-[9px] text-slate-600">{level2.length}</span>
                  </button>
                  <button onClick={() => onCleanup(p.id)} className="opacity-0 group-hover:opacity-100 px-1 text-slate-500 hover:text-amber-400 text-[11px]" title={`清理「${p.name}」里待探索且无内容的子问题`}>🧹</button>
                  <button onClick={() => onBuildTeam(p.id)} className="opacity-0 group-hover:opacity-100 px-1 text-slate-500 hover:text-blue-400 text-[11px]" title={`AI 拆解方向：读懂「${p.name}」目标→拆解 5–8 个关键节点。假设验证团队位于项目内「AI 团队」`}>🤝</button>
                  <button onClick={() => onCreateDirection(p.id)} className="opacity-0 group-hover:opacity-100 px-1.5 text-slate-500 hover:text-emerald-400 text-sm" title={`在「${p.name}」里新增一个关键节点（二级）`}>＋</button>
                </div>
                {isOpen && (
                  <div>
                    {PageRows(p.id, 'root', 0)}
                    {Array.from(grouped.entries()).map(([fn, fnodes]) => {
                      const fkey = `${p.id}::f::${fn}`;
                      const fopen = !collapsed.has(fkey);
                      const agent = fnodes.find(n => n.assignedAgent)?.assignedAgent;
                      return (
                        <div key={fkey}>
                          <button onClick={() => toggleProject(fkey)} style={{ paddingLeft: 14 }} className="w-full flex items-center gap-1.5 py-1.5 text-left min-w-0 hover:bg-slate-800/40 rounded-lg">
                            <span className={`text-slate-500 text-[9px] transition-transform ${fopen ? 'rotate-90' : ''}`}>▶</span>
                            <span className="text-[11px]">{fopen ? '📂' : '📁'}</span>
                            <span className="text-[11px] font-bold text-slate-300 truncate">{fn}</span>
                            {agent && <span className="flex-shrink-0 text-[8px] text-blue-400 bg-blue-900/30 border border-blue-500/30 rounded-full px-1.5 py-0.5 truncate max-w-[84px]">🤖 {agent}</span>}
                            <span className="text-[9px] text-slate-600">{fnodes.length}</span>
                          </button>
                          {fopen && sortNotes(fnodes).map(n => renderNode(n, 1, new Set<string>()))}
                        </div>
                      );
                    })}
                    {ungrouped.map(n => renderNode(n, 0, new Set<string>()))}
                    {pn.length === 0 && <div className="text-[9px] text-slate-600 italic pl-7 py-1">{ui("空项目")}</div>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ProjectNotesTree;
