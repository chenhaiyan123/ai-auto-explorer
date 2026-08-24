import { tryCompile, Compiled, run, FUNCS } from './expr';

/**
 * 仿真规格（SimSpec）：一个「问题 → 可拖动的实验」的声明式描述。
 *
 * 这是 PhET 那种「拖滑块看曲线」在本产品里的落法，但有一条底线跟 PhET 不一样：
 * **PhET 背后是被验证过几百年的物理定律，我们背后只有一个模型的推测。**
 * 所以这里所有的设计都围绕同一件事——让人看清楚这条曲线是怎么算出来的、
 * 以及它在哪一步是猜的。
 *
 * 三条硬约束：
 *
 * 1. **模型不写代码，只写公式。** 见 `services/expr.ts`。AI 输出的是参数和递推式，
 *    由我们自己的求值器解释执行，结构上就不可能执行任意 JS，也就碰不到用户
 *    存在 localStorage 里的模型 Key。
 *
 * 2. **公式必须摊给用户看。** `specToMarkdown` 把递推式原样写进笔记正文。
 *    仿真最危险的地方是它长得像证据；能被读到的公式是唯一有效的解药。
 *
 * 3. **仿真结果永远不是现实证据。** 这个文件不产出任何 `Evidence`，
 *    唯一通向现实的出口是 `simToProbeDraft`——把「最敏感的那个参数」变成一个探针，
 *    等人真的去量了、回填了，才会有 `origin:'probe'` 的证据。
 *
 * 全部纯函数，可单测。
 */

// ---------- 通用输出结构（首屏预置仿真也用这套）----------

export interface SimParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 默认值 */
  value: number;
  unit?: string;
  /** 这个数你多半只能靠猜——界面上会打问号 */
  soft?: boolean;
  /** 为什么它是猜的 */
  why?: string;
}

export interface SimSeries {
  label: string;
  color: string;
  points: number[];
}

export interface SimOutput {
  x: number[];
  xLabel: string;
  yLabel: string;
  series: SimSeries[];
  /** 一句话结论 */
  headline: string;
  /** 结论是坏消息时用告警色 */
  bad?: boolean;
  readouts: { label: string; value: string; bad?: boolean }[];
  /** 算不下去时的说明（除零、溢出）。有值时曲线是被截断的。 */
  note?: string;
}

// ---------- 规格 ----------

export interface SimSeriesSpec {
  /** 必须是某个状态变量名 */
  key: string;
  label: string;
  color?: string;
}

export interface SimReadoutSpec {
  /** headline 模板里用 {key} 引用 */
  key: string;
  label: string;
  expr: string;
  unit?: string;
  digits?: number;
  /** 满足这个条件时这个读数标红（表达式，可用和 readout 相同的作用域） */
  badIf?: string;
}

export interface SimSpec {
  version: 1;
  title: string;
  /** 它在回答的那个问题 */
  question: string;
  /** 在验哪句假设（快照——假设后来改了也能追溯当时在验什么） */
  hypothesis?: string;
  /** 跑多少步 */
  steps: number;
  xLabel: string;
  yLabel: string;
  params: SimParam[];
  /** 状态变量初值：变量名 → 表达式（只能引用参数和常量） */
  init: Record<string, string>;
  /** 每步递推：变量名 → 表达式（可引用参数、`t`、以及上一步的各状态变量） */
  step: Record<string, string>;
  series: SimSeriesSpec[];
  readouts: SimReadoutSpec[];
  /** 结论模板，`{readoutKey}` 会被替换成对应读数 */
  headline: string;
  /** headline 用告警色的条件（表达式） */
  badIf?: string;
  /** 这个模型最脆弱的假设是什么——必填 */
  realityCheck: string;
  /** 花一天怎么把它验掉——必填 */
  probeHint: string;
  createdAt: number;
}

// ---------- 上限（模型偶尔会写出离谱的数，先夹住）----------

export const MAX_STEPS = 200;
export const MAX_PARAMS = 6;
export const MAX_VARS = 8;
export const MAX_SERIES = 3;
export const MAX_READOUTS = 4;

const PALETTE = ['#38bdf8', '#a78bfa', '#fbbf24'];

