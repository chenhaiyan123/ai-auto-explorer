import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { migrateProjectOverview, projectOverviewContext, overviewExportNodes } from '../services/projectOverview';
import { ensureWorktree, saveStage, branchFromStage } from '../services/projectWorktree';
import ProjectHome from '../components/ProjectHome';
import ProjectNotesTree from '../components/ProjectNotesTree';
import { NodeStatus, type Project } from '../types';
const noop = () => {};
const fixture = (): Project => ({ id: 'legacy', name: '旧项目', metaProblem: '核心问题', createdAt: 1, nodes: [
  { id: 'readme', title: 'README', noteType: 'readme', fullNote: '唯一的目标与限制', status: NodeStatus.SOLVED, confidence: 1, notes: '', dependencies: [], chatHistory: [], agentResults: [] },
  { id: 'overview', title: '总览', noteType: 'overview', fullNote: '独有研究结论', status: NodeStatus.SOLVED, confidence: 1, notes: '', dependencies: [], chatHistory: [], agentResults: [] },
  { id: 'idea', title: '方向一', notes: '', status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: ['overview'], chatHistory: [], agentResults: [] },
] });
test('合并保留两种笔记原文、ID 与依赖；迁移幂等且归档不随当前摘要变化', () => {
  const original = fixture();
  const p = migrateProjectOverview(original);
  assert.equal(p.overviewBrief, '唯一的目标与限制');
  assert.equal(p.nodes[2].dependencies[0], 'overview');
  assert.equal(migrateProjectOverview(p), p);
  assert.equal(original.overviewMigration, undefined);
  p.nodes = p.nodes.map(n => n.id === 'overview' ? { ...n, fullNote: '新摘要' } : n);
  assert.equal(p.overviewMigration!.originals[1].fullNote, '独有研究结论');
  assert.ok(projectOverviewContext(p).includes('新摘要'));
  assert.ok(!projectOverviewContext({ ...p, overviewBrief: '用户更新目标' }).includes('唯一的目标与限制'));
});
test('总览展示迁入内容，侧栏不再列出 README 与旧总览笔记入口', () => {
  const p = migrateProjectOverview(fixture());
  const home = renderToStaticMarkup(<ProjectHome project={p} scopeId="root" onPage={noop} onNote={noop} />);
  assert.ok(home.includes('唯一的目标与限制') && home.includes('独有研究结论'));
  assert.ok(home.includes('合并前的笔记原文'));
  const tree = renderToStaticMarkup(<ProjectNotesTree projects={[p]} currentProjectId={p.id} selectedNodeId={null} search="" onSearch={noop} onOpenNode={noop} onCreateProject={noop} onCreateDirection={noop} onAddChild={noop} onBuildTeam={noop} onOpenPage={noop} onCleanup={noop} />);
  assert.ok(!tree.includes('README'));
  assert.ok(!tree.includes('研究仪表盘'));
  assert.equal(tree.split('项目总览').length - 1, 1);
  assert.ok(tree.includes('方向一'));
});
test('编辑后的目标随探索阶段保存和恢复，原始归档不被覆盖', () => {
  let p = ensureWorktree(migrateProjectOverview(fixture()));
  p = saveStage({ ...p, overviewBrief: '阶段一的目标' }, '第一阶段');
  const stage = p.worktree!.currentStageId;
  p = { ...p, overviewBrief: '阶段二的目标' };
  const restored = branchFromStage(p, stage, '重探');
  assert.equal(restored.overviewBrief, '阶段一的目标');
  assert.equal(restored.overviewMigration!.originals[0].fullNote, '唯一的目标与限制');
});

test('Markdown 导出包含更新后的目标，并保持项目源笔记不变', () => {
  const p = { ...migrateProjectOverview(fixture()), overviewBrief: '新目标与成本边界' };
  const exported = overviewExportNodes(p);
  assert.ok(exported.find(n => n.id === 'overview')!.fullNote!.includes('新目标与成本边界'));
  assert.equal(p.nodes.find(n => n.id === 'overview')!.fullNote, '独有研究结论');
});
