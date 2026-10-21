import type { KeyInfo, KeyInfoTopic, ProjectBrief } from '../types';

/**
 * 关键信息 —— AI 项目经理**主动**问用户、并记进 AI 记忆的那几件事：
 * 需要用户给的支持、资源、权限、预算，以及只有用户知道的前提（目标人群、手上有什么数据……）。
 *
 * 和事实看板里的「已核验事实」不是一回事：
 * 事实是关于世界的，要证据；这里是**用户亲口交代的**——关于他自己的约束和意愿，
 * 他说了就算，AI 不能拿推理去覆盖，也不该再问一遍。
 *
 * 纯函数，方便单测。
 */

export const TOPIC_LABEL: Record<KeyInfoTopic, string> = {
  goal: '目标', support: '需要你', resources: '资源', permissions: '权限', budget: '预算', other: '其他',
};
const TOPICS = Object.keys(TOPIC_LABEL) as KeyInfoTopic[];

/** 同一个问题隔多久可以再问（「以后再说」之后） */
export const REASK_AFTER = 24 * 3600_000;
/** 一个项目最多挂着几个没问的问题——再多就是在审问用户了 */
export const MAX_PENDING = 5;

const norm = (s: string) => s.replace(/[\s，。？?！!、：:；;“”"'（）()]/g, '').toLowerCase();
const clip = (s: unknown, n: number) => { const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''; return t.length > n ? t.slice(0, n) + '…' : t; };
let seq = 0;
const kid = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 把「需要你：确认目标人群」这类陈述变成一个能直接回答的问题 */
export const asQuestion = (s: string) => {
  const t = clip(s, 80).replace(/[。.]$/, '');
  if (!t) return '';
  if (/[？?]$/.test(t)) return t;
  if (/^(确认|提供|告诉|说明|决定|给出|选择|明确)/.test(t)) return `能${t}吗？`;
  return `${t}——你这边是什么情况？`;
};

/** 简报里该问用户的：优先模型专门写的 asks，没有就从「需要你 / 资源 / 权限」里转 */
export function questionsFromBrief(b: ProjectBrief | undefined): { topic: KeyInfoTopic; question: string }[] {
  if (!b) return [];
  const out: { topic: KeyInfoTopic; question: string }[] = [];
  const add = (topic: KeyInfoTopic, q: string) => { const question = asQuestion(q); if (question && !out.some(o => norm(o.question) === norm(question))) out.push({ topic, question }); };
  if (b.asks?.length) b.asks.forEach(a => add(a.topic, a.question));
  else {
    b.support.forEach(s => add('support', s));
    // 资源和权限里只有「要用户给」的才问；「联网搜索」这类 AI 自己能做的不问
    b.resources.filter(r => /你|您|贵|内部|自有|已有|名单|账号|数据/.test(r)).forEach(r => add('resources', `提供${r.replace(/^提供/, '')}`));
  }
  return out.slice(0, 3);
}

/** 解析模型给的 asks（拼在简报里） */
export const parseAsks = (raw: unknown): { topic: KeyInfoTopic; question: string }[] =>
  (Array.isArray(raw) ? raw : [])
    .map((a: any) => ({ topic: (TOPICS.includes(a?.topic) ? a.topic : 'other') as KeyInfoTopic, question: clip(a?.question ?? a?.q, 80) }))
    .filter(a => a.question)
    .slice(0, 3);

/** 加入待问队列：和已答 / 已挂着的重复就不加；挂太多就不加 */
export function addPending(list: KeyInfo[] | undefined, qs: { topic: KeyInfoTopic; question: string }[], source: KeyInfo['source'], now = Date.now()): KeyInfo[] {
  const cur = (list || []).slice();
  for (const q of qs) {
    if (cur.some(k => norm(k.question) === norm(q.question))) continue;
    if (cur.filter(k => k.status === 'pending').length >= MAX_PENDING) break;
    cur.push({ id: kid(), topic: q.topic, question: q.question, answer: '', status: 'pending', source, at: now });
  }
  return cur;
}

/** 下一个该问的（没问过的优先；「以后再说」过的隔一天再问） */
export const nextPending = (list: KeyInfo[] | undefined, now = Date.now()): KeyInfo | undefined =>
  (list || []).filter(k => k.status === 'pending' && (!k.askedAt || now - k.askedAt >= REASK_AFTER))
    .sort((a, b) => (a.askedAt || 0) - (b.askedAt || 0) || a.at - b.at)[0];

export const pendingCount = (list: KeyInfo[] | undefined) => (list || []).filter(k => k.status === 'pending').length;

export const markAsked = (list: KeyInfo[] | undefined, id: string, now = Date.now()): KeyInfo[] =>
  (list || []).map(k => (k.id === id ? { ...k, askedAt: now } : k));

export const answerInfo = (list: KeyInfo[] | undefined, id: string, answer: string, now = Date.now()): KeyInfo[] =>
  (list || []).map(k => (k.id === id ? { ...k, answer: clip(answer, 300), status: 'answered' as const, answeredAt: now } : k));

/** 「不确定，你先按常理假设」：不再问，AI 自己假设，但要在记忆里标明是假设 */
export const skipInfo = (list: KeyInfo[] | undefined, id: string, now = Date.now()): KeyInfo[] =>
  (list || []).map(k => (k.id === id ? { ...k, status: 'skipped' as const, answeredAt: now } : k));

/** 直接记一条（比如花钱权限、用户在别处说的） */
export function remember(list: KeyInfo[] | undefined, topic: KeyInfoTopic, question: string, answer: string, source: KeyInfo['source'], now = Date.now()): KeyInfo[] {
  // 用户自己补的每条都留着；AI 问来的同一个问题只留最新的答案
  const cur = source === 'user' ? (list || []).slice() : (list || []).filter(k => !(k.topic === topic && norm(k.question) === norm(question)));
  return [...cur, { id: kid(), topic, question, answer: clip(answer, 300), status: 'answered', source, at: now, answeredAt: now }];
}

export const forget = (list: KeyInfo[] | undefined, id: string): KeyInfo[] => (list || []).filter(k => k.id !== id);

/**
 * 放进提示词的那一段。每次写笔记、团队对话、醒来看一眼都带上，
 * 这样 AI 不会再问已经问过的，也不会拿推理去顶替用户的原话。
 */
export function keyInfoContext(list: KeyInfo[] | undefined, max = 1500): string {
  const answered = (list || []).filter(k => k.status === 'answered');
  const skipped = (list || []).filter(k => k.status === 'skipped');
  const pending = (list || []).filter(k => k.status === 'pending');
  if (!answered.length && !skipped.length && !pending.length) return '';
  const lines: string[] = ['用户亲口交代过的关键信息（以用户原话为准，不要再问这些，也不要用推理覆盖）：'];
  for (const k of answered) lines.push(`- [${TOPIC_LABEL[k.topic]}] ${k.question} → ${k.answer}`);
  if (skipped.length) lines.push(`用户表示不确定、让你按常理假设的（写的时候要明说是假设）：${skipped.map(k => k.question).join('；')}`);
  if (pending.length) lines.push(`还在等用户回答的（不要当成已知）：${pending.map(k => k.question).join('；')}`);
  const s = lines.join('\n');
  return s.length > max ? s.slice(0, max) + '…' : s;
}