/** 提示词里要告诉模型能用哪些函数——从白名单直接生成，防止文档和实现走散 */
export const FUNC_LIST = Object.keys(FUNCS).join('、');

// ---------- 解析与校验 ----------

const str = (v: any, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fin = (v: any, dflt: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

/** 合法的变量名/参数名：不许和内置常量、函数名撞车，也不许是 `t` */
const RESERVED = new Set(['t', 'PI', 'E']);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

export interface ParseResult {
  spec?: SimSpec;
  /** 为什么没解析成功 / 哪里被丢掉了。要给用户看，不能吞。 */
  problems: string[];
}

/**
 * 把模型返回的 JSON 变成 SimSpec。
 *
 * 校验是**严格**的：任何一条公式引用了不存在的变量、调用了不存在的函数、
 * 或者根本不是合法表达式，整个仿真就不生成——宁可告诉用户"这次没生成出来"，
 * 也不要给一条算错的曲线。曲线比文字更容易被当真。
 */
export function parseSimSpec(raw: any, now = Date.now()): ParseResult {
  const problems: string[] = [];
  const bail = (m: string): ParseResult => { problems.push(m); return { problems }; };

  if (!raw || typeof raw !== 'object') return bail('模型没有返回可用的 JSON');

  const title = str(raw.title, 40);
  const question = str(raw.question, 80);
  if (!title || !question) return bail('缺少标题或要回答的问题');

  const realityCheck = str(raw.reality_check ?? raw.realityCheck, 400);
  const probeHint = str(raw.probe_hint ?? raw.probeHint, 400);
  // 不肯说自己哪里靠不住的仿真，比没有仿真更糟——直接拒收
  if (realityCheck.length < 10) return bail('模型没说清这个仿真哪里靠不住（reality_check）');
  if (probeHint.length < 10) return bail('模型没给出去现实验证的办法（probe_hint）');

  // --- 参数 ---
  const rawParams = Array.isArray(raw.params) ? raw.params.slice(0, MAX_PARAMS) : [];
  const params: SimParam[] = [];
  for (const p of rawParams) {
    const key = str(p?.key, 24);
    if (!NAME_RE.test(key) || RESERVED.has(key)) { problems.push(`参数名不合法：${key || '(空)'}`); continue; }
    if (params.some(x => x.key === key)) { problems.push(`参数重名：${key}`); continue; }
    let min = fin(p.min, 0);
    let max = fin(p.max, 1);
    if (min > max) [min, max] = [max, min];
    if (min === max) max = min + 1;
    const step = Math.max(1e-6, Math.abs(fin(p.step, (max - min) / 20)));
    params.push({
      key,
      label: str(p.label, 20) || key,
      min, max, step,
      value: Math.min(max, Math.max(min, fin(p.value ?? p.default, (min + max) / 2))),
      unit: str(p.unit, 6) || undefined,
      soft: !!p.soft,
      why: str(p.why, 120) || undefined,
    });
  }
  if (!params.length) return bail('一个可调参数都没有——那就不是仿真，是一句结论');
  // 至少要有一个「你其实是猜的」参数，否则整个模块的意义就没了
  if (!params.some(p => p.soft)) params[params.length - 1].soft = true;

  const paramKeys = params.map(p => p.key);

  // --- 状态变量 ---
  const rawInit = raw.init && typeof raw.init === 'object' ? raw.init : {};
  const varNames = Object.keys(rawInit).slice(0, MAX_VARS);
  if (!varNames.length) return bail('没有定义任何状态变量（init）');

  const initC: Record<string, Compiled> = {};
  for (const name of varNames) {
    if (!NAME_RE.test(name) || RESERVED.has(name) || paramKeys.includes(name)) {
      return bail(`状态变量名不合法或与参数重名：${name}`);
    }
    const c = tryCompile(String(rawInit[name] ?? ''));
    if (!c) return bail(`初值公式写不出来：${name} = ${rawInit[name]}`);
    const unknown = c.idents.filter(i => !paramKeys.includes(i));
    if (unknown.length) return bail(`初值 ${name} 用到了不存在的量：${unknown.join('、')}`);
    initC[name] = c;
  }

  const rawStep = raw.step && typeof raw.step === 'object' ? raw.step : {};
  const allowedInStep = new Set([...paramKeys, ...varNames, 't']);
  const stepC: Record<string, Compiled> = {};
  for (const name of varNames) {
    const src = rawStep[name];
    if (src === undefined || src === null || String(src).trim() === '') {
      stepC[name] = tryCompile(name)!;   // 没给递推式就是保持不变（变量名一定编得过）
      continue;
    }
    const c = tryCompile(String(src));
    if (!c) return bail(`递推公式写不出来：${name} = ${src}`);
    const unknown = c.idents.filter(i => !allowedInStep.has(i));
    if (unknown.length) return bail(`递推 ${name} 用到了不存在的量：${unknown.join('、')}`);
    stepC[name] = c;
  }

  // --- 曲线 ---
  const rawSeries = Array.isArray(raw.series) ? raw.series.slice(0, MAX_SERIES) : [];
  const series: SimSeriesSpec[] = [];
  rawSeries.forEach((s: any, i: number) => {
    const key = str(s?.key, 24);
    if (!varNames.includes(key)) { problems.push(`要画的曲线 ${key || '(空)'} 不是状态变量，已跳过`); return; }
    series.push({ key, label: str(s.label, 24) || key, color: PALETTE[i % PALETTE.length] });
  });
  if (!series.length) {
    // 模型没说画哪条就画第一个状态变量——这个回退是安全的，不涉及编数
    series.push({ key: varNames[0], label: varNames[0], color: PALETTE[0] });
  }

  // --- 读数 ---
  // 读数能用的量：参数 + 每个状态变量的末值 / 最大 / 最小 / 累计 / 首次转正的步数
  const readoutScope = new Set<string>(paramKeys);
  for (const v of varNames) {
    readoutScope.add(v);
    for (const pre of ['last_', 'max_', 'min_', 'sum_', 'cross_']) readoutScope.add(pre + v);
  }
  const readouts: SimReadoutSpec[] = [];
  for (const r of (Array.isArray(raw.readouts) ? raw.readouts.slice(0, MAX_READOUTS) : [])) {
    const key = str(r?.key, 24);
    const c = tryCompile(String(r?.expr ?? ''));
    if (!NAME_RE.test(key)) { problems.push(`读数 key 不合法：${key || '(空)'}`); continue; }
    if (!c) { problems.push(`读数公式写不出来：${key}`); continue; }
    const unknown = c.idents.filter(i => !readoutScope.has(i));
    if (unknown.length) { problems.push(`读数 ${key} 用到了不存在的量：${unknown.join('、')}`); continue; }
    const badIf = str(r.bad_if ?? r.badIf, 200);
    if (badIf) {
      const bc = tryCompile(badIf);
      if (!bc || bc.idents.some(i => !readoutScope.has(i))) {
        problems.push(`读数 ${key} 的告警条件不合法，已忽略`);
      }
    }
    readouts.push({
      key,
      label: str(r.label, 20) || key,
      expr: c.src,
      unit: str(r.unit, 6) || undefined,
      digits: Math.max(0, Math.min(3, Math.round(fin(r.digits, 1)))),
      badIf: badIf || undefined,
    });
  }
  if (!readouts.length) return bail('没有任何关键读数——曲线好看但读不出结论，没有意义');

  const headline = str(raw.headline, 120) || `${readouts[0].label}：{${readouts[0].key}}`;
  const badIf = str(raw.bad_if ?? raw.badIf, 200) || undefined;
  if (badIf && !tryCompile(badIf)) problems.push('结论告警条件不合法，已忽略');

  const spec: SimSpec = {
    version: 1,
    title, question,
    hypothesis: str(raw.hypothesis, 200) || undefined,
    steps: Math.max(2, Math.min(MAX_STEPS, Math.round(fin(raw.steps, 24)))),
    xLabel: str(raw.x_label ?? raw.xLabel, 12) || '步',
    yLabel: str(raw.y_label ?? raw.yLabel, 16) || '',
    params,
    init: Object.fromEntries(varNames.map(n => [n, initC[n].src])),
    step: Object.fromEntries(varNames.map(n => [n, stepC[n].src])),
    series, readouts, headline,
    badIf: badIf && tryCompile(badIf) ? badIf : undefined,
    realityCheck, probeHint,
    createdAt: now,
  };
  return { spec, problems };
}

// ---------- 运行 ----------

/** 取参数值，越界夹回、缺失回落默认 */
export function paramValues(spec: { params: SimParam[] }, override: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of spec.params) {
    const raw = override[p.key];
    out[p.key] = Number.isFinite(raw) ? Math.min(p.max, Math.max(p.min, raw)) : p.value;
  }
  return out;
}

/**
 * `cross_x` 用 -1 表示「从未发生」。这是系统里唯一一个哨兵值，
 * 所以显示的时候必须翻译回人话——界面上出现一个「回本时间 -1 个月」比不显示更糟。
 */
export const isNeverSentinel = (expr: string, v: number): boolean =>
  /\bcross_\w+/.test(expr) && v < 0;

const fmtNum = (v: number, digits = 1): string => {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 100000) return `${Math.round(v / 1000)}k`;
  const p = Math.pow(10, digits);
  const r = Math.round(v * p) / p;
  return String(r);
};

