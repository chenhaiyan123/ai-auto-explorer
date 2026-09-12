/**
 * LLM Provider — 统一模型接入层
 *
 * 支持两类后端：
 * 1. cloud-proxy        云端代理（如阿里云函数计算，自行部署，前端不暴露 Key）
 * 2. openai-compatible  任何 OpenAI 兼容 API（Ollama / LM Studio / vLLM / DeepSeek / Moonshot 等，
 *                       包括本地模型，baseUrl 例如 http://localhost:11434/v1）
 *
 * 配置保存在 localStorage，用户可在「设置 → 模型接入」中修改。
 */

import { getLanguage } from './language';
import { sharedRequest } from './sharedModelsClient';
import { trackEvent } from './analytics';
import { buildModelRequest, parseModelResponse } from './modelRequest';

export type LLMProviderType = 'platform' | 'cloud-proxy' | 'openai-compatible' | 'trial' | 'openai' | 'anthropic';

export interface LLMSettings {
  provider: LLMProviderType;
  /** cloud-proxy: 代理完整 URL；openai-compatible: API base（以 /v1 结尾） */
  baseUrl: string;
  /** openai-compatible 可选；本地模型（Ollama 等）通常不需要 */
  apiKey: string;
  /** 模型名，如 qwen-turbo / llama3.1 / qwen2.5:7b */
  model: string;
}

const STORAGE_KEY = 'ai_explorer_llm_settings';

/** 部署者可通过环境变量提供默认云代理（见 .env.example），开源用户默认走本地配置 */
const ENV_PROXY_URL: string = (import.meta as any).env?.VITE_API_PROXY_URL || '';

/** 体验代理后端：默认复用登录后端(VITE_AUTH_API)，也可单独用 VITE_TRIAL_API 指定 */
const ENV_TRIAL_API: string = (((import.meta as any).env?.VITE_TRIAL_API || (import.meta as any).env?.VITE_AUTH_API) || '').replace(/\/+$/, '');
/** 托管版是否提供「免配置体验」 */
export const hasTrialBackend = (): boolean => !!ENV_TRIAL_API;

const DEVICE_KEY = 'hiexplore-device-id';
/** 匿名体验用的稳定设备标识（存在浏览器） */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(16).slice(2)));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return 'nodev'; }
}
function getAuthToken(): string {
  try { return localStorage.getItem('aae-auth-token') || ''; } catch { return ''; }
}

export const PRESET_PROVIDERS: { label: string; baseUrl: string; model: string; hint: string }[] = [
  { label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', hint: '需先运行 ollama serve' },
  { label: 'LM Studio（本地）', baseUrl: 'http://localhost:1234/v1', model: 'local-model', hint: '在 LM Studio 中启动本地服务器' },
  { label: 'vLLM（本地/私有）', baseUrl: 'http://localhost:8000/v1', model: '', hint: '填写启动 vLLM 时指定的模型名' },
  { label: '通义千问（云端）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', hint: '需要 DashScope API Key' },
  { label: 'DeepSeek（云端）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '需要 DeepSeek API Key' },
  { label: 'Claude（Anthropic 云端）', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', hint: '需要 Claude API Key；更深更完整。浏览器直连可能受 CORS 限制，必要时走云代理' },
];

export function getDefaultSettings(): LLMSettings {
  // 托管版：新用户默认走「免配置体验」（DeepSeek，有额度），一进来就能用
  if (ENV_TRIAL_API) {
    return { provider: 'trial', baseUrl: ENV_TRIAL_API, apiKey: '', model: 'deepseek-chat' };
  }
  if (ENV_PROXY_URL) {
    return { provider: 'cloud-proxy', baseUrl: ENV_PROXY_URL, apiKey: '', model: 'qwen-turbo' };
  }
  return { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5:7b' };
}

/** 当前是否处于「免配置体验」模式 */
export function isTrialMode(): boolean {
  return loadLLMSettings().provider === 'trial';
}

export function loadLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.baseUrl !== undefined) return { ...getDefaultSettings(), ...parsed };
    }
  } catch { /* ignore */ }
  return getDefaultSettings();
}

