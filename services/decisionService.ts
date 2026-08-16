/**
 * 决策节点持久化（重点功能）
 * - 记录每个决策的过程（选中/放弃的选项 + 可选的理由）
 * - 决策当时对节点子树做完整快照
 * - 随时可从任意决策点 fork（复刻）出新分支，新旧路线并存对比
 */
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, DecisionRecord, DecisionOption, DecisionTrigger } from '../types';

/** 捕获 rootId 节点及其全部后代（子树）的深拷贝快照。带防环保护。 */
export function captureSubtree(nodes: ProblemNode[], rootId: string): ProblemNode[] {
  const byParent = new Map<string, ProblemNode[]>();
  for (const n of nodes) {
    for (const dep of n.dependencies || []) {
      const arr = byParent.get(dep) || [];
      arr.push(n);
      byParent.set(dep, arr);
    }
  }
  const seen = new Set<string>();
  const out: ProblemNode[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    out.push(JSON.parse(JSON.stringify(node)));
    for (const child of byParent.get(id) || []) walk(child.id);
  };
  walk(rootId);
  return out;
}

/** 创建一条决策记录（快照在调用处捕获，保证删除/失效前的状态被留存） */
export function createDecision(params: {
  nodeId: string;
  nodeTitle: string;
  question: string;
  options: DecisionOption[];
  trigger: DecisionTrigger;
  snapshot: ProblemNode[];
}): DecisionRecord {
  return {
    id: uuidv4(),
    nodeId: params.nodeId,
    nodeTitle: params.nodeTitle,
    question: params.question.trim() || `关于「${params.nodeTitle}」的决策`,
    options: params.options
      .map(o => ({ ...o, label: o.label.trim(), reason: o.reason?.trim() || undefined }))
      .filter(o => o.label),
    trigger: params.trigger,
    snapshot: params.snapshot,
    createdAt: Date.now(),
    forks: [],
  };
}

/**
 * 从决策记录 fork：用快照在同一项目里复刻出一条新分支。
 * - 快照内所有节点换新 id，内部依赖重新映射
 * - 对外部（快照外）的依赖：仅保留当前项目里仍存在的节点，保证新分支挂回原位置
 * - 根节点标题加 ⑂ 标记并记录 forkOfDecisionId
 */
export function forkFromDecision(
  decision: DecisionRecord,
  existingNodeIds: Set<string>
): { nodes: ProblemNode[]; rootId: string } {
  const idMap = new Map<string, string>();
  for (const n of decision.snapshot) idMap.set(n.id, uuidv4());
  const now = Date.now();
  const nodes: ProblemNode[] = decision.snapshot.map(n => {
    const clone: ProblemNode = JSON.parse(JSON.stringify(n));
    clone.id = idMap.get(n.id)!;
    clone.dependencies = (n.dependencies || [])
      .map(d => (idMap.has(d) ? idMap.get(d)! : existingNodeIds.has(d) ? d : ''))
      .filter(Boolean);
    if (n.id === decision.nodeId) {
      clone.title = `${n.title} ⑂`;
      clone.forkOfDecisionId = decision.id;
    }
    clone.noteUpdatedAt = now;
    delete (clone as any).x;
    delete (clone as any).y;
    return clone;
  });
  return { nodes, rootId: idMap.get(decision.nodeId)! };
}

export const TRIGGER_LABEL: Record<DecisionTrigger, string> = {
  manual: '手动记录',
  delete_node: '删除节点前',
  invalidate: '设为无效前',
  explore: '探索方向',
  fork: '分支复刻',
  contradicted: '假设被现实推翻',
};
