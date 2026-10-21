import type { ProjectBrief, ProjectCharter, OutlineItem } from '../types';
import { parseAsks } from './keyInfo';

/**
 * 项目简报 —— 开工前先像一个人那样跟用户把事说清楚：
 * 怎么拆、大概怎么做、难在哪、需要你给什么支持 / 资源 / 权限、大概花多少钱；
 * 并且实话实说：短期能做到哪一步，长期要靠积累和迭代。
 *
 * 用户回了话（尤其是「多少钱以内 AI 可以自己下单」）之后，才开始往下写。
 * 纯函数，方便单测。
 */

const MAX_LINE = 60;
const MAX_ITEMS = 3;

const clean = (s: unknown, n = MAX_LINE): string => {
  if (typeof s !== 'string') return '';
  const t = s.replace(/^#{1,6}\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*•]\s*|\d{1,2}[.、)]\s*)/gm, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const lines = (v: unknown): string[] => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n；;]/) : [];
  const out: string[] = [];
  for (const x of arr) { const t = clean(x); if (t && !out.includes(t)) out.push(t); if (out.length >= MAX_ITEMS) break; }
  return out;
};

/** 模型给的 brief → 规整后的简报。字段太少（说明模型没认真给）就返回 undefined，退回只有目录的老卡片。 */
export function parseBrief(raw: any): ProjectBrief | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b: ProjectBrief = {
    approach: clean(raw.approach, 120),
    hard: lines(raw.hard ?? raw.difficulties),
    support: lines(raw.support),
    resources: lines(raw.resources),
    permissions: lines(raw.permissions),
    budget: clean(raw.budget, 80),
    shortTerm: clean(raw.shortTerm ?? raw.short, 80),
    longTerm: clean(raw.longTerm ?? raw.long, 80),
  };
  const asks = parseAsks(raw.asks);
  if (asks.length) b.asks = asks;
  const filled = [b.approach, b.hard.length, b.support.length || b.resources.length || b.permissions.length, b.shortTerm || b.longTerm].filter(Boolean).length;
  return filled >= 3 ? b : undefined;
}

/** 给模型的那段要求（拼在拟目录的提示词里，一次调用拿到目录 + 简报，省 token） */
export const BRIEF_PROMPT = `同时给一份**项目简报**，放在 "brief" 字段里。读的人是项目的主人，他不想看长文，只想知道：
- approach：大概怎么做，一两句话（不超过 60 字）
- hard：最难的 1-3 个地方
- support：需要他本人做的事或拍的板，1-3 条（比如「确认目标用户是谁」「提供过去一年的续费数据」）
- resources：需要的资源，1-3 条（数据、人、设备、外部服务）
- permissions：需要他授权你去做的事，1-3 条（比如「联网搜索」「在服务广场找人做访谈」「发布需求」）
- budget：大概要花多少，给量级（模型调用费 + 可能要买的外部服务），不确定就说不确定
- shortTerm：短期（这一两周）实际能做到哪一步——实话实说，做不成就说做不成
- longTerm：长期靠不断积累、迭代能走到哪里——让他知道短期做不到不要紧
- asks：开工前要问他的 1-3 个问题，只问**只有他知道、又会改变怎么做**的事（他手上有什么数据和资源、目标人群、能接受的范围……），每个问题一句话、能直接回答；topic 取 goal / support / resources / permissions / other（预算会单独问，这里不要问）
每一条都要具体到这个项目，不要写谁的项目都能套的话。`;

