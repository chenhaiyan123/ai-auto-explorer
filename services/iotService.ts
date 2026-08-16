/**
 * IoT Service — 物联网设备接入（HTTP REST）
 *
 * 用户在「设置 → IoT 设备」中注册设备：名称、API 地址、鉴权、可执行的操作。
 * 注册后：
 * 1. 可在设置面板手动触发操作（调试）
 * 2. AI 在探索/对话中可通过 ```iot {...}``` 指令块自动调用设备，
 *    实现「长期自主探究 + 操纵实验设备」
 *
 * 配置与调用日志均保存在 localStorage（纯前端，开源部署无需后端）。
 */

/** 一个参数的取值边界：越界直接拒绝调用，不发出去 */
export interface ParamLimit {
  name: string;
  min?: number;
  max?: number;
  /** 枚举白名单（与 min/max 二选一） */
  allowed?: string[];
}

export interface IoTAction {
  id: string;
  name: string;            // 操作名（AI 可读），如 "读取温度" / "启动搅拌器"
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;            // 相对路径，如 /api/temperature
  description: string;     // 给 AI 看的说明：何时用、参数含义
  bodyTemplate?: string;   // POST/PUT 请求体模板（JSON 字符串，可含 {{param}} 占位符）
  /**
   * read = 只读采集，AI / 自动实验可以随便调；
   * write = 会改变物理世界（加热、通电、投料），默认需要人点确认。
   * 不填时按 method 推断（GET 视为 read，其余视为 write）。
   */
  mode?: 'read' | 'write';
  /** 参数上下限 / 白名单。AI 给出越界参数时直接拒绝 */
  limits?: ParamLimit[];
}

export interface IoTDevice {
  id: string;
  name: string;            // 如 "恒温培养箱-1"
  baseUrl: string;         // 如 http://192.168.1.50:8080
  description: string;     // 设备用途说明（给 AI 看）
  authHeader?: string;     // 可选，如 "Bearer xxx" 或 "ApiKey xxx"，放入 Authorization
  actions: IoTAction[];
  enabled: boolean;        // 关闭后 AI 不可调用
  createdAt: number;
  /**
   * 写操作是否必须人工确认。默认 true。
   * 只有当设备接的东西烧不坏也伤不到人时才建议关掉。
   */
  requireConfirm?: boolean;
  /** 每分钟最多调用次数（防止 AI 循环把设备打爆），默认 30 */
  maxCallsPerMin?: number;
}

/** 被拦下、等人点确认的写操作 */
export interface PendingCall {
  id: string;
  deviceId: string;
  deviceName: string;
  actionId: string;
  actionName: string;
  params: Record<string, string>;
  source: CallSource;
  reason: string;
  createdAt: number;
}

export type CallSource = 'manual' | 'ai' | 'probe' | 'approved';

export interface IoTCallLog {
  id: string;
  deviceName: string;
  actionName: string;
  request: string;
  response: string;
  ok: boolean;
  timestamp: number;
  source: CallSource;
}

const DEVICES_KEY = 'ai_explorer_iot_devices';
const LOGS_KEY = 'ai_explorer_iot_logs';
const PENDING_KEY = 'ai_explorer_iot_pending';
const ESTOP_KEY = 'ai_explorer_iot_estop';
const MAX_LOGS = 100;
const MAX_PENDING = 30;
const DEFAULT_CALLS_PER_MIN = 30;

// ─── 设备管理 ─────────────────────────────────────────────

