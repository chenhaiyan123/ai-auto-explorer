import type { Project, ProblemNode } from '../types';
import { sharedRequest, SHARED_API } from './sharedModelsClient';

/**
 * 让 AI 碰到真人：卡在「要到现实里验证」的那一步时，AI 选一种最合适、最便宜的办法——
 *  - survey：发一份问卷（问卷星），收真实回答
 *  - page：做一个预售页 / 报名页，看真实点击和留资（测「会不会真的要」）
 *  - company：查企业信息（天眼查），核实竞品 / 合作方 / 供应商
 *  - market：去服务广场找人做（访谈、实验、打样……）
 * 结果回来先记成「待核实的现实证据」，再拿它重新推进这一步。
 */

export type RealityKind = 'survey' | 'page' | 'company' | 'poi' | 'stats' | 'market';
/** 世界银行常用指标（和后台 WB_INDICATORS 一致） */
export const STAT_INDICATORS: Record<string, string> = { 'SP.POP.TOTL': '总人口', 'SP.POP.0014.TO': '0–14 岁人口', 'SP.POP.1564.TO': '15–64 岁人口', 'SP.POP.65UP.TO': '65 岁及以上人口', 'SP.URB.TOTL.IN.ZS': '城镇人口占比', 'SP.DYN.TFRT.IN': '总和生育率', 'SP.DYN.CBRT.IN': '出生率', 'NY.GDP.MKTP.CD': 'GDP', 'NY.GDP.PCAP.CD': '人均 GDP', 'NY.GDP.MKTP.KD.ZG': 'GDP 增速', 'NE.CON.PRVT.CD': '居民消费', 'FP.CPI.TOTL.ZG': '通胀率', 'SL.UEM.TOTL.ZS': '失业率', 'SL.UEM.1524.ZS': '青年失业率', 'SE.TER.ENRR': '高等教育毛入学率', 'SE.PRM.ENRL': '小学在校生', 'SE.SEC.ENRL': '中学在校生', 'GB.XPD.RSDV.GD.ZS': '研发支出占 GDP', 'IT.NET.USER.ZS': '互联网普及率', 'IT.CEL.SETS.P2': '手机签约数', 'EG.ELC.RNEW.ZS': '可再生能源发电占比', 'SH.XPD.CHEX.PC.CD': '人均医疗支出' };
export interface SurveyQ { type: 'single' | 'multi' | 'text' | 'scale' | 'nps'; title: string; options?: string[] }
export type RealityAction =
  | { type: 'survey'; why: string; title: string; intro: string; questions: SurveyQ[]; target: number }
  | { type: 'page'; why: string; headline: string; sub: string; bullets: string[]; price: string; cta: string; /** 意向金（元，1–9.9；0 = 不收）：访客真付钱表示想要，7 天后全额退回 */ deposit?: number }
  | { type: 'company'; why: string; keyword: string }
  | { type: 'poi'; why: string; keyword: string; city: string; around?: string; radius?: number }
  | { type: 'stats'; why: string; indicators: string[]; country?: string }
  | { type: 'market'; why: string }
  | { type: 'none'; why: string };

/** 项目里记着的「现实验证」 */
export interface RealityCheck {
  id: string; kind: 'survey' | 'page' | 'company' | 'audio' | 'poi' | 'stats'; nodeId?: string; title: string; url?: string;
  /** 录音：转写状态和时长 */ status?: string; durationSec?: number;
  createdAt: number; target?: number;
  /** 最新数字：问卷答卷数 / 页面访客 · 点击 · 留资 */
  count?: number; visitors?: number; clicks?: number; leads?: number; /** 付了意向金的人数 */ deposits?: number; checkedAt?: number;
  /** 已经拿去推进过的数量（新增够多才再推进一次） */
  ingested?: number; closed?: boolean; summary?: string;
}

export interface PlatformCatalog { services: { id: string; label: string; ready: boolean }[]; prices: Record<string, number>; dailyCapCents: number }

export const platformRequest = <T>(path: string, method = 'GET', body?: unknown) => sharedRequest<T>(`/platform${path}`, method, body, 130000);
export const pageUrl = (path: string) => `${SHARED_API}${path}`;

