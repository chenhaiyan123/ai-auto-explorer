import type { InquiryFact } from './inquiry';
import type { ServiceListing } from './serviceMarket';

/**
 * 事实看板 → 服务广场。
 *
 * 一条「待验证 / 有争议」的事实，自己的 AI 团队往往只能给出「证据不足」——
 * 因为它要的是现实里的数据、实验、测量，而不是更多推理。
 * 这时候就去服务广场找能做这件事的人或 Agent；找不到，就把它发布成需求。
 *
 * 纯函数，方便单测。
 */

export interface HelpSeek {
  factId: string;
  claim: string;
  scope: string;
  source: string;
  /** 这条事实属于哪个问题（项目核心问题或某篇文章） */
  question: string;
  projectId?: string;
}

export const seekFromFact = (fact: InquiryFact, question: string, projectId?: string): HelpSeek => ({
  factId: fact.id, claim: fact.claim, scope: fact.scope, source: fact.source, question, projectId,
});

/** 只有还没定论的事实才需要外援 */
export const needsOutsideHelp = (fact: InquiryFact) => fact.status === 'pending' || fact.status === 'disputed';

/** AI 团队最近一次判断是不是「证据不足」——是的话提示得更明显一些 */
export const aiCouldNotVerify = (fact: InquiryFact) => {
  const ai = fact.reviews.filter(r => r.actor !== 'human');
  return ai.length > 0 && ai[ai.length - 1].decision === 'uncertain';
};

// 中文没有空格分词：用「二字片段 + 英文单词」做粗匹配，够用来挑出相关的服务
const grams = (text: string): Set<string> => {
  const s = (text || '').toLowerCase();
  const out = new Set<string>();
  for (const w of s.match(/[a-z0-9]{2,}/g) || []) out.add(w);
  const han = s.replace(/[^一-鿿]+/g, ' ');
  for (const seg of han.split(' ')) for (let i = 0; i + 1 < seg.length; i++) out.add(seg.slice(i, i + 2));
  return out;
};

// 太常见、不说明能力的片段不计分
const STOP = new Set(['验证', '是否', '可以', '进行', '一个', '这个', '需要', '提供', '服务', '我们', '以及', '相关', '通过', '能够', '没有', '数据']);

/** 按和这条事实的相关度给已发布的服务排序，只返回有交集的（最多 n 个） */
export const matchServices = (services: ServiceListing[], seek: HelpSeek, n = 5): ServiceListing[] => {
  const want = grams(`${seek.claim} ${seek.scope}`);
  STOP.forEach(w => want.delete(w));
  if (!want.size) return [];
  return services
    .filter(s => s.published && !s.mine)
    .map(s => {
      const have = grams(`${s.title} ${s.description} ${s.inputs} ${s.deliverables} ${s.category}`);
      let score = 0;
      want.forEach(g => { if (have.has(g)) score += g.length > 2 ? 2 : 1; });
      return { s, score };
    })
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.s);
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 找不到服务时，帮用户把需求先填好（发布前用户仍要自己确认、补预算和截止时间） */
export const demandDraftFromSeek = (seek: HelpSeek) => ({
  title: clip(`验证：${seek.claim.replace(/\s+/g, ' ').trim()}`, 100),
  requirements: [
    '需要独立核验下面这条判断（目前没有可靠证据，AI 推理无法给出结论）：',
    `判断：${seek.claim.trim()}`,
    seek.scope ? `适用范围：${seek.scope.trim()}` : '',
    seek.source ? `目前的线索 / 来源：${seek.source.trim()}` : '',
    seek.question ? `背景问题：${seek.question.trim()}` : '',
  ].filter(Boolean).join('\n').slice(0, 5000),
  acceptance: '给出可核对的证据：原始数据、实验或测量记录、文献出处（含链接或页码）及适用条件；并明确结论是「支持 / 反对 / 无法判断」，说明理由。',
});
