import { v4 as uuidv4 } from 'uuid';
import {
  ProblemNode, NodeStatus, Probe, ProbeResult, ProbeCost,
  Evidence, EvidenceLayer, Hypothesis, DeviceProbeSpec, NumericCondition, ProbeMetric,
} from '../types';
import { callGemini } from './geminiService';
import { checkTriggers, summarizeHits, isContradictedByReality } from './validationTrigger';
import { loadDevices, actionMode, IoTDevice } from './iotService';
import { describeSpec } from './deviceProbe';

/**
 * 探针（Probe）：AI 在探索过程中向现实伸出去的小触角。
 *
 * 分工是有意这样切的：
 * - AI 负责**设计**验证方案——它做这个已经够用了。
 * - 人负责**执行和回填**——卡点从来在这一步，短期内也不打算自动化。
 *
 * 存在 Project.probes 里，跟 decisions 一样走现有的 idbSet 自动持久化，不新增任何后端。
 */

const LAYERS: EvidenceLayer[] = ['stated', 'behavior', 'outcome', 'environment', 'market'];
const COSTS: ProbeCost[] = ['low', 'medium', 'high'];

const METRICS: ProbeMetric[] = ['avg', 'max', 'min', 'last'];
const OPS: NumericCondition['op'][] = ['>', '>=', '<', '<=', 'between', 'outside'];

/** 解析模型给的判定条件；给不出合法数值就返回 undefined（宁可没有，也不要一个假阈值） */
export function parseCondition(raw: any): NumericCondition | undefined {
  if (!raw) return undefined;
  const op = OPS.includes(raw.op) ? raw.op : undefined;
  const value = typeof raw.value === 'number' ? raw.value : parseFloat(raw.value);
  if (!op || !Number.isFinite(value)) return undefined;
  const v2 = typeof raw.value2 === 'number' ? raw.value2 : parseFloat(raw.value2);
  return { op, value, value2: Number.isFinite(v2) ? v2 : undefined };
}

/**
 * 把模型给的设备实验配置落成 DeviceProbeSpec。
 *
 * 这里做了三件代码层面的强制，都是防止"实验"退化成走过场：
 * 1. 设备 / 动作必须是真实注册过的，模型编的一律丢掉；
 * 2. 只接受**只读**动作——自动采样绝不允许碰执行器；
 * 3. 采样次数和间隔都夹在合理区间，避免模型写出「采样 10000 次」把设备打爆。
 */
export function parseDeviceSpec(raw: any, devices: IoTDevice[]): DeviceProbeSpec | undefined {
  if (!raw) return undefined;
  const device = devices.find(d => d.id === raw.device_id && d.enabled);
  const action = device?.actions.find(a => a.id === raw.action_id);
  if (!device || !action) return undefined;
  if (actionMode(action) !== 'read') return undefined;

  const params: Record<string, string> = {};
  if (raw.params && typeof raw.params === 'object') {
    for (const [k, v] of Object.entries(raw.params)) params[k] = String(v);
  }
  const samples = Math.max(1, Math.min(60, Math.round(Number(raw.samples) || 5)));
  const intervalSec = Math.max(0, Math.min(3600, Math.round(Number(raw.interval_sec) || 5)));

  return {
    deviceId: device.id,
    deviceName: device.name,
    actionId: action.id,
    actionName: action.name,
    params: Object.keys(params).length ? params : undefined,
    readPath: typeof raw.read_path === 'string' ? raw.read_path.trim().slice(0, 60) || undefined : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit.trim().slice(0, 8) || undefined : undefined,
    samples,
    intervalSec,
    metric: METRICS.includes(raw.metric) ? raw.metric : 'avg',
    supportIf: parseCondition(raw.support_if),
    refuteIf: parseCondition(raw.refute_if),
  };
}

/** 从模型返回的 JSON 里解析出探针。纯函数（devices 由外面传进来），可单测。 */
export function parseProbes(
  raw: any, nodeId: string, hypothesis: string, now = Date.now(), devices: IoTDevice[] = [],
): Probe[] {
  const list = Array.isArray(raw?.probes) ? raw.probes : Array.isArray(raw) ? raw : [];
  return list
    .filter((p: any) => p && typeof p.method === 'string' && p.method.trim())
    .slice(0, 3)
    .map((p: any) => {
      const device = parseDeviceSpec(p.device, devices);
      return {
        id: uuidv4(),
        nodeId,
        kind: device ? ('device' as const) : ('manual' as const),
        device,
        hypothesis: hypothesis.slice(0, 200),
        method: String(p.method).trim().slice(0, 300),
        cost: COSTS.includes(p.cost) ? p.cost : 'low',
        effort: typeof p.effort === 'string' ? p.effort.trim().slice(0, 40) : undefined,
        // 设备实验的判定标准由 spec 自动生成，不采信模型的自由发挥——数字必须和真正会执行的阈值一致
        expectedSignal: device
          ? describeSpec(device)
          : (typeof p.expectedSignal === 'string' && p.expectedSignal.trim()
            ? p.expectedSignal.trim().slice(0, 300)
            : '（未写明判定标准——补上再执行，否则拿到数据会顺着想要的方向解释）'),
        status: 'draft' as const,
        createdAt: now,
      };
    });
}

/**
 * 让 AI 为一个节点设计 1-3 个低成本的现实验证方案。
 * 已注册 IoT 设备时，会把设备清单喂给它——**能用设备自动测的，就别让人去手动跑**。
 */
