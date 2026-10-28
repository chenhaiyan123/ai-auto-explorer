import { NodeStatus, type Project } from '../types';

/**
 * AI 项目经理简介：这个项目的 AI 在探索里攒下了什么本事、能接什么活、需要什么。
 * - AI 随着项目推进自己起草 / 更新（每多做完几步就更新一次），先存成草稿；
 * - 用户点「确认发布」后，才用这个项目的 AI 授权挂到服务广场（全站可见），别人下单后由这个 AI 接单交付，收入进项目钱包；
 * - 只写做过的事能撑住的本事，不吹。
 */
export interface PmProfile {
  title: string;
  summary: string;
  /** 能接的活 */
  canDo: string[];
  /** 攒下来的技能 / 数据 / 和别的 AI 不一样的地方 */
  edge: string[];
  /** 它需要什么（找人帮、要数据、要设备…） */
  needs: string[];
  priceYuan: number;
  deliveryDays: number;
  /** 生成时项目已做完几步 */
  basis: number;
  updatedAt: number;
}
export interface PmProfileState {
  draft?: PmProfile;
  published?: PmProfile;
  serviceId?: string;
  serviceRevision?: number;
  publishedAt?: number;
  /** 用户暂时不想挂出去 */
  hidden?: boolean;
}

const DAY = 86400000;
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const strip = (s: string | undefined, n: number) => clip((s || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*|`/g, ''), n);

export const solvedCount = (p: Project) => (p.nodes || []).filter(n => n.status === NodeStatus.SOLVED && n.noteType !== 'simulation').length;
export const latestProfile = (p: Project): PmProfile | undefined => p.pmProfile?.draft || p.pmProfile?.published;

/** 什么时候该（重新）写简介：做完 ≥3 步还没有；或者比上一版又多做完 ≥3 步、且隔了一天以上 */
export function profileDue(p: Project, now = Date.now()): boolean {
  const solved = solvedCount(p);
  const last = latestProfile(p);
  if (!last) return solved >= 3;
  return solved - last.basis >= 3 && now - last.updatedAt >= DAY;
}

export function buildProfileMessages(p: Project) {
  const solved = (p.nodes || []).filter(n => n.status === NodeStatus.SOLVED && n.noteType !== 'simulation').slice(-12);
  const reality = (p.realityChecks || []).filter(c => c.summary || c.count || c.leads).slice(-5);
  const digest = (p.digests || []).slice(0, 2);
  const last = latestProfile(p);
  return [
    { role: 'system', content: '你是这个项目的 AI 项目经理，要给自己写一份挂在服务广场上的简介：别人看了知道你能接什么活、凭什么找你、你需要什么。只写做过的事撑得住的本事，不夸大、不承诺做不到的（不能到现场、不能打电话、不能签字盖章、不能提供你没有的数据）。只返回 JSON。' },
    { role: 'user', content: `项目：${clip(p.name, 60)}
目标：${clip(p.metaProblem, 300)}
做完的步骤和结论：
${solved.map((n, i) => `${i + 1}. ${clip(n.title, 80)}：${strip(n.fullNote || n.notes || n.manualResults, 200)}`).join('\n') || '（还没有）'}
${reality.length ? `\n在现实里验证过：\n${reality.map(c => `- ${c.kind === 'survey' ? '问卷' : c.kind === 'page' ? '预售页' : '企业查询'}「${clip(c.title, 40)}」${c.count ? ` ${c.count} 份答卷` : ''}${c.leads ? ` ${c.leads} 个留资` : ''}${c.summary ? `：${clip(c.summary, 120)}` : ''}`).join('\n')}\n` : ''}${digest.length ? `\n最近的心得：${digest.flatMap(d => d.insights).slice(0, 4).map(s => clip(s, 80)).join('；')}\n` : ''}${last ? `\n上一版简介：${clip(last.summary, 200)}；能接：${last.canDo.join('、')}\n（在它基础上更新，新攒的本事加进去）\n` : ''}
返回 JSON：
{"title":"服务名（≤24字，说清楚领域和活儿，如「宠物食品市场调研 · AI 项目经理」）","summary":"两三句话：我在这个领域做过什么、能帮你干什么","canDo":["能接的活，具体到交付物，3-5条"],"edge":["攒下的独特东西：做过的调研、整理过的数据、验证过的结论、熟悉的渠道…2-4条"],"needs":["我需要什么：要找谁帮、缺什么数据、想合作什么，1-3条"],"priceYuan":起步价数字,"deliveryDays":1-7}` },
  ];
}

export function parseProfile(text: string, basis: number, now = Date.now()): PmProfile | null {
  let r: any;
  try { r = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
  const list = (v: unknown, n: number, k: number) => (Array.isArray(v) ? v : []).map(x => clip(x, k)).filter(Boolean).slice(0, n);
  const title = clip(r?.title, 40), summary = clip(r?.summary, 400), canDo = list(r?.canDo, 5, 80);
  if (title.length < 4 || summary.length < 10 || !canDo.length) return null;
  const price = Math.round(Number(r?.priceYuan));
  const days = Math.round(Number(r?.deliveryDays));
  return { title, summary, canDo, edge: list(r?.edge, 4, 100), needs: list(r?.needs, 3, 80),
    priceYuan: Number.isFinite(price) && price >= 1 && price <= 5000 ? price : 50, deliveryDays: days >= 1 && days <= 14 ? days : 3, basis, updatedAt: now };
}

/** 接单时给 AI 看的「我擅长什么」 */
export function profileSkills(p: Project): string {
  const pr = latestProfile(p);
  const base = `${p.name}：${clip(p.metaProblem, 200)}`;
  return pr ? `${base}\n我能接：${pr.canDo.join('；')}\n我攒下的：${pr.edge.join('；')}` : base;
}

/** 简介 → 服务广场上架的服务（由这个项目的 AI 授权发布：别人下单后这个 AI 接单交付，收入进项目钱包） */
export function profileToListing(pr: PmProfile, st: PmProfileState | undefined, providerName: string) {
  return {
    ...(st?.serviceId ? { id: st.serviceId, revision: st.serviceRevision } : { revision: 0 }),
    title: pr.title, providerName: clip(providerName, 80), category: 'compute',
    description: `${pr.summary}\n\n【我攒下的】\n${pr.edge.map(s => `· ${s}`).join('\n') || '· 还在积累'}\n\n【我需要】\n${pr.needs.map(s => `· ${s}`).join('\n') || '· 暂无'}\n\n这是一个 AI 项目经理：纯 AI 完成，不能到现场、打电话、签字盖章。`,
    inputs: '说清楚你要什么、给我什么资料（链接、文件、背景）、截止时间',
    deliverables: pr.canDo.map(s => `· ${s}`).join('\n'),
    limits: '只做 AI 能做的资料调研、整理、分析、写作；结论会标出处和不确定的地方；不提供真人现场服务',
    location: '线上', unit: '次', priceCents: pr.priceYuan * 100, deliveryDays: pr.deliveryDays,
    availability: 'always', automation: 'automatic', published: true, confirmed: true,
  };
}
