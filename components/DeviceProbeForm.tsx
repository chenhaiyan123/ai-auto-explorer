import React, { useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, Probe, DeviceProbeSpec, ProbeMetric, NumericCondition } from '../types';
import { loadDevices, actionMode } from '../services/iotService';
import { describeSpec, METRIC_LABEL } from '../services/deviceProbe';

/**
 * 手动配一个设备实验。
 *
 * 为什么要有这个：AI 不一定想得到用哪台设备，用户自己最清楚。
 * 而且这里强制先填阈值再保存——判定标准必须在跑之前定死。
 */

const inp = 'bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200';
const METRICS: ProbeMetric[] = ['avg', 'max', 'min', 'last'];

const CondRow: React.FC<{
  label: string;
  value: NumericCondition | undefined;
  onChange: (c: NumericCondition | undefined) => void;
  unit: string;
}> = ({ label, value, onChange, unit }) => {
  const op = value?.op || '>';
  const range = op === 'between' || op === 'outside';
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-slate-500 w-12 flex-shrink-0">{label}</span>
      <select value={op} onChange={e => onChange({ op: e.target.value as any, value: value?.value ?? 0, value2: value?.value2 })} className={inp}>
        {['>', '>=', '<', '<=', 'between', 'outside'].map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <input type="number" value={value?.value ?? ''} placeholder="阈值"
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v)) onChange(undefined);
          else onChange({ op: op as any, value: v, value2: value?.value2 });
        }}
        className={`${inp} w-20`} />
      {range && (
        <input type="number" value={value?.value2 ?? ''} placeholder="上界"
          onChange={e => onChange({ op: op as any, value: value?.value ?? 0, value2: parseFloat(e.target.value) })}
          className={`${inp} w-20`} />
      )}
      {unit && <span className="text-[10px] text-slate-600">{unit}</span>}
    </div>
  );
};

const DeviceProbeForm: React.FC<{
  node: ProblemNode;
  onCreate: (probe: Probe) => void;
  onCancel: () => void;
}> = ({ node, onCreate, onCancel }) => {
  // 只列只读动作：自动采样永远不碰执行器
  const options = useMemo(
    () => loadDevices()
      .filter(d => d.enabled)
      .flatMap(d => d.actions.filter(a => actionMode(a) === 'read').map(a => ({ d, a }))),
    [],
  );

  const [pick, setPick] = useState(0);
  const [readPath, setReadPath] = useState('');
  const [unit, setUnit] = useState('');
  const [samples, setSamples] = useState(5);
  const [intervalSec, setIntervalSec] = useState(5);
  const [metric, setMetric] = useState<ProbeMetric>('avg');
  const [supportIf, setSupportIf] = useState<NumericCondition | undefined>();
  const [refuteIf, setRefuteIf] = useState<NumericCondition | undefined>();

  if (!options.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-3 text-[11px] text-slate-500 space-y-1.5">
        <div>还没有可用于采集的设备。</div>
        <div className="text-slate-600">到「设置 → 🔌 IoT 设备」注册一台，并把用于读数的操作标成<span className="text-emerald-400">只读采集</span>。</div>
        <button onClick={onCancel} className="text-[10px] text-slate-400 hover:text-white">返回</button>
      </div>
    );
  }

  const cur = options[Math.min(pick, options.length - 1)];
  const spec: DeviceProbeSpec = {
    deviceId: cur.d.id, deviceName: cur.d.name,
    actionId: cur.a.id, actionName: cur.a.name,
    readPath: readPath.trim() || undefined,
    unit: unit.trim() || undefined,
    samples, intervalSec, metric, supportIf, refuteIf,
  };
  const ready = !!(supportIf || refuteIf);

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-2.5 space-y-2">
      <div className="text-[11px] font-bold text-slate-300">🔬 配一个设备实验</div>

      <select value={pick} onChange={e => setPick(Number(e.target.value))} className={`${inp} w-full`}>
        {options.map((o, i) => <option key={o.d.id + o.a.id} value={i}>{o.d.name} · {o.a.name}</option>)}
      </select>

      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={readPath} onChange={e => setReadPath(e.target.value)} placeholder="读数字段，如 data.temperature"
          className={`${inp} flex-1 min-w-[140px]`} title="留空表示整个响应就是数值" />
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="单位" className={`${inp} w-16`} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-slate-500">采样</span>
        <input type="number" min={1} max={60} value={samples} onChange={e => setSamples(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className={`${inp} w-16`} />
        <span className="text-[10px] text-slate-500">次，每</span>
        <input type="number" min={0} max={3600} value={intervalSec} onChange={e => setIntervalSec(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))} className={`${inp} w-16`} />
        <span className="text-[10px] text-slate-500">秒，取</span>
        <select value={metric} onChange={e => setMetric(e.target.value as ProbeMetric)} className={inp}>
          {METRICS.map(m => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
        </select>
      </div>

      <div className="space-y-1 pt-1 border-t border-slate-700/60">
        <div className="text-[10px] text-amber-400/80">判定线必须现在定，跑完再定等于没验证。</div>
        <CondRow label="支持时" value={supportIf} onChange={setSupportIf} unit={unit} />
        <CondRow label="反对时" value={refuteIf} onChange={setRefuteIf} unit={unit} />
      </div>

      <div className="text-[10px] text-slate-500 leading-relaxed">{describeSpec(spec)}</div>

      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="text-[10px] px-2 py-1 text-slate-400 hover:text-white">取消</button>
        <button
          disabled={!ready}
          onClick={() => onCreate({
            id: uuidv4(), nodeId: node.id, kind: 'device', device: spec,
            hypothesis: node.hypothesis?.statement || node.title,
            method: `用「${spec.deviceName} · ${spec.actionName}」采样 ${samples} 次`,
            cost: 'low', effort: `${Math.round((samples - 1) * intervalSec / 60) || 1} 分钟内`,
            expectedSignal: describeSpec(spec),
            status: 'draft', createdAt: Date.now(),
          })}
          title={ready ? '' : '至少要定一条判定线'}
          className="text-[10px] px-2.5 py-1 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500">
          创建实验
        </button>
      </div>
    </div>
  );
};

export default DeviceProbeForm;
