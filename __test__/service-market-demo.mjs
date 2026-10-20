// Isolated local preview only: synthetic services/users, no real model/device/payment calls.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { ServiceMarket } from '../server/service-market.mjs';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiexplore-market-demo-'));
const app = await createWakeServer({ env: { WAKE_HOST: '127.0.0.1', WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://demo.invalid', WAKE_ALLOWED_ORIGINS: 'http://127.0.0.1:3000,http://localhost:3000' }, fetch: async (url, opts) => {
  if (url !== 'https://demo.invalid/auth/me') throw new Error('Preview never calls external services');
  const actor = opts.headers.Authorization.replace('Bearer ', '');
  return ['demo-buyer', 'demo-provider'].includes(actor) ? Response.json({ username: actor }) : Response.json({ error: 'Invalid demo identity' }, { status: 401 });
} });
const market = new ServiceMarket(app.storage), seller = { owner: 'demo-provider', agent: false };
const base = { revision: 0, providerName: '演示工作室 · 非真实供应商', description: '', inputs: '提供任务说明和验收条件', deliverables: '', limits: '仅用于界面演示，不提供实际设备服务', location: '线上', contact: '演示联系方式，无实际联系人', unit: '次', priceCents: 0, deliveryDays: 2, published: true, confirmed: true };
for (const input of [
  { title: '房间温湿度采集', availability: 'always', automation: 'automatic', category: 'sensing', description: '按约定频率采集环境数据，交付时间序列与设备参数，帮助验证环境变化。', deliverables: 'CSV 数据、采样说明与缺失数据记录', priceCents: 2000, unit: '小时' },
  { title: '3D 打印：验证你的第一件原型', availability: 'scheduled', automation: 'assisted', category: 'printing', description: '根据 STL 文件制作小型 PLA 原型，确认尺寸与配合关系。', deliverables: '打印件、尺寸测量与过程照片', priceCents: 3500, unit: '件', location: '同城交付' },
  { title: '开放数据清洗与复现', availability: 'always', automation: 'automatic', category: 'compute', description: '按指定方法处理公开数据，交付脚本、结果和失败记录。', deliverables: '可复现脚本、运行日志和结果文件', priceCents: 5000, unit: '任务' }
]) await market.saveService(seller, { ...base, ...input });
for (const [name, title, requirements, acceptance] of [
  ['环境实验 Agent（演示）', '遮阳是否能降低室内温度？', '按约定方案采集遮阳与对照位置的温度。仅隔离测试，不会执行实际采样。', 'CSV、采样时间、设备参数、缺失记录'],
  ['文献研究 Agent（演示）', '寻找反驳当前假设的公开研究', '检索公开论文中的反例与负面结果。仅隔离测试，不会实际检索。', '原始链接、相关段落、研究条件与局限'],
]) {
  const credential = await market.createToken({ owner: 'demo-buyer', agent: false }, { name, permissions: ['demand_publish'] });
  await market.publishDemand(await market.authenticate(credential.token), { requestId: randomUUID(), title, requirements, acceptance, budgetCents: 5000, deadline: Date.now() + 7 * 86400000, confirmed: true });
}
await new Promise(resolve => app.server.listen(8898, '127.0.0.1', resolve));
let ending = false;
async function stop() { if (ending) return; ending = true; await app.close(); await fs.rm(dir, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('Isolated demo API ready at http://127.0.0.1:8898');
