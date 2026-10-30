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
export const DEFAULT_PRICES = { company_search: 20, company_info: 50, survey_create: 200, page_create: 0, asr_file: 100, poi_search: 10, stats_query: 0 };
export const DAILY_CAP_CENTS = 5000;
const SERVICES = {
  survey: { label: '问卷调查（问卷星）', needs: 'wjxKey' },
  company: { label: '企业信息（天眼查）', needs: 'tycKey' },
  page: { label: '预售页 / 报名页（平台自建）', needs: null },
  papers: { label: '学术文献检索（OpenAlex / Crossref，免费）', needs: null },
  asr: { label: '访谈录音转文字（阿里云百炼 Paraformer）', needs: 'asrKey' },
  poi: { label: '周边门店 / 兴趣点统计（高德地图）', needs: 'amapKey' },
  stats: { label: '宏观统计数据（世界银行公开数据，免费）', needs: null },
};
/** OpenAlex 把摘要存成「词 → 位置」的倒排表，拼回原文 */
const abstractOf = inv => {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const i of pos) if (i < 400) words[i] = w;
  return words.filter(Boolean).join(' ').slice(0, 900);
};
const DOI_RE = /^10\.\d{4,9}\/[^\s]+$/;
/** 世界银行常用指标（中国及各国，按年）：AI 从这里挑，也可以直接给指标代码 */
export const WB_INDICATORS = {
  'SP.POP.TOTL': '总人口', 'SP.POP.0014.TO': '0–14 岁人口', 'SP.POP.1564.TO': '15–64 岁人口', 'SP.POP.65UP.TO': '65 岁及以上人口',
  'SP.URB.TOTL.IN.ZS': '城镇人口占比（%）', 'SP.DYN.TFRT.IN': '总和生育率', 'SP.DYN.CBRT.IN': '粗出生率（每千人）',
  'NY.GDP.MKTP.CD': 'GDP（现价美元）', 'NY.GDP.PCAP.CD': '人均 GDP（现价美元）', 'NY.GDP.MKTP.KD.ZG': 'GDP 实际增速（%）',
  'NE.CON.PRVT.CD': '居民最终消费（现价美元）', 'FP.CPI.TOTL.ZG': '通胀率（CPI，%）', 'SL.UEM.TOTL.ZS': '失业率（%）', 'SL.UEM.1524.ZS': '青年失业率（15–24 岁，%）',
  'SE.TER.ENRR': '高等教育毛入学率（%）', 'SE.PRM.ENRL': '小学在校生人数', 'SE.SEC.ENRL': '中学在校生人数', 'GB.XPD.RSDV.GD.ZS': '研发支出占 GDP（%）',
  'IT.NET.USER.ZS': '互联网用户占比（%）', 'IT.CEL.SETS.P2': '手机签约数（每百人）', 'EG.ELC.RNEW.ZS': '可再生能源发电占比（%）', 'SH.XPD.CHEX.PC.CD': '人均医疗支出（美元）',
};
/** 网站流量统计（Umami Cloud）：www.hiexplore.com 的网站 ID；统计从 2026-07-27 开始 */
const DEFAULT_UMAMI_SITE = 'be74bdcf-1923-4f20-9e43-7fafb0595554';
const UMAMI_SINCE = Date.parse('2026-07-27T00:00:00+08:00');
/** Umami 免费版不给 API Key：管理员在 Umami 后台登录后，把数据导出成这份快照（真实数据，不自动更新；要更新就重新导一次） */
const UMAMI_SNAPSHOT = {"asOf":1793330548345,"since":"2026-07-27","total":{"visitors":422,"visits":471,"pageviews":522,"bounces":323,"totaltime":18751},"months":[["2026-07",11,11,14],["2026-08",136,156,173],["2026-09",135,146,152],["2026-10",140,158,183]],"countries":[["CN",226],["US",96],["SC",22],["SG",10],["NL",7],["DE",7],["BR",6],["JP",5]],"devices":[["laptop",292],["mobile",102],["desktop",31]],"referrers":[["hiexplore.com",6],["baidu.com",2],["dmc.marketingforce.com",1],["google.com",1],["m.baidu.com",1]],"events":[["validation_triggered",2108],["batch_start",611],["batch_end",606],["feed_answer",165],["trial_quota_exhausted",136],["funnel_landed",113],["explore_halted",92],["unattended_resume",91],["login",73],["pulse_wake",59],["pm_market",25],["outline_proposed",16],["trial_start",15],["funnel_tried_sim",13],["outline_confirmed",11],["funnel_entered_app",9],["key_info",7],["autonomy_report",7],["write_this_one",6],["funnel_project_created",6],["feedback_open",6],["step_pause",5],["autonomy_granted",5],["funnel_exploration_started",4],["charter_set",4],["digest",4],["return_d1",3],["sim_to_trial",3],["return_d7",2],["return_d30",2],["project_created",2],["sim_generated",2]],"daily":[["2026-07-28",1],["2026-07-29",7],["2026-07-30",1],["2026-07-31",2],["2026-08-01",1],["2026-08-02",2],["2026-08-03",9],["2026-08-04",2],["2026-08-05",1],["2026-08-06",3],["2026-08-07",1],["2026-08-08",13],["2026-08-09",6],["2026-08-10",7],["2026-08-11",26],["2026-08-12",5],["2026-08-13",2],["2026-08-14",1],["2026-08-15",4],["2026-08-16",2],["2026-08-17",10],["2026-08-18",11],["2026-08-19",12],["2026-08-20",2],["2026-08-22",2],["2026-08-24",4],["2026-08-25",3],["2026-08-28",4],["2026-08-29",2],["2026-08-30",4],["2026-08-31",6],["2026-09-01",7],["2026-09-02",9],["2026-09-03",8],["2026-09-04",3],["2026-09-05",3],["2026-09-06",5],["2026-09-07",8],["2026-09-08",8],["2026-09-09",6],["2026-09-10",6],["2026-09-11",4],["2026-09-12",4],["2026-09-13",5],["2026-09-14",7],["2026-09-15",4],["2026-09-16",6],["2026-09-17",3],["2026-09-18",5],["2026-09-19",2],["2026-09-20",4],["2026-09-21",6],["2026-09-22",3],["2026-09-24",9],["2026-09-25",3],["2026-09-26",3],["2026-09-28",3],["2026-09-29",4],["2026-09-30",2],["2026-10-02",2],["2026-10-04",3],["2026-10-05",7],["2026-10-06",3],["2026-10-07",4],["2026-10-08",6],["2026-10-09",6],["2026-10-10",6],["2026-10-11",4],["2026-10-12",1],["2026-10-13",4],["2026-10-14",2],["2026-10-15",2],["2026-10-16",5],["2026-10-17",6],["2026-10-18",5],["2026-10-19",7],["2026-10-20",6],["2026-10-21",6],["2026-10-22",2],["2026-10-23",5],["2026-10-24",9],["2026-10-25",4],["2026-10-26",3],["2026-10-27",8],["2026-10-28",7],["2026-10-29",23],["2026-10-30",3]]};
function umamiFromSnapshot(days) {
  const S = UMAMI_SNAPSHOT, cut = new Date(S.asOf - days * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  const recent = S.daily.filter(([d]) => d > cut);
  return { configured: true, snapshot: true, asOf: S.asOf, since: UMAMI_SINCE, total: S.total,
    recent: { days, visitors: recent.reduce((a, [, n]) => a + n, 0), activeDays: recent.length, summed: true },
    months: S.months.map(([month, visitors, visits, pageviews]) => ({ month, visitors, visits, pageviews })),
    daily: S.daily.map(([day, visitors]) => ({ day, visitors })),
    events: S.events.map(([name, count]) => ({ name, count })),
    countries: S.countries.map(([code, visitors]) => ({ code, visitors })),
    devices: S.devices.map(([name, visitors]) => ({ name, visitors })),
    referrers: S.referrers.map(([name, visitors]) => ({ name, visitors })) };
}
const QTYPES = { single: '单选', multi: '多选', text: '简答题', scale: '量表题', nps: 'NPS量表' };

export class PlatformServices {
  /** opts.dashscopeKey：没单独填语音密钥时，借用平台已开通的通义千问（百炼）Key；opts.audioDir：录音临时存放处 */
  constructor(storage, billing, fetchImpl = fetch, env = {}, opts = {}) {
    this.storage = storage; this.billing = billing; this.fetch = fetchImpl; this.env = env; this.queue = Promise.resolve(); this.opts = opts;
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
  keys(s) { return { wjxKey: s.config.wjxKey || this.env.WJX_API_KEY || '', tycKey: s.config.tycKey || this.env.TYC_AUTHORIZATION || '', asrKey: s.config.asrKey || this.env.DASHSCOPE_API_KEY || this.dsKey || '', amapKey: s.config.amapKey || this.env.AMAP_KEY || '' }; }
  async refreshDsKey() { try { this.dsKey = (await this.opts.dashscopeKey?.()) || ''; } catch { this.dsKey = ''; } }
  prices(s) { return { ...DEFAULT_PRICES, ...(s.config.prices || {}) }; }

  /** 给用户 / AI 看：哪些服务开通了、多少钱 */
  async catalog() {
    await this.refreshDsKey();
    return this.tx(s => {
      const k = this.keys(s), p = this.prices(s);
      return { services: Object.entries(SERVICES).map(([sid, x]) => ({ id: sid, label: x.label, ready: !x.needs || !!k[x.needs] })), prices: p, dailyCapCents: DAILY_CAP_CENTS };
    }, false);
  }
  /** 管理员：填密钥、改价格（密钥只写不读） */
  async configure(body) {
    await this.refreshDsKey();
    return this.tx(s => {
      if (typeof body.wjxKey === 'string') s.config.wjxKey = body.wjxKey.trim().slice(0, 500);
      if (typeof body.tycKey === 'string') s.config.tycKey = body.tycKey.trim().slice(0, 4000);
      if (typeof body.asrKey === 'string') s.config.asrKey = body.asrKey.trim().slice(0, 500);
      if (typeof body.amapKey === 'string') s.config.amapKey = body.amapKey.trim().slice(0, 200);
      if (typeof body.umamiKey === 'string') { s.config.umamiKey = body.umamiKey.trim().slice(0, 300); this.umamiCache = null; }
      if (typeof body.umamiSite === 'string' && /^[0-9a-f-]{36}$/.test(body.umamiSite.trim())) { s.config.umamiSite = body.umamiSite.trim(); this.umamiCache = null; }
      if (body.prices && typeof body.prices === 'object') {
        s.config.prices = { ...(s.config.prices || {}) };
        for (const [k, v] of Object.entries(body.prices)) if (k in DEFAULT_PRICES && Number.isSafeInteger(v) && v >= 0 && v <= 100000) s.config.prices[k] = v;
      }
      const k = this.keys(s);
      return { wjx: !!k.wjxKey, tyc: !!k.tycKey, asr: !!k.asrKey, asrOwn: !!s.config.asrKey, amap: !!k.amapKey, umami: !!(s.config.umamiKey || this.env.UMAMI_API_KEY), umamiSite: s.config.umamiSite || this.env.UMAMI_WEBSITE_ID || DEFAULT_UMAMI_SITE, prices: this.prices(s) };
    });
  }

  /** 扣钱 → 调用 → 失败退回。ref 幂等。 */
  async charged(owner, kind, ref, note, run, projectId) {
    const cents = await this.tx(s => {
      const c = this.prices(s)[kind] || 0;
      const today = day(Date.now());
      const used = s.spend[owner]?.day === today ? s.spend[owner].cents : 0;
      if (c && used + c > DAILY_CAP_CENTS) throw fail(`今天平台服务已花 ¥${(used / 100).toFixed(2)}，到了每天 ¥${DAILY_CAP_CENTS / 100} 的上限，明天再继续`, 429);
      if (c) s.spend[owner] = { day: today, cents: used + c };
      return c;
    });
    if (cents) await this.billing.spendWallet(owner, cents, `svc-${kind}-${ref}`, note, projectId || undefined);
    try { return { ...(await run()), chargedCents: cents }; }
    catch (e) {
      if (cents) {
        await this.billing.refundWallet(owner, `svc-${kind}-${ref}`, `${note}没成功，退回`).catch(() => {});
        await this.tx(s => { if (s.spend[owner]) s.spend[owner].cents = Math.max(0, s.spend[owner].cents - cents); });
      }
      throw e;
    }
  }

  // ===== 学术文献（免费）：真论文，减少 AI 编造引用 =====
  limited(owner) {
    const now = Date.now(); this.paperHits ||= new Map();
    const h = this.paperHits.get(owner);
    if (!h || now - h.at > 3600000) { this.paperHits.set(owner, { at: now, n: 1 }); return false; }
    return ++h.n > 120;
  }
  async papers(owner, input) {
    const q = clean(input.q, 200);
    if (q.length < 2) throw fail('请写检索关键词');
    if (this.limited(owner)) throw fail('检索太频繁了，过一会儿再试', 429);
    const n = Math.min(10, Math.max(1, Number(input.n) || 6));
    const mail = encodeURIComponent(this.env.OPENALEX_MAILTO || 'service@hiexplore.com');
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=${n}&mailto=${mail}&select=id,doi,title,publication_year,primary_location,authorships,cited_by_count,abstract_inverted_index,open_access`;
    const r = await this.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!r.ok) throw fail(`文献检索暂时不可用（HTTP ${r.status}）`, 502);
    const body = await r.json();
    return { q, results: (body.results || []).map(w => ({
      title: String(w.title || '').slice(0, 300), year: w.publication_year || null,
      venue: String(w.primary_location?.source?.display_name || '').slice(0, 160),
      authors: (w.authorships || []).slice(0, 4).map(a => a.author?.display_name).filter(Boolean),
      doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, '') : null,
      url: w.doi || w.open_access?.oa_url || w.id, cited: w.cited_by_count || 0,
      abstract: abstractOf(w.abstract_inverted_index),
    })).filter(x => x.title) };
  }
  /** 核对 AI 写出来的 DOI 是不是真的存在（Crossref） */
  async verifyDois(owner, input) {
    const dois = (Array.isArray(input.dois) ? input.dois : []).map(d => String(d).trim().replace(/^https?:\/\/doi\.org\//i, '')).filter(d => DOI_RE.test(d)).slice(0, 10);
    if (this.limited(owner)) throw fail('核对太频繁了，过一会儿再试', 429);
    const out = [];
    for (const doi of dois) {
      const r = await this.fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' }).catch(() => null);
      if (!r) { out.push({ doi, exists: null }); continue; }
      if (r.status === 404) { out.push({ doi, exists: false }); continue; }
      const m = r.ok ? (await r.json()).message : null;
      out.push({ doi, exists: !!m, title: String(m?.title?.[0] || '').slice(0, 300), year: m?.issued?.['date-parts']?.[0]?.[0] || null });
    }
    return { results: out };
  }

  // ===== 访谈录音转文字（百炼 Paraformer，异步） =====
  /** 录音文件存进临时目录，给百炼一个一次性的公开地址去拉；转完就删 */
  async audioSubmit(owner, input) {
    const { file, size, mime } = input;
    if (!file || !size) throw fail('没收到录音文件');
    await this.refreshDsKey();
    const key = (await this.tx(s => this.keys(s), false)).asrKey;
    if (!key) throw fail('录音转文字还没开通（管理员要先开通阿里云百炼）', 503);
    const base = String(this.env.WAKE_PUBLIC_URL || this.env.BILLING_PUBLIC_URL || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(base)) throw fail('后台没配置公开地址，转不了', 503);
    const rec = { id: id(), owner, projectId: clean(input.projectId, 120) || null, nodeId: clean(input.nodeId, 120) || null, name: clean(input.name, 80) || '访谈录音', file, size, mime: clean(mime, 60), createdAt: Date.now(), status: 'PENDING', taskId: null, text: '', durationSec: 0 };
    return this.charged(owner, 'asr_file', rec.id, `录音转文字：${rec.name}`, async () => {
      const r = await this.fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: 'paraformer-v2', input: { file_urls: [`${base}/a/${file}`] }, parameters: { language_hints: ['zh', 'en'], diarization_enabled: true } }),
        signal: AbortSignal.timeout(30000), redirect: 'error',
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.output?.task_id) throw fail(`录音转文字没提交成功：${body.message || r.status}`, 502);
      rec.taskId = body.output.task_id;
      await this.tx(s => { (s.audios ||= []).push(rec); if (s.audios.length > 2000) s.audios = s.audios.slice(-2000); });
      return { id: rec.id, name: rec.name, status: 'PENDING' };
    }, rec.projectId);
  }
  /** 查进度；转好了就把文字存下来、删掉录音 */
  async audioResult(owner, aid) {
    const rec = await this.tx(s => (s.audios || []).find(x => x.id === aid && x.owner === owner), false);
    if (!rec) throw fail('录音不存在', 404);
    if (rec.status === 'SUCCEEDED' || rec.status === 'FAILED') return { id: rec.id, name: rec.name, status: rec.status, text: rec.text, durationSec: rec.durationSec, error: rec.error };
    const key = (await this.tx(s => this.keys(s), false)).asrKey;
    const r = await this.fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(rec.taskId)}`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000), redirect: 'error' });
    const body = await r.json().catch(() => ({}));
    const st = body.output?.task_status;
    let patch = null;
    if (st === 'SUCCEEDED') {
      const sub = (body.output.results || [])[0] || {};
      if (sub.subtask_status === 'SUCCEEDED' && sub.transcription_url) {
        const tr = await (await this.fetch(sub.transcription_url, { signal: AbortSignal.timeout(30000) })).json();
        const t = (tr.transcripts || [])[0] || {};
        const lines = (t.sentences || []).map(x => `${x.speaker_id !== undefined ? `【说话人${Number(x.speaker_id) + 1}】` : ''}${x.text}`);
        patch = { status: 'SUCCEEDED', text: (lines.length ? lines.join('\n') : String(t.text || '')).slice(0, 200000), durationSec: Math.round((t.content_duration_in_milliseconds || 0) / 1000) };
      } else patch = { status: 'FAILED', error: String(sub.message || sub.code || '识别失败').slice(0, 200) };
    } else if (st === 'FAILED' || st === 'UNKNOWN') patch = { status: 'FAILED', error: String(body.output?.message || '识别失败').slice(0, 200) };
    if (patch) {
      await this.tx(s => { const x = (s.audios || []).find(y => y.id === aid); if (x) Object.assign(x, patch); });
      await this.opts.removeAudio?.(rec.file).catch(() => {});
      if (patch.status === 'FAILED') await this.billing.refundWallet(owner, `svc-asr_file-${rec.id}`, '录音转文字没成功，退回').catch(() => {});
      return { id: rec.id, name: rec.name, ...patch };
    }
    return { id: rec.id, name: rec.name, status: st || 'RUNNING' };
  }

  // ===== 高德地图：某个城市 / 片区有多少家某类店（比 AI 估算可靠） =====
  async poi(owner, input) {
    const keyword = clean(input.keyword, 40), city = clean(input.city, 30), around = clean(input.around, 40);
    if (keyword.length < 2) throw fail('请写要找的店或地点类型，比如「少儿编程」');
    const key = (await this.tx(s => this.keys(s), false)).amapKey;
    if (!key) throw fail('门店统计还没开通（管理员要先填高德 Web 服务 Key）', 503);
    return this.charged(owner, 'poi_search', input.requestId || id(), `门店统计：${city}${around ? ' ' + around : ''} ${keyword}`, async () => {
      const get = async u => { const r = await this.fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'error' }); const b = await r.json().catch(() => ({})); if (b.status !== '1') throw fail(`高德查询失败：${b.info || r.status}`, 502); return b; };
      let center = '';
      if (around) { // 「某个地址周边 3 公里」：先把地址变成坐标
        const g = await get(`https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(around)}&city=${encodeURIComponent(city)}&key=${key}`);
        center = g.geocodes?.[0]?.location || '';
        if (!center) throw fail(`找不到「${around}」这个位置`, 400);
      }
      const radius = Math.min(50000, Math.max(500, Number(input.radius) || 3000));
      const pois = []; let total = 0;
      for (let page = 1; page <= 4; page++) {
        const u = center
          ? `https://restapi.amap.com/v5/place/around?keywords=${encodeURIComponent(keyword)}&location=${center}&radius=${radius}&page_size=25&page_num=${page}&key=${key}`
          : `https://restapi.amap.com/v5/place/text?keywords=${encodeURIComponent(keyword)}&region=${encodeURIComponent(city)}&city_limit=true&page_size=25&page_num=${page}&key=${key}`;
        const b = await get(u);
        total = Math.max(total, Number(b.count) || 0);
        const got = (b.pois || []).map(x => ({ name: String(x.name || '').slice(0, 60), address: String(x.address || '').slice(0, 80), district: String(x.adname || ''), type: String(x.type || '').split(';').pop() }));
        pois.push(...got);
        if (got.length < 25) break;
      }
      const byDistrict = {};
      for (const p of pois) byDistrict[p.district || '未知'] = (byDistrict[p.district || '未知'] || 0) + 1;
      return { keyword, city, around: around || null, radius: center ? radius : null, total: Math.max(total, pois.length), sampled: pois.length, byDistrict, pois: pois.slice(0, 100),
        note: '高德收录的兴趣点，可能漏掉没登记的小店，也可能包含已关门的；当作量级参考，关键结论要实地核实。' };
    }, clean(input.projectId, 120));
  }

  // ===== 世界银行公开数据：人口、GDP、教育等宏观数字（免费） =====
  async stats(owner, input) {
    const codes = (Array.isArray(input.indicators) ? input.indicators : [input.indicator]).map(c => String(c || '').trim().toUpperCase()).filter(c => /^[A-Z0-9.]{3,40}$/.test(c)).slice(0, 5);
    const country = /^[A-Z]{3}$/.test(String(input.country || '').toUpperCase()) ? String(input.country).toUpperCase() : 'CHN';
    if (!codes.length) throw fail('请指定要查的指标');
    if (this.limited(owner)) throw fail('查询太频繁了，过一会儿再试', 429);
    const out = [];
    for (const code of codes) {
      const r = await this.fetch(`https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(code)}?format=json&per_page=12&mrv=12`, { signal: AbortSignal.timeout(20000), redirect: 'error' }).catch(() => null);
      const b = r?.ok ? await r.json().catch(() => null) : null;
      const rows = Array.isArray(b?.[1]) ? b[1] : [];
      out.push({ code, name: WB_INDICATORS[code] || rows[0]?.indicator?.value || code, country: rows[0]?.country?.value || country,
        values: rows.filter(x => x.value !== null).map(x => ({ year: Number(x.date), value: x.value })).slice(0, 10) });
    }
    return { source: '世界银行公开数据（World Bank Open Data）', results: out };
  }

  // ===== 网站访客（Umami Cloud）：给运营数据页看真实访客，不和注册用户混在一起 =====
  async umami(days = 30) {
    const cfg = await this.tx(s => ({ key: s.config.umamiKey || this.env.UMAMI_API_KEY || '', site: s.config.umamiSite || this.env.UMAMI_WEBSITE_ID || DEFAULT_UMAMI_SITE }), false);
    if (!cfg.key) return umamiFromSnapshot(days);
    const ck = `${days}`;
    if (this.umamiCache?.k === ck && Date.now() - this.umamiCache.at < 10 * 60000) return this.umamiCache.v;
    const base = String(this.env.UMAMI_API_BASE || 'https://api.umami.is/v1').replace(/\/+$/, '');
    const get = async p => {
      const r = await this.fetch(`${base}/websites/${cfg.site}${p}`, { headers: { Authorization: `Bearer ${cfg.key}`, 'x-umami-api-key': cfg.key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!r.ok) throw fail(`Umami 读不到（HTTP ${r.status}${r.status === 401 ? '，Key 不对或过期' : ''}）`, 502);
      return r.json();
    };
    const now = Date.now(), from = now - days * 86400000;
    const q = (a, b) => `startAt=${a}&endAt=${b}`;
    const all = q(UMAMI_SINCE, now), range = q(from, now);
    const [total, recent, events, countries, daily] = await Promise.all([
      get(`/stats?${all}`), get(`/stats?${range}`),
      get(`/metrics?${all}&type=event&limit=40`), get(`/metrics?${all}&type=country&limit=8`),
      get(`/pageviews?${range}&unit=day&timezone=Asia/Shanghai`),
    ]);
    // 按月访客
    const months = [];
    for (let d = new Date(UMAMI_SINCE); d.getTime() < now;) {
      const a = d.getTime(); const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1); const b = Math.min(now, nx.getTime());
      const st = await get(`/stats?${q(a, b)}`).catch(() => null);
      months.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, visitors: Number(st?.visitors?.value ?? st?.visitors ?? 0), visits: Number(st?.visits?.value ?? st?.visits ?? 0), bounces: Number(st?.bounces?.value ?? st?.bounces ?? 0), totaltime: Number(st?.totaltime?.value ?? st?.totaltime ?? 0) });
      d = nx;
    }
    const num = v => Number(v?.value ?? v ?? 0);
    const sessionsDaily = (daily.sessions || []).map(x => ({ day: String(x.x || x.t).slice(0, 10), visitors: x.y }));
    const v = { configured: true, since: UMAMI_SINCE,
      total: { visitors: num(total.visitors), visits: num(total.visits), pageviews: num(total.pageviews), bounces: num(total.bounces), totaltime: num(total.totaltime) },
      recent: { days, visitors: num(recent.visitors), visits: num(recent.visits), pageviews: num(recent.pageviews), bounces: num(recent.bounces), totaltime: num(recent.totaltime) },
      months, daily: sessionsDaily,
      events: (Array.isArray(events) ? events : []).map(e => ({ name: e.x, count: e.y })),
      countries: (Array.isArray(countries) ? countries : []).map(c => ({ code: c.x, visitors: c.y })) };
    this.umamiCache = { k: ck, at: Date.now(), v };
    return v;
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
    return this.charged(owner, 'company_search', input.requestId || id(), `企业查询：${keyword}`, async () => ({ keyword, result: await this.tyc('search_companies', { searchKey: keyword, pageSize: 10 }) }), clean(input.projectId, 120));
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
    }, clean(input.projectId, 120));
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
    }, projectId);
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
      // 意向金（分）：0 = 不收；100–990 = 访客可付 ¥1–9.9 表示真想要，7 天后全额退回
      deposit: Number.isSafeInteger(input.deposit) && input.deposit >= 100 && input.deposit <= 990 ? input.deposit : 0,
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
      return { id: p.id, headline: p.headline, views: p.views, visitors: p.uniques.length, clicks: p.clicks, leads: p.leads.map(l => ({ at: l.at, contact: l.contact, note: l.note })), closed: p.closed, deposit: p.deposit || 0 };
    }, false).then(async r => ({ ...r, deposits: r.deposit && this.billing.depositStats ? await this.billing.depositStats(pid) : { count: 0, cents: 0, refunded: 0 } }));
  }
  /** 访客付意向金：只在作者开了意向金、页面没关时 */
  async pageDeposit(pid, visitor) {
    const p = await this.tx(s => s.pages.find(x => x.id === pid), false);
    if (!p || p.closed || !p.deposit) throw fail('这个页面没有开意向金', 404);
    const o = await this.billing.createDeposit({ pageId: pid, amount: p.deposit, title: p.headline, visitor });
    if (!o.codeUrl) throw fail('微信支付暂时不可用，过一会儿再试', 503);
    return { id: o.id, codeUrl: o.codeUrl, amount: o.amount };
  }
  async closePage(owner, pid) {
    return this.tx(s => { const p = s.pages.find(x => x.id === pid && x.owner === owner); if (!p) throw fail('页面不存在', 404); p.closed = true; return { closed: true }; });
  }
  async mine(owner, projectId) {
    return this.tx(s => ({
      surveys: s.surveys.filter(x => x.owner === owner && (!projectId || x.projectId === projectId)).slice(-50).map(({ owner: _o, ...x }) => x),
      pages: s.pages.filter(x => x.owner === owner && (!projectId || x.projectId === projectId)).slice(-50).map(p => ({ id: p.id, headline: p.headline, projectId: p.projectId, nodeId: p.nodeId, createdAt: p.createdAt, views: p.views, visitors: p.uniques.length, clicks: p.clicks, leads: p.leads.length, closed: p.closed, deposit: p.deposit || 0 })),
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
export function renderPage(p, depositOpen = false) {
  const dep = depositOpen && p.deposit ? p.deposit : 0;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(p.headline)}</title>
<style>body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f7f4;color:#1f2a27}main{max-width:560px;margin:0 auto;padding:40px 20px 28px}h1{font-size:28px;line-height:1.3;margin:0 0 12px}p.sub{font-size:16px;color:#4a5753;line-height:1.7;margin:0 0 20px}ul{padding-left:20px;line-height:1.9;margin:0 0 20px}.price{font-size:20px;font-weight:700;color:#295c4d;margin:0 0 20px}button{width:100%;padding:14px;border:0;border-radius:12px;background:#295c4d;color:#fff;font-size:17px;font-weight:700}form{display:none;margin-top:16px}form.on{display:block}input,textarea{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cfd6d2;border-radius:10px;font-size:15px;margin-bottom:10px;font-family:inherit}.ok{display:none;padding:16px;background:#e4ede7;border-radius:12px;margin-top:16px}.ok.on{display:block}footer{max-width:560px;margin:0 auto;padding:0 20px 32px;font-size:12px;color:#8a9590;line-height:1.7}.dep{margin-top:24px;padding:16px;border:1px dashed #9db5aa;border-radius:12px}.dt{font-weight:700;margin:0 0 6px}.dn{font-size:13px;color:#4a5753;line-height:1.6;margin:0 0 10px}button.sec{background:#07a35a}#qr svg{display:block;width:200px;height:200px;margin:12px auto 0}</style></head>
<body><main><h1>${esc(p.headline)}</h1>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${p.bullets.length ? `<ul>${p.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${p.price ? `<p class="price">${esc(p.price)}</p>` : ''}
<button id="go">${esc(p.cta)}</button>
<form id="f"><p>${esc(p.ask)}</p><input name="contact" required maxlength="80" placeholder="手机号 / 微信 / 邮箱"><textarea name="note" maxlength="200" rows="2" placeholder="想说的话（选填）"></textarea><button type="submit">提交</button></form>
<div class="ok" id="ok">收到了，谢谢！有进展会联系你。</div>
${dep ? `<div class="dep"><p class="dt">真的想要？付 ¥${(dep / 100).toFixed(2)} 意向金</p><p class="dn">只是表示你真心想要，<b>${7} 天后全额原路退回</b>，不是购买、不会发货。</p><button id="pay" class="sec">微信付 ¥${(dep / 100).toFixed(2)} 意向金</button><div id="qr"></div><p id="ps" class="dn"></p></div>` : ''}</main>
<footer>这个页面由 HiExplore 用户${p.maker ? `「${esc(p.maker)}」` : ''}创建，用来了解大家是否需要这个产品，产品可能还没做出来；${dep ? '意向金由 HiExplore 平台代收，到期全额原路退回，不会转给创建者' : '不收任何费用'}。你留下的联系方式只给创建者用于联系你。</footer>
<script>var f=document.getElementById('f'),go=document.getElementById('go'),ok=document.getElementById('ok');go.onclick=function(){go.style.display='none';f.className='on';fetch(location.pathname+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({click:true})}).catch(function(){})};f.onsubmit=function(e){e.preventDefault();var d=new FormData(f);fetch(location.pathname+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact:d.get('contact'),note:d.get('note')})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'提交失败');f.className='';ok.className='ok on'})}).catch(function(err){alert(err.message)})};var pay=document.getElementById('pay');if(pay){pay.onclick=function(){pay.disabled=true;var ps=document.getElementById('ps');fetch(location.pathname+'/deposit',{method:'POST'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'暂时付不了');document.getElementById('qr').innerHTML=j.qr||'';ps.textContent=j.qr?'用微信扫码付款（手机上可长按识别二维码）':'';var n=0,t=setInterval(function(){if(++n>120){clearInterval(t);return}fetch(location.pathname+'/deposit/'+j.id).then(function(r){return r.json()}).then(function(s){if(s.paid){clearInterval(t);document.getElementById('qr').innerHTML='';ps.textContent='付好了，谢谢你的支持！到期会全额原路退回。'}}).catch(function(){})},3000)})}).catch(function(err){pay.disabled=false;ps.textContent=err.message})}}</script></body></html>`;
}