export interface SimRun extends SimOutput {
  /** 每个状态变量的完整轨迹（导出笔记、做敏感度分析都用它） */
  history: Record<string, number[]>;
  /** 读数的原始数值（不是格式化后的串） */
  values: Record<string, number>;
}

/**
 * 跑一次仿真。
 *
 * 遇到算不出来的一步（除零、溢出）**就地截断并说明**，不做任何插值补点——
 * 补出来的点是我们编的，不是模型算的。
 */
export function runSim(spec: SimSpec, override: Record<string, number> = {}): SimRun {
  const values = paramValues(spec, override);
  const varNames = Object.keys(spec.init);

  // 用 tryCompile 而不是 compile：存量数据 / 手改过的 spec 不应该让整个笔记白屏
  const initC: Record<string, Compiled | null> = {};
  const stepC: Record<string, Compiled | null> = {};
  for (const n of varNames) {
    initC[n] = tryCompile(spec.init[n] ?? '0');
    stepC[n] = tryCompile(spec.step[n] ?? n);
  }
  const broken = varNames.filter(n => !initC[n] || !stepC[n]);

  const history: Record<string, number[]> = {};
  let state: Record<string, number> = {};
  for (const n of varNames) {
    const v = initC[n] ? run(initC[n]!, values) : NaN;
    state[n] = v;
    history[n] = [v];
  }

  let note: string | undefined = broken.length
    ? `公式已损坏（${broken.join('、')}），这条曲线不可信。`
    : undefined;
  let steps = 0;
  outer: for (let t = 1; t <= spec.steps; t++) {
    const scope = { ...values, ...state, t };
    const next: Record<string, number> = {};
    for (const n of varNames) {
      const v = stepC[n] ? run(stepC[n]!, scope) : NaN;
      if (!Number.isFinite(v)) {
        note = note || `公式在第 ${t} 步算不出数了（除零或溢出），曲线到此为止。`;
        break outer;
      }
      next[n] = v;
    }
    state = next;
    for (const n of varNames) history[n].push(state[n]);
    steps = t;
  }

  // --- 读数作用域 ---
  const agg: Record<string, number> = { ...values };
  for (const n of varNames) {
    const h = history[n];
    agg[n] = h[h.length - 1];
    agg['last_' + n] = h[h.length - 1];
    agg['max_' + n] = Math.max(...h);
    agg['min_' + n] = Math.min(...h);
    agg['sum_' + n] = h.reduce((a, b) => a + b, 0);
    // 第一次由负转正的步数；从未转正返回 -1（模板里可以用 cross_x < 0 判断）
    agg['cross_' + n] = h.findIndex((v, i) => i > 0 && v >= 0);
  }

  const readValues: Record<string, number> = {};
  const readouts = spec.readouts.map(r => {
    const c = tryCompile(r.expr);
    const v = c ? run(c, agg) : NaN;
    readValues[r.key] = v;
    const bc = r.badIf ? tryCompile(r.badIf) : null;
    return {
      label: r.label,
      value: isNeverSentinel(r.expr, v) ? '从未' : fmtNum(v, r.digits) + (r.unit || ''),
      bad: bc ? run(bc, agg) === 1 : undefined,
    };
  });

  // headline 模板里的 {key} 替换成格式化后的读数
  const headline = spec.headline.replace(/\{(\w+)\}/g, (_, k) => {
    const r = spec.readouts.find(x => x.key === k);
    if (!r) return '—';
    return isNeverSentinel(r.expr, readValues[k]) ? '从未' : fmtNum(readValues[k], r.digits) + (r.unit || '');
  });
  const badC = spec.badIf ? tryCompile(spec.badIf) : null;

  return {
    x: Array.from({ length: steps + 1 }, (_, i) => i),
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
    series: spec.series.map((s, i) => ({
      label: s.label,
      color: s.color || PALETTE[i % PALETTE.length],
      points: history[s.key] || [],
    })),
    headline,
    bad: badC ? run(badC, agg) === 1 : undefined,
    readouts,
    note,
    history,
    values: readValues,
  };
}

