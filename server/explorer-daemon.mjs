#!/usr/bin/env node
/**
 * HiExplore 自主探索守护进程（本地常驻，真正 7×24）
 *
 * 不依赖浏览器：直接对着你配置的模型不停地跑自主研究循环：
 *   选前沿 → 拆解 → 执行 → 评审验证 → 沉淀 → 决策 → 限流休眠 → 循环
 *
 * 结果写到 vaultDir：
 *   - project.json   ：完整状态（可被守护进程和你随时查看）
 *   - *.md           ：每个节点一篇 Markdown（可在 HiExplore「本地库/导入」或 Obsidian 打开）
 *   - explorer.log   ：运行日志
 *
 * 用法：
 *   1) 复制 server/explorer.config.example.json 为 server/explorer.config.json 并填好模型/问题
 *   2) node server/explorer-daemon.mjs              （读配置里的 question）
 *      或  node server/explorer-daemon.mjs "你的研究问题"
 *   3) Ctrl+C 安全停止（会先存盘）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 配置 ----------
const DEFAULTS = {
  model: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5:7b' },
  question: '',
  vaultDir: './explorer-vault',
  budget: { maxStepsPerDay: 200, intervalSec: 20, maxTokensPerCall: 2048, timeoutSec: 180 },
  maxDepth: 3,        // 节点最多 3 级
  maxNodes: 60,       // 全项目节点上限，防无限膨胀
  minConfidence: 0.5, // 评审低于此值 → 标记「待人工复核」
};

function loadConfig() {
  const cfgPath = path.join(__dirname, 'explorer.config.json');
  let cfg = { ...DEFAULTS };
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      cfg = { ...DEFAULTS, ...raw, model: { ...DEFAULTS.model, ...(raw.model || {}) }, budget: { ...DEFAULTS.budget, ...(raw.budget || {}) } };
    } catch (e) { console.error('读取 explorer.config.json 失败：', e.message); }
  }
  const cliQuestion = process.argv.slice(2).join(' ').trim();
  if (cliQuestion) cfg.question = cliQuestion;
  return cfg;
}

const cfg = loadConfig();
const VAULT = path.resolve(process.cwd(), cfg.vaultDir);
const PROJECT_FILE = path.join(VAULT, 'project.json');
const LOG_FILE = path.join(VAULT, 'explorer.log');

fs.mkdirSync(VAULT, { recursive: true });

function log(...args) {
  const line = `[${new Date().toLocaleString()}] ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- 模型调用（OpenAI 兼容） ----------
async function callLLM(messages, { json = false, maxTokens } = {}) {
  const url = cfg.model.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.model.apiKey) headers['Authorization'] = `Bearer ${cfg.model.apiKey}`;
  const body = {
    model: cfg.model.model,
    messages,
    max_tokens: maxTokens || cfg.budget.maxTokensPerCall,
    temperature: 0.7,
  };
  if (json) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (cfg.budget.timeoutSec || 180) * 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(t);
  }
}

function extractJSON(text) {
  let s = (text || '').replace(/```json\n?|\n?```/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

const shortTitle = (t) => String(t || '').trim().replace(/^(如何|怎么|怎样|为什么|什么是|关于)/u, '').replace(/[？?。.！!，,]+$/u, '').slice(0, 12);

// ---------- 项目状态 ----------
function loadProject() {
  if (fs.existsSync(PROJECT_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROJECT_FILE, 'utf8')); } catch {}
  }
  return null;
}
function saveProject(p) {
  fs.writeFileSync(PROJECT_FILE, JSON.stringify(p, null, 2));
}

function seedProject(question) {
  const name = shortTitle(question) || '研究项目';
  const overviewId = uid(), rootId = uid();
  return {
    name, question, createdAt: Date.now(),
    _meta: { budgetDate: new Date().toDateString(), stepsToday: 0, totalSteps: 0 },
    nodes: [
      { id: uid(), title: 'README', noteType: 'readme', status: 'solved', dependencies: [], confidence: 1,
        fullNote: `# ${name}\n\n> 自主探索项目（守护进程）\n\n## 核心问题\n${question}\n` },
      { id: overviewId, title: '总览', noteType: 'overview', status: 'solved', dependencies: [], confidence: 1,
        fullNote: `# ${name} · 总览\n\n## 现状\n（守护进程会持续更新）\n` },
      { id: rootId, title: shortTitle(question) || '核心问题', noteType: 'direction', status: 'unexplored',
        dependencies: [overviewId], confidence: 0, fullNote: '' },
    ],
  };
}

// ---------- 树/前沿 ----------
const isDir = (n) => n.noteType === 'direction' || !n.noteType;
function depthOf(node, byId) {
  let d = 0, cur = node, guard = 0;
  while (cur && guard++ < 20) {
    const parent = (cur.dependencies || []).map((id) => byId.get(id)).find((p) => p && isDir(p));
    if (!parent) break;
    d++; cur = parent;
  }
  return d;
}

function selectFrontier(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const unexplored = p.nodes.filter((n) => isDir(n) && n.status === 'unexplored');
  if (unexplored.length) {
    // 广度优先：浅的先做
    unexplored.sort((a, b) => depthOf(a, byId) - depthOf(b, byId));
    return unexplored[0];
  }
  return null;
}

// ---------- 执行 + 验证 ----------
async function explore(node, p) {
  const prompt = `你是资深研究员，正在深入探索这个关键节点。给出有深度、可落地的分析。
项目核心问题：${p.question}
当前节点：${node.title}
${node.fullNote ? `已有内容：${node.fullNote.slice(0, 300)}` : ''}

返回 JSON：
{
 "notes": "结构化探索笔记(Markdown, 400-800字)，含：## 探索现状  ## 关键发现  ## 方法与思路  ## 后续方向",
 "confidence": 0.0到1.0,
 "subProblems": [{"title":"子问题(名词短语,≤10字)"}]
}
要求：notes 具体、避免空话；subProblems 0-3 个，宁缺毋滥。`;
  const out = await callLLM([{ role: 'user', content: prompt }], { json: true });
  const parsed = extractJSON(out) || {};
  return {
    notes: String(parsed.notes || '').trim() || '（未产出有效内容）',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    subProblems: Array.isArray(parsed.subProblems)
      ? parsed.subProblems.map((s) => shortTitle(s && (s.title || s))).filter(Boolean).slice(0, 3)
      : [],
  };
}

async function critique(node, notes, p) {
  const prompt = `作为批判性评审，审查下面这段研究笔记的质量。
项目问题：${p.question}
节点：${node.title}
笔记：
${notes.slice(0, 1500)}

返回 JSON：{"score":0.0到1.0,"issues":["最多3条问题：空泛/无依据/自相矛盾/跑题等"],"verdict":"pass或needs_review"}
评判标准：是否具体有据、是否真的推进了对核心问题的理解。`;
  try {
    const out = await callLLM([{ role: 'user', content: prompt }], { json: true, maxTokens: 600 });
    const j = extractJSON(out) || {};
    return { score: typeof j.score === 'number' ? j.score : 0.5, issues: Array.isArray(j.issues) ? j.issues.slice(0, 3) : [] };
  } catch (e) {
    return { score: 0.5, issues: ['评审调用失败：' + e.message] };
  }
}

async function proposeDirection(p) {
  const existing = p.nodes.filter((n) => isDir(n)).map((n) => n.title).join('、');
  const prompt = `项目核心问题：${p.question}
已有方向：${existing || '（无）'}
请再提出 1 个还没覆盖、且值得深入的新关键方向，名词短语、不超过 10 字。只返回 JSON：{"title":"…","reason":"一句话理由"}`;
  try {
    const j = extractJSON(await callLLM([{ role: 'user', content: prompt }], { json: true, maxTokens: 300 })) || {};
    const title = shortTitle(j.title);
    return title ? { title, reason: String(j.reason || '') } : null;
  } catch { return null; }
}

// ---------- Markdown 输出 ----------
const sanitize = (s) => String(s || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '未命名';
function writeVaultMarkdown(p) {
  const dir = path.join(VAULT, sanitize(p.name));
  fs.mkdirSync(dir, { recursive: true });
  // 清掉旧 md（简单起见每轮重写）
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) fs.unlinkSync(path.join(dir, f)); } catch {}
  for (const n of p.nodes) {
    const fm = ['---', `title: ${JSON.stringify(n.title)}`, `type: ${n.noteType || 'direction'}`, `status: ${n.status}`, `confidence: ${n.confidence ?? ''}`, '---', ''].join('\n');
    fs.writeFileSync(path.join(dir, `${sanitize(n.title)}.md`), fm + (n.fullNote || ''));
  }
}

// ---------- 主循环 ----------
let project = loadProject();
let running = true;
process.on('SIGINT', () => { running = false; log('收到停止信号，存盘后退出…'); });

async function main() {
  if (!project) {
    if (!cfg.question) {
      console.error('\n没有可探索的问题。请在 server/explorer.config.json 里填 "question"，或运行：\n  node server/explorer-daemon.mjs "你的研究问题"\n');
      process.exit(1);
    }
    project = seedProject(cfg.question);
    saveProject(project); writeVaultMarkdown(project);
    log(`新建项目「${project.name}」，开始自主探索。`);
  } else {
    log(`载入项目「${project.name}」，继续探索。已探索 ${project._meta?.totalSteps || 0} 步。`);
  }
  log(`模型：${cfg.model.model} @ ${cfg.model.baseUrl} ｜ 每日上限 ${cfg.budget.maxStepsPerDay} 步 ｜ 间隔 ${cfg.budget.intervalSec}s`);

  while (running) {
    // 预算：跨天重置
    const today = new Date().toDateString();
    if (!project._meta) project._meta = { budgetDate: today, stepsToday: 0, totalSteps: 0 };
    if (project._meta.budgetDate !== today) { project._meta.budgetDate = today; project._meta.stepsToday = 0; }
    if (project._meta.stepsToday >= cfg.budget.maxStepsPerDay) {
      log(`今日预算已用完（${cfg.budget.maxStepsPerDay} 步），休眠 30 分钟…`);
      await sleep(30 * 60 * 1000); continue;
    }

    let node = selectFrontier(project);

    // 没有可探索前沿：在节点上限内自动提新方向，否则进入待命
    if (!node) {
      const dirCount = project.nodes.filter((n) => isDir(n)).length;
      if (dirCount < cfg.maxNodes) {
        const prop = await proposeDirection(project);
        if (prop) {
          const overview = project.nodes.find((n) => n.noteType === 'overview');
          node = { id: uid(), title: prop.title, noteType: 'direction', status: 'unexplored', dependencies: overview ? [overview.id] : [], confidence: 0, fullNote: '' };
          project.nodes.push(node);
          log(`🧭 自主提出新方向：「${prop.title}」（${prop.reason}）`);
        }
      }
      if (!node) { log('暂无可探索前沿，待命 5 分钟…'); await sleep(5 * 60 * 1000); continue; }
    }

    const byId = new Map(project.nodes.map((n) => [n.id, n]));
    node.status = 'exploring'; saveProject(project);
    log(`▶ 探索：「${node.title}」（第 ${depthOf(node, byId) + 1} 级）`);

    try {
      const res = await explore(node, project);
      const crit = await critique(node, res.notes, project);
      const pass = crit.score >= cfg.minConfidence;

      // 沉淀
      node.confidence = Math.min(res.confidence, crit.score);
      node.fullNote = `# ${node.title}\n\n${res.notes}\n\n---\n> 🔎 自评：置信度 ${(crit.score).toFixed(2)} · ${pass ? '通过' : '待人工复核'}` +
        (crit.issues.length ? `\n> 评审意见：${crit.issues.join('；')}` : '');
      node.status = pass ? 'solved' : 'needs_review';

      // 生成子节点（不超过深度/总量上限）
      const depth = depthOf(node, byId);
      if (depth + 1 < cfg.maxDepth && project.nodes.filter((n) => isDir(n)).length < cfg.maxNodes) {
        for (const t of res.subProblems) {
          if (project.nodes.some((n) => n.title === t)) continue;
          project.nodes.push({ id: uid(), title: t, noteType: 'direction', status: 'unexplored', dependencies: [node.id], confidence: 0, fullNote: '' });
        }
      }

      project._meta.stepsToday++; project._meta.totalSteps++;
      saveProject(project); writeVaultMarkdown(project);
      log(`✔ 完成「${node.title}」 置信度 ${node.confidence.toFixed(2)} ${pass ? '' : '⚠ 待复核'} ｜ 新增子问题 ${res.subProblems.length} ｜ 今日 ${project._meta.stepsToday}/${cfg.budget.maxStepsPerDay}`);
    } catch (e) {
      node.status = 'needs_review';
      node.fullNote = (node.fullNote || '') + `\n\n> ⚠ 探索失败：${e.message}`;
      saveProject(project); writeVaultMarkdown(project);
      log(`✘ 探索「${node.title}」失败：${e.message}`);
    }

    await sleep((cfg.budget.intervalSec || 20) * 1000);
  }

  saveProject(project); writeVaultMarkdown(project);
  log('已停止，状态已保存。');
  process.exit(0);
}

main().catch((e) => { log('守护进程异常退出：' + (e.stack || e.message)); process.exit(1); });
