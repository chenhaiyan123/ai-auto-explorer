import { createHash } from 'node:crypto';

export const projectKey = (owner, projectId) => createHash('sha256').update(JSON.stringify([owner, projectId])).digest('hex');
export const mandateError = (message, code = 'PROJECT_STOPPED', status = 409) => Object.assign(new Error(message), { code, status, notSent: true });
const text = (s, max, name) => { if (typeof s !== 'string' || !s.trim() || s.length > max) throw mandateError(`${name}不能为空或过长`, 'INVALID_MANDATE', 400); return s.trim(); };
const number = (n, name) => { if (!Number.isSafeInteger(n) || n < 0 || n > 1e9) throw mandateError(`${name}必须为 0–1000000000 的整数`, 'INVALID_MANDATE', 400); return n; };
export function projectCalls(s, m) { return s.calls.filter(c => c.owner === m.owner && c.scope?.projectId === m.projectId && c.projectBudget); }
export function mandateView(s, m, now = Date.now()) {
  if (!m) return null;
  const calls = projectCalls(s, m), today = new Date(now).toISOString().slice(0, 10);
  const ids = new Set([...Object.keys(m.budgets), ...calls.map(c => c.modelId)]);
  const usage = Object.fromEntries([...ids].map(id => {
    const rows = calls.filter(c => c.modelId === id);
    const spent = rows.reduce((n, c) => n + (c.charged ?? 0), 0);
    const held = rows.reduce((n, c) => n + (c.charged === undefined ? c.reserved : 0), 0);
    return [id, { spent, held, remaining: Math.max(0, (m.budgets[id]?.totalTokens || 0) - spent - held), today: rows.filter(c => c.day === today).reduce((n, c) => n + (c.charged ?? c.reserved), 0) }];
  }));
  const uncertain = calls.some(c => c.status === 'uncertain');
  return { ...m, usage, uncertain, effectiveStatus: m.status !== 'active' ? m.status : now >= m.deadline ? 'deadline' : uncertain ? 'uncertain' : 'active', calls: calls.slice(-30).reverse().map(({ id, modelId, reserved, charged, status, at, scope }) => ({ id, modelId, reserved, charged, status, at, scope })) };
}
export function saveMandate(s, owner, projectId, body, now = Date.now()) {
  const key = projectKey(owner, projectId), old = s.projects?.[key];
  if (body.confirmed !== true || body.expectedRevision !== (old?.revision || 0)) throw mandateError('请确认项目约定；若已被修改，请刷新后重试');
  if ((old?.history.length || 0) >= 100) throw mandateError('约定版本达到首版上限，请归档');
  const goal = text(body.goal, 1500, '阶段目标'), acceptance = text(body.acceptance, 2500, '验收标准'), stopCondition = text(body.stopCondition, 1500, '停止条件');
  if (!Number.isSafeInteger(body.deadline) || body.deadline <= now || body.deadline > now + 366 * 86400000) throw mandateError('截止时间须在未来一年内', 'INVALID_MANDATE', 400);
  if (!Array.isArray(body.tools) || !body.tools.includes('model_analysis') || body.tools.some(t => !['model_analysis', 'paper_search', 'web_search'].includes(t))) throw mandateError('首版仅支持材料分析、论文元数据检索和联网搜索', 'INVALID_MANDATE', 400);
  if (!body.budgets || typeof body.budgets !== 'object' || Array.isArray(body.budgets) || !Object.keys(body.budgets).length || Object.keys(body.budgets).length > 50) throw mandateError('请设置至少一个共享模型预算', 'INVALID_MANDATE', 400);
  const budgets = Object.fromEntries(Object.entries(body.budgets).map(([id, b]) => {
    if (!Object.hasOwn(s.models, id) || !b) throw mandateError('预算引用了不存在的共享模型', 'INVALID_MANDATE', 400);
    const totalTokens = number(b.totalTokens, '累计上限'), dailyTokens = number(b.dailyTokens, '每日上限'), perCallTokens = number(b.perCallTokens, '单次预留上限');
    if (perCallTokens > dailyTokens || dailyTokens > totalTokens) throw mandateError('预算须满足：单次 ≤ 每日 ≤ 累计', 'INVALID_MANDATE', 400);
    return [id, { totalTokens, dailyTokens, perCallTokens }];
  }));
  const terms = { goal, acceptance, stopCondition, deadline: body.deadline, tools: [...new Set(body.tools)].sort() };
  const changedTerms = !old || JSON.stringify(terms) !== JSON.stringify({ goal: old.goal, acceptance: old.acceptance, stopCondition: old.stopCondition, deadline: old.deadline, tools: old.tools });
  const revision = (old?.revision || 0) + 1;
  const m = { owner, projectId, ...terms, budgets, deadline: body.deadline, revision, termsRevision: (old?.termsRevision || 0) + Number(changedTerms), status: 'paused', confirmedAt: now, createdAt: old?.createdAt || now,
    history: [...(old?.history || []), { revision, ...terms, budgets, deadline: body.deadline, confirmedAt: now, actor: owner, action: 'confirm' }] };
  s.projects ||= {}; s.projects[key] = m;
  return mandateView(s, m, now);
}
export function checkMandate(s, owner, projectId, { modelId, reserved = 0, tool = 'model_analysis', revision, now = Date.now() } = {}) {
  const m = s.projects?.[projectKey(owner, projectId)]; if (!m) return null; // Existing projects keep their old limits until explicitly enrolled.
  if (m.status !== 'active') throw mandateError(`项目约定已${m.status === 'completed' ? '验收完成' : m.status === 'stopped' ? '停止' : '暂停'}，请在预算面板手动恢复`);
  if (now >= m.deadline) throw mandateError('阶段截止时间已到，已停止新增执行', 'PROJECT_DEADLINE');
  if (revision !== undefined && m.revision !== revision) throw mandateError('项目约定已更新，旧任务停止，等待重新确认', 'PROJECT_CHANGED');
  if (!m.tools.includes(tool)) throw mandateError('此工具未获项目授权', 'PROJECT_PERMISSION');
  const view = mandateView(s, m, now);
  if (view.uncertain) throw mandateError('项目存在用量待核对的请求，核对前不能继续或切换模型', 'PROJECT_UNCERTAIN');
  if (modelId) {
    const b = m.budgets[modelId], u = view.usage[modelId];
    if (!b || reserved > b.perCallTokens || reserved > u.remaining || u.today + reserved > b.dailyTokens) throw mandateError(`项目模型预算不足：${modelId} 本次需预留 ${reserved} Token；请检查累计、UTC 每日和单次上限。不会自动充值`, 'PROJECT_BUDGET', 402);
  }
  return m;
}
