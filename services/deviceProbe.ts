import {
  DeviceProbeSpec, NumericCondition, ProbeMetric, ProbeSample, ProbeResult,
} from '../types';
import { loadDevices, invokeDeviceAction, actionMode, IoTDevice, IoTAction } from './iotService';

/**
 * 设备探针执行与判定。
 *
 * 判定逻辑全是纯函数（可单测），只有 runDeviceProbe 会真的去打设备。
 *
 * 一条铁律：**阈值必须在跑之前就定好**（写在 supportIf / refuteIf 里，
 * 并渲染成 expectedSignal 显示在界面上）。拿到数据再决定"多少算成功"，
 * 实验就退化成了给结论找证据。
 */

// ---------- 从设备响应里取出读数 ----------

/** 按 "data.temp" / "list[0].v" 这样的路径取值 */
export function getByPath(obj: any, path?: string): any {
  if (!path || !path.trim()) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const k of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * 把设备返回的一坨文本变成一个数。
 * 取不到就返回 null——**绝不猜**，宁可这次采样作废。
 */
export function pickNumber(responseText: string, readPath?: string): number | null {
  const text = (responseText || '').trim();
  if (!text) return null;

  let target: any = text;
  try {
    target = getByPath(JSON.parse(text), readPath);
  } catch {
    // 不是 JSON：只有在没指定路径时才允许把整段当数值
    if (readPath && readPath.trim()) return null;
  }

  if (typeof target === 'number') return Number.isFinite(target) ? target : null;
  if (typeof target === 'boolean') return target ? 1 : 0;
  if (typeof target === 'string') {
    // 容忍 "36.7℃" / "temp=36.7" 这类带单位或前缀的返回
    const m = target.match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
    if (!m) return null;
    const v = parseFloat(m[0]);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

// ---------- 聚合与判定 ----------

export function aggregate(values: number[], metric: ProbeMetric): number | null {
  if (!values.length) return null;
  switch (metric) {
    case 'max': return Math.max(...values);
    case 'min': return Math.min(...values);
    case 'last': return values[values.length - 1];
    case 'avg':
    default: return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

export function evalCondition(v: number, c?: NumericCondition): boolean {
  if (!c || !Number.isFinite(v) || !Number.isFinite(c.value)) return false;
  switch (c.op) {
    case '>': return v > c.value;
    case '>=': return v >= c.value;
    case '<': return v < c.value;
    case '<=': return v <= c.value;
    case 'between': {
      const [lo, hi] = [c.value, c.value2 ?? c.value].sort((a, b) => a - b);
      return v >= lo && v <= hi;
    }
    case 'outside': {
      const [lo, hi] = [c.value, c.value2 ?? c.value].sort((a, b) => a - b);
      return v < lo || v > hi;
    }
    default: return false;
  }
}

/**
 * 判定一次设备实验。
 * **先判反对，再判支持**：同时命中时算被推翻——宁可发现自己错，也不要错过一次证伪。
 */
export function judgeSamples(
  samples: ProbeSample[],
  spec: DeviceProbeSpec,
): { stance: ProbeResult['stance']; metricValue: number | null; reason: string } {
  const values = samples.map(s => s.value).filter(v => Number.isFinite(v));
  if (!values.length) {
    return { stance: 'unclear', metricValue: null, reason: '一个有效读数都没拿到' };
  }
  const metricValue = aggregate(values, spec.metric)!;
  const unit = spec.unit ? spec.unit : '';
  const shown = `${round(metricValue)}${unit}`;

  if (evalCondition(metricValue, spec.refuteIf)) {
    return { stance: 'refute', metricValue, reason: `${METRIC_LABEL[spec.metric]}=${shown}，落进了反对区间（${describeCondition(spec.refuteIf!, unit)}）` };
  }
  if (evalCondition(metricValue, spec.supportIf)) {
    return { stance: 'support', metricValue, reason: `${METRIC_LABEL[spec.metric]}=${shown}，落进了支持区间（${describeCondition(spec.supportIf!, unit)}）` };
  }
  return { stance: 'unclear', metricValue, reason: `${METRIC_LABEL[spec.metric]}=${shown}，两边区间都没落进去` };
}

const round = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);

export const METRIC_LABEL: Record<ProbeMetric, string> = {
  avg: '平均值', max: '最大值', min: '最小值', last: '最后一次',
};

export function describeCondition(c: NumericCondition, unit = ''): string {
  const v = `${c.value}${unit}`;
  const v2 = `${c.value2 ?? c.value}${unit}`;
  switch (c.op) {
    case 'between': return `在 ${v} ~ ${v2} 之间`;
    case 'outside': return `在 ${v} ~ ${v2} 之外`;
    default: return `${c.op} ${v}`;
  }
}

/** 生成事前写死的判定标准文案（存进 probe.expectedSignal，跑之前就显示出来） */
export function describeSpec(spec: DeviceProbeSpec): string {
  const unit = spec.unit || '';
  const head = `用「${spec.deviceName} · ${spec.actionName}」采样 ${spec.samples} 次（每 ${spec.intervalSec}s 一次），取${METRIC_LABEL[spec.metric]}`;
  const parts: string[] = [];
  if (spec.supportIf) parts.push(`${describeCondition(spec.supportIf, unit)} 算支持`);
  if (spec.refuteIf) parts.push(`${describeCondition(spec.refuteIf, unit)} 算反对`);
  if (!parts.length) return `${head}。⚠️ 还没设阈值——跑之前先把"多少算支持、多少算反对"定下来，否则等于没验证。`;
  return `${head}：${parts.join('；')}；都不满足则算没测出来。`;
}

/** 一句话总结实验结果，写进证据 */
export function summarizeRun(spec: DeviceProbeSpec, samples: ProbeSample[], judged: ReturnType<typeof judgeSamples>): string {
  const n = samples.length;
  const vals = samples.map(s => round(s.value)).slice(0, 8).join(', ');
  return `${spec.deviceName}·${spec.actionName} 采样 ${n} 次：${judged.reason}。读数：${vals}${n > 8 ? ' …' : ''}`;
}

// ---------- 执行（唯一有副作用的部分）----------

export interface RunProgress {
  index: number;
  total: number;
  sample?: ProbeSample;
  error?: string;
}

export interface RunOutcome {
  samples: ProbeSample[];
  errors: string[];
  aborted: boolean;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 找到 spec 指向的设备与动作；找不到就返回原因 */
export function resolveTarget(spec: DeviceProbeSpec, devices: IoTDevice[]):
  { device: IoTDevice; action: IoTAction } | { error: string } {
  const device = devices.find(d => d.id === spec.deviceId);
  if (!device) return { error: `设备「${spec.deviceName}」已不存在或被删除` };
  if (!device.enabled) return { error: `设备「${device.name}」已停用` };
  const action = device.actions.find(a => a.id === spec.actionId);
  if (!action) return { error: `操作「${spec.actionName}」已不存在` };
  // 自动跑的实验只允许只读操作。要动执行器，必须人在界面上点确认。
  if (actionMode(action) !== 'read') return { error: `「${action.name}」是写操作，不能作为自动采样使用` };
  return { device, action };
}

/**
 * 跑一次设备实验：按间隔采样 N 次。
 * 单次失败不中断，记进 errors；全部失败会在判定阶段变成 unclear。
 */
export async function runDeviceProbe(
  spec: DeviceProbeSpec,
  opts: { onProgress?: (p: RunProgress) => void; shouldAbort?: () => boolean } = {},
): Promise<RunOutcome> {
  const target = resolveTarget(spec, loadDevices());
  if ('error' in target) return { samples: [], errors: [target.error], aborted: true };

  const samples: ProbeSample[] = [];
  const errors: string[] = [];
  const total = Math.max(1, Math.min(200, spec.samples || 1));

  for (let i = 0; i < total; i++) {
    if (opts.shouldAbort?.()) return { samples, errors, aborted: true };

    const r = await invokeDeviceAction(target.device, target.action, spec.params || {}, 'probe');
    if (!r.ok) {
      errors.push(`第 ${i + 1} 次：${r.response.slice(0, 120)}`);
      opts.onProgress?.({ index: i + 1, total, error: r.response.slice(0, 120) });
    } else {
      const value = pickNumber(r.response, spec.readPath);
      if (value === null) {
        errors.push(`第 ${i + 1} 次：读不出数值${spec.readPath ? `（路径 ${spec.readPath}）` : ''}`);
        opts.onProgress?.({ index: i + 1, total, error: '读不出数值' });
      } else {
        const sample: ProbeSample = { at: Date.now(), value, raw: r.response.slice(0, 120) };
        samples.push(sample);
        opts.onProgress?.({ index: i + 1, total, sample });
      }
    }

    if (i < total - 1) await sleep(Math.max(0, Math.min(3600, spec.intervalSec || 0)) * 1000);
  }

  return { samples, errors, aborted: false };
}