// ---------- 敏感度：这条曲线最怕你猜错哪个数 ----------

/** 把某个读数的原始数值格式化成人话（哨兵值 → 「从未」，带上单位） */
export function formatReadout(spec: SimSpec, readoutKey: string, v: number): string {
  const r = spec.readouts.find(x => x.key === readoutKey);
  if (!r) return fmtNum(v, 1);
  return isNeverSentinel(r.expr, v) ? '从未' : fmtNum(v, r.digits) + (r.unit || '');
}

export interface Sensitivity {
  paramKey: string;
  paramLabel: string;
  readoutKey: string;
  readoutLabel: string;
  /** 该参数从 min 到 max 扫一遍，这个读数的最小/最大值 */
  low: number;
  high: number;
  /** 相对当前值的倍数跨度，用来排序（当前值为 0 时用差的绝对值） */
  spread: number;
  soft: boolean;
}

/**
 * 把每个参数从 min 扫到 max，看某个读数会晃到什么程度。
 *
 * 这是整个仿真模块真正有用的那一步：曲线本身只是模型的推测，
 * 但「结论对哪个数最敏感」是这条推测自身的客观性质——那个数就是你该花一天去量的东西。
 */
export function sensitivity(spec: SimSpec, override: Record<string, number> = {}, samples = 9): Sensitivity[] {
  const base = paramValues(spec, override);
  const out: Sensitivity[] = [];
  for (const p of spec.params) {
    // 一个参数扫一遍就够了，所有读数一起收——不要按 参数×读数 重复跑仿真
    const lo: Record<string, number> = {};
    const hi: Record<string, number> = {};
    for (let i = 0; i < samples; i++) {
      const v = p.min + ((p.max - p.min) * i) / (samples - 1);
      const res = runSim(spec, { ...base, [p.key]: v });
      for (const r of spec.readouts) {
        const y = res.values[r.key];
        if (!Number.isFinite(y)) continue;
        lo[r.key] = r.key in lo ? Math.min(lo[r.key], y) : y;
        hi[r.key] = r.key in hi ? Math.max(hi[r.key], y) : y;
      }
    }
    for (const r of spec.readouts) {
      if (!(r.key in lo)) continue;
      const mid = Math.max(Math.abs(lo[r.key]), Math.abs(hi[r.key]));
      out.push({
        paramKey: p.key, paramLabel: p.label,
        readoutKey: r.key, readoutLabel: r.label,
        low: lo[r.key], high: hi[r.key],
        spread: mid === 0 ? 0 : (hi[r.key] - lo[r.key]) / mid,
        soft: !!p.soft,
      });
    }
  }
  // 猜出来的参数优先，其次晃得越厉害越靠前
  return out.sort((a, b) => (Number(b.soft) - Number(a.soft)) || (b.spread - a.spread));
}

