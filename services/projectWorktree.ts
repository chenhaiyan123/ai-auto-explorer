import { migrateProjectOverview } from './projectOverview';
import type { Project } from '../types';
import { NodeStatus } from '../types';
import { recoverInquiry } from './inquiry';

export type ProjectSnapshot = Omit<Project, 'worktree'>;
export interface ExplorationStage {
  id: string;
  parentId?: string;
  branchId: string;
  label: string;
  reason: string;
  createdAt: number;
  decisionId?: string;
  snapshot: ProjectSnapshot;
}
export interface ExplorationBranch { id: string; name: string; headId: string }
export interface ProjectWorktree {
  stages: ExplorationStage[];
  branches: ExplorationBranch[];
  activeBranchId: string;
  currentStageId: string;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomUUID();

export function captureProject(project: Project): ProjectSnapshot {
  const { worktree, ...snapshot } = project;
  return clone(snapshot);
}

export function ensureWorktree(project: Project): Project {
  if (project.worktree?.stages.length) return project;
  const branchId = uid(); const stageId = uid();
  return { ...project, worktree: {
    branches: [{ id: branchId, name: '主线', headId: stageId }], activeBranchId: branchId, currentStageId: stageId,
    stages: [{ id: stageId, branchId, label: '初始阶段', reason: '首次保存的项目全貌', createdAt: Date.now(), snapshot: captureProject(project) }],
  } };
}

/** Full state checkpoints never embed the history itself. */
export function saveStage(project: Project, label: string, reason = '', decisionId?: string): Project {
  if (!label.trim()) throw new Error('请为探索阶段填写名称');
  const p = ensureWorktree(project); const tree = p.worktree!;
  const stage: ExplorationStage = { id: uid(), branchId: tree.activeBranchId, parentId: tree.currentStageId,
    label: label.trim().slice(0, 100), reason: reason.trim().slice(0, 2000), createdAt: Date.now(), decisionId, snapshot: captureProject(p) };
  return { ...p, worktree: { ...tree, currentStageId: stage.id, stages: [...tree.stages, stage],
    branches: tree.branches.map(b => b.id === tree.activeBranchId ? { ...b, headId: stage.id } : b) } };
}

export function hasUnsavedStage(project: Project): boolean {
  const stage = project.worktree?.stages.find(s => s.id === project.worktree?.currentStageId);
  return !stage || JSON.stringify(captureProject(project)) !== JSON.stringify(stage.snapshot);
}

function preserveCurrent(project: Project): Project {
  const p = ensureWorktree(project);
  return hasUnsavedStage(p) ? saveStage(p, '离开前自动保存', '切换探索阶段前保留当前全部进展') : p;
}

function activate(snapshot: ProjectSnapshot, project: Project): Project {
  const saved = clone(snapshot);
  // Restoring history cannot restart API calls or resurrect a stale "running" flag.
  saved.nodes = saved.nodes.map(n => n.status === NodeStatus.EXPLORING ? { ...n, status: NodeStatus.UNEXPLORED } : n);
  if (saved.inquiries) saved.inquiries = Object.fromEntries(Object.entries(saved.inquiries).map(([id, w]) => [id, recoverInquiry(w)]));
  return migrateProjectOverview({ ...saved, id: project.id, createdAt: project.createdAt, worktree: project.worktree });
}

/** Returning creates a branch; the previous branch and unsaved work are always retained. */
export function branchFromStage(project: Project, stageId: string, name: string): Project {
  const source = project.worktree?.stages.find(s => s.id === stageId);
  if (!source) throw new Error('找不到此项目的探索阶段');
  if (!name.trim()) throw new Error('请填写分支名称');
  const p = preserveCurrent(project); const tree = p.worktree!;
  const branchId = uid();
  const restored = activate(source.snapshot, p);
  const stage: ExplorationStage = { id: uid(), branchId, parentId: source.id, label: `返回：${source.label}`,
    reason: `从「${source.label}」恢复完整项目状态`, createdAt: Date.now(), snapshot: captureProject(restored) };
  return { ...restored, worktree: { ...tree, activeBranchId: branchId, currentStageId: stage.id,
    stages: [...tree.stages, stage], branches: [...tree.branches, { id: branchId, name: name.trim().slice(0, 80), headId: stage.id }] } };
}

export function switchExplorationBranch(project: Project, branchId: string): Project {
  const tree = project.worktree;
  if (!tree) throw new Error('项目还没有探索分支');
  if (tree.activeBranchId === branchId) return project;
  const branch = tree.branches.find(b => b.id === branchId);
  const stage = tree.stages.find(s => s.id === branch?.headId);
  if (!branch || !stage) throw new Error('探索分支不存在');
  const p = preserveCurrent(project);
  return { ...activate(stage.snapshot, p), worktree: { ...p.worktree!, activeBranchId: branchId, currentStageId: stage.id } };
}

/** A scope includes the idea and all descendant notes, with cycle protection. */
export function scopeNodes(project: Project, scopeId: string) {
  if (scopeId === 'root') return project.nodes;
  const ids = new Set([scopeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of project.nodes) if (!ids.has(n.id) && n.dependencies.some(d => ids.has(d))) { ids.add(n.id); changed = true; }
  }
  return project.nodes.filter(n => ids.has(n.id));
}

export type ProjectPage = 'research' | 'team' | 'facts' | 'worktree';
export const PROJECT_PAGES: Record<ProjectPage, { label: string; icon: string }> = {
  research: { label: '项目总览', icon: '◈' }, team: { label: 'AI 团队', icon: '🤖' },
  facts: { label: '事实看板', icon: '▦' }, worktree: { label: '决策与探索分支', icon: '⑂' },
};
