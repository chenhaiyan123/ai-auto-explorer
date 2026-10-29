import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { PlatformServices, renderPage } from '../server/platform-services.mjs';

const calls = [];
const fakeFetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://auth.example.test')) return Response.json({ email: opts.headers.Authorization.replace('Bearer ', '') });
  calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
  if (u.startsWith('https://www.wjx.cn/openapi/default.aspx')) {
    const b = JSON.parse(opts.body);
    if (b.action === 1000106) return Response.json({ result: true, data: { vid: 123456, sid: 'AbC12x', pc_path: '/vm/AbC12x.aspx' } });
    if (b.action === 1000001) return Response.json({ result: true, data: { vid: 123456, answer_valid: 37, answer_total: 40 } });
    if (b.action === 1001101) return Response.json({ result: true, data: { questions: [{ title: '你会买吗', items: [{ title: '会', count: 20 }, { title: '不会', count: 17 }] }] } });
    return Response.json({ result: false, errormsg: 'bad action' });
  }
  if (u === 'https://mcp.tianyancha.com/v1/core/tools/call') {
    const b = JSON.parse(opts.body);
    if (b.arguments.searchKey === '失败公司') return new Response('{"error":"quota_exceeded"}', { status: 429 });
    return Response.json({ content: JSON.stringify({ tool: b.tool_name, items: [{ name: b.arguments.searchKey + '有限公司' }] }) });
  }
  if (u.startsWith('https://api.openalex.org/works?')) return Response.json({ results: [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/xyz123', title: 'Solar-powered UAV endurance', publication_year: 2021, primary_location: { source: { display_name: 'Aerospace Journal' } }, authorships: [{ author: { display_name: 'A. Li' } }], cited_by_count: 42, abstract_inverted_index: { Solar: [0], power: [1], extends: [2], flight: [3] } }] });
  if (u.startsWith('https://api.crossref.org/works/')) return u.includes('10.1000%2Fxyz123') ? Response.json({ message: { title: ['Solar-powered UAV endurance'], issued: { 'date-parts': [[2021]] } } }) : new Response('not found', { status: 404 });
  throw new Error('unexpected ' + u);
};

async function boot(t, extraEnv = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'platform-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: 'boss@x.cn', BILLING_SALES_ENABLED: 'true', BILLING_TOPUP_ENABLED: 'true', ...extraEnv }, fetch: fakeFetch,
    paymentProviders: { alipay: { create: async () => ({ checkoutUrl: 'https://openapi.alipay.com/gateway.do?x=1' }), query: async o => ({ orderId: o.id, amount: o.amount, currency: 'CNY', transactionId: `T${o.id}` }), verifyNotification: async () => null } } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (who, route, method = 'GET', body, raw = false) => {
    const r = await fetch(base + route, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: raw ? await r.text() : await r.json() };
  };
  const topup = async (who, amount) => { const o = await call(who, '/billing/orders', 'POST', { sku: 'topup', amount, provider: 'alipay', requestId: crypto.randomUUID() }); return call(who, `/billing/orders/${o.body.id}`, 'POST'); };
  return { app, call, topup, base };
}

test('not configured → honest 503, nothing charged', async t => {
  const { call, topup } = await boot(t);
  await topup('u@x.cn', 1000);
  const cat = (await call('u@x.cn', '/platform/catalog')).body;
  assert.deepEqual(cat.services.map(s => [s.id, s.ready]), [['survey', false], ['company', false], ['page', true], ['papers', true]]);
  const r = await call('u@x.cn', '/platform/company/search', 'POST', { keyword: '嘉立创' });
  assert.equal(r.status, 503);
  assert.equal((await call('u@x.cn', '/billing/account')).body.wallet.balanceCents, 1000, 'refunded / not charged');
});

test('company lookup: charges wallet, refunds on provider failure, admin-only config', async t => {
  const { call, topup } = await boot(t);
  assert.equal((await call('u@x.cn', '/admin/platform', 'PUT', { tycKey: 'k' })).status, 403);
  assert.equal((await call('boss@x.cn', '/admin/platform', 'PUT', { tycKey: 'tyc-secret', prices: { company_search: 30 } })).body.tyc, true);
  await topup('u@x.cn', 1000);
  const r = await call('u@x.cn', '/platform/company/search', 'POST', { keyword: '嘉立创' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.chargedCents, 30);
  assert.equal(r.body.result.items[0].name, '嘉立创有限公司');
  assert.equal(calls.at(-1).auth, 'tyc-secret');
  assert.equal((await call('u@x.cn', '/billing/account')).body.wallet.balanceCents, 970);
  const bad = await call('u@x.cn', '/platform/company/search', 'POST', { keyword: '失败公司' });
  assert.equal(bad.status, 429);
  assert.equal((await call('u@x.cn', '/billing/account')).body.wallet.balanceCents, 970, 'failed call refunded');
  const info = await call('u@x.cn', '/platform/company/info', 'POST', { name: '深圳嘉立创' });
  assert.equal(info.status, 200); assert.equal(info.body.registration.tool, 'get_company_registration_info');
  const broke = await call('poor@x.cn', '/platform/company/search', 'POST', { keyword: '嘉立创' });
  assert.equal(broke.status, 402, 'empty wallet');
});

test('survey: create with attention check, link returned, results fetched', async t => {
  const { call, topup } = await boot(t, { WJX_API_KEY: 'wjx-secret' });
  await topup('u@x.cn', 1000);
  const r = await call('u@x.cn', '/platform/surveys', 'POST', { title: '家长选编程课调研', projectId: 'p1', nodeId: 'n1', questions: [
    { type: 'single', title: '孩子几岁', options: ['6岁以下', '6-10岁', '10岁以上'] }, { type: 'scale', title: '作品展示有多重要' }, { type: 'text', title: '最担心什么' }, { type: 'single', title: '只有一个选项', options: ['A'] }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.url, 'https://www.wjx.cn/vm/AbC12x.aspx'); assert.equal(r.body.questions, 3, 'invalid question dropped');
  const sent = calls.find(c => c.body?.action === 1000106);
  assert.equal(sent.auth, 'Bearer wjx-secret'); assert.equal(sent.body.publish, true);
  const rows = sent.body.surveydatajson.split('\n').map(x => JSON.parse(x));
  assert.equal(rows[0].qtype, '问卷基础信息'); assert.ok(rows.some(x => x.title.includes('认真作答')), 'attention check added');
  assert.equal((await call('u@x.cn', '/billing/account')).body.wallet.balanceCents, 800);
  const res = await call('u@x.cn', `/platform/surveys/${r.body.id}/results`);
  assert.equal(res.body.count, 37); assert.match(res.body.report, /你会买吗/);
  assert.equal((await call('other@x.cn', `/platform/surveys/${r.body.id}/results`)).status, 404, 'only owner');
  assert.equal((await call('u@x.cn', '/platform/mine?projectId=p1')).body.surveys.length, 1);
});

test('pre-sale page: public, escaped, counts views / clicks / leads; owner-only stats', async t => {
  const { call, base } = await boot(t);
  const r = await call('u@x.cn', '/platform/pages', 'POST', { projectId: 'p1', headline: '<script>alert(1)</script>少儿编程作品集', sub: '每月一次线上作品展', bullets: ['老师点评', '<b>家长可见</b>'], price: '¥99/月（预售价）', cta: '我想要', maker: '海探' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html = await fetch(base + r.body.path, { headers: { 'User-Agent': 'A' } });
  const text = await html.text();
  assert.equal(html.status, 200); assert.ok(!text.includes('<script>alert(1)'), 'escaped'); assert.ok(text.includes('&lt;b&gt;'), 'bullets escaped');
  assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
  await fetch(base + r.body.path, { headers: { 'User-Agent': 'A' } }); await fetch(base + r.body.path, { headers: { 'User-Agent': 'B' } });
  const lead = (body, ua = 'A') => fetch(base + r.body.path + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua, Origin: 'https://evil.example' }, body: JSON.stringify(body) });
  assert.equal((await lead({ click: true })).status, 200);
  assert.equal((await lead({ contact: '13800001111', note: '想给孩子报' })).status, 200);
  assert.equal((await lead({ contact: '1' })).status, 400);
  const st = (await call('u@x.cn', `/platform/pages/${r.body.id}`)).body;
  assert.deepEqual([st.views, st.visitors, st.clicks, st.leads.length], [3, 2, 1, 1]);
  assert.equal((await call('x@x.cn', `/platform/pages/${r.body.id}`)).status, 404);
  await call('u@x.cn', `/platform/pages/${r.body.id}/close`, 'POST');
  assert.equal((await fetch(base + r.body.path)).status, 404);
});

test('surveyJsonl keeps structure', () => {
  const j = PlatformServices.surveyJsonl('T', '', [{ type: 'multi', title: 'Q', options: ['a', 'b'] }]).split('\n').map(x => JSON.parse(x));
  assert.equal(j[1].qtype, '多选'); assert.equal(j.length, 3);
  assert.ok(renderPage({ headline: 'x', sub: '', bullets: [], price: '', cta: 'go', ask: 'a', maker: '' }).includes('不收任何费用'));
});

test('学术文献检索：免费、返回真论文（标题、年份、DOI、摘要），DOI 可核对真假', async t => {
  const { call } = await boot(t);
  const cat = (await call('u@x.cn', '/platform/catalog')).body;
  assert.ok(cat.services.find(x => x.id === 'papers').ready);
  const r = await call('u@x.cn', '/platform/papers?q=' + encodeURIComponent('solar UAV endurance'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body.results[0];
  assert.equal(p.doi, '10.1000/xyz123'); assert.equal(p.year, 2021); assert.equal(p.venue, 'Aerospace Journal'); assert.equal(p.abstract, 'Solar power extends flight');
  assert.equal((await call('u@x.cn', '/platform/papers?q=a')).status, 400);
  const v = await call('u@x.cn', '/platform/papers/verify', 'POST', { dois: ['10.1000/xyz123', '10.9999/fake-made-up', 'not-a-doi'] });
  assert.deepEqual(v.body.results.map(x => x.exists), [true, false]);
  assert.equal((await call(null, '/platform/papers?q=solar')).status, 401, '要登录');
});