/** 最该去问现实的那一个 */
export const topSensitivity = (s: Sensitivity[]): Sensitivity | undefined => s.find(x => x.spread > 0) || s[0];

// ---------- 通向现实的唯一出口 ----------

/**
 * 把「最敏感的那个参数」变成一个探针草稿。
 *
 * 注意这里返回的是**探针**，不是证据。仿真本身不产生任何 Evidence，
 * 只有人真的去量了、把结果回填进探针，才会有 `origin:'probe'` 的证据。
 */
export function simToProbeDraft(spec: SimSpec, override: Record<string, number> = {}): {
  hypothesis: string; method: string; expectedSignal: string; effort: string;
} | null {
  const s = topSensitivity(sensitivity(spec, override));
  if (!s) return null;
  const p = spec.params.find(x => x.key === s.paramKey);
  const lo = formatReadout(spec, s.readoutKey, s.low), hi = formatReadout(spec, s.readoutKey, s.high);
  return {
    hypothesis: spec.hypothesis || spec.question,
    method: `${spec.probeHint}\n\n（要量的是「${s.paramLabel}」——仿真里它从 ${p?.min}${p?.unit || ''} 到 ${p?.max}${p?.unit || ''} 扫一遍，${s.readoutLabel} 就在 ${lo} 和 ${hi} 之间来回。）`,
    expectedSignal: `量出来的「${s.paramLabel}」落在 ${p?.min}–${p?.max}${p?.unit || ''} 的哪一段，就按仿真里对应的那条曲线走；` +
      `若量不出来或明显超出这个范围，说明模型的结构本身就错了，该重做假设而不是调参数。`,
    effort: '一天以内',
  };
}

