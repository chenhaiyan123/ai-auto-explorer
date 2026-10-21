import { parseBrief, briefSections, briefFoot, briefMarkdown, charterFromText, charterLabel, mustAskBeforeBuying } from '../services/projectBrief';
import { outlineAsk, charterAsk } from '../services/agentFeed';
import type { Outline } from '../types';
import { questionsFromBrief, asQuestion, addPending, nextPending, markAsked, answerInfo, skipInfo, remember, forget, keyInfoContext, pendingCount, MAX_PENDING, REASK_AFTER } from '../services/keyInfo';
import { infoAsk } from '../services/agentFeed';
import { parsePulse, buildPulseMessages } from '../services/projectPulse';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };

// 简报解析：去 Markdown、每栏最多 3 条、字段太少就不要
const b = parseBrief({
  approach: '**先**弄清谁在流失，再看流失前发生了什么',
  hard: ['- 拿不到真实续费数据', '家长和孩子的意愿不一致', '样本少', '第四条应被截掉'],
  support: '确认目标人群；提供过去一年的续费名单',
  resources: ['续费数据', '5-10 位家长访谈', '1. 竞品价格表'], permissions: ['联网搜索', '在服务广场找人做家长访谈'],
  budget: '模型费几块钱；访谈服务约 200-500 元',
  shortTerm: '两周内能给出流失原因的假设清单，但没法证明',
  longTerm: '攒够真实数据后，能定位到具体是哪一节课让人流失',
});
ok(b && b.hard.length === 3 && b.hard[0] === '拿不到真实续费数据', 'hard clipped to 3, bullets stripped');
ok(b && b.approach.startsWith('先弄清'), 'markdown stripped');
ok(b && b.resources[1] === '5-10 位家长访谈' && b.resources[2] === '竞品价格表', 'numbers kept, list markers stripped');
ok(b && b.support.length === 2, 'support split from string');
ok(parseBrief({ approach: 'x' }) === undefined, 'too thin → undefined');
ok(parseBrief(null) === undefined && parseBrief('x') === undefined, 'garbage → undefined');

const secs = briefSections(b!, [{ title: '谁在流失', question: '哪类家长不续费' }]);
ok(secs.map(s => s.label).join('|') === '大概思路|怎么拆（1 篇）|难点|需要你|需要的资源|需要你授权|预算', 'section order');
ok(briefFoot(b!)!.includes('短期：') && briefFoot(b!)!.includes('长期：'), 'foot has short & long');
ok(briefMarkdown(b!, { autoBuyCNY: 50, confirmedAt: 0 }).includes('单笔 ≤ ¥50'), 'markdown carries charter');

// 简报卡
const outline: Outline = { id: 'o1', goal: 'g', createdAt: 0, status: 'draft', items: [{ id: '1', title: '一', question: 'q', state: 'keep' }], brief: b! };
const card = outlineAsk(outline);
ok(card.sections && card.sections.length >= 5 && card.foot && card.ask!.options[0].id === 'confirm', 'brief card');
const plain = outlineAsk({ ...outline, brief: undefined });
ok(!plain.sections && plain.list!.length === 1, 'no brief → old outline card');

// 花钱权限卡
const ca = charterAsk('p1', 'n1');
ok(ca.ask!.type === 'charter' && ca.nodeId === 'n1' && ca.ask!.options[0].id === 'cny:0' && ca.ask!.options[0].primary, 'charter card defaults to ask-first');

// 一句话 → 权限
const c1 = charterFromText('每月最多 300，单笔不超过 100');
ok(c1.monthlyCNY === 300 && c1.autoBuyCNY === 100, 'monthly + single');
ok(charterFromText('50 以内你自己买').autoBuyCNY === 50, 'single number = per order');
ok(charterFromText('都先问我').autoBuyCNY === 0, 'ask first');
ok(charterFromText('随便').autoBuyCNY === 0, 'no number → 0');
ok(charterFromText('每月 30，单笔 100').autoBuyCNY === 30, 'single capped by monthly');
ok(charterLabel({ autoBuyCNY: 0 }) === '花钱都先问你', 'label 0');

// 该不该先问
ok(mustAskBeforeBuying(undefined, 1), 'no charter → ask');
ok(!mustAskBeforeBuying({ autoBuyCNY: 50, confirmedAt: 0 }, 40), 'under cap → buy');
ok(mustAskBeforeBuying({ autoBuyCNY: 50, confirmedAt: 0 }, 60), 'over cap → ask');
ok(mustAskBeforeBuying({ autoBuyCNY: 50, monthlyCNY: 100, confirmedAt: 0 }, 40, 80), 'over monthly → ask');

