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

export type LLMProviderType = 'cloud-proxy' | 'openai-compatible';

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

export const PRESET_PROVIDERS: { label: string; baseUrl: string; model: string; hint: string }[] = [
  { label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', hint: '需先运行 ollama serve' },
  { label: 'LM Studio（本地）', baseUrl: 'http://localhost:1234/v1', model: 'local-model', hint: '在 LM Studio 中启动本地服务器' },
  { label: 'vLLM（本地/私有）', baseUrl: 'http://localhost:8000/v1', model: '', hint: '填写启动 vLLM 时指定的模型名' },
  { label: '通义千问（云端）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', hint: '需要 DashScope API Key' },
  { label: 'DeepSeek（云端）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '需要 DeepSeek API Key' },
];

export function getDefaultSettings(): LLMSettings {
  if (ENV_PROXY_URL) {
    return { provider: 'cloud-proxy', baseUrl: ENV_PROXY_URL, apiKey: '', model: 'qwen-turbo' };
  }
  return { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5:7b' };
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
}

/**
 * 调用当前配置的 LLM（OpenAI Chat Completions 格式）
 */
export async function callLLM(
  messages: { role: string; content: string }[],
  options: LLMCallOptions = {}
): Promise<LLMResult> {
  const s = loadLLMSettings();
  if (!s.baseUrl) {
    throw new Error('尚未配置模型 API，请点击右上角 ⚙️ 设置模型接入');
  }

  const url = s.provider === 'cloud-proxy'
    ? s.baseUrl
    : `${s.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.provider === 'openai-compatible' && s.apiKey) {
    headers['Authorization'] = `Bearer ${s.apiKey}`;
  }

  const body: any = {
    model: options.model || s.model,
    messages,
    max_tokens: options.maxTokens ?? 1000,
    temperature: options.temperature ?? 0.7,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

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
      throw new Error(`HTTP ${response.status}: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || data.content || '',
      usage: data.usage,
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
      [{ role: 'user', content: '回复"OK"两个字母即可' }],
      { maxTokens: 10, timeoutMs: 20000 }
    );
    const latencyMs = Date.now() - start;
    if (r.content) return { ok: true, message: `连接成功（${latencyMs}ms）`, latencyMs };
    return { ok: false, message: '连接成功但返回为空' };
  } catch (e: any) {
    if (prev) saveLLMSettings(prev);
    const msg = e.name === 'AbortError' ? '连接超时' : (e.message || '未知错误');
    return { ok: false, message: `连接失败：${msg}` };
  }
}
