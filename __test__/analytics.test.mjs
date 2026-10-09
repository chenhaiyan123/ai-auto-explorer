import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

async function fixture({ configured = true, hostname = 'www.hiexplore.com', search = '' } = {}) {
  const { outputFiles } = await build({
    stdin: { contents: "export * from './services/analytics'; export * from './services/funnel';", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    define: { 'import.meta.env': JSON.stringify({ VITE_UMAMI_WEBSITE_ID: configured ? 'test-site' : '' }) },
  });
  const scripts = [], sent = [], storage = new Map(), timers = new Map();
  let timerId = 0;
  const context = {
    module: { exports: {} }, URLSearchParams, Promise,
    location: { hostname, search }, window: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: {
      querySelector: () => scripts[0] || null,
      createElement: () => ({ setAttribute() {} }),
      head: { appendChild: script => scripts.push(script) },
    },
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(outputFiles[0].text, context);
  return {
    api: context.module.exports, scripts, sent, storage, timers, context,
    ready() { context.window.umami = { track: (name, data) => sent.push({ name, data }) }; scripts[0]?.onload(); },
  };
}

test('real startup order retains first visit and milestones until the script loads, once and in order', async () => {
  const f = await fixture();
  f.api.initAnalytics(); f.api.recordVisit(); f.api.markMilestone('funnel_entered_app');
  f.api.recordVisit(); f.api.markMilestone('funnel_entered_app'); f.api.initAnalytics();
  assert.equal(f.scripts.length, 1); assert.equal(f.sent.length, 0);
  f.ready(); f.scripts[0].onload();
  assert.deepEqual(f.sent.map(e => e.name), ['funnel_landed', 'funnel_entered_app']);
  assert.equal(f.timers.size, 0);
  f.api.trackEvent('after-load'); assert.equal(f.sent.at(-1).name, 'after-load');
});

test('disabled, localhost and notrack sessions do not load or buffer tracking', async () => {
  for (const options of [{ configured: false }, { hostname: 'localhost' }, { search: '?notrack=1' }]) {
    const f = await fixture(options);
    f.api.initAnalytics(); f.api.recordVisit(); f.api.trackEvent('early');
    assert.equal(f.scripts.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.sent.length, 0);
  }
});

test('opting out during load discards queued events', async () => {
  const f = await fixture(); f.api.initAnalytics(); f.api.trackEvent('early');
  f.storage.set('hiexplore_no_track', '1'); f.ready(); f.api.trackEvent('later');
  assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 0);
});

test('script failure or deadline discards events without retrying or persisting a queue', async () => {
  for (const mode of ['error', 'timeout']) {
    const f = await fixture(); f.api.initAnalytics(); f.api.trackEvent('early');
    if (mode === 'error') f.scripts[0].onerror(); else [...f.timers.values()][0]();
    f.ready();
    assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.storage.size, 0);
  }
});

test('pending events are bounded and copy metadata at occurrence time', async () => {
  const f = await fixture(); f.api.initAnalytics();
  const data = { count: 1 }; f.api.trackEvent('first', data); data.count = 2;
  for (let i = 0; i < 150; i++) f.api.trackEvent(`event-${i}`);
  f.ready(); assert.equal(f.sent.length, 100); assert.equal(f.sent[0].data.count, 1);
});

test('tracker exceptions and rejected requests do not escape or trigger retries', async () => {
  const f = await fixture(); f.api.initAnalytics(); f.ready(); let calls = 0;
  f.context.window.umami.track = () => { calls++; throw new Error('sync'); };
  assert.doesNotThrow(() => f.api.trackEvent('sync'));
  f.context.window.umami.track = () => { calls++; return Promise.reject(new Error('network')); };
  f.api.trackEvent('async'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});