/** 上传访谈 / 实验录音，后台交给百炼转文字（异步，几分钟） */
export async function uploadAudio(file: File, projectId: string, nodeId?: string): Promise<{ id: string; name: string }> {
  if (!SHARED_API) throw new Error('本地预览没有连后台，到正式网站登录后再传');
  if (file.size > 200 * 1024 * 1024) throw new Error('录音太大了：最大 200MB');
  const token = localStorage.getItem('aae-auth-token');
  if (!token) throw new Error('请先登录');
  const type = file.type || (/\.m4a$/i.test(file.name) ? 'audio/x-m4a' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : /\.wav$/i.test(file.name) ? 'audio/wav' : /\.amr$/i.test(file.name) ? 'audio/amr' : 'audio/mpeg');
  const q = new URLSearchParams({ projectId, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60), ...(nodeId ? { nodeId } : {}) });
  const r = await fetch(`${SHARED_API}/platform/audio?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: file, signal: AbortSignal.timeout(600000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `上传失败（${r.status}）`);
  return d;
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function buildActionMessages(project: Project, node: ProblemNode, ready: Record<string, boolean>, prices: Record<string, number>, force?: RealityKind) {
  const avail = [
    ready.survey && `survey：发问卷（每份问卷 ¥${((prices.survey_create || 0) / 100).toFixed(2)}，链接要发给目标人群；适合了解现状、痛点、偏好、优先级）`,
    ready.page && `page：做预售页 / 报名页（免费，挂出去看多少人点「我想要」、留联系方式；还可以开「意向金」：访客用微信付 ¥1–9.9 表示真想要，7 天后全额退回——验证「愿不愿意真掏钱」最有说服力）`,
    ready.company && `company：查企业工商信息（每次 ¥${((prices.company_info || 0) / 100).toFixed(2)}；适合核实竞品、合作方、供应商是否存在、规模和风险）`,
    ready.poi && `poi：用高德地图数门店 / 兴趣点（每次 ¥${((prices.poi_search || 0) / 100).toFixed(2)}；适合「某城市 / 某地址周边有多少家同类店、分布在哪」的选址和竞争判断）`,
    ready.stats && `stats：查宏观统计数据（世界银行公开数据，免费；可用指标：${Object.entries(STAT_INDICATORS).map(([k, v]) => `${k}=${v}`).join('，')}）`,
    'market：去服务广场找真人 / 机构做（访谈、实验、测量、检测、PCB 打样、3D 打印、寄样品、拿真实数据）',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: '你是项目的 AI 负责人。这一步需要到现实里验证。选一种最便宜、最快、最能拿到真实证据的办法，并把它设计好。只返回 JSON。' },
    { role: 'user', content: `项目目标：${clip(project.metaProblem || project.name, 300)}
这一步：${clip(node.title, 120)}
要验证的判断：${clip(node.hypothesis?.statement || node.hypothesis?.unknown || node.notes, 400)}
${node.validationReason ? `为什么要现实验证：${clip(node.validationReason, 200)}\n` : ''}
可用的办法：
${avail}
${force ? `\n用户指定用：${force}\n` : ''}
规则：问卷最多 8 题，题目具体、不诱导、选项互斥；预售页要像真的产品介绍，不夸大、不承诺做不到的事，价格写「预售价 / 意向价」；不能用的办法不要选。

返回 JSON 之一：
{"type":"survey","why":"为什么选它（≤40字）","title":"问卷标题","intro":"一句开场白","target":30,"questions":[{"type":"single|multi|text|scale|nps","title":"题目","options":["选项"]}]}
{"type":"page","why":"…","headline":"一句话卖点","sub":"两句说明","bullets":["卖点1","卖点2","卖点3"],"price":"预售价 ¥xx","cta":"我想要","deposit":意向金元数（验证付费意愿时填 1–9.9，只看兴趣填 0）}
{"type":"company","why":"…","keyword":"企业名或关键词"}
{"type":"poi","why":"…","keyword":"店的类型，如 少儿编程","city":"城市，如 深圳","around":"（选填）某个地址，查它周边","radius":3000}
{"type":"stats","why":"…","indicators":["指标代码，最多 5 个"],"country":"CHN"}
{"type":"market","why":"…"}
{"type":"none","why":"为什么现在不需要"}` },
  ];
}

export function parseAction(text: string, ready: Record<string, boolean>): RealityAction | null {
  let raw: any;
  try { raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
  const why = clip(raw?.why, 80);
  switch (raw?.type) {
    case 'survey': {
      if (!ready.survey) return null;
      const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 8).map((q: any) => ({
        type: ['single', 'multi', 'text', 'scale', 'nps'].includes(q?.type) ? q.type : 'single', title: clip(q?.title, 120),
        options: (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => clip(o, 60)).filter(Boolean).slice(0, 8),
      })).filter((q: SurveyQ) => q.title && (!['single', 'multi'].includes(q.type) || (q.options || []).length >= 2));
      const title = clip(raw.title, 60);
      return title.length >= 4 && questions.length ? { type: 'survey', why, title, intro: clip(raw.intro, 200), questions, target: Math.min(200, Math.max(10, Number(raw.target) || 30)) } : null;
    }
    case 'page': {
      if (!ready.page) return null;
      const headline = clip(raw.headline, 60);
      const dep = Math.round(Number(raw.deposit) * 10) / 10;
      return headline.length >= 4 ? { type: 'page', why, headline, sub: clip(raw.sub, 200), bullets: (Array.isArray(raw.bullets) ? raw.bullets : []).map((b: unknown) => clip(b, 80)).filter(Boolean).slice(0, 5), price: clip(raw.price, 40), cta: clip(raw.cta, 16) || '我想要', deposit: dep >= 1 && dep <= 9.9 ? dep : 0 } : null;
    }
    case 'company': { const keyword = clip(raw.keyword, 60); return ready.company && keyword.length >= 2 ? { type: 'company', why, keyword } : null; }
    case 'poi': { const keyword = clip(raw.keyword, 40), city = clip(raw.city, 30); return ready.poi && keyword.length >= 2 && city.length >= 2 ? { type: 'poi', why, keyword, city, around: clip(raw.around, 40) || undefined, radius: Math.min(50000, Math.max(500, Number(raw.radius) || 3000)) } : null; }
    case 'stats': { const indicators = (Array.isArray(raw.indicators) ? raw.indicators : []).map((c: unknown) => String(c).trim().toUpperCase()).filter((c: string) => /^[A-Z0-9.]{3,40}$/.test(c)).slice(0, 5); return ready.stats && indicators.length ? { type: 'stats', why, indicators, country: /^[A-Z]{3}$/.test(String(raw.country || '').toUpperCase()) ? String(raw.country).toUpperCase() : 'CHN' } : null; }
    case 'market': return { type: 'market', why };
    case 'none': return { type: 'none', why };
    default: return null;
  }
}

/** 这次动作要花多少钱（分） */
export const actionCost = (a: RealityAction, prices: Record<string, number>) =>
  a.type === 'survey' ? prices.survey_create || 0 : a.type === 'company' ? prices.company_info || 0 : a.type === 'poi' ? prices.poi_search || 0 : 0;

/** 什么时候把新回来的结果拿去推进：问卷新增 ≥ 10 份或到了目标数；页面新增 ≥ 20 个访客或有新留资 */
export function shouldIngest(c: RealityCheck): boolean {
  if (c.closed) return false;
  const now = c.kind === 'survey' ? c.count || 0 : (c.visitors || 0) + (c.leads || 0) * 10 + (c.deposits || 0) * 30;
  const done = c.ingested || 0;
  if (c.kind === 'audio') return (c.count || 0) > done;
  if (c.kind === 'survey') return now > done && (now - done >= 10 || (!!c.target && now >= c.target && done < c.target));
  return now - done >= 20;
}

export function buildIngestMessages(project: Project, node: ProblemNode | undefined, c: RealityCheck, raw: string) {
  return [
    { role: 'system', content: '把一份真实回收的数据总结成证据。只说数据说明了什么、样本多大、有什么偏差；不夸大、不下数据撑不起的结论。只返回 JSON。' },
    { role: 'user', content: `项目：${clip(project.metaProblem || project.name, 200)}
这一步：${clip(node?.title || c.title, 120)}
数据来源：${c.kind === 'audio' ? `访谈 / 实验录音「${c.title}」转写的原话（时长 ${Math.round((c.durationSec || 0) / 60)} 分钟；只总结受访者真实说了什么，不替他们下结论）` : c.kind === 'survey' ? `问卷「${c.title}」，有效答卷 ${c.count || 0} 份` : `预售页「${c.title}」：访客 ${c.visitors || 0}，点「我想要」${c.clicks || 0}，留联系方式 ${c.leads || 0}，付意向金 ${c.deposits || 0} 人（真掏钱的信号最强，比留资更可信）`}
原始统计：
${clip(raw, 6000)}

返回 JSON：{"claim":"一句话结论（≤60字，带数字）","detail":"三句话以内：数据说明了什么、局限在哪","supports":true/false/null}` },
  ];
}
export function parseIngest(text: string): { claim: string; detail: string; supports: boolean | null } | null {
  try { const r = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); const claim = clip(r.claim, 120); return claim ? { claim, detail: clip(r.detail, 400), supports: typeof r.supports === 'boolean' ? r.supports : null } : null; }
  catch { return null; }
}

export const addCheck = (list: RealityCheck[] | undefined, c: RealityCheck) => [...(list || []), c].slice(-50);
export const patchCheck = (list: RealityCheck[] | undefined, id: string, patch: Partial<RealityCheck>) => (list || []).map(c => (c.id === id ? { ...c, ...patch } : c));
