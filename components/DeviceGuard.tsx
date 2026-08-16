import React, { useEffect, useState } from 'react';
import {
  PendingCall, loadPending, dropPending, approvePending,
  isEmergencyStopped, setEmergencyStop, loadDevices,
} from '../services/iotService';

/**
 * 设备安全条（顶栏）：待确认的写操作 + 急停。
 *
 * 为什么放在顶栏而不是设置里：AI 会去控制加热器、电源这类真会动的东西。
 * 出事的时候，"停"这个动作必须永远在一次点击之内，不能藏在两层菜单后面。
 *
 * 没注册任何设备时整条不渲染，不打扰纯软件用户。
 */
const DeviceGuard: React.FC = () => {
  const [estop, setEstop] = useState(isEmergencyStopped());
  const [pending, setPending] = useState<PendingCall[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasDevices, setHasDevices] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const sync = () => {
      setPending(loadPending());
      setEstop(isEmergencyStopped());
      setHasDevices(loadDevices().length > 0);
    };
    sync();
    window.addEventListener('iot-pending', sync);
    window.addEventListener('iot-estop', sync);
    // 别的标签页 / 设置面板里改了设备，也要跟上
    const timer = setInterval(sync, 4000);
    return () => {
      window.removeEventListener('iot-pending', sync);
      window.removeEventListener('iot-estop', sync);
      clearInterval(timer);
    };
  }, []);

  if (!hasDevices && !pending.length && !estop) return null;

  const approve = async (id: string) => {
    setBusy(id);
    const r = await approvePending(id);
    setBusy(null);
    setToast(r.ok ? '✅ 已执行' : `❌ ${r.response.slice(0, 60)}`);
    setTimeout(() => setToast(''), 4000);
    setPending(loadPending());
  };

  return (
    <div className="relative flex items-center gap-1.5">
      {pending.length > 0 && (
        <button
          onClick={() => setOpen(v => !v)}
          className="px-2.5 py-1.5 bg-amber-900/40 hover:bg-amber-600 hover:text-white border border-amber-500/50 rounded-full transition-colors text-[11px] font-bold text-amber-300 flex items-center gap-1"
          title="AI 想执行的写操作被拦下了，等你确认"
        >⏸ 待确认<span className="text-[9px] opacity-70">{pending.length}</span></button>
      )}

      <button
        onClick={() => { setEmergencyStop(!estop); setEstop(!estop); }}
        className={`px-2.5 py-1.5 rounded-full transition-colors text-[11px] font-bold border flex items-center gap-1 ${
          estop
            ? 'bg-red-600 text-white border-red-400 animate-pulse'
            : 'bg-slate-800 text-red-400 border-slate-700 hover:bg-red-700 hover:text-white hover:border-red-500'}`}
        title={estop ? '急停中：所有设备调用都会被拒绝。点击解除。' : '一键拒绝所有设备调用'}
      >🛑 {estop ? '已急停 · 点击解除' : '急停'}</button>

      {toast && (
        <span className="text-[10px] text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1">{toast}</span>
      )}

      {open && pending.length > 0 && (
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-[96] w-[380px] max-w-[calc(100vw-24px)] max-h-[60vh] overflow-y-auto scroll-hide bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900">
              <span className="text-[11px] font-bold text-amber-300">⏸ 等你确认的写操作</span>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="p-2 space-y-2">
              <div className="text-[10px] text-slate-500 leading-relaxed px-1">
                这些操作会真的改变物理世界，所以 AI 不能自己按下去。看清楚参数再决定。
              </div>
              {pending.map(pc => (
                <div key={pc.id} className="rounded-lg border border-amber-600/30 bg-amber-950/20 p-2.5 space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-100">{pc.deviceName} · {pc.actionName}</div>
                  {Object.keys(pc.params || {}).length > 0 && (
                    <div className="text-[10px] text-slate-300 font-mono break-all">
                      {Object.entries(pc.params).map(([k, v]) => `${k}=${v}`).join('  ')}
                    </div>
                  )}
                  <div className="text-[9px] text-slate-500">
                    由 {pc.source === 'ai' ? 'AI 探索' : pc.source === 'probe' ? '设备实验' : pc.source} 发起 · {new Date(pc.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => { dropPending(pc.id); setPending(loadPending()); }}
                      className="text-[10px] px-2 py-1 rounded text-slate-400 hover:text-white">拒绝</button>
                    <button onClick={() => approve(pc.id)} disabled={busy === pc.id || estop}
                      title={estop ? '急停中，先解除急停' : ''}
                      className="text-[10px] px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40">
                      {busy === pc.id ? '执行中…' : '确认执行'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DeviceGuard;
