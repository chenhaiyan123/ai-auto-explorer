import { NodeStatus, type Project } from '../types';
import { createInquiry, addFact, reviewFact } from '../services/inquiry';
import { createAwakening, type Awakening } from '../services/awakening';

export function loopFixture(now = Date.now()): { project: Project; state: Awakening } {
  const node = (id: string, title: string) => ({ id, title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: '', chatHistory: [], agentResults: [] });
  let root = addFact(createInquiry('root', '遮阳能否减少西晒房间的降温能耗？'), { claim: '试验房间西窗下午受到直晒', source: '演示用观察记录', excerpt: '14:00–16:00 西窗有直射阳光', scope: '仅演示房间' });
  root = reviewFact(root, root.facts[0].id, 'confirmed', '演示：已核对观察记录');
  const idea = createInquiry('shade', '外遮阳对室温的影响');
  idea.rounds = [{ id: 'round1', number: 1, createdAt: now - 10000, completedAt: now - 5000, status: 'completed', hypotheses: [{ id: 'h1', statement: '外遮阳可能降低午后室温', falsification: '同等天气条件下温度没有降低，则不支持这个假设' }], tasks: [
    { id: 'e1', role: 'executor', hypothesisId: 'h1', dependencies: [], status: 'completed', result: { summary: '已制定对照测量方案，尚未完成现实实验' } },
    { id: 'v1', role: 'verifier', hypothesisId: 'h1', dependencies: ['e1'], status: 'completed', result: { summary: '需要控制天气、空调设置和测量时间', verdict: 'uncertain' } },
  ] }];
  const project: Project = { id: 'loop-demo', name: '房间降温 · 演示数据', metaProblem: root.question, createdAt: now, nodes: [node('shade', idea.question), node('other', '不相关想法')], inquiries: { root, shade: idea }, probes: [{ id: 'probe1', nodeId: 'shade', hypothesis: '外遮阳可能降低午后室温', method: '连续两天按相同时间测量室温，记录天气和空调设置', expectedSignal: '对照条件相近且温度下降，否则继续观察', cost: 'low', status: 'running', createdAt: now }] };
  const facts = root.facts.map(({ id, claim, source, excerpt, scope, status }) => ({ id, claim, source, excerpt, scope, status }));
  const state = createAwakening({ projectId: project.id, branchId: 'main', scopeId: 'root', question: root.question, background: '', agents: {}, facts }, now);
  state.policy.enabled = true; state.status = 'needs_user'; state.reason = '等待你提供两天的室温对照记录；不会反复生成同样的方案。';
  state.nextCheckAt = now + 86400000;
  state.runs = [{ id: 'cloud1', startedAt: now - 10000, completedAt: now - 5000, outcome: 'waiting', eventIds: [], steps: [{ role: 'manager', purpose: '确定最小验证任务', result: '先获得可比较的真实数据', startedAt: now - 10000, completedAt: now - 5000 }], reason: '用户提出降温问题', summary: '方案已整理，缺少对照数据', next: '上传室温、天气和空调设置记录后再核验', plan: { decision: 'wait', reason: '缺少数据', task: '收集相同条件下的温度记录', stopCondition: '没有新的现实数据时等待', hypothesis: '外遮阳可能减少制冷需求', missingEvidence: '两天的室温与天气记录' } }];
  return { project, state };
}
