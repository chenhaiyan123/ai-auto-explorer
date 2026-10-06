import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { MAX_WORKSPACE_BYTES } from '../server/project-sync.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';

test('workspace API isolates accounts, persists encrypted data, rejects stale writers and keeps recovery copy', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-sync-'));
  const config = { env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://identity.invalid', WAKE_TEST_MODE: 'true' }, fetch: async (_url, opts) => {
    const token = opts.headers.Authorization;
    return { ok: ['Bearer alice', 'Bearer bob'].includes(token), json: async () => ({ user: { email: token.slice(7) + '@example.com' } }) };
  } };
  let app;
  const start = async () => { app = await createWakeServer(config); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); };
  await start();
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const request = async (token, body) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/projects/workspace`, { method: body ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  const p = { id: 'project1', name: 'private-project-title', metaProblem: 'A real question', nodes: [{ notes: '中文'.repeat(200000), apiKey: 'NOT-A-REAL-KEY' }], inquiries: { root: { credentials: 'NEVER-SYNC', memory: ['verified fact'] } }, worktree: { stages: [{ id: 'stage1' }] } };
  assert.equal((await request('invalid')).status, 401);
  assert.equal((await request('alice')).data.revision, 0);
  const saved = await request('alice', { owner: 'bob@example.com', revision: 0, projects: [p] });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.equal(saved.data.projects[0].nodes[0].notes.length, 400000);
  assert.ok(!JSON.stringify(saved.data).includes('NOT-A-REAL-KEY'));
  assert.ok(!JSON.stringify(saved.data).includes('NEVER-SYNC'));
  assert.deepEqual((await request('bob')).data.projects, []);
  const files = await fs.readdir(path.join(dir, 'project-sync'));
  assert.equal(files.length, 1);
  assert.ok(!(await fs.readFile(path.join(dir, 'project-sync', files[0]), 'utf8')).includes('private-project-title'));
  await app.close(); await start();
  assert.equal((await request('alice')).data.revision, 1);
  const races = await Promise.all([request('alice', { revision: 1, projects: [] }), request('alice', { revision: 1, projects: [p] })]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  assert.equal((await request('alice', { revision: 0, projects: [] })).status, 409);
  assert.equal((await request('alice', { revision: 2, projects: [p, p] })).status, 400);
  assert.equal((await request('alice', { revision: 2, projects: [{ ...p, nodes: [], name: 'x'.repeat(MAX_WORKSPACE_BYTES) }] })).status, 413);
  assert.equal((await request('alice')).data.revision, 2);
  const encrypted = new WakeStorage(path.join(dir, 'project-sync'), Buffer.from(config.env.WAKE_MASTER_KEY, 'base64'));
  const recovery = await encrypted.credentials(files[0].split('.')[0]);
  assert.equal(recovery.previous.revision, 1);
  assert.equal(recovery.previous.projects[0].name, 'private-project-title');
  // The wake scheduler must not interpret document files as research tasks.
  await app.tick();
  assert.equal((await app.storage.keys()).length, 0);
});