// ---------- 导出成笔记正文 ----------

/**
 * 仿真笔记的正文。
 *
 * 刻意把公式原样写出来：这篇笔记会被导出成 Obsidian 里的一个 md 文件，
 * 半年后回头看，「当时那条曲线是怎么算的」必须还能查到，否则它就只是一张好看的图。
 */
export function specToMarkdown(spec: SimSpec, out?: SimRun): string {
  const L: string[] = [];
  L.push(`# 🧪 ${spec.title}`);
  L.push('');
  L.push(`> ${spec.question}`);
  L.push('');
  L.push('> [!warning] 这是仿真，不是证据');
  L.push('> 下面这条曲线是**按假设推算**出来的，不是观测到的。');
  L.push('> 它不会计入任何一条现实证据，也不会让节点离开「等现实验证」。');
  L.push('> 它唯一的用处是告诉你：**该去量哪一个数。**');
  L.push('');

  if (spec.hypothesis) {
    L.push('## 在验哪句话');
    L.push('');
    L.push(spec.hypothesis);
    L.push('');
  }

  if (out) {
    L.push('## 当前结论');
    L.push('');
    L.push(`**${out.headline}**`);
    L.push('');
    for (const r of out.readouts) L.push(`- ${r.label}：${r.value}`);
    if (out.note) { L.push(''); L.push(`> ${out.note}`); }
    L.push('');
  }

  L.push('## 可调参数');
  L.push('');
  L.push('| 参数 | 范围 | 当前 | 是不是猜的 |');
  L.push('| --- | --- | --- | --- |');
  for (const p of spec.params) {
    const u = p.unit || '';
    L.push(`| ${p.label} | ${p.min}${u} – ${p.max}${u} | ${p.value}${u} | ${p.soft ? `⚠️ 是${p.why ? '：' + p.why : ''}` : '有依据' } |`);
  }
  L.push('');

  L.push('## 这条曲线是怎么算的');
  L.push('');
  L.push('初值：');
  L.push('');
  L.push('```');
  for (const [k, v] of Object.entries(spec.init)) L.push(`${k} = ${v}`);
  L.push('```');
  L.push('');
  L.push(`每一步（${spec.xLabel}，共 ${spec.steps} 步）：`);
  L.push('');
  L.push('```');
  for (const [k, v] of Object.entries(spec.step)) L.push(`${k} ← ${v}`);
  L.push('```');
  L.push('');

  L.push('## ⚠️ 这个模型哪里靠不住');
  L.push('');
  L.push(spec.realityCheck);
  L.push('');

  L.push('## 怎么去问现实');
  L.push('');
  L.push(spec.probeHint);
  L.push('');

  const s = topSensitivity(sensitivity(spec));
  if (s) {
    L.push(`**最该去量的数：${s.paramLabel}。** 它从最小扫到最大，`
      + `「${s.readoutLabel}」就在 ${formatReadout(spec, s.readoutKey, s.low)} 和 ${formatReadout(spec, s.readoutKey, s.high)} 之间来回。`);
    L.push('');
  }
  return L.join('\n');
}
