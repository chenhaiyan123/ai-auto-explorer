import { grantAutonomy, logAuto, autoSpentCNY, budgetLeftCNY, canPlanNextStage, reportDue, fallbackReport, parseReport, autoChoice, nextCheckIn, MAX_STAGE_ROUNDS, STAGE_GAP, LOG_LIMIT, REPORT_GAP } from '../services/autonomy';
import { reportAsk } from '../services/agentFeed';
import { parseBrief, briefSections } from '../services/projectBrief';
import type { Project } from '../types';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const T0 = Date.UTC(2026, 9, 21, 2);
const DAY = 86400_000;

// 授权
const a = grantAutonomy(20, 14, T0);
ok(a.on && a.budgetCNY === 20 && a.checkInDays === 14 && a.lastReportAt === T0, '授权：预算 / 回看周期');
ok(grantAutonomy(10, 9, T0).checkInDays === 7, '回看周期只有 7 / 14');
ok(nextCheckIn(a, T0) === T0 + 14 * DAY, '下次来看 = 上次汇报 + 周期');

// 日志：去重、截断
let log = logAuto(undefined, 'did', '做完「A」', 'n1', T0);
log = logAuto(log, 'did', '做完「A」', 'n1', T0 + 1000);
ok(log.length === 1, '一分钟内同一件事不重复记');
for (let i = 0; i < LOG_LIMIT + 20; i++) log = logAuto(log, 'think', `想法 ${i}`, undefined, T0 + i);
ok(log.length === LOG_LIMIT && log[log.length - 1].text === `想法 ${LOG_LIMIT + 19}`, '日志有上限，留最新的');

// 花钱：授权之后的模型花费 + 服务广场
const p = { id: 'p', name: 'P', metaProblem: 'G', createdAt: T0, nodes: [], autonomy: { ...a, marketCents: 500 },
  wallet: { model: [
    { day: '2026-10-20', model: 'x', input: 1e6, output: 0, calls: 1, cny: 3, lastAt: T0 - DAY },
    { day: '2026-10-21', model: 'deepseek', input: 1e6, output: 0, calls: 2, cny: 2, lastAt: T0 + 1000 },
    { day: '2026-10-21', model: 'qwen', input: 5e5, output: 5e5, calls: 2, cny: 0, quota: true, lastAt: T0 + 2000 },
  ] } } as unknown as Project;
ok(Math.abs(autoSpentCNY(p, { qwen: 400 }) - (2 + 4 + 5)) < 1e-9, '花费 = 授权后的模型（自有 + 平台按价）+ 服务广场');
ok(Math.abs(budgetLeftCNY(p, { qwen: 400 }) - 9) < 1e-9, '剩余启动资金');

// 拆下一阶段有节制
ok(canPlanNextStage(a, T0), '第一次可以自己拆下一阶段');
ok(!canPlanNextStage({ ...a, stageRounds: 1, lastStageAt: T0 }, T0 + STAGE_GAP - 1), '拆完要隔一阵');
ok(!canPlanNextStage({ ...a, stageRounds: MAX_STAGE_ROUNDS }, T0 + 99 * DAY), '总轮数有上限');

// 回来汇报的时机
const withLog = (n: number, at: number) => ({ ...p, autonomy: { ...a, lastReportAt: T0 }, autolog: Array.from({ length: n }, (_, i) => ({ at: T0 + 1000 + i, kind: 'did' as const, text: `t${i}` })) }) as Project;
ok(reportDue(withLog(3, T0), T0 + REPORT_GAP), '离开够久、有新动静 → 汇报');
ok(!reportDue(withLog(2, T0), T0 + REPORT_GAP), '没什么新动静不汇报');
ok(!reportDue(withLog(5, T0), T0 + 60_000), '刚汇报过不汇报');
ok(!reportDue({ ...withLog(5, T0), autonomy: { ...a, on: false } } as Project, T0 + DAY), '没授权不汇报');

// 汇报内容
const fb = fallbackReport([
  { at: 1, kind: 'did', text: '做完「A」' }, { at: 2, kind: 'think', text: '先做便宜的' },
  { at: 3, kind: 'stuck', text: '拿不到数据' }, { at: 4, kind: 'need', text: '启动资金用完了' },
], [{ id: 'k', topic: 'goal', question: '目标用户是谁？', status: 'pending', source: 'brief', at: 0 } as any]);
ok(fb.did[0] === '做完「A」' && fb.thinking[0] === '先做便宜的' && fb.difficulties[0] === '拿不到数据', '不调模型也能分四栏');
ok(fb.needs.includes('启动资金用完了') && fb.needs.some(n => n.includes('目标用户是谁')), '需要支持里带上没问的问题');
const pr = parseReport('```json\n{"headline":"做了三件事","did":["a","b"],"thinking":["c"],"difficulties":[],"needs":["d"]}\n```');
ok(pr?.did.length === 2 && pr.needs[0] === 'd', '解析模型汇报');
ok(parseReport('不是 JSON') === null && parseReport('{"did":[],"thinking":[]}') === null, '坏的 / 空的汇报不要');
const card = reportAsk(pr!, { since: T0 - 7 * DAY, nextCheck: T0 + 7 * DAY, hasQuestions: true });
ok(card.ask?.type === 'report' && card.text.includes('7 天'), '汇报卡：类型 + 时间跨度');
ok(card.sections?.map(s => s.label).join('|') === '这段时间我做了什么|我的思考|遇到的困难|需要你的支持', '汇报卡四栏');
ok(card.ask!.options.some(o => o.id === 'questions') && card.ask!.input?.optionId === 'adjust', '能回答问题、能提调整');

// 自己拿主意 vs 留给用户
ok(autoChoice('step', ['next', 'rewrite', 'stop', 'auto'])?.option === 'auto', '做完一步：接着做');
ok(autoChoice('step', ['seek', 'stop'])?.option === 'stop', '没有下一步：交回自主运行逻辑');
ok(autoChoice('branch', ['continue', 'retry', 'terminate'])?.option === 'continue', '岔路：自己判断');
ok(autoChoice('outline', ['confirm', 'edit', 'redo'])?.option === 'confirm', '自己拆的下一阶段自己确认');
ok(autoChoice('anchor', ['skip', 'open']) === null && autoChoice('halted', ['retry']) === null && autoChoice('charter', ['cny:0']) === null, '很重要的事留给用户');

// 简报：分阶段 + 从小做起
const b = parseBrief({ approach: '先小后大', hard: ['x'], support: ['y'], resources: ['z'], permissions: ['联网'], budget: '几十元', shortTerm: 's', longTerm: 'l',
  stages: [{ title: '摸底', goal: '找到 10 个目标用户', weeks: 2 }, { title: '验证', goal: '小规模试卖', weeks: 4 }], startCNY: 2000, runEstimate: '够跑两周', checkInDays: 14 });
ok(b?.stages?.length === 2 && b.startCNY === 500 && b.checkInDays === 14, '解析分阶段 / 启动资金（有上限）/ 回看周期');
const secs = briefSections(b!, []);
ok(secs.some(s => s.label === '分阶段') && secs.some(s => s.label === '建议先从小做起' && s.items[0].includes('¥500')), '简报卡里有分阶段和从小做起');

console.log(`autonomy: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
