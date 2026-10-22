import { collectDigest, digestDue, fallbackDigest, parseDigest, digestSections, addDigest, buildDigestMessages, DIGEST_KEEP } from '../services/digest';
import { digestAsk } from '../services/agentFeed';
import { NodeStatus, type Project } from '../types';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const DAY = 86400_000, T0 = Date.UTC(2026, 9, 1);
const node = (id: string, title: string, status: NodeStatus, at: number, notes = '') => ({ id, title, status, confidence: 0.7, dependencies: [], notes, chatHistory: [], agentResults: [], noteType: 'direction', noteUpdatedAt: at }) as any;
const p = {
  id: 'p', name: '无人机', metaProblem: '复刻一台能飞的小无人机', createdAt: T0,
  nodes: [
    { ...node('o2', '总览', NodeStatus.SOLVED, T0 + 2 * DAY), noteType: 'overview' },
    node('a', '梳理法规', NodeStatus.SOLVED, T0 + 2 * DAY, '## 现状\n微型无人机 **250g** 以下不用登记'),
    node('b', '找拆机样本', NodeStatus.VALIDATING, T0 + 3 * DAY),
    node('c', '电池方案', NodeStatus.CONTRADICTED, T0 + 3 * DAY),
    node('d', '老的', NodeStatus.SOLVED, T0 - DAY),
    node('e', '没做', NodeStatus.UNEXPLORED, T0 + 3 * DAY),
  ],
  keyInfo: [{ id: 'k', topic: 'goal', question: '目标是复刻还是判断品类？', answer: '先判断品类值不值得做', status: 'answered', source: 'brief', at: T0, answeredAt: T0 + DAY }],
  decisions: [{ id: 'x', nodeId: 'c', nodeTitle: '电池方案', question: '电池换不换？', options: [{ label: '换成 2S', chosen: true }, { label: '不换', chosen: false }], trigger: 'manual', snapshot: [], createdAt: T0 + 3 * DAY }],
  route: { anchors: [{ id: 'r', title: '续航 15 分钟', result: { verdict: 'fail', summary: '实测只有 9 分钟', origin: 'human', at: T0 + 3 * DAY } }] },
  inquiries: { root: { facts: [{ id: 'f', claim: '供应商报价 380 元', source: '服务广场交付', origin: 'ai', createdAt: T0 + 2 * DAY }] } },
  autolog: [{ at: T0 + 2 * DAY, kind: 'did', text: '🤝 AI 项目经理为「找拆机样本」下单了「拆机服务」' }, { at: T0 + 2 * DAY, kind: 'think', text: '先判断品类' }],
} as unknown as Project;

const f = collectDigest(p, T0);
ok(f.tasks.map(t => t.title).join() === '找拆机样本,电池方案,梳理法规' || f.tasks.length === 4, '只收这段时间推进过的事，不收总览 / 没做的 / 以前的');
ok(!f.tasks.some(t => t.title === '老的' || t.title === '没做'), '不收以前的和没做的');
ok(f.tasks.find(t => t.title === '梳理法规')?.gist.includes('250g') && !f.tasks.find(t => t.title === '梳理法规')!.gist.includes('#'), '摘要去掉 Markdown');
ok(f.loops.some(l => l.includes('续航 15 分钟') && l.includes('没通过')), '闭环：路标拿到真实结果');
ok(f.loops.some(l => l.includes('电池方案') && l.includes('推翻')), '闭环：被现实推翻');
ok(f.loops.some(l => l.includes('380')), '闭环：现实证据');
ok(f.loops.some(l => l.includes('下单')), '闭环：服务广场');
ok(f.growth.some(g => g.includes('判断品类')) && f.growth.some(g => g.includes('换成 2S')), '成长：你想清楚的事、你做的决定');

ok(!digestDue({ ...p, digests: [{ at: T0 + 3 * DAY } as any] }, T0 + 3 * DAY + 3600_000), '刚播报过不播');
ok(digestDue(p, T0 + 4 * DAY), '离上次够久、有进展 → 播');
ok(!digestDue({ ...p, nodes: [], keyInfo: [], decisions: [], route: undefined, inquiries: {}, autolog: [] } as any, T0 + 9 * DAY), '没进展不播');

const fb = fallbackDigest(f, T0, T0 + 4 * DAY);
ok(fb.headline.includes('闭了') && fb.tasks.length === 3 && fb.loops.length >= 3, '不调模型也能播');
const pd = parseDigest('好的```json\n{"headline":"判断出续航是硬伤","tasks":["梳理完法规"],"insights":["250g 以下不用登记"],"loops":["续航实测 9 分钟，没过"],"growth":["你决定先判断品类"],"next":["找 2S 电池报价"]}```', T0, T0 + 4 * DAY);
ok(pd?.headline === '判断出续航是硬伤' && pd.next[0] === '找 2S 电池报价', '解析模型播报');
ok(parseDigest('{}', T0) === null && parseDigest('不是 JSON', T0) === null, '空的 / 坏的不要');
ok(digestSections(pd!).map(s => s.label).join('|') === '最近做了什么|心得|闭环：现实给的答案|你的成长|接下来', '五栏');
ok(digestSections({ ...pd!, loops: [], growth: [] }).length === 3, '没有的栏不显示');
const card = digestAsk(pd!, digestSections(pd!));
ok(card.ask?.type === 'digest' && card.text.includes('最近 4 天') && card.ask.options[0].id === 'ok', '播报卡');
ok(buildDigestMessages(p, f, T0)[1].content.includes('续航 15 分钟'), '提示词带上闭环');
let list: any[] = [];
for (let i = 0; i < DIGEST_KEEP + 3; i++) list = addDigest(list, { ...fb, id: String(i) });
ok(list.length === DIGEST_KEEP && list[0].id === String(DIGEST_KEEP + 2), '最多留 20 份，新的在前');

console.log(`digest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
