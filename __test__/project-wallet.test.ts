import { addModelSpend, walletSummary, estimateCNY, serviceSpentThisMonth, fmtCNY, fmtTokens, charterRoom, onModelUsage, reportModelUsage, meterFor, isQuota } from '../services/projectWallet';
import { PROJECT_PAGES, ROOT_ONLY_PAGES } from '../services/projectWorktree';
let pass = 0, fail = 0; const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const now = Date.UTC(2026, 9, 21, 8), D = 864e5;

ok(estimateCNY('deepseek-flash', 'openai-compatible', 1e6, 1e6) === 5, 'deepseek price');
ok(estimateCNY('qwen-flash', 'platform', 1e6, 1e6) === 0 && isQuota('trial'), 'quota is not money');
ok(estimateCNY('some-model', 'openai-compatible', 1e6, 0) === 2, 'default price');

let w = addModelSpend(undefined, { model: 'deepseek-flash', provider: 'openai-compatible', input: 1000, output: 500 }, now);
w = addModelSpend(w, { model: 'deepseek-flash', provider: 'openai-compatible', input: 1000, output: 500 }, now + 1000);
w = addModelSpend(w, { model: 'qwen-flash', provider: 'platform', input: 2000, output: 0 }, now);
w = addModelSpend(w, { model: 'deepseek-flash', provider: 'openai-compatible', input: 1000, output: 0 }, now - 40 * D);
ok(w.model!.length === 3, 'same day × model merged');
const r = w.model!.find(x => x.model === 'deepseek-flash' && x.day === '2026-10-21')!;
ok(r.calls === 2 && r.input === 2000 && r.output === 1000 && r.lastAt === now + 1000, 'merged numbers');
const s = walletSummary(w, now);
ok(s.monthCalls === 3 && s.monthTokens === 5000 && s.quotaTokens === 2000, 'month summary only counts this month');
ok(Math.abs(s.monthCNY - (2000 * 2 + 1000 * 3) / 1e6) < 1e-12 && s.totalCNY > s.monthCNY, 'month vs total');

const orders = [
  { totalCents: 5000, status: 'completed', createdAt: now - D },
  { totalCents: 3000, status: 'proposed', createdAt: now },
  { totalCents: 9900, status: 'accepted', createdAt: now - 40 * D },
  { totalCents: 2000, status: 'cancelled', createdAt: now },
];
ok(serviceSpentThisMonth(orders, now) === 50, 'only committed orders this month');
ok(charterRoom({ autoBuyCNY: 50, monthlyCNY: 300, confirmedAt: 0 }, 50) === 250 && charterRoom({ autoBuyCNY: 50, confirmedAt: 0 }, 1) === undefined, 'room left');
ok(fmtCNY(0) === '¥0' && fmtCNY(0.001) === '<¥0.01' && fmtCNY(1.234) === '¥1.23' && fmtCNY(123.4) === '¥123', 'fmtCNY');
ok(fmtTokens(1500) === '2k' && fmtTokens(2_500_000) === '2.5M', 'fmtTokens');

// 上报归属：meterFor 里的记到指定项目
const got: (string | null)[] = [];
const off = onModelUsage((_, pid) => got.push(pid));
reportModelUsage({ model: 'm', provider: 'p', input: 1, output: 1 });
await meterFor('p2', async () => reportModelUsage({ model: 'm', provider: 'p', input: 1, output: 1 }));
reportModelUsage({ model: 'm', provider: 'p', input: 1, output: 1 });
off();
reportModelUsage({ model: 'm', provider: 'p', input: 1, output: 1 });
ok(JSON.stringify(got) === JSON.stringify([null, 'p2', null]), 'meterFor attributes, unsubscribe works');

ok(Object.keys(PROJECT_PAGES)[1] === 'wallet' && ROOT_ONLY_PAGES.includes('wallet'), 'wallet page sits right after overview, project-level only');

console.log(`project-wallet: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
