import { pushFeed, answerFeed, closeAsks, openAsks, status, stepAsk, branchAsk, outlineAsk, FEED_LIMIT, batchProgress, batchAsk, BATCH_SIZE, type Batch } from '../services/agentFeed';
import { NodeStatus, ProblemNode, Outline, FeedItem } from '../types';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };

const node = (id: string, title: string, st = NodeStatus.SOLVED): ProblemNode => ({ id, title, status: st, confidence: 0, dependencies: [], notes: '一段笔记' });

// 同 key 替换：正在写 → 写完，一篇只占一行
let f = pushFeed(undefined, status('✍️ 正在写《A》', { key: 'write:a' }));
f = pushFeed(f, status('其它', {}));
f = pushFeed(f, status('✅ 写完《A》', { key: 'write:a' }));
ok(f.length === 2 && f[1].text.startsWith('✅'), 'same key replaces');

// 问题卡：一篇一停
const prog = { total: 3, written: 1, next: { nodeId: 'b', title: '下一篇', question: '' } };
const ask = stepAsk(node('a', 'A'), prog);
f = pushFeed(f, ask);
ok(f.length === 2 && f[1].kind === 'ask', 'step ask replaces the status line of the same note');
ok(ask.ask!.options[0].id === 'next' && ask.ask!.options[0].primary, 'next is primary');
ok(ask.ask!.options.length <= 4, 'at most 4 options');
ok(openAsks(f).length === 1, 'one open ask');

// 回答后收成一行，且不会被同 key 覆盖（那是决策记录）
f = answerFeed(f, ask.id, '写下一篇');
ok(openAsks(f).length === 0 && f[1].ask!.answer!.label === '写下一篇', 'answered');
f = pushFeed(f, status('✍️ 正在写《A》', { key: 'write:a' }));
ok(f.length === 3 && !!f[1].ask!.answer, 'answered card is kept');

// 没有下一篇：没有 next/auto，输入框改成重写
const last = stepAsk(node('a', 'A'), { total: 1, written: 1 });
ok(!last.ask!.options.some(o => o.id === 'next' || o.id === 'auto') && last.ask!.input!.optionId === 'rewrite', 'no next');

// closeAsks 只关同类、可按节点
f = pushFeed(f, branchAsk({ ...node('x', 'X', NodeStatus.NEEDS_REVIEW), pendingDecision: { nodeId: 'x', context: '岔路', options: [] } }));
f = pushFeed(f, branchAsk({ ...node('y', 'Y', NodeStatus.NEEDS_REVIEW), pendingDecision: { nodeId: 'y', context: '自动探索多次失败', options: [] } }));
ok(openAsks(f).length === 2, 'two branch asks');
f = closeAsks(f, 'branch', '已处理', 'x');
ok(openAsks(f).length === 1 && openAsks(f)[0].nodeId === 'y', 'close by node');
ok(openAsks(f)[0].ask!.options.some(o => o.id === 'retry'), 'failure branch offers retry');
f = closeAsks(f, 'step');
ok(openAsks(f).length === 1, 'close other type is no-op');

// 框架卡：只列保留的条目
const outline: Outline = { id: 'o1', goal: 'g', createdAt: 0, status: 'draft', items: [
  { id: '1', title: '一', question: 'q1', state: 'keep' }, { id: '2', title: '二', question: 'q2', state: 'drop' }, { id: '3', title: '三', question: 'q3', state: 'keep' },
] };
const oa = outlineAsk(outline);
ok(oa.list!.length === 2 && oa.ref === 'o1' && oa.text.includes('2 篇'), 'outline ask lists kept items');

// 上限
let big: FeedItem[] | undefined;
for (let i = 0; i < FEED_LIMIT + 30; i++) big = pushFeed(big, status('s' + i));
ok(big!.length === FEED_LIMIT && big![big!.length - 1].text === 's' + (FEED_LIMIT + 29), 'capped');

// 连写一轮：一行进度原地更新，结束一张汇总卡
const b: Batch = { id: 'b1', target: 5, done: [], newDirs: 0 };
let bf = pushFeed(undefined, batchProgress(b, '甲'));
b.done.push({ id: 'n1', title: '甲' });
bf = pushFeed(bf, batchProgress(b));
b.done.push({ id: 'n2', title: '乙', flag: '🟡' });
bf = pushFeed(bf, batchProgress(b, '丙'));
ok(bf.length === 1 && bf[0].text.includes('3/5') && bf[0].text.includes('丙'), 'batch progress stays one line');
bf = pushFeed(bf, batchAsk(b, 'stopped', 7));
ok(bf.length === 1 && bf[0].ask?.type === 'batch' && bf[0].list?.length === 2, 'batch summary replaces progress');
ok(bf[0].ask!.options[0].id === 'more' && bf[0].ask!.options[0].label.includes('5'), 'offers another round');
const empty = batchAsk({ ...b, done: [] }, 'empty', 0);
ok(empty.ask!.options.length === 1 && empty.ask!.options[0].id === 'done', 'nothing left: only ok');
ok(BATCH_SIZE === 5, 'batch size');

console.log(`agent-feed: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