export function saveLLMSettings(s: LLMSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** 是否已有可用的模型配置 */
export function isLLMConfigured(): boolean {
  const s = loadLLMSettings();
  return !!s.baseUrl;
}

// ─── 统一调用 ─────────────────────────────────────────────

export interface LLMCallOptions {
  model?: string;          // 覆盖默认模型
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export interface LLMResult {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** 体验模式下返回的剩余次数信息 */
  trial?: { scope: 'anon' | 'user'; remaining: number; limit: number };
}

/** 体验额度用完时抛出的错误（前端可据此引导注册/填 Key） */
export class TrialQuotaError extends Error {
  code: string; scope?: string;
  constructor(message: string, code = 'QUOTA_EXCEEDED', scope?: string) {
    super(message); this.name = 'TrialQuotaError'; this.code = code; this.scope = scope;
  }
}

/**
 * 调用当前配置的 LLM（OpenAI Chat Completions 格式）
 */
export async function callLLM(
  messages: { role: string; content: string }[],
  options: LLMCallOptions = {},
  settings?: LLMSettings,
): Promise<LLMResult> {
  if (getLanguage() === 'en') messages = [{ role: 'system', content: 'Use English for user-facing prose and generated descriptions. Keep JSON schema keys, IDs, quotations and source evidence unchanged.' }, ...messages];
  const s = settings || loadLLMSettings();
  if (s.provider === 'platform') return sharedRequest<LLMResult>('/shared/chat', 'POST', { modelId: s.model, requestId: crypto.randomUUID(), messages, maxTokens: options.maxTokens ?? 2048, jsonMode: options.jsonMode === true }, options.timeoutMs ?? 90000);
  if (!s.baseUrl) {
    throw new Error('尚未配置模型 API，请点击右上角 ⚙️ 设置模型接入');
  }

  const isTrial = s.provider === 'trial';
  const globalTrial = loadLLMSettings();
  const trustedTrialBase = (ENV_TRIAL_API || (globalTrial.provider === 'trial' ? globalTrial.baseUrl : '')).replace(/\/+$/, '');
  if (isTrial && settings && (!trustedTrialBase || s.baseUrl.replace(/\/+$/, '') !== trustedTrialBase)) {
    throw new Error('体验代理仅允许使用全局配置的地址。自定义服务请使用独立 API 协议和密钥');
  }
  const { url, headers, body } = buildModelRequest(isTrial && ENV_TRIAL_API ? { ...s, baseUrl: ENV_TRIAL_API } : s, messages, options);
  if (isTrial) {
    headers['X-Device-Id'] = getDeviceId();
    const t = getAuthToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({} as any));
      if (isTrial && (response.status === 402 || response.status === 429)) {
        // 体验额度耗尽是最关键的流失点：它意味着用户想继续用但被挡住了。
        // 埋点让你能看出「额度设小了」还是「压根没人用到额度上限」。
        trackEvent('trial_quota_exhausted', { scope: err.scope || 'unknown' });
        throw new TrialQuotaError(err.error || '体验次数已用完', err.code || 'QUOTA_EXCEEDED', err.scope);
      }
      // 兼容两种错误结构：OpenAI 的 {error:{message}} 与本服务的 {error:"..."}
      const msg = err.error?.message || (typeof err.error === 'string' ? err.error : '') || response.statusText;
      throw new Error(`HTTP ${response.status}: ${s.apiKey ? String(msg).split(s.apiKey).join('[密钥已隐藏]') : msg}`);
    }

    const data = await response.json();
    return parseModelResponse(data, s.provider);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 查询体验剩余次数（托管版；非托管或未开启返回 null） */
export async function getTrialQuota(): Promise<{ enabled: boolean; scope: 'anon' | 'user'; limit: number; used: number; remaining: number } | null> {
  if (!ENV_TRIAL_API) return null;
  try {
    const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() };
    const t = getAuthToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const r = await fetch(`${ENV_TRIAL_API}/api/quota`, { headers });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * 测试当前（或给定）配置是否可用
 */
export async function testLLMConnection(settings?: LLMSettings): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const prev = settings ? loadLLMSettings() : null;
  if (settings) saveLLMSettings(settings);
  const start = Date.now();
  try {
    const r = await callLLM(
      [{ role: 'user', content: '请只回复：OK' }],
      { maxTokens: 64, timeoutMs: 25000 }
    );
    const latencyMs = Date.now() - start;
    if (r.content && r.content.trim()) return { ok: true, message: `连接成功（${latencyMs}ms）`, latencyMs };
    // 200 但 content 为空：连接其实通了，常见于推理模型（deepseek-reasoner 等）把额度用在隐藏思考上
    return { ok: true, message: `连接已通，但模型未返回正文。若用的是 deepseek-reasoner 这类推理模型，建议模型名改成 deepseek-chat（更快、支持本应用所需的 JSON 模式）。`, latencyMs };
  } catch (e: any) {
    if (prev) saveLLMSettings(prev);
    const msg = e.name === 'AbortError' ? '连接超时' : (e.message || '未知错误');
    return { ok: false, message: `连接失败：${msg}` };
  }
}
