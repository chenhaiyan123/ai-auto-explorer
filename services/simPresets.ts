import { SimParam, SimOutput } from './simSpec';
/**
 * 预置仿真实验（首屏用）。
 *
 * 为什么要有这个：落地页现在是一张「请填邮箱」的表单，跳出率 91%、平均停留 10 秒。
 * 访客在十秒内没有任何东西可以**动手**，也就没有理由留下。这里放几个拖一下滑块
 * 曲线就变的模型，让「先算清楚这个问题值不值得答」这句话在十秒内变成可触摸的东西。
 *
 * ⚠️ 三条不能破的规矩：
 *
 * 1. **仿真结果永远不是现实证据。** 这些模型是算术，不是观测。它们的输出
 *    `origin` 只能是 'sim'，而 'sim' 不在 `types.REAL_ORIGINS` 里——所以仿真
 *    跑一万次，节点也不会离开「等现实验证」，更不可能把假设判成「被现实推翻」。
 *    仿真的作用是**把模糊的假设变成带数字的假设**，好让你知道该去量哪一个数。
 *
 * 2. **每个模型必须自己交代它最脆弱的地方。** `realityCheck` 是必填字段，
 *    写的是「这个模型哪一步在瞎猜」；`probeHint` 写的是「花一天怎么把它验掉」。
 *    一个不肯说自己哪里靠不住的仿真，比没有仿真更糟。
 *
 * 3. **只放算术能算清的模型。** 这里三个全是复利/衰减/几何级数——数学上没有争议，
 *    争议全在输入的那几个数上，而那几个数正好只能问现实。不做需要编经验系数的
 *    物理、化学、生物模型：那种曲线看着最像科学，实际上是模型在编。
 *
 * 全部是纯函数，不碰 DOM、不调模型，可以直接单测。
 */

/*
 * 类型和 paramValues 都从 simSpec 来——首屏这三个手写模型和 AI 生成的仿真
 * 共用同一套输出结构，图表组件才能只写一遍。这里重新导出是为了不改动已有的 import。
 */
export type { SimParam, SimSeries, SimOutput } from './simSpec';
export { paramValues } from './simSpec';

export interface SimPreset {
  id: string;
  icon: string;
  title: string;
  /** 它在回答的那个问题 */
  question: string;
  params: SimParam[];
  run(v: Record<string, number>): SimOutput;
  /** 这个模型最脆弱的假设是什么 */
  realityCheck: string;
  /** 花一天怎么把那个假设验掉 */
  probeHint: string;
}

// ---------- 小工具 ----------

const round = (n: number, d = 1) => {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
};

// ---------- ① 留存衰减 ----------

/**
 * 一批新用户随时间流失。用幂律留存 r(d) = r1 · d^(-α)。
 *
 * 为什么用幂律不用指数：真实产品的留存曲线普遍是「前几天掉得很凶、之后拖出一条
 * 长尾」，指数衰减会把长尾算没，幂律更接近观察到的形状。但 α 具体是多少，
 * 除了看你自己的后台数据，没有任何办法知道——这正是要去问现实的那个数。
 */
export function retentionCurve(r1: number, alpha: number, days = 30): number[] {
  const out = [100];
  for (let d = 1; d <= days; d++) {
    out.push(round(100 * (r1 / 100) * Math.pow(d, -alpha), 2));
  }
  return out;
}

const retention: SimPreset = {
  id: 'retention',
  icon: '🪫',
  title: '留存衰减',
  question: '100 个人今天来了，一个月后还剩几个？',
  params: [
    { key: 'r1', label: '次日留存', min: 5, max: 80, step: 1, value: 30, unit: '%' },
    { key: 'alpha', label: '衰减指数 α', min: 0.1, max: 1.5, step: 0.05, value: 0.6, soft: true },
    { key: 'daily', label: '每天新增', min: 10, max: 2000, step: 10, value: 100, unit: '人' },
  ],
  run: v => {
    const curve = retentionCurve(v.r1, v.alpha, 30);
    const left = curve[30];
    // 稳态日活 = 每天新增 × (今天来的 1 + 之前每一天还留着的比例之和)
    let sum = 1;
    for (let d = 1; d <= 180; d++) sum += (v.r1 / 100) * Math.pow(d, -v.alpha);
    const dau = v.daily * sum;
    return {
      x: curve.map((_, i) => i),
      xLabel: '天',
      yLabel: '还在用的人数',
      series: [{ label: '这 100 人剩下多少', color: '#38bdf8', points: curve }],
      headline: `100 个人里，30 天后还剩 ${round(left, 1)} 个`,
      bad: left < 5,
      readouts: [
        { label: '30 天后剩', value: `${round(left, 1)} 人`, bad: left < 5 },
        { label: '稳态日活', value: `${Math.round(dau)} 人` },
        { label: '每个新用户折合', value: `${round(sum, 1)} 个活跃人日` },
      ],
    };
  },
  realityCheck: 'α 是这条曲线的命门，而它是你拍的。α=0.4 和 α=0.9 算出来的稳态日活能差 3 倍以上——但两条曲线在前 3 天几乎重合，靠肉眼分不出来。',
  probeHint: '打开你的后台，导出任意一周注册的用户，数一下他们第 1 / 7 / 30 天分别还剩多少，两个点就能反解出 α。',
};

// ---------- ② 单位经济 ----------

/**
 * 一个付费用户这辈子能赚回多少，多久回本。
 * 纯复利算术：每月贡献 ARPU×毛利率，存活率按 (1-churn) 逐月衰减。
 */
export function cumulativeMargin(cac: number, arpu: number, churn: number, gm: number, months = 24): number[] {
  const out: number[] = [-cac];
  let alive = 1;
  let cum = -cac;
  for (let m = 1; m <= months; m++) {
    cum += arpu * (gm / 100) * alive;
    alive *= 1 - churn / 100;
    out.push(round(cum, 1));
  }
  return out;
}