export async function designProbes(node: ProblemNode, goal?: string): Promise<Probe[]> {
  const h = node.hypothesis;
  const statement = h?.statement || node.title;
  const unknown = h?.unknown || '';

  // 只把只读动作给它看：自动实验永远不允许碰执行器
  const devices = loadDevices().filter(d => d.enabled);
  const readable = devices
    .map(d => ({ d, acts: d.actions.filter(a => actionMode(a) === 'read') }))
    .filter(x => x.acts.length);

  const deviceBlock = readable.length
    ? `\n\n【可用实验设备】优先用设备自动测，不要让人去手动跑能自动跑的东西。
${readable.map(({ d, acts }) =>
  `设备 device_id="${d.id}" 名称="${d.name}"：${d.description || '无说明'}\n` +
  acts.map(a => `  - action_id="${a.id}" 名称="${a.name}"：${a.description || '无说明'}`).join('\n')
).join('\n')}

想用设备时，在那个 probe 里加上 device 字段：
"device": {
  "device_id": "...", "action_id": "...",
  "params": {},
  "read_path": "从返回 JSON 里取哪个字段，如 data.temperature；整个响应就是数值则留空",
  "unit": "℃",
  "samples": 10, "interval_sec": 30,
  "metric": "avg|max|min|last",
  "support_if": {"op": ">", "value": 37.2},
  "refute_if": {"op": "<", "value": 36.8}
}
support_if / refute_if 是**跑之前就定死**的判定线，必须给具体数字。给不出数字就别用设备型。`
    : '';

  const prompt = `你在为一个正在探索的问题设计**现实验证**方案。目标不是继续分析，而是尽快让下面这个判断暴露在现实里。

${goal ? `项目目标：${goal}\n` : ''}节点：${node.title}
当前假设：${statement}
${unknown ? `最大未知量：${unknown}` : ''}
${node.validationReason ? `为什么需要验证：${node.validationReason}` : ''}${deviceBlock}

请返回 JSON：
{
  "probes": [
    {
      "method": "具体怎么做：找谁/用哪台设备、做什么、看什么。要具体到能直接照着执行",
      "cost": "low|medium|high",
      "effort": "预计投入，如「半天」「20 个用户」「采样 5 分钟」",
      "expectedSignal": "什么结果算支持、什么算反对——要给出可判定的界线",
      "device": null
    }
  ]
}

要求：
1. 只给 1-3 个，**优先最低成本、最快能拿到信号的**。一周以上才有结果的方案不要给。
2. method 必须是人能直接照着做的动作，不要写"进行市场调研"这种。
3. expectedSignal 必须事前给出判定界线（如"20 人里少于 8 人愿意留联系方式就算反对"）。含糊的判定等于没验证。
4. 不要设计需要先做出完整产品才能跑的验证。
5. 能用上面列出的设备自动采集数据的，一律优先用设备型（填 device 字段）。`;

  const raw = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
  let clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) clean = clean.slice(a, b + 1);
  try {
    return parseProbes(JSON.parse(clean), node.id, statement, Date.now(), devices);
  } catch {
    return [];
  }
}

/** 回填探针结果后，节点该变成什么样。纯函数——UI 只负责把返回的 updates 交给 updateNode。 */
export function applyProbeResult(
  node: ProblemNode,
  probe: Probe,
  result: ProbeResult,
): { updates: Partial<ProblemNode>; probe: Probe; contradicted: boolean } {
  const done: Probe = { ...probe, status: 'done', result };

  // unclear = 没测出来，不产生证据（硬塞一条"不确定"的证据只会污染统计）
  if (result.stance === 'unclear') {
    return { updates: {}, probe: done, contradicted: false };
  }

  const base: Hypothesis = node.hypothesis || {
    statement: probe.hypothesis,
    belief: 'medium',
    evidence: [],
    updatedAt: Date.now(),
  };

  const ev: Evidence = {
    id: uuidv4(),
    stance: result.stance,
    layer: LAYERS.includes(result.layer) ? result.layer : 'behavior',
    claim: result.summary.trim().slice(0, 200),
    source: `探针：${probe.method.slice(0, 40)}`,
    origin: 'probe',
    probeId: probe.id,
    createdAt: result.at || Date.now(),
  };

  const hypothesis: Hypothesis = {
    ...base,
    evidence: [...(base.evidence || []), ev],
    updatedAt: Date.now(),
  };

  const contradicted = isContradictedByReality(hypothesis);
  if (contradicted) {
    return {
      updates: { hypothesis, status: NodeStatus.CONTRADICTED, validationReason: '探针结果与假设冲突，需要转向', noteUpdatedAt: Date.now() },
      probe: done,
      contradicted: true,
    };
  }

  // 拿到现实证据后重跑一次触发器：还有没有别的理由继续等？没有就算验证通过。
  const hits = checkTriggers({ ...node, hypothesis, status: NodeStatus.VALIDATING, noteUpdatedAt: Date.now() }, []);
  return {
    updates: hits.length
      ? { hypothesis, status: NodeStatus.VALIDATING, validationReason: summarizeHits(hits), noteUpdatedAt: Date.now() }
      : { hypothesis, status: NodeStatus.SOLVED, validationReason: undefined, noteUpdatedAt: Date.now() },
    probe: done,
    contradicted: false,
  };
}

/** 某个节点的探针（最近在前） */
export const probesOf = (probes: Probe[] | undefined, nodeId: string): Probe[] =>
  (probes || []).filter(p => p.nodeId === nodeId).sort((a, b) => b.createdAt - a.createdAt);

/** 待执行（draft / running）的探针数——仪表盘和图标角标用 */
export const pendingProbeCount = (probes: Probe[] | undefined): number =>
  (probes || []).filter(p => p.status === 'draft' || p.status === 'running').length;
