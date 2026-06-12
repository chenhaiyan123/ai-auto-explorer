/**
 * SettingsModal — 设置面板
 *
 * Tab 1：模型接入（云端代理 / 本地 OpenAI 兼容 API：Ollama、LM Studio、vLLM 等）
 * Tab 2：IoT 设备（注册 HTTP REST 设备，供 AI 在探索中调用）
 */

import React, { useState, useEffect } from 'react';
import {
  LLMSettings, loadLLMSettings, saveLLMSettings, testLLMConnection, PRESET_PROVIDERS,
} from '../services/llmProvider';
import {
  IoTDevice, IoTAction, loadDevices, upsertDevice, removeDevice, invokeDeviceAction, loadLogs, IoTCallLog,
} from '../services/iotService';

interface SettingsModalProps {
  onClose: () => void;
}

type Tab = 'llm' | 'iot';

const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500';
const labelCls = 'text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 block';

const newAction = (): IoTAction => ({
  id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '', method: 'GET', path: '/', description: '', bodyTemplate: '',
});

const newDevice = (): IoTDevice => ({
  id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '', baseUrl: '', description: '', authHeader: '', actions: [newAction()], enabled: true, createdAt: Date.now(),
});

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>('llm');

  // ── LLM 状态 ──
  const [llm, setLlm] = useState<LLMSettings>(loadLLMSettings());
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── IoT 状态 ──
  const [devices, setDevices] = useState<IoTDevice[]>([]);
  const [editing, setEditing] = useState<IoTDevice | null>(null);
  const [logs, setLogs] = useState<IoTCallLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [actionTestResult, setActionTestResult] = useState<Record<string, string>>({});

  useEffect(() => { setDevices(loadDevices()); setLogs(loadLogs()); }, []);

  const handleSaveLLM = () => {
    saveLLMSettings(llm);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestLLM = async () => {
    setTesting(true); setTestResult(null);
    saveLLMSettings(llm);
    const r = await testLLMConnection();
    setTestResult(r);
    setTesting(false);
  };

  const handleSaveDevice = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.baseUrl.trim()) return;
    const cleaned: IoTDevice = {
      ...editing,
      actions: editing.actions.filter(a => a.name.trim() && a.path.trim()),
    };
    upsertDevice(cleaned);
    setDevices(loadDevices());
    setEditing(null);
  };

  const handleTestAction = async (device: IoTDevice, action: IoTAction) => {
    setActionTestResult(prev => ({ ...prev, [action.id]: '测试中...' }));
    const r = await invokeDeviceAction(device, action, {}, 'manual');
    setActionTestResult(prev => ({ ...prev, [action.id]: `${r.ok ? '✅' : '❌'} ${r.response.slice(0, 120)}` }));
    setLogs(loadLogs());
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-7 pt-6 pb-0 border-b border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">⚙️ 设置</h2>
            <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="flex gap-1">
            {([['llm', '🧠 模型接入'], ['iot', '🔌 IoT 设备']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${tab === t ? 'text-blue-400 border-blue-500 bg-slate-800/50' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5">
          {/* ════ Tab: 模型接入 ════ */}
          {tab === 'llm' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                所有 AI 功能（探索、评估、对话）通过这里配置的 API 调用。支持<b className="text-slate-300">本地模型</b>（Ollama / LM Studio / vLLM）或任何 OpenAI 兼容的云端 API，数据仅保存在你的浏览器。
              </p>

              {/* 快速预设 */}
              <div>
                <label className={labelCls}>快速预设</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PROVIDERS.map(p => (
                    <button key={p.label} title={p.hint}
                      onClick={() => { setLlm({ provider: 'openai-compatible', baseUrl: p.baseUrl, apiKey: llm.apiKey, model: p.model }); setTestResult(null); }}
                      className={`px-3 py-1.5 text-[11px] font-medium rounded-full border transition-colors ${llm.baseUrl === p.baseUrl ? 'bg-blue-600/20 text-blue-400 border-blue-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>接入方式</label>
                <select value={llm.provider} onChange={e => setLlm({ ...llm, provider: e.target.value as any })} className={inputCls}>
                  <option value="openai-compatible">OpenAI 兼容 API（本地或云端，推荐）</option>
                  <option value="cloud-proxy">云端代理（自部署函数计算，Key 不进浏览器）</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>{llm.provider === 'cloud-proxy' ? '代理地址' : 'API Base URL'}</label>
                <input value={llm.baseUrl} onChange={e => { setLlm({ ...llm, baseUrl: e.target.value }); setTestResult(null); }}
                  placeholder={llm.provider === 'cloud-proxy' ? 'https://your-proxy.example.com' : 'http://localhost:11434/v1'}
                  className={inputCls} />
              </div>

              {llm.provider === 'openai-compatible' && (
                <div>
                  <label className={labelCls}>API Key（本地模型可留空）</label>
                  <input type="password" value={llm.apiKey} onChange={e => setLlm({ ...llm, apiKey: e.target.value })}
                    placeholder="sk-..." className={inputCls} />
                </div>
              )}

              <div>
                <label className={labelCls}>模型名称</label>
                <input value={llm.model} onChange={e => setLlm({ ...llm, model: e.target.value })}
                  placeholder="qwen2.5:7b / llama3.1 / qwen-turbo ..." className={inputCls} />
              </div>

              {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{testResult.message}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleTestLLM} disabled={testing || !llm.baseUrl}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-bold disabled:opacity-50">
                  {testing ? '测试中...' : '测试连接'}
                </button>
                <button onClick={handleSaveLLM} disabled={!llm.baseUrl}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-bold disabled:opacity-50">
                  {saved ? '✅ 已保存' : '保存设置'}
                </button>
              </div>
            </div>
          )}

          {/* ════ Tab: IoT 设备 ════ */}
          {tab === 'iot' && !editing && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                注册带 HTTP REST API 的实验/物联网设备后，AI 在长期探索和节点对话中可以<b className="text-slate-300">自主调用设备</b>（读取传感器、触发操作），并把结果纳入探究。
              </p>

              {devices.length === 0 && (
                <div className="text-center py-10 text-slate-600 text-sm border border-dashed border-slate-700 rounded-xl">
                  还没有注册设备
                </div>
              )}

              {devices.map(d => (
                <div key={d.id} className="border border-slate-800 rounded-xl p-4 bg-slate-800/30">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${d.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                        <span className="text-sm font-bold text-white">{d.name}</span>
                        <span className="text-[10px] text-slate-500 truncate">{d.baseUrl}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">{d.description || '无说明'} · {d.actions.length} 个操作</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => { upsertDevice({ ...d, enabled: !d.enabled }); setDevices(loadDevices()); }}
                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white">
                        {d.enabled ? '停用' : '启用'}
                      </button>
                      <button onClick={() => setEditing(JSON.parse(JSON.stringify(d)))}
                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 border border-slate-700 text-blue-400 hover:text-blue-300">编辑</button>
                      <button onClick={() => { if (confirm(`删除设备「${d.name}」？`)) { removeDevice(d.id); setDevices(loadDevices()); } }}
                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 border border-slate-700 text-red-400 hover:text-red-300">删除</button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex gap-3">
                <button onClick={() => setEditing(newDevice())}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold">+ 注册设备</button>
                <button onClick={() => setShowLogs(!showLogs)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-bold">
                  调用日志（{logs.length}）
                </button>
              </div>

              {showLogs && (
                <div className="border border-slate-800 rounded-xl divide-y divide-slate-800/70 max-h-60 overflow-y-auto">
                  {logs.length === 0 && <div className="p-4 text-xs text-slate-600 text-center">暂无调用记录</div>}
                  {logs.map(l => (
                    <div key={l.id} className="p-3 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span>{l.ok ? '✅' : '❌'}</span>
                        <span className="font-bold text-slate-300">{l.deviceName} → {l.actionName}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${l.source === 'ai' ? 'bg-violet-600/20 text-violet-400' : 'bg-slate-700 text-slate-400'}`}>{l.source === 'ai' ? 'AI 调用' : '手动'}</span>
                        <span className="text-slate-600 ml-auto">{new Date(l.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="text-slate-500 mt-1 truncate">{l.request}</div>
                      <div className="text-slate-400 mt-0.5 line-clamp-2">{l.response}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── IoT 设备编辑表单 ── */}
          {tab === 'iot' && editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>设备名称 *</label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="恒温培养箱-1" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>API 地址 *</label>
                  <input value={editing.baseUrl} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="http://192.168.1.50:8080" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>设备说明（AI 会根据它判断何时使用）</label>
                <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="可控温度 4–60℃ 的培养箱，带温湿度传感器" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>鉴权 Header（可选，填入 Authorization 值）</label>
                <input value={editing.authHeader || ''} onChange={e => setEditing({ ...editing, authHeader: e.target.value })} placeholder="Bearer xxx" className={inputCls} />
              </div>

              <div className="space-y-3">
                <label className={labelCls}>操作列表（AI 可调用的指令）</label>
                {editing.actions.map((a, i) => (
                  <div key={a.id} className="border border-slate-800 rounded-xl p-3 space-y-2 bg-slate-800/30">
                    <div className="grid grid-cols-[1fr_90px_1fr_auto] gap-2">
                      <input value={a.name} onChange={e => { const acts = [...editing.actions]; acts[i] = { ...a, name: e.target.value }; setEditing({ ...editing, actions: acts }); }} placeholder="操作名，如：读取温度" className={inputCls} />
                      <select value={a.method} onChange={e => { const acts = [...editing.actions]; acts[i] = { ...a, method: e.target.value as any }; setEditing({ ...editing, actions: acts }); }} className={inputCls}>
                        {['GET', 'POST', 'PUT', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                      </select>
                      <input value={a.path} onChange={e => { const acts = [...editing.actions]; acts[i] = { ...a, path: e.target.value }; setEditing({ ...editing, actions: acts }); }} placeholder="/api/temperature" className={inputCls} />
                      <button onClick={() => setEditing({ ...editing, actions: editing.actions.filter(x => x.id !== a.id) })}
                        className="px-2 text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                    <input value={a.description} onChange={e => { const acts = [...editing.actions]; acts[i] = { ...a, description: e.target.value }; setEditing({ ...editing, actions: acts }); }} placeholder="说明：何时使用、参数含义" className={inputCls} />
                    {(a.method === 'POST' || a.method === 'PUT') && (
                      <input value={a.bodyTemplate || ''} onChange={e => { const acts = [...editing.actions]; acts[i] = { ...a, bodyTemplate: e.target.value }; setEditing({ ...editing, actions: acts }); }} placeholder='请求体模板，如 {"target_temp": "{{temp}}"}' className={`${inputCls} font-mono text-xs`} />
                    )}
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleTestAction(editing, a)} className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white">▶ 测试</button>
                      {actionTestResult[a.id] && <span className="text-[10px] text-slate-400 truncate">{actionTestResult[a.id]}</span>}
                    </div>
                  </div>
                ))}
                <button onClick={() => setEditing({ ...editing, actions: [...editing.actions, newAction()] })}
                  className="text-xs text-blue-400 hover:text-blue-300 font-bold">+ 添加操作</button>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditing(null)} className="flex-1 py-2.5 bg-slate-800 rounded-xl text-sm font-bold">取消</button>
                <button onClick={handleSaveDevice} disabled={!editing.name.trim() || !editing.baseUrl.trim()}
                  className="flex-[2] py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold disabled:opacity-50">保存设备</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
