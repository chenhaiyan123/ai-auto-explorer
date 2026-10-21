import { defaultLife, nextInterval, pickDue, budgetAllows, spendBudget, parsePulse, applyPulse, notableToShow, touchViewed, setCadence, setWatching, MAX_WAKES_PER_DAY, failPulse, glowOf, glowLine, litDays } from '../services/projectPulse';
let pass = 0, fail = 0; const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const H = 3600_000, D = 24 * H, now = Date.UTC(2026, 9, 20, 8);
const proj = (id: string, life?: any): any => ({ id, name: id, metaProblem: '目标' + id, nodes: [], createdAt: 0, life });

// 默认活着、首次醒来错开
const l0 = defaultLife(now, 0), l2 = defaultLife(now, 2);
ok(l0.state === 'watching' && l0.nextWakeAt === now + H && l2.nextWakeAt === now + 5 * H, 'default alive & staggered');
// 没有 life 的项目也算活着，但不会立刻醒
ok(!pickDue([proj('a')], now, () => false), 'fresh project not due immediately');
ok(pickDue([proj('a', { ...l0, nextWakeAt: now - 1 })], now, () => false)?.id === 'a', 'due project picked');
ok(!pickDue([proj('a', { ...l0, nextWakeAt: now - 1 })], now, () => true), 'busy project skipped');
ok(!pickDue([proj('a', { ...l0, state: 'paused', nextWakeAt: now - 1 })], now, () => false), 'paused not woken');
ok(pickDue([proj('a', { ...l0, nextWakeAt: now - 1 }), proj('b', { ...l0, nextWakeAt: now - 5 })], now, () => false)?.id === 'b', 'most overdue first');

// 节奏：安静会放慢，最长一周；很久没看也放慢
ok(nextInterval({ ...l0, quietStreak: 0 }, now) === D, 'base 24h');
ok(nextInterval({ ...l0, quietStreak: 1 }, now) === 2 * D, 'quiet x2');
ok(nextInterval({ ...l0, quietStreak: 9 }, now) === 7 * D, 'quiet capped at a week');
ok(nextInterval({ ...l0, lastViewedAt: now - 20 * D }, now) === 7 * D, 'faded → weekly');
const back = touchViewed({ ...l0, lastViewedAt: now - 20 * D, nextWakeAt: now + 6 * D }, now);
ok(back.nextWakeAt === now + D && back.lastViewedAt === now, 'coming back restores cadence');

// 全局闸门
let b: any = null;
ok(budgetAllows(b, now), 'empty budget allows');
b = spendBudget(b, now);
ok(!budgetAllows(b, now + 5 * 60_000), 'min gap enforced');
for (let i = 1; i < MAX_WAKES_PER_DAY; i++) b = spendBudget(b, now + i * H);
ok(!budgetAllows(b, now + 10 * H), 'daily cap enforced');
ok(budgetAllows(b, now + D + 1), 'resets next day');

// 解析：容错、截断、最多 3 条、非法 kind 丢弃
const r = parsePulse('好的：{"summary":"看到两条线索","observations":[{"kind":"clue","title":"查一下 2025 年的综述","detail":"d","notable":true},{"kind":"bad","title":"x"},{"kind":"question","title":"预算多少"},{"kind":"evidence","title":"a"},{"kind":"inspiration","title":"b"}]}');
ok(r.observations.length === 3 && r.observations[0].notable && r.summary === '看到两条线索', 'parse tolerant & capped');
// 回写：去重、安静计数、下次时间
const a1 = applyPulse(l0, r, now);
ok(a1.added.length === 3 && a1.life.quietStreak === 0 && a1.life.nextWakeAt === now + D, 'apply adds');
const a2 = applyPulse(a1.life, r, now + D);
ok(a2.added.length === 0 && a2.life.quietStreak === 1 && a2.life.nextWakeAt === now + D + 2 * D, 'duplicates ignored → quiet → slower');
// 打扰：只说 notable、一天最多一次
ok(notableToShow(l0, a1.added, now)?.title === '查一下 2025 年的综述', 'notable shown');
ok(!notableToShow({ ...l0, lastNotifiedAt: now - 2 * H }, a1.added, now), 'once a day');
ok(!notableToShow(l0, a1.added.filter(x => !x.notable), now), 'non-notable silent');
// 失败不连着重试
ok(failPulse(l0, now, 'x').nextWakeAt >= now + 6 * H, 'failure backs off');
// 设置
ok(setCadence(l0, 72, now).cadenceHours === 72 && setCadence(l0, 5, now).cadenceHours === 24, 'cadence validated');
ok(setWatching(l0, false, now).state === 'paused' && setWatching({ ...l0, state: 'paused' }, true, now).nextWakeAt === now + D, 'pause/resume');
const web = parsePulse('{"summary":"s","observations":[{"kind":"evidence","title":"有出处","detail":"d","source":2},{"kind":"clue","title":"没出处","source":7}]}', [{ index: 2, title: 't', url: 'https://www.example.cn/p' }]);
ok(web.observations[0].url === 'https://www.example.cn/p' && web.observations[0].site === 'example.cn' && !web.observations[1].url, 'web sources mapped by index');
// ===== 点亮 =====
{
  const lit = defaultLife(now);
  ok(lit.litAt === now && glowOf(lit) === 'dormant', 'new project is lit (dormant)');
  ok(glowOf(lit, { active: true }) === 'active', 'working → active');
  const off = setWatching(lit, false, now + D);
  ok(glowOf(off) === 'standby' && off.litAt === now, 'standby keeps history');
  ok(glowOf(off, { cloud: true }) === 'dormant', 'cloud watching still alive');
  const relit = setWatching(off, true, now + 3 * D);
  ok(relit.litAt === now + 3 * D, 're-lighting restarts the count');
  ok(setWatching(lit, true, now + 5 * D).litAt === now, 'lighting an already-lit project keeps its day count');
  ok(litDays(lit, 0, now) === 1 && litDays(lit, 0, now + 9 * D + H) === 10, 'lit days count from 1');
  ok(litDays({ ...lit, litAt: undefined }, now - 2 * D, now) === 3, 'old projects count from creation');
  ok(glowLine('standby', off, now, now).startsWith('待机') && glowLine('dormant', lit, now, now).includes('下次醒来'), 'glow lines');
}
console.log(`project-pulse: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
