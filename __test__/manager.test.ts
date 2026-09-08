import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInquiry, addFact, reviewFact, newRound, recoverInquiry } from '../services/inquiry';
import { managerMessages, parseManagerReply, validateManagerAction } from '../services/projectManager';
import { profilesOf } from '../services/agentProfiles';
import { ensureWorktree, saveStage, branchFromStage } from '../services/projectWorktree';
import type { Project } from '../types';

const project = (): Project => ({ id: 'pm', name: '证据驱动眼镜研究', metaProblem: '什么条件下用户会持续使用翻译眼镜？', createdAt: 1, nodes: [], inquiries: { root: createInquiry('root', '什么条件下用户会持续使用翻译眼镜？') } });
const reply = (p: Project, type = 'start', questionId = 'root') => parseManagerReply(JSON.stringify({ reply: '先设计一个最小验证方案。', actions: [{ type, questionId, reason: '检验竞争假设' }] }), p);

test('经理只可协调本项目问题，不接受任意工具或外部地址', () => {
  const p = project();
  assert.equal(reply(p).actions?.[0].status, 'proposed');
  assert.throws(() => reply(p, 'shell'), /不支持/);
  assert.throws(() => reply(p, 'start', 'other-project'), /不存在/);
  assert.throws(() => parseManagerReply('{"reply":"x","actions":[{"type":"start","questionId":"root","reason":"a"},{"type":"pause","questionId":"root","reason":"b"}]}', p), /重复/);
});

test('建议执行前重新检查状态；无新证据不重复启动已完成轮次', () => {
  const p = project();
  const initial = reply(p).actions![0];
  validateManagerAction(p, initial);
  let w = newRound(p.inquiries!.root);
  w = { ...w, rounds: w.rounds.map(r => ({ ...r, status: 'completed' })) };
  p.inquiries!.root = w;
  assert.throws(() => validateManagerAction(p, initial), /状态已变化/);
  assert.throws(() => validateManagerAction(p, reply(p).actions![0]), /没有新增/);
  w = addFact(w, { claim: '合成样本中 8 人选择翻译', source: '合成测试', excerpt: '8/10', scope: '仅测试' });
  p.inquiries!.root = w;
  assert.throws(() => validateManagerAction(p, reply(p).actions![0]), /没有新增/);
  p.inquiries!.root = reviewFact(w, w.facts[0].id, 'confirmed', '核验合成记录');
  validateManagerAction(p, reply(p).actions![0]);
});

test('经理最新上下文只读取核验事实，撤回事实与其他项目内容不进入有效记忆', () => {
  const p = project();
  let w = addFact(p.inquiries!.root, { claim: '限定测试陈述', source: '测试源', excerpt: '原始记录', scope: '合成数据' });
  w = reviewFact(w, w.facts[0].id, 'confirmed', '核验完成');
  // Migration: older records have facts but no manager memory yet.
  delete w.agentMemories!.manager;
  w.agents = profilesOf(w);
  w.agents.manager!.model = { provider: 'openai', baseUrl: 'https://manager.test/v1', model: 'model-secret-id', credentialId: 'credential-secret-id' };
  p.inquiries!.root = w;
  let prompt = JSON.stringify(managerMessages(p, w));
  assert.ok(prompt.includes('限定测试陈述'));
  assert.ok(!prompt.includes('credential-secret-id') && !prompt.includes('manager.test'));
  p.inquiries!.root = reviewFact(w, w.facts[0].id, 'disputed', '发现重复样本');
  prompt = JSON.stringify(managerMessages(p, p.inquiries!.root));
  assert.ok(!prompt.includes('限定测试陈述'));
});

test('经理对话与建议随阶段恢复，刷新后不显示仍在执行的旧操作', () => {
  let p = ensureWorktree(project());
  p.inquiries!.root.managerMessages = [{ ...reply(p), role: 'assistant', id: 'm', createdAt: 1 }];
  p = saveStage(p, '经理建议已记录');
  const stage = p.worktree!.stages.at(-1)!;
  p.inquiries!.root.managerMessages![0].content = '后续对话';
  const restored = branchFromStage(p, stage.id, '测试分支');
  assert.equal(restored.inquiries!.root.managerMessages![0].content, '先设计一个最小验证方案。');
  const w = restored.inquiries!.root;
  w.managerMessages![0].actions![0].status = 'running';
  assert.equal(recoverInquiry(w).managerMessages![0].actions![0].status, 'failed');
});