const unitEconomics: SimPreset = {
  id: 'unit-economics',
  icon: '💸',
  title: '单位经济',
  question: '花钱买来一个用户，多久能回本？',
  params: [
    { key: 'cac', label: '获客成本', min: 5, max: 1000, step: 5, value: 120, unit: '元' },
    { key: 'arpu', label: '每月付费', min: 5, max: 500, step: 5, value: 30, unit: '元' },
    { key: 'churn', label: '月流失率', min: 1, max: 40, step: 1, value: 12, unit: '%', soft: true },
    { key: 'gm', label: '毛利率', min: 20, max: 95, step: 5, value: 80, unit: '%' },
  ],
  run: v => {
    const curve = cumulativeMargin(v.cac, v.arpu, v.churn, v.gm, 24);
    const ltv = (v.arpu * (v.gm / 100)) / (v.churn / 100);
    const ratio = ltv / v.cac;
    // 第一个转正的月份；始终为负说明这门生意本身不成立
    const payback = curve.findIndex((c, i) => i > 0 && c >= 0);
    const ok = payback > 0;
    return {
      x: curve.map((_, i) => i),
      xLabel: '月',
      yLabel: '累计毛利（元）',
      series: [{ label: '单个用户累计贡献', color: ratio >= 3 ? '#34d399' : '#f472b6', points: curve }],
      headline: ok
        ? `第 ${payback} 个月回本，LTV/CAC = ${round(ratio, 1)}`
        : `24 个月都回不了本，LTV/CAC = ${round(ratio, 1)}`,
      bad: !ok || ratio < 3,
      readouts: [
        { label: '生命周期价值', value: `${Math.round(ltv)} 元` },
        { label: 'LTV / CAC', value: `${round(ratio, 1)}×`, bad: ratio < 3 },
        { label: '回本时间', value: ok ? `${payback} 个月` : '回不了本', bad: !ok },
      ],
    };
  },
  realityCheck: '模型假设流失率每月恒定。真实的流失几乎从来不恒定——头两个月掉一大批，剩下的人反而很粘。用一个恒定 churn 算长期 LTV，通常会**低估**忠实用户、**高估**整体，两个偏差互相掩盖，看着像对的。',
  probeHint: '别去问「你会续费吗」。翻出三个月前的付费名单，数一下今天还有多少人在扣款——真实的数字通常和你估的差一半。',
};

// ---------- ③ 口碑扩散 ----------

/**
 * 病毒系数 k = 每人邀请数 × 邀请转化率。
 * k < 1：几何级数收敛，总量停在 n0/(1-k)，无论跑多久。
 * k > 1：指数起飞。
 *
 * 这个模型的价值不在预测，而在于让人一眼看见 k=0.9 和 k=1.1 之间那道悬崖。
 */
export function diffusionCurve(n0: number, k: number, rounds = 12): number[] {
  const out = [n0];
  let wave = n0;
  let total = n0;
  for (let i = 1; i <= rounds; i++) {
    wave = wave * k;
    total += wave;
    out.push(Math.round(total));
  }
  return out;
}

const diffusion: SimPreset = {
  id: 'diffusion',
  icon: '📣',
  title: '口碑扩散',
  question: '靠用户互相推荐，最后能长到多大？',
  params: [
    { key: 'n0', label: '起始用户', min: 10, max: 1000, step: 10, value: 100, unit: '人' },
    { key: 'invites', label: '每人推荐给', min: 0, max: 10, step: 0.5, value: 3, unit: '人', soft: true },
    { key: 'conv', label: '被推荐后注册率', min: 0, max: 60, step: 1, value: 25, unit: '%', soft: true },
  ],
  run: v => {
    const k = (v.invites * v.conv) / 100;
    const curve = diffusionCurve(v.n0, k, 12);
    const ceiling = k < 1 ? v.n0 / (1 - k) : Infinity;
    return {
      x: curve.map((_, i) => i),
      xLabel: '传播轮次',
      yLabel: '累计用户',
      series: [{ label: '累计用户', color: k >= 1 ? '#34d399' : '#fbbf24', points: curve }],
      headline: k >= 1
        ? `k = ${round(k, 2)} ≥ 1：不用再买量，自己会长`
        : `k = ${round(k, 2)} < 1：最多长到 ${Math.round(ceiling)} 人就熄火`,
      bad: k < 1,
      readouts: [
        { label: '病毒系数 k', value: round(k, 2).toFixed(2), bad: k < 1 },
        { label: '12 轮后', value: `${curve[12]} 人` },
        { label: '天花板', value: k < 1 ? `${Math.round(ceiling)} 人` : '无上限（理论上）', bad: k < 1 },
      ],
    };
  },
  realityCheck: '真实世界里 k 会随时间掉：最早那批人推荐得最起劲，越往后推荐意愿越低，而且社交圈会重叠——第三轮被推荐的人，很可能第一轮已经被推荐过了。这个模型把 k 当常数，所以 k>1 那条曲线一定比现实乐观。',
  probeHint: '给现有用户一个专属邀请链接，跑两周，数：多少人真的发出去了、发出去的带回来几个注册。这两个数相乘就是你真实的 k，通常比估的低一个数量级。',
};

// ---------- 导出 ----------

export const SIM_PRESETS: SimPreset[] = [retention, unitEconomics, diffusion];

export const getPreset = (id: string): SimPreset | undefined => SIM_PRESETS.find(p => p.id === id);

/** 首屏那句永远不能省的话 */
export const SIM_DISCLAIMER = '这只是仿真，它给你方向；真答案要问现实';
