import { parseBrief, briefSections, briefFoot, briefMarkdown, charterFromText, charterLabel, mustAskBeforeBuying } from '../services/projectBrief';
import { outlineAsk, charterAsk } from '../services/agentFeed';
import type { Outline } from '../types';

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

console.log(`project-charter: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
