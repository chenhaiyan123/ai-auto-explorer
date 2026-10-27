import { createHash, randomBytes } from 'node:crypto';

/**
 * 平台直连服务：平台用自己的账号调第三方，AI 和用户按次从 AI 钱包付费。
 *  - 问卷（问卷星 OpenAPI）：AI 建问卷、拿到答题链接、回收结果
 *  - 企业信息（天眼查）：查企业、看工商登记 / 简介 / 规模 / 风险
 *  - 预售页 / 报名页（平台自建）：固定模板、只放文字，统计访问和留资——测「会不会真的要」
 *
 * 钱：先扣钱包再调用，第三方失败就退回；每人每天有上限，防止 AI 跑飞。
 * 密钥：管理员在后台填（加密存储），没填就显示「未开通」，不假装能用。
 */

const STORE = createHash('sha256').update('hiexplore-platform-services-v1').digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = () => randomBytes(9).toString('base64url');
const day = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);

/** 默认价格（分）；管理员可改 */
export const DEFAULT_PRICES = { company_search: 20, company_info: 50, survey_create: 200, page_create: 0 };
export const DAILY_CAP_CENTS = 5000;
const SERVICES = {
  survey: { label: '问卷调查（问卷星）', needs: 'wjxKey' },
  company: { label: '企业信息（天眼查）', needs: 'tycKey' },
  page: { label: '预售页 / 报名页（平台自建）', needs: null },
};
const QTYPES = { single: '单选', multi: '多选', text: '简答题', scale: '量表题', nps: 'NPS量表' };

export class PlatformServices {
  constructor(storage, billing, fetchImpl = fetch, env = {}) {
    this.storage = storage; this.billing = billing; this.fetch = fetchImpl; this.env = env; this.queue = Promise.resolve();
  }
  tx(fn, write = true) {
    const next = this.queue.catch(() => {}).then(async () => {
      const s = { version: 1, config: {}, surveys: [], pages: [], spend: {}, ...((await this.storage.credentials(STORE)) || {}) };
      const out = await fn(s);
      if (write) await this.storage.credentials(STORE, s);
      return out;
    });
    this.queue = next; return next;
  }
  keys(s) { return { wjxKey: s.config.wjxKey || this.env.WJX_API_KEY || '', tycKey: s.config.tycKey || this.env.TYC_AUTHORIZATION || '' }; }
  prices(s) { return { ...DEFAULT_PRICES, ...(s.config.prices || {}) }; }

  /** 给用户 / AI 看：哪些服务开通了、多少钱 */
  async catalog() {
    return this.tx(s => {
      const k = this.keys(s), p = this.prices(s);
      return { services: Object.entries(SERVICES).map(([sid, x]) => ({ id: sid, label: x.label, ready: !x.needs || !!k[x.needs] })), prices: p, dailyCapCents: DAILY_CAP_CENTS };
    }, false);
  }
  /** 管理员：填密钥、改价格（密钥只写不读） */
  async configure(body) {
    return this.tx(s => {
      if (typeof body.wjxKey === 'string') s.config.wjxKey = body.wjxKey.trim().slice(0, 500);
      if (typeof body.tycKey === 'string') s.config.tycKey = body.tycKey.trim().slice(0, 4000);
      if (body.prices && typeof body.prices === 'object') {
        s.config.prices = { ...(s.config.prices || {}) };
        for (const [k, v] of Object.entries(body.prices)) if (k in DEFAULT_PRICES && Number.isSafeInteger(v) && v >= 0 && v <= 100000) s.config.prices[k] = v;
      }
      const k = this.keys(s);
      return { wjx: !!k.wjxKey, tyc: !!k.tycKey, prices: this.prices(s) };
    });
  }

  /** 扣钱 → 调用 → 失败退回。ref 幂等。 */
  async charged(owner, kind, ref, note, run) {
    const cents = await this.tx(s => {
      const c = this.prices(s)[kind] || 0;
      const today = day(Date.now());
      const used = s.spend[owner]?.day === today ? s.spend[owner].cents : 0;
      if (c && used + c > DAILY_CAP_CENTS) throw fail(`今天平台服务已花 ¥${(used / 100).toFixed(2)}，到了每天 ¥${DAILY_CAP_CENTS / 100} 的上限，明天再继续`, 429);
      if (c) s.spend[owner] = { day: today, cents: used + c };
      return c;
    });
    if (cents) await this.billing.spendWallet(owner, cents, `svc-${kind}-${ref}`, note);
    try { return { ...(await run()), chargedCents: cents }; }
    catch (e) {
      if (cents) {
        await this.billing.refundWallet(owner, `svc-${kind}-${ref}`, `${note}没成功，退回`).catch(() => {});
        await this.tx(s => { if (s.spend[owner]) s.spend[owner].cents = Math.max(0, s.spend[owner].cents - cents); });
      }
      throw e;
    }
  }