/** 简报 → 对话卡里的分栏（目录也作为「怎么拆」放进去） */
export function briefSections(b: ProjectBrief, items: Pick<OutlineItem, 'title' | 'question'>[]): { label: string; items: string[] }[] {
  const s: { label: string; items: string[] }[] = [];
  if (b.approach) s.push({ label: '大概思路', items: [b.approach] });
  if (items.length) s.push({ label: `怎么拆（${items.length} 篇）`, items: items.map(i => `${i.title}${i.question ? ' —— ' + i.question : ''}`) });
  if (b.hard.length) s.push({ label: '难点', items: b.hard });
  if (b.support.length) s.push({ label: '需要你', items: b.support });
  if (b.resources.length) s.push({ label: '需要的资源', items: b.resources });
  if (b.permissions.length) s.push({ label: '需要你授权', items: b.permissions });
  if (b.budget) s.push({ label: '预算', items: [b.budget] });
  return s;
}

export const briefFoot = (b: ProjectBrief) =>
  [b.shortTerm && `短期：${b.shortTerm}`, b.longTerm && `长期：${b.longTerm}`].filter(Boolean).join('\n') || undefined;

/** 写进项目总览，方便以后回看「当初是怎么说的」 */
export function briefMarkdown(b: ProjectBrief, charter?: ProjectCharter): string {
  const sec = (h: string, xs: string[]) => (xs.length ? `**${h}**\n${xs.map(x => `- ${x}`).join('\n')}\n` : '');
  return [
    '## 🧭 项目简报',
    b.approach ? `**大概思路**：${b.approach}\n` : '',
    sec('难点', b.hard), sec('需要你', b.support), sec('需要的资源', b.resources), sec('需要授权', b.permissions),
    b.budget ? `**预算**：${b.budget}\n` : '',
    b.shortTerm ? `**短期**：${b.shortTerm}` : '', b.longTerm ? `**长期**：${b.longTerm}` : '',
    charter ? `\n**花钱权限**：${charterLabel(charter)}` : '',
  ].filter(Boolean).join('\n');
}

// ===== 花钱权限 =====

export const CHARTER_PRESETS = [0, 50, 200] as const;

export const charterLabel = (c: Pick<ProjectCharter, 'autoBuyCNY' | 'monthlyCNY'>) =>
  (c.autoBuyCNY > 0 ? `单笔 ≤ ¥${c.autoBuyCNY} 的服务 AI 可以自己下单，更贵的先问你` : '花钱都先问你')
  + (c.monthlyCNY ? `；每月最多 ¥${c.monthlyCNY}` : '');

/**
 * 从一句话里读出花钱权限，比如「每月 300，单笔不超过 100」「50 以内自己买」「都先问我」。
 * 读不出数字就当 0（先问）——宁可多问一次，也不替人花钱。
 */
export function charterFromText(text: string, now = Date.now()): ProjectCharter {
  const t = (text || '').replace(/[,，]/g, ' ');
  const num = (re: RegExp) => { const m = t.match(re); return m ? Math.min(100000, Math.max(0, Math.round(Number(m[1])))) : undefined; };
  const monthly = num(/(?:每月|一个月|月)[^0-9]{0,6}(\d+(?:\.\d+)?)/) ?? num(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*\/\s*月/);
  let single = num(/(?:单笔|每笔|一笔|每单|单次)[^0-9]{0,6}(\d+(?:\.\d+)?)/);
  if (single === undefined) {
    // 只说了一个数、又不是每月 → 当单笔上限
    const all = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
    if (all.length === 1 && monthly === undefined) single = Math.min(100000, Math.round(all[0]));
  }
  if (/先问|都问|不要花|别花|不花钱/.test(t) && single === undefined) single = 0;
  const autoBuyCNY = single ?? 0;
  return { autoBuyCNY: monthly !== undefined ? Math.min(autoBuyCNY, monthly) : autoBuyCNY, monthlyCNY: monthly || undefined, note: text.trim().slice(0, 200) || undefined, confirmedAt: now };
}

/** 一笔服务该不该先问人 */
export const mustAskBeforeBuying = (c: ProjectCharter | undefined, priceCNY: number, spentThisMonthCNY = 0) =>
  !c || priceCNY > c.autoBuyCNY || (c.monthlyCNY !== undefined && spentThisMonthCNY + priceCNY > c.monthlyCNY);
