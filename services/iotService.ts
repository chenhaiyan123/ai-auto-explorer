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

export interface IoTAction {
  id: string;
  name: string;            // 操作名（AI 可读），如 "读取温度" / "启动搅拌器"
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;            // 相对路径，如 /api/temperature
  description: string;     // 给 AI 看的说明：何时用、参数含义
  bodyTemplate?: string;   // POST/PUT 请求体模板（JSON 字符串，可含 {{param}} 占位符）
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
}

export interface IoTCallLog {
  id: string;
  deviceName: string;
  actionName: string;
  request: string;
  response: string;
  ok: boolean;
  timestamp: number;
  source: 'manual' | 'ai';
}

const DEVICES_KEY = 'ai_explorer_iot_devices';
const LOGS_KEY = 'ai_explorer_iot_logs';
const MAX_LOGS = 100;

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

// ─── 调用设备 ─────────────────────────────────────────────

/**
 * 执行设备操作。params 用于替换 bodyTemplate 中的 {{key}} 占位符，
 * GET 请求时作为 query string 附加。
 */
export async function invokeDeviceAction(
  device: IoTDevice,
  action: IoTAction,
  params: Record<string, string> = {},
  source: 'manual' | 'ai' = 'manual'
): Promise<{ ok: boolean; response: string }> {
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
    const acts = d.actions.map(a =>
      `  - action_id="${a.id}" 名称="${a.name}"（${a.method}）：${a.description || '无说明'}${a.bodyTemplate ? `，参数占位符：${(a.bodyTemplate.match(/\{\{\s*(\w+)\s*\}\}/g) || []).join(', ') || '无'}` : ''}`
    ).join('\n');
    return `设备 device_id="${d.id}" 名称="${d.name}"：${d.description || '无说明'}\n${acts}`;
  }).join('\n');

  return `\n\n【可用实验设备】你可以调用以下 IoT 设备辅助探索。需要调用时，在回复中单独输出一个指令块（可多个）：
\`\`\`iot
{"device_id": "...", "action_id": "...", "params": {"参数名": "值"}}
\`\`\`
设备列表：
${lines}
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
