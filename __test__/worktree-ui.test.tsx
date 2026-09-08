import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ProjectHome from '../components/ProjectHome';
import ProjectNotesTree from '../components/ProjectNotesTree';
import InquiryPanel from '../components/InquiryPanel';
import ExplorationWorktree from '../components/ExplorationWorktree';
import { ensureWorktree, saveStage } from '../services/projectWorktree';
import { addFact, createInquiry, reviewFact } from '../services/inquiry';
import { NodeStatus, type Project } from '../types';
import './worktree.test';
import './overview.test';
const noop = () => {};
const note = (id: string) => ({ id, title: `想法${id}`, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: '', chatHistory: [], agentResults: [] });
const fact = (id: string) => {
  let w = addFact(createInquiry(id, `想法${id}`), { claim: `${id}专属可信数据`, source: '记录第一页', excerpt: '原始观测', scope: '仅此测试' });
  return reviewFact(w, w.facts[0].id, 'confirmed', '核对了原始记录');
};
const project = (): Project => ensureWorktree({ id: 'p', name: '测试项目', metaProblem: '核心问题', createdAt: 1, nodes: [note('A'), note('B')], inquiries: { A: fact('A'), B: fact('B') } });

test('项目主页聚合各想法，而想法主页不展示其他想法的事实', () => {
  const p = project();
  const root = renderToStaticMarkup(<ProjectHome project={p} scopeId="root" onPage={noop} onNote={noop} />);
  assert.ok(root.includes('A专属可信数据') && root.includes('B专属可信数据'));
  assert.ok(root.includes('项目总览'));
  const idea = renderToStaticMarkup(<ProjectHome project={p} scopeId="A" onPage={noop} onNote={noop} />);
  assert.ok(idea.includes('A专属可信数据'));
  assert.ok(!idea.includes('B专属可信数据'));
  assert.ok(idea.includes('想法总览'));
});

test('项目笔记树为每个项目提供研究、团队、事实和分支入口', () => {
  const p = project();
  const html = renderToStaticMarkup(<ProjectNotesTree projects={[p, { ...p, id: 'other', name: '另一个项目' }]} currentProjectId="p" selectedNodeId={null} search="" onSearch={noop} onOpenNode={noop} onCreateProject={noop} onCreateDirection={noop} onAddChild={noop} onBuildTeam={noop} onCleanup={noop} onOpenPage={noop} selectedPage={{ scopeId: 'root', page: 'research' }} />);
  for (const label of ['项目总览', 'AI 团队', '事实看板', '决策与探索分支']) assert.equal(html.replace(/<[^>]*>/g, '').split(label).length - 1, 2);
  assert.ok(html.includes('另一个项目'));
});

test('嵌入想法的事实页锁定到该想法，不依赖全局选择器', () => {
  const p = project();
  const teams: any = { change: noop, isRunning: () => false, isStopping: () => false };
  const html = renderToStaticMarkup(<InquiryPanel project={p} nodes={p.nodes} scopeId="A" mode="facts" teams={teams} onOpenFacts={noop} />);
  assert.ok(html.includes('A专属可信数据'));
  assert.ok(!html.includes('B专属可信数据'));
  assert.ok(!html.includes('<select'));
});

test('探索树呈现决策理由和完整阶段恢复入口，运行时禁用切换', () => {
  const d = { id: 'decision', nodeId: 'A', nodeTitle: '想法A', question: '选择小规模验证', options: [{ label: '先访谈', chosen: true, reason: '先检验需求' }], trigger: 'manual' as const, snapshot: [note('A')], createdAt: 2 };
  const p = saveStage({ ...project(), decisions: [d] }, '首次路线决策', '数据不足，缩小实验范围', d.id);
  const actions = { save: noop, branch: noop, switchBranch: noop, recordDecision: noop, legacyFork: noop };
  const html = renderToStaticMarkup(<ExplorationWorktree project={p} actions={actions} busy={true} onStop={noop} />);
  assert.ok(html.includes('先检验需求'));
  assert.ok(html.includes('数据不足，缩小实验范围'));
  assert.ok(html.includes('返回此阶段并新建分支'));
  assert.ok(html.includes('disabled=""'));
});
