import { platformRequest } from './realityActions';

/**
 * 学术文献检索（OpenAlex，免费）：做研究型步骤前先找几篇真论文塞进提示词，
 * 要求 AI 只引用这些（带 DOI），减少编造文献。检索词由便宜模型把问题翻成英文关键词（OpenAlex 英文覆盖最好）。
 */
export interface Paper { title: string; year: number | null; venue: string; authors: string[]; doi: string | null; url: string; cited: number; abstract: string }
type LLM = (messages: { role: string; content: string }[]) => Promise<string>;

const queryCache = new Map<string, string>();
const paperCache = new Map<string, Paper[]>();

export async function englishQuery(text: string, llm: LLM): Promise<string> {
  const key = text.slice(0, 200);
  if (queryCache.has(key)) return queryCache.get(key)!;
  let q = '';
  try {
    q = (await llm([{ role: 'user', content: `把下面这个研究问题改写成用于学术文献检索的英文关键词（3-8 个词，只输出关键词本身，不要解释、不要引号）：\n${key}` }])).replace(/["'\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  } catch { /* 翻不了就用原文 */ }
  if (!q || q.length < 3) q = key;
  queryCache.set(key, q);
  return q;
}

export async function searchPapers(q: string, n = 6): Promise<Paper[]> {
  const k = `${q}|${n}`;
  if (paperCache.has(k)) return paperCache.get(k)!;
  const r = await platformRequest<{ results: Paper[] }>(`/papers?q=${encodeURIComponent(q)}&n=${n}`);
  const list = (r.results || []).filter(p => p.title);
  paperCache.set(k, list);
  if (paperCache.size > 200) paperCache.clear();
  return list;
}

export function paperContext(papers: Paper[]): string {
  if (!papers.length) return '';
  return `【可引用的真实文献（来自 OpenAlex 检索）】引用文献时只能用下面这些，写明作者、年份和 DOI；下面没有的，不要编造论文名或 DOI，写「待查文献」：\n${papers.map((p, i) => `${i + 1}. ${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' 等' : ''}（${p.year || '年份不详'}）《${p.title}》${p.venue ? `，${p.venue}` : ''}${p.doi ? `，DOI: ${p.doi}` : ''}；被引 ${p.cited}${p.abstract ? `\n   摘要：${p.abstract.slice(0, 300)}` : ''}`).join('\n')}`;
}

/** 做一步之前：按「项目目标 + 这一步」找几篇真论文，返回可塞进提示词的文字；任何一步失败都返回空串，不影响干活 */
export async function paperNoteFor(goal: string, stepTitle: string, llm: LLM, n = 6): Promise<string> {
  try {
    const q = await englishQuery(`${stepTitle}（项目：${goal}）`, llm);
    return paperContext(await searchPapers(q, n));
  } catch { return ''; }
}