  // ===== 天眼查 =====
  async tyc(tool, args) {
    const key = (await this.tx(s => this.keys(s), false)).tycKey;
    if (!key) throw fail('企业信息服务还没开通（管理员还没填天眼查密钥）', 503);
    const r = await this.fetch('https://mcp.tianyancha.com/v1/core/tools/call', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: key },
      body: JSON.stringify({ tool_name: tool, arguments: args, format: 'json' }), signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { throw fail(`天眼查返回的不是 JSON（HTTP ${r.status}）`, 502); }
    if (!r.ok) throw fail(`天眼查查询失败：${body.error_description || body.error || r.status}`, r.status === 429 ? 429 : 502);
    const c = body.content;
    if (typeof c === 'string') { try { return JSON.parse(c); } catch { return c; } }
    return c ?? body;
  }
  async companySearch(owner, input) {
    const keyword = clean(input.keyword, 60);
    if (keyword.length < 2) throw fail('请给出至少两个字的企业名称或关键词');
    return this.charged(owner, 'company_search', input.requestId || id(), `企业查询：${keyword}`, async () => ({ keyword, result: await this.tyc('search_companies', { searchKey: keyword, pageSize: 10 }) }));
  }
  async companyInfo(owner, input) {
    const name = clean(input.name, 80);
    if (name.length < 2) throw fail('请给出企业全称或统一社会信用代码');
    return this.charged(owner, 'company_info', input.requestId || id(), `企业信息：${name}`, async () => {
      const [registration, profile, scale, risk] = await Promise.allSettled([
        this.tyc('get_company_registration_info', { searchKey: name }), this.tyc('get_company_profile', { searchKey: name }),
        this.tyc('get_company_scale', { searchKey: name }), this.tyc('get_risk_overview', { searchKey: name })]);
      const v = x => (x.status === 'fulfilled' ? x.value : null);
      if (registration.status === 'rejected') throw registration.reason;
      return { name, registration: v(registration), profile: v(profile), scale: v(scale), risk: v(risk) };
    });
  }

