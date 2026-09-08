import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeStatus, type Project } from '../types';
import { addFact, createInquiry, newRound, reviewFact } from '../services/inquiry';
import { branchFromStage, captureProject, ensureWorktree, hasUnsavedStage, saveStage, scopeNodes, switchExplorationBranch } from '../services/projectWorktree';
const node = (id: string, deps: string[] = []) => ({ id, title: id, status: NodeStatus.UNEXPLORED, dependencies: deps, notes: '', confidence: 0, chatHistory: [], agentResults: [] });
const fixture = (): Project => ({ id: 'p', name: '项目', metaProblem: '为什么', createdAt: 1, nodes: [node('a'), node('b', ['a']), node('c')], inquiries: { a: createInquiry('a', '想法 A') } });

test('旧项目幂等初始化，完整快照不递归嵌套探索树', () => {
  const original = fixture(); const p = ensureWorktree(original);
  assert.equal(p.worktree!.stages.length, 1);
  assert.equal(p.worktree!.branches.length, 1);
  assert.equal(ensureWorktree(p), p);
  assert.equal(original.worktree, undefined);
  assert.equal('worktree' in p.worktree!.stages[0].snapshot, false);
  assert.equal(hasUnsavedStage(p), false);
  assert.equal(hasUnsavedStage({ ...p, summaryNote: '新总结' }), true);
});

test('阶段快照保存团队、事实、决策和研究资料，之后编辑不会改变旧快照', () => {
  let p = ensureWorktree(fixture());
  let w = addFact(p.inquiries!.a, { claim: '样本为 10 人', source: '记录第 1 页', excerpt: '编号1到10', scope: '本次测试' });
  w = reviewFact(w, w.facts[0].id, 'confirmed', '逐个核对编号');
  p = saveStage({ ...p, inquiries: { a: w }, summaryNote: '阶段性认识', decisions: [{ id: 'd', nodeId: 'a', nodeTitle: 'A', question: '选哪条路线', options: [{ label: '继续', chosen: true }], trigger: 'manual', snapshot: [node('a')], createdAt: 2 }] }, '证据就绪', '已取得第一份外部资料', 'd');
  const stage = p.worktree!.stages.at(-1)!;
  assert.equal(stage.decisionId, 'd');
  assert.equal(stage.snapshot.inquiries!.a.facts[0].status, 'confirmed');
  p.inquiries!.a.facts[0].claim = '修改后的数据';
  p.nodes[0].notes = '新正文';
  assert.equal(stage.snapshot.inquiries!.a.facts[0].claim, '样本为 10 人');
  assert.equal(stage.snapshot.nodes[0].notes, '');
});

test('返回旧阶段自动保存当前进展并新建分支，切回主线找回后续成果', () => {
  let p = ensureWorktree(fixture());
  const main = p.worktree!.activeBranchId; const initial = p.worktree!.currentStageId;
  p = { ...p, nodes: [...p.nodes, node('later')], summaryNote: '最新结论' };
  p = branchFromStage(p, initial, '另一种假设');
  assert.equal(p.nodes.some(n => n.id === 'later'), false);
  assert.equal(p.summaryNote, undefined);
  assert.equal(p.worktree!.branches.length, 2);
  assert.notEqual(p.worktree!.activeBranchId, main);
  const newHead = p.worktree!.stages.find(s => s.id === p.worktree!.currentStageId)!;
  assert.equal(newHead.parentId, initial);
  assert.equal(p.worktree!.stages.filter(s => s.label === '离开前自动保存').length, 1);
  p = switchExplorationBranch(p, main);
  assert.equal(p.summaryNote, '最新结论');
  assert.equal(p.nodes.some(n => n.id === 'later'), true);
  assert.equal(p.worktree!.activeBranchId, main);
});

test('分支的事实和团队互不污染，切换会保存当前分支未存的事实', () => {
  let p = ensureWorktree(fixture());
  const main = p.worktree!.activeBranchId; const initial = p.worktree!.currentStageId;
  p = branchFromStage(p, initial, '支线');
  const fork = p.worktree!.activeBranchId;
  p = { ...p, inquiries: { a: addFact(p.inquiries!.a, { claim: '仅支线的事实', source: '', excerpt: '', scope: '' }) } };
  p = switchExplorationBranch(p, main);
  assert.equal(p.inquiries!.a.facts.length, 0);
  p = switchExplorationBranch(p, fork);
  assert.equal(p.inquiries!.a.facts[0].claim, '仅支线的事实');
});

test('切换到历史阶段不恢复运行中的 API 状态', () => {
  let p = fixture(); let w = newRound(p.inquiries!.a);
  w.rounds[0].status = 'running'; w.rounds[0].tasks[0].status = 'running';
  p.nodes[0].status = NodeStatus.EXPLORING;
  p = ensureWorktree({ ...p, inquiries: { a: w } });
  p = branchFromStage(p, p.worktree!.currentStageId, '恢复测试');
  assert.equal(p.nodes[0].status, NodeStatus.UNEXPLORED);
  assert.equal(p.inquiries!.a.rounds[0].status, 'paused');
  assert.equal(p.inquiries!.a.rounds[0].tasks[0].status, 'pending');
});

test('无效或跨项目阶段拒绝恢复；空标签拒绝保存', () => {
  const p = ensureWorktree(fixture());
  const other = ensureWorktree({ ...fixture(), id: 'other' });
  assert.throws(() => branchFromStage(p, other.worktree!.currentStageId, 'x'));
  assert.throws(() => branchFromStage(p, p.worktree!.currentStageId, ' '));
  assert.throws(() => switchExplorationBranch(p, 'missing'));
  assert.throws(() => saveStage(p, ' '));
});

test('想法仪表盘只统计该想法子树，跨级后代保留且依赖成环不会死循环', () => {
  const p = fixture(); p.nodes.push(node('d', ['b']), node('e', ['c']));
  assert.deepEqual(scopeNodes(p, 'a').map(n => n.id), ['a', 'b', 'd']);
  p.nodes[0].dependencies.push('d');
  assert.deepEqual(scopeNodes(p, 'a').map(n => n.id), ['a', 'b', 'd']);
  assert.equal(scopeNodes(p, 'root').length, 5);
});

test('快照 JSON 持久化往返后仍能恢复，长历史不嵌套历史本身', () => {
  let p = ensureWorktree(fixture());
  for (let i = 0; i < 15; i++) p = saveStage({ ...p, summaryNote: String(i) }, `阶段 ${i}`);
  const loaded: Project = JSON.parse(JSON.stringify(p));
  const restored = branchFromStage(loaded, loaded.worktree!.stages[4].id, '历史路线');
  assert.equal(restored.summaryNote, '3');
  assert.ok(restored.worktree!.stages.every(s => !('worktree' in s.snapshot)));
  assert.equal(captureProject(restored).id, 'p');
});
