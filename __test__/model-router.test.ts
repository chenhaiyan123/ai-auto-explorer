import { pickModel, modelStrength, usableModel, routePreview, asTask, currentTask, setModelRouter, routeModel } from '../services/modelRouter';
import type { SharedModel } from '../services/sharedModelsClient';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const M = (id: string, label: string, provider: string, model: string, price: number, extra: Partial<SharedModel> = {}): SharedModel =>
  ({ id, label, provider, baseUrl: 'https://x', model, hasKey: true, enabled: true, dailyTokens: 5e6, maxOutputTokens: 4096, usedToday: 0, priceCentsPerM: price, ...extra });
const ds = M('economy', 'DeepSeek', 'openai-compatible', 'deepseek-chat', 800);
const kimi = M('kimi', 'Kimi', 'openai-compatible', 'kimi-k2-turbo', 2000);
const claude = M('claude', 'Claude', 'anthropic', 'claude-sonnet-4-5', 9000);
const gpt = M('gpt', 'GPT', 'openai', 'gpt-6', 12000);
const qwen = M('qwen', '通义千问', 'openai-compatible', 'qwen-plus', 400);

ok(modelStrength(ds) === 1 && modelStrength(qwen) === 1 && modelStrength(kimi) === 2 && modelStrength(claude) === 3 && modelStrength(gpt) === 3, '认模型强弱');
ok(!usableModel(M('a', 'a', 'x', 'm', 0), undefined, 10000), '没钱包价也没额度：用不了');
ok(usableModel(M('a', 'a', 'x', 'm', 0), { granted: 0, available: 1e6, spent: 0, held: 0 }, 0), '有送的额度：能用');
ok(!usableModel(ds, undefined, 50), '钱包不到 ¥1：用不了');
ok(!usableModel({ ...ds, enabled: false }, undefined, 10000) && !usableModel({ ...ds, usedToday: 5e6 }, undefined, 10000), '暂停 / 今日用完：用不了');

const base = { models: [ds, kimi, claude, gpt, qwen], balances: {}, walletCents: 10000, defaultId: 'economy' };
ok(pickModel('simple', base)?.modelId === 'qwen', '均衡：简单的活用最便宜的');
ok(pickModel('normal', base)?.modelId === 'economy', '均衡：一般的活用默认模型');
ok(pickModel('hard', base)?.modelId === 'claude', '均衡：难的活用最强里最便宜的');
ok(pickModel('hard', { ...base, policy: 'save' })?.modelId === 'kimi', '省钱：难的活只升级到较强');
ok(pickModel('normal', { ...base, policy: 'save' })?.modelId === 'qwen', '省钱：一般的活也用最便宜的');
ok(pickModel('normal', { ...base, policy: 'best' })?.modelId === 'claude' && pickModel('simple', { ...base, policy: 'best' })?.modelId === 'economy', '效果优先');
ok(pickModel('hard', { ...base, models: [ds, kimi, qwen] })?.modelId === 'kimi', '没开放 Claude / GPT：难的活用现有最强');
ok(pickModel('hard', { ...base, models: [ds, kimi, claude], walletCents: 0 }) === undefined, '钱包没钱、没额度：不换（用默认）');
ok(pickModel('hard', { ...base, models: [ds, { ...claude, usedToday: 5e6 }] })?.modelId === 'economy', '强模型今天用完了：退回能用的');
ok(routePreview(base).map(x => x.route?.modelId).join() === 'qwen,economy,claude', '界面预览');

// 难度范围 + 路由器
setModelRouter(t => pickModel(t, base));
(async () => {
  ok(currentTask() === 'normal', '默认一般');
  const inner = await asTask('hard', async () => { await new Promise(r => setTimeout(r, 5)); return routeModel()?.modelId; });
  ok(inner === 'claude' && currentTask() === 'normal', 'asTask 范围内按难的活挑，结束后恢复');
  setModelRouter(() => { throw new Error('boom'); });
  ok(routeModel('hard') === undefined, '路由出错不影响干活');
  console.log(`model-router: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