// ===== 关键信息：主动问 + 记进 AI 记忆 =====
ok(asQuestion('确认目标人群是 6-12 岁') === '能确认目标人群是 6-12 岁吗？', 'statement → question');
ok(asQuestion('你有续费名单吗？') === '你有续费名单吗？', 'question kept');
const withAsks = parseBrief({ approach: 'a', hard: ['h'], support: ['s'], shortTerm: 's', asks: [{ topic: 'resources', question: '你手上有过去一年的续费名单吗？' }, { topic: 'bogus', q: '目标是几岁的孩子？' }, { question: '' }] });
ok(withAsks?.asks?.length === 2 && withAsks.asks[1].topic === 'other', 'asks parsed, bad topic → other, empty dropped');
ok(questionsFromBrief(withAsks).map(q => q.question).join('|') === '你手上有过去一年的续费名单吗？|目标是几岁的孩子？', 'model asks preferred');
ok(questionsFromBrief(b!).some(q => q.question.startsWith('能确认目标人群')), 'fallback from support');
ok(!questionsFromBrief(b!).some(q => q.question.includes('联网搜索')), 'AI-doable permissions not asked');

let ki = addPending(undefined, questionsFromBrief(withAsks), 'brief', 1000);
ki = addPending(ki, [{ topic: 'other', question: '目标是几岁的孩子?' }], 'pulse', 2000);
ok(ki.length === 2, 'dedupe ignores punctuation');
const first = nextPending(ki, 3000)!;
ok(first.question.startsWith('你手上有'), 'oldest first');
ki = markAsked(ki, first.id, 3000);
ok(nextPending(ki, 3001)!.id !== first.id, 'asked one waits');
ok(nextPending(markAsked(ki, nextPending(ki, 3001)!.id, 3001), 3002) === undefined, 'nothing to ask right after');
{ const both = markAsked(ki, ki.find(k => k.id !== first.id)!.id, 3001); ok(nextPending(both, 3000 + REASK_AFTER)!.id === first.id, 're-ask after a day, oldest ask first'); }
ki = answerInfo(ki, first.id, '有，脱敏的 Excel');
const second = ki.find(k => k.status === 'pending')!;
ki = skipInfo(ki, second.id);
ok(pendingCount(ki) === 0, 'all handled');
ki = remember(ki, 'budget', '花钱权限', '花钱都先问你', 'charter');
ki = remember(ki, 'budget', '花钱权限', '单笔 ≤ ¥50', 'charter');
ok(ki.filter(k => k.topic === 'budget').length === 1 && ki.find(k => k.topic === 'budget')!.answer === '单笔 ≤ ¥50', 'charter overwritten not duplicated');
ki = remember(ki, 'other', '你补充的', '不要碰线下渠道', 'user');
ki = remember(ki, 'other', '你补充的', '数据只能用脱敏的', 'user');
ok(ki.filter(k => k.source === 'user').length === 2, 'user additions all kept');
const ctx = keyInfoContext(ki);
ok(ctx.includes('有，脱敏的 Excel') && ctx.includes('按常理假设') && ctx.includes('不要再问'), 'context has answers + assumptions');
ok(keyInfoContext(undefined) === '', 'empty context');
ok(keyInfoContext(forget(ki, first.id)).includes('脱敏的 Excel') === false, 'forget removes');
let many = addPending(undefined, Array.from({ length: 9 }, (_, i) => ({ topic: 'other' as const, question: `问题${i}？` })), 'pulse');
ok(pendingCount(many) === MAX_PENDING, 'pending capped');

const ia = infoAsk(first, 2, 'n1');
ok(ia.ask!.type === 'info' && ia.ref === first.id && ia.ask!.input!.optionId === 'answer' && ia.ask!.options.some(o => o.id === 'start') && ia.detail!.includes('还有 2'), 'kickoff info card');
ok(!infoAsk(first, 0).ask!.options.some(o => o.id === 'start'), 'later card has no start');

// 醒来看一眼：带上 AI 记忆，能主动提一个问题
const pr = parsePulse(JSON.stringify({ summary: 's', observations: [], askUser: { topic: 'resources', question: '你们有没有家长群可以发问卷？' } }));
ok(pr.askUser?.question === '你们有没有家长群可以发问卷？' && pr.askUser.topic === 'resources', 'pulse askUser parsed');
ok(parsePulse(JSON.stringify({ summary: 's', observations: [] })).askUser === undefined, 'no askUser');
const msgs = buildPulseMessages({ id: 'p', name: 'n', metaProblem: 'm', createdAt: 0, nodes: [], keyInfo: ki } as any, 0);
ok(msgs[1].content.includes('有，脱敏的 Excel') && msgs[0].content.includes('askUser'), 'pulse prompt carries memory');

console.log(`project-charter: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
