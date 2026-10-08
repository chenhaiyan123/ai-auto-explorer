import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExplorationLoop from '../components/ExplorationLoop';
import { explorationLoop } from '../services/explorationLoop';
import { recordJudgments, heartbeatAction } from '../services/problemHeartbeat';
import { loopFixture } from './exploration-loop.fixture';
const now = 1800000000000;

test('等待现实反馈不是活跃执行，实验与模型结果不自动确认', () => {
  const { project, state } = loopFixture(now);
  const loop = explorationLoop(project, 'root', state, true, [], now);
  assert.equal(loop.status, 'needs_user'); assert.equal(loop.stage, 'feedback'); assert.equal(loop.confirmed.length, 1);
  assert.equal(loop.smallLoops.length, 3); assert.equal(loop.accepted, undefined);
  assert.match(loop.details.learning, /尚无/);
  assert.equal(loop.smallLoops.find(l => l.kind === 'experiment')?.status, 'waiting');
});
test('云端心跳过期或断连时不继续亮绿灯', () => {
  const { project, state } = loopFixture(now);
  state.status = 'researching'; state.heartbeatAt = now; state.activeRunId = state.runs[0].id; state.runs[0].outcome = 'running';
  state.runs[0].steps.push({ role: 'verifier', purpose: '核验', startedAt: now });
  const live = explorationLoop(project, 'root', state, true, [], now);
  assert.equal(live.status, 'active'); assert.equal(live.stage, 'verification'); assert.equal(live.role, 'verifier');
  assert.equal(explorationLoop(project, 'root', state, true, [], now + 91000).status, 'unknown');
  assert.equal(explorationLoop(project, 'root', state, false, [], now).nextCheckAt, undefined);
});
test('暂停、休眠、结束、故障分别保留真实状态', () => {
  const { project, state } = loopFixture(now);
  state.status = 'blocked'; state.policy.enabled = false;
  assert.equal(explorationLoop(project, 'root', state, true).status, 'blocked');
  state.status = 'paused'; assert.equal(explorationLoop(project, 'root', state, true).status, 'paused');
  state.policy.enabled = true; state.status = 'sleeping';
  state.problemHeartbeat = { version: 1, lifecycle: 'dormant', waits: [], judgments: [], updates: [], priority: 'normal', preference: 'important', createdAt: now, lastMeaningfulAt: now, lastViewedAt: now };
  assert.equal(explorationLoop(project, 'root', state, true).status, 'dormant');
  state.problemHeartbeat.lifecycle = 'resolved';
  assert.equal(explorationLoop(project, 'root', state, true).status, 'resolved');
  assert.equal(explorationLoop(project, 'root', state, true).nextCheckAt, undefined);
});
test('想法、项目和历史分支的云端数据不会串用', () => {
  const { project, state } = loopFixture(now);
  const idea = explorationLoop(project, 'shade', state, true);
  assert.equal(idea.state, undefined); assert.equal(idea.confirmed.length, 0); assert.equal(idea.smallLoops.length, 2);
  assert.equal(explorationLoop(project, 'other', state, true).smallLoops.length, 0);
  state.context.branchId = 'other-branch'; assert.equal(explorationLoop(project, 'root', state, true).state, undefined);
  state.context.branchId = 'main'; state.context.projectId = 'other-project'; assert.equal(explorationLoop(project, 'root', state, true).state, undefined);
});
test('浏览器遗留 running 标志不能代表此刻仍在调用模型', () => {
  const { project, state } = loopFixture(now);
  const round = project.inquiries!.shade.rounds[0]; round.status = 'running'; round.tasks[0].status = 'running';
  assert.equal(explorationLoop(project, 'shade', undefined, true).status, 'paused');
  assert.equal(explorationLoop(project, 'shade', undefined, true, ['shade']).status, 'active');
  state.context.scopeId = 'shade'; state.policy.enabled = false; state.status = 'paused';
  const live = explorationLoop(project, 'shade', state, true, ['shade']);
  assert.equal(live.status, 'active'); assert.equal(live.source, 'browser');
});
test('认知变化必须被采纳且证据在当前事实板仍有效', () => {
  const { project, state } = loopFixture(now);
  const proposed = recordJudgments(state, [{ subject: '直晒', after: '值得进行遮阳对照实验', reason: '基于观察记录', evidenceIds: [state.context.facts[0].id] }], 'cloud1', now, () => 'judgment1');
  assert.match(explorationLoop(project, 'root', proposed, true).details.learning, /待审核/);
  const accepted = heartbeatAction(proposed, { action: 'judgment', id: 'judgment1', status: 'accepted' }, now, () => 'update');
  assert.ok(explorationLoop(project, 'root', accepted, true).accepted);
  project.inquiries!.root.facts[0].status = 'disputed';
  const withdrawn = explorationLoop(project, 'root', accepted, true);
  assert.equal(withdrawn.accepted, undefined); assert.match(withdrawn.details.learning, /尚无/);
});
test('总览呈现八个可选环节、小循环入口及停止条件，无虚构进度条', () => {
  const { project, state } = loopFixture(now);
  const html = renderToStaticMarkup(<ExplorationLoop project={project} scopeId="root" state={state} connected onPage={() => {}} />);
  assert.equal((html.match(/aria-pressed=/g) || []).length, 8);
  assert.match(html, /aria-current="step"/); assert.match(html, /展开假设与实验小循环/); assert.match(html, /上传室温/);
  assert.ok(!html.includes('progressbar')); assert.ok(!html.includes('animate-spin'));
});