  // ===== 问卷星 =====
  async wjx(action, params, timeoutMs = 60000) {
    const key = (await this.tx(s => this.keys(s), false)).wjxKey;
    if (!key) throw fail('问卷服务还没开通（管理员还没填问卷星密钥）', 503);
    const r = await this.fetch(`https://www.wjx.cn/openapi/default.aspx?traceid=${id()}&action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-WJX-Client': 'hiexplore' },
      body: JSON.stringify({ action, ...params }), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    if (!r.ok) throw fail(`问卷星请求失败 HTTP ${r.status}`, 502);
    const body = await r.json().catch(() => null);
    if (!body || typeof body.result !== 'boolean') throw fail('问卷星返回格式不对', 502);
    if (!body.result) throw fail(`问卷星：${body.errormsg || '操作失败'}`, 502);
    return body.data;
  }
  /** 只接受结构化题目（AI 生成），在这里拼成问卷星的 JSONL；10 题以内，强制带一道注意力检测题 */
  static surveyJsonl(title, intro, questions) {
    const rows = [{ qtype: '问卷基础信息', title, introduction: intro || '本问卷用于产品调研，约 3 分钟，答案只用于统计。', atype: 1 }];
    for (const q of questions) {
      const qtype = QTYPES[q.type] || '单选';
      const row = { qtype, title: q.title, requir: q.type !== 'text' };
      if (['single', 'multi'].includes(q.type)) row.select = q.options;
      if (q.type === 'scale') Object.assign(row, { select: ['1', '2', '3', '4', '5'], minvaluetext: q.options?.[0] || '很不同意', maxvaluetext: q.options?.[1] || '非常同意' });
      rows.push(row);
    }
    const mid = Math.min(rows.length, 3);
    rows.splice(mid, 0, { qtype: '单选', title: '这一题用来确认你在认真作答，请选「我在认真作答」', select: ['随便选的', '我在认真作答', '不清楚'], requir: true });
    return rows.map(r => JSON.stringify(r)).join('\n');
  }
  static validQuestions(raw) {
    const list = (Array.isArray(raw) ? raw : []).slice(0, 10).map(q => ({
      type: Object.keys(QTYPES).includes(q?.type) ? q.type : 'single',
      title: clean(q?.title, 120),
      options: (Array.isArray(q?.options) ? q.options : []).map(o => clean(o, 60)).filter(Boolean).slice(0, 8),
    })).filter(q => q.title && (!['single', 'multi'].includes(q.type) || q.options.length >= 2));
    if (!list.length) throw fail('问卷至少要有一道有效的题（单选 / 多选要有两个以上选项）');
    return list;
  }
  async createSurvey(owner, input) {
    const title = clean(input.title, 60);
    if (title.length < 4) throw fail('问卷标题太短');
    const questions = PlatformServices.validQuestions(input.questions);
    const projectId = clean(input.projectId, 120) || null;
    return this.charged(owner, 'survey_create', input.requestId || id(), `问卷：${title}`, async () => {
      const data = await this.wjx(1000106, { title, atype: 1, desc: clean(input.intro, 300), surveydatajson: PlatformServices.surveyJsonl(title, clean(input.intro, 300), questions), publish: true }, 120000);
      const vid = Number(data?.vid);
      if (!vid) throw fail('问卷星没返回问卷编号', 502);
      const sid = typeof data?.sid === 'string' && /^[A-Za-z0-9]+$/.test(data.sid) ? data.sid : '';
      const path = [data?.pc_path, data?.mobile_path, data?.fill_url].find(p => typeof p === 'string' && /\/(vm|m|jq)\//.test(p));
      const url = path ? new URL(path, 'https://www.wjx.cn').toString() : sid ? `https://www.wjx.cn/vm/${sid}.aspx` : `https://www.wjx.cn/jq/${vid}.aspx`;
      const rec = { id: id(), owner, projectId, nodeId: clean(input.nodeId, 120) || null, vid, url, title, questions: questions.length, createdAt: Date.now(), lastCount: 0 };
      await this.tx(s => { s.surveys.push(rec); if (s.surveys.length > 20000) s.surveys = s.surveys.slice(-20000); });
      const { owner: _o, ...pub } = rec; return pub;
    });
  }
  /** 回收结果（不收费）：答卷数 + 统计报告原文（给 AI 总结） */
  async surveyResults(owner, sid) {
    const rec = await this.tx(s => s.surveys.find(x => x.id === sid && x.owner === owner), false);
    if (!rec) throw fail('问卷不存在', 404);
    const detail = await this.wjx(1000001, { vid: rec.vid, get_questions: false });
    let report = null;
    try { report = await this.wjx(1001101, { vid: rec.vid, valid: true }, 120000); } catch { /* 报告可能还没生成：先只给数量 */ }
    const count = Number(detail?.answer_valid ?? detail?.answer_total ?? 0) || 0;
    await this.tx(s => { const x = s.surveys.find(y => y.id === sid); if (x) { x.lastCount = count; x.checkedAt = Date.now(); } });
    return { id: rec.id, title: rec.title, url: rec.url, count, report: report ? JSON.stringify(report).slice(0, 20000) : null };
  }

  // ===== 预售页 / 报名页（平台自建） =====
  async createPage(owner, input) {
    const page = {
      id: id(), owner, projectId: clean(input.projectId, 120) || null, nodeId: clean(input.nodeId, 120) || null,
      headline: clean(input.headline, 60), sub: clean(input.sub, 200),
      bullets: (Array.isArray(input.bullets) ? input.bullets : []).map(b => clean(b, 80)).filter(Boolean).slice(0, 5),
      price: clean(input.price, 40), cta: clean(input.cta, 16) || '我想要',
      ask: clean(input.ask, 40) || '留个联系方式，有消息第一时间告诉你',
      maker: clean(input.maker, 40), createdAt: Date.now(), views: 0, uniques: [], clicks: 0, leads: [], closed: false,
    };
    if (page.headline.length < 4) throw fail('预售页需要一句清楚的标题');
    const n = await this.tx(s => s.pages.filter(p => p.owner === owner && !p.closed).length, false);
    if (n >= 20) throw fail('同时开着的预售页最多 20 个，先关掉旧的');
    return this.charged(owner, 'page_create', page.id, `预售页：${page.headline}`, async () => {
      await this.tx(s => { s.pages.push(page); });
      return { id: page.id, path: `/p/${page.id}`, headline: page.headline };
    });
  }
  async pageStats(owner, pid) {
    return this.tx(s => {
      const p = s.pages.find(x => x.id === pid && x.owner === owner); if (!p) throw fail('页面不存在', 404);
      return { id: p.id, headline: p.headline, views: p.views, visitors: p.uniques.length, clicks: p.clicks, leads: p.leads.map(l => ({ at: l.at, contact: l.contact, note: l.note })), closed: p.closed };
    }, false);
  }
  async closePage(owner, pid) {
    return this.tx(s => { const p = s.pages.find(x => x.id === pid && x.owner === owner); if (!p) throw fail('页面不存在', 404); p.closed = true; return { closed: true }; });
  }
  async mine(owner, projectId) {
    return this.tx(s => ({
      surveys: s.surveys.filter(x => x.owner === owner && (!projectId || x.projectId === projectId)).slice(-50).map(({ owner: _o, ...x }) => x),
      pages: s.pages.filter(x => x.owner === owner && (!projectId || x.projectId === projectId)).slice(-50).map(p => ({ id: p.id, headline: p.headline, projectId: p.projectId, nodeId: p.nodeId, createdAt: p.createdAt, views: p.views, visitors: p.uniques.length, clicks: p.clicks, leads: p.leads.length, closed: p.closed })),
    }), false);
  }
  /** 公开访问：记一次浏览（同一访客一天只算一个访客） */
  async viewPage(pid, visitor) {
    return this.tx(s => {
      const p = s.pages.find(x => x.id === pid); if (!p || p.closed) return null;
      p.views++; const v = `${day(Date.now())}:${visitor}`;
      if (!p.uniques.includes(v)) { p.uniques.push(v); if (p.uniques.length > 5000) p.uniques = p.uniques.slice(-5000); }
      const { owner: _o, uniques: _u, leads: _l, ...pub } = p; return pub;
    });
  }
  async leadPage(pid, visitor, input) {
    const contact = clean(input.contact, 80), note = clean(input.note, 200);
    if (input.click === true) return this.tx(s => { const p = s.pages.find(x => x.id === pid); if (p && !p.closed) p.clicks++; return { ok: true }; });
    if (contact.length < 5) throw fail('请留下手机号、微信或邮箱');
    return this.tx(s => {
      const p = s.pages.find(x => x.id === pid); if (!p || p.closed) throw fail('这个页面已关闭', 404);
      const today = day(Date.now());
      if (p.leads.filter(l => l.visitor === visitor && day(l.at) === today).length >= 3) throw fail('今天已经提交过了，谢谢', 429);
      if (p.leads.length >= 5000) throw fail('名额已满', 409);
      p.leads.push({ at: Date.now(), visitor, contact, note }); return { ok: true };
    });
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 预售页的固定模板：只放转义过的文字，不放任何外链 / 脚本以外的东西；页脚写明是谁做的 */
export function renderPage(p) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(p.headline)}</title>
<style>body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f7f4;color:#1f2a27}main{max-width:560px;margin:0 auto;padding:40px 20px 28px}h1{font-size:28px;line-height:1.3;margin:0 0 12px}p.sub{font-size:16px;color:#4a5753;line-height:1.7;margin:0 0 20px}ul{padding-left:20px;line-height:1.9;margin:0 0 20px}.price{font-size:20px;font-weight:700;color:#295c4d;margin:0 0 20px}button{width:100%;padding:14px;border:0;border-radius:12px;background:#295c4d;color:#fff;font-size:17px;font-weight:700}form{display:none;margin-top:16px}form.on{display:block}input,textarea{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cfd6d2;border-radius:10px;font-size:15px;margin-bottom:10px;font-family:inherit}.ok{display:none;padding:16px;background:#e4ede7;border-radius:12px;margin-top:16px}.ok.on{display:block}footer{max-width:560px;margin:0 auto;padding:0 20px 32px;font-size:12px;color:#8a9590;line-height:1.7}</style></head>
<body><main><h1>${esc(p.headline)}</h1>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${p.bullets.length ? `<ul>${p.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${p.price ? `<p class="price">${esc(p.price)}</p>` : ''}
<button id="go">${esc(p.cta)}</button>
<form id="f"><p>${esc(p.ask)}</p><input name="contact" required maxlength="80" placeholder="手机号 / 微信 / 邮箱"><textarea name="note" maxlength="200" rows="2" placeholder="想说的话（选填）"></textarea><button type="submit">提交</button></form>
<div class="ok" id="ok">收到了，谢谢！有进展会联系你。</div></main>
<footer>这个页面由 HiExplore 用户${p.maker ? `「${esc(p.maker)}」` : ''}创建，用来了解大家是否需要这个产品，产品可能还没做出来；不收任何费用。你留下的联系方式只给创建者用于联系你。</footer>
<script>var f=document.getElementById('f'),go=document.getElementById('go'),ok=document.getElementById('ok');go.onclick=function(){go.style.display='none';f.className='on';fetch(location.pathname+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({click:true})}).catch(function(){})};f.onsubmit=function(e){e.preventDefault();var d=new FormData(f);fetch(location.pathname+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact:d.get('contact'),note:d.get('note')})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'提交失败');f.className='';ok.className='ok on'})}).catch(function(err){alert(err.message)})};</script></body></html>`;
}