export function loadDevices(): IoTDevice[] {
  try {
    const raw = localStorage.getItem(DEVICES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

export function saveDevices(devices: IoTDevice[]) {
  localStorage.setItem(DEVICES_KEY, JSON.stringify(devices));
}

export function upsertDevice(device: IoTDevice) {
  const devices = loadDevices();
  const idx = devices.findIndex(d => d.id === device.id);
  if (idx >= 0) devices[idx] = device; else devices.push(device);
  saveDevices(devices);
}

export function removeDevice(id: string) {
  saveDevices(loadDevices().filter(d => d.id !== id));
}

// ─── 调用日志 ─────────────────────────────────────────────

export function loadLogs(): IoTCallLog[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function appendLog(log: IoTCallLog) {
  const logs = [log, ...loadLogs()].slice(0, MAX_LOGS);
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
}

// ─── 安全边界 ─────────────────────────────────────────────
//
// 这一节的存在理由很直接：AI 会控制加热器、电源、搅拌器这类真会动的东西。
// 代码写错顶多报错，设备开错会烧东西、会伤人。所以宁可多拦。
//
// 四道闸：
//   ① 急停：一键拒绝所有调用，先停下再说
//   ② 读写分级：AI 和自动实验只能碰只读操作
//   ③ 参数限值：越界的参数根本不发出去
//   ④ 人工确认：写操作排队等人点，AI 不能自己按下按钮

/** 操作是读还是写。不填时按 method 推断——**默认按危险的那边算**。 */
export function actionMode(a: IoTAction): 'read' | 'write' {
  if (a.mode === 'read' || a.mode === 'write') return a.mode;
  return a.method === 'GET' ? 'read' : 'write';
}

/** 写操作是否需要人工确认（默认要） */
export const needsConfirm = (d: IoTDevice, a: IoTAction) =>
  actionMode(a) === 'write' && d.requireConfirm !== false;

// ① 急停
export function isEmergencyStopped(): boolean {
  try { return localStorage.getItem(ESTOP_KEY) === '1'; } catch { return false; }
}
export function setEmergencyStop(on: boolean) {
  try {
    if (on) localStorage.setItem(ESTOP_KEY, '1');
    else localStorage.removeItem(ESTOP_KEY);
    window.dispatchEvent(new CustomEvent('iot-estop', { detail: on }));
  } catch { /* ignore */ }
}

// ③ 参数限值
export function validateParams(action: IoTAction, params: Record<string, string>):
  { ok: true } | { ok: false; error: string } {
  for (const lim of action.limits || []) {
    const raw = params[lim.name];
    if (raw === undefined || raw === '') continue; // 没传就不管，由设备自己兜底
    if (lim.allowed && lim.allowed.length) {
      if (!lim.allowed.includes(raw)) {
        return { ok: false, error: `${lim.name}="${raw}" 不在允许列表 [${lim.allowed.join(', ')}] 里` };
      }
      continue;
    }
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return { ok: false, error: `${lim.name}="${raw}" 不是数值` };
    if (lim.min !== undefined && v < lim.min) return { ok: false, error: `${lim.name}=${v} 低于下限 ${lim.min}` };
    if (lim.max !== undefined && v > lim.max) return { ok: false, error: `${lim.name}=${v} 超过上限 ${lim.max}` };
  }
  return { ok: true };
}

// 限流：进程内计数，刷新页面即重置（够用了，目的是挡住失控循环而不是做配额）
const callTimes = new Map<string, number[]>();
export function rateLimited(device: IoTDevice, now = Date.now()): boolean {
  const cap = device.maxCallsPerMin ?? DEFAULT_CALLS_PER_MIN;
  if (cap <= 0) return false;
  const arr = (callTimes.get(device.id) || []).filter(t => now - t < 60_000);
  callTimes.set(device.id, arr);
  return arr.length >= cap;
}
function noteCall(deviceId: string, now = Date.now()) {
  const arr = (callTimes.get(deviceId) || []).filter(t => now - t < 60_000);
  arr.push(now);
  callTimes.set(deviceId, arr);
}

/**
 * 调用前的总闸门。纯判断，不发请求。
 * allow=false 时 reason 会原样返回给调用方（AI 也能读懂为什么被拦）。
 */
export function guardCall(
  device: IoTDevice,
  action: IoTAction,
  params: Record<string, string>,
  source: CallSource,
): { allow: true } | { allow: false; reason: string; queue?: boolean } {
  if (isEmergencyStopped()) return { allow: false, reason: '🛑 急停已启用，所有设备调用被拒绝' };
  if (!device.enabled) return { allow: false, reason: `设备「${device.name}」已停用` };

  const v = validateParams(action, params);
  if (!v.ok) return { allow: false, reason: `参数越界，已拒绝：${v.error}` };

  if (rateLimited(device)) {
    return { allow: false, reason: `「${device.name}」调用过于频繁（上限 ${device.maxCallsPerMin ?? DEFAULT_CALLS_PER_MIN} 次/分钟），已拦下` };
  }

  // 人点的、以及人确认过的，放行；AI 和自动实验碰写操作一律排队
  if (source !== 'manual' && source !== 'approved' && needsConfirm(device, action)) {
    return { allow: false, queue: true, reason: `「${action.name}」是写操作，需要你确认后才会执行` };
  }
  return { allow: true };
}

// ④ 待确认队列
export function loadPending(): PendingCall[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}
function savePending(list: PendingCall[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(0, MAX_PENDING)));
    window.dispatchEvent(new CustomEvent('iot-pending'));
  } catch { /* ignore */ }
}
export function enqueuePending(p: Omit<PendingCall, 'id' | 'createdAt'>): PendingCall {
  const item: PendingCall = { ...p, id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
  savePending([item, ...loadPending()]);
  return item;
}
export function dropPending(id: string) {
  savePending(loadPending().filter(x => x.id !== id));
}
/** 人点了「确认执行」：以 approved 身份重新发起，绕过确认闸（其它闸仍然生效） */
export async function approvePending(id: string): Promise<{ ok: boolean; response: string }> {
  const item = loadPending().find(x => x.id === id);
  dropPending(id);
  if (!item) return { ok: false, response: '这条待确认记录已不存在' };
  const device = loadDevices().find(d => d.id === item.deviceId);
  const action = device?.actions.find(a => a.id === item.actionId);
  if (!device || !action) return { ok: false, response: '设备或操作已被删除' };
  return invokeDeviceAction(device, action, item.params, 'approved');
}

// ─── 调用设备 ─────────────────────────────────────────────

/**
 * 执行设备操作。params 用于替换 bodyTemplate 中的 {{key}} 占位符，
 * GET 请求时作为 query string 附加。
 */
export async function invokeDeviceAction(
  device: IoTDevice,
  action: IoTAction,
  params: Record<string, string> = {},
  source: CallSource = 'manual'
): Promise<{ ok: boolean; response: string }> {
  // 先过安全闸。被拦下的写操作会进待确认队列，等人点。
  const guard = guardCall(device, action, params, source);
  if (!guard.allow) {
    if (guard.queue) {
      enqueuePending({
        deviceId: device.id, deviceName: device.name,
        actionId: action.id, actionName: action.name,
        params, source, reason: guard.reason,
      });
    }
    appendLog({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceName: device.name, actionName: action.name,
      request: `${action.method} ${action.path} ${JSON.stringify(params)}`,
      response: `[已拦截] ${guard.reason}`,
      ok: false, timestamp: Date.now(), source,
    });
    return { ok: false, response: guard.queue ? `⏸ ${guard.reason}（已加入待确认队列）` : `⛔ ${guard.reason}` };
  }
  noteCall(device.id);

  let url = `${device.baseUrl.replace(/\/+$/, '')}${action.path.startsWith('/') ? '' : '/'}${action.path}`;

  const headers: Record<string, string> = {};
  if (device.authHeader) headers['Authorization'] = device.authHeader;

  let body: string | undefined;
  if (action.method === 'GET' || action.method === 'DELETE') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  } else {
    headers['Content-Type'] = 'application/json';
    let template = action.bodyTemplate || JSON.stringify(params);
    Object.entries(params).forEach(([k, v]) => {
      template = template.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
    });
    body = template;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let ok = false;
  let responseText = '';
  try {
    const resp = await fetch(url, { method: action.method, headers, body, signal: controller.signal });
    responseText = await resp.text();
    ok = resp.ok;
    if (!resp.ok) responseText = `HTTP ${resp.status}: ${responseText.slice(0, 500)}`;
  } catch (e: any) {
    responseText = e.name === 'AbortError' ? '请求超时（15s）' : `请求失败：${e.message}`;
  } finally {
    clearTimeout(timeoutId);
  }

  appendLog({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceName: device.name,
    actionName: action.name,
    request: `${action.method} ${url}${body ? ` ${body.slice(0, 200)}` : ''}`,
    response: responseText.slice(0, 1000),
    ok,
    timestamp: Date.now(),
    source,
  });

  return { ok, response: responseText.slice(0, 2000) };
}

// ─── AI 集成 ─────────────────────────────────────────────

/**
 * 生成注入 AI system prompt 的设备说明。
 * 没有可用设备时返回空字符串。
 */
export function buildIoTSystemPrompt(): string {
  const devices = loadDevices().filter(d => d.enabled && d.actions.length > 0);
  if (devices.length === 0) return '';

  const lines = devices.map(d => {
    const acts = d.actions.map(a => {
      const mode = actionMode(a);
      const lim = (a.limits || []).map(l =>
        l.allowed?.length ? `${l.name}∈[${l.allowed.join('|')}]`
          : `${l.name}${l.min !== undefined ? `≥${l.min}` : ''}${l.max !== undefined ? `≤${l.max}` : ''}`
      ).join(', ');
      return `  - action_id="${a.id}" 名称="${a.name}"（${a.method}，${mode === 'read' ? '只读采集' : '⚠️写操作'}）：${a.description || '无说明'}` +
        `${a.bodyTemplate ? `，参数占位符：${(a.bodyTemplate.match(/\{\{\s*(\w+)\s*\}\}/g) || []).join(', ') || '无'}` : ''}` +
        `${lim ? `，参数限值：${lim}` : ''}`;
    }).join('\n');
    return `设备 device_id="${d.id}" 名称="${d.name}"：${d.description || '无说明'}${d.requireConfirm === false ? '（写操作免确认）' : ''}\n${acts}`;
  }).join('\n');

  return `\n\n【可用实验设备】你可以调用以下 IoT 设备辅助探索。需要调用时，在回复中单独输出一个指令块（可多个）：
\`\`\`iot
{"device_id": "...", "action_id": "...", "params": {"参数名": "值"}}
\`\`\`
设备列表：
${lines}

规则（会被代码强制执行，绕不过去）：
1. 只读采集你可以直接调。
2. ⚠️写操作会改变物理世界，你调用后**不会立即执行**，而是排队等人确认——所以不要指望马上拿到结果，也不要连发多次。
3. 参数必须落在限值内，越界的调用会被直接拒绝。
4. 用户可以随时按急停，届时你的所有调用都会被拒绝。
只在确有必要时调用设备；调用结果会反馈给你。`;
}

export interface IoTCommandResult {
  deviceName: string;
  actionName: string;
  ok: boolean;
  response: string;
}

/**
 * 扫描 AI 输出中的 ```iot {...}``` 指令块并执行，返回执行结果。
 * 返回空数组表示没有指令。
 */
export async function executeIoTCommandsInText(text: string): Promise<IoTCommandResult[]> {
  const results: IoTCommandResult[] = [];
  const regex = /```iot\s*([\s\S]*?)```/g;
  const devices = loadDevices();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    try {
      const cmd = JSON.parse(match[1].trim());
      const device = devices.find(d => d.id === cmd.device_id && d.enabled);
      const action = device?.actions.find(a => a.id === cmd.action_id);
      if (!device || !action) {
        results.push({ deviceName: cmd.device_id || '?', actionName: cmd.action_id || '?', ok: false, response: '设备或操作不存在/未启用' });
        continue;
      }
      const r = await invokeDeviceAction(device, action, cmd.params || {}, 'ai');
      results.push({ deviceName: device.name, actionName: action.name, ok: r.ok, response: r.response });
    } catch (e: any) {
      results.push({ deviceName: '?', actionName: '?', ok: false, response: `指令解析失败：${e.message}` });
    }
  }
  return results;
}

/** 把执行结果格式化为追加到对话的文本 */
export function formatIoTResults(results: IoTCommandResult[]): string {
  return results.map(r =>
    `🔌 [设备执行${r.ok ? '成功' : '失败'}] ${r.deviceName} → ${r.actionName}\n返回：${r.response.slice(0, 300)}`
  ).join('\n\n');
}
