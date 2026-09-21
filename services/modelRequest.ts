import type { LLMSettings, LLMCallOptions, LLMResult } from './llmProvider';

/** Pure dialect adapter: can be tested without sending credentials or network requests. */
export function buildModelRequest(s: LLMSettings, messages: { role: string; content: string }[], options: LLMCallOptions = {}) {
  const base = s.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.provider === 'anthropic') {
    if (s.apiKey) headers['x-api-key'] = s.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    // Official direct-browser opt-in; custom proxies may handle CORS server-side.
    if (new URL(base).hostname === 'api.anthropic.com') headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return { url: /\/messages$/.test(base) ? base : `${base}/messages`, headers, body: {
      model: options.model || s.model, max_tokens: options.maxTokens ?? 4096,
      system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    } };
  }
  if (s.apiKey && s.provider !== 'trial') headers.Authorization = `Bearer ${s.apiKey}`;
  const body: Record<string, unknown> = { model: options.model || s.model, messages };
  if (s.provider === 'openai') body.max_completion_tokens = options.maxTokens ?? 4096;
  else { body.max_tokens = options.maxTokens ?? 2048; body.temperature = options.temperature ?? 0.7; }
  // Bounded JSON tasks use the non-thinking DeepSeek mode to reserve tokens for the answer.
  if (s.provider === 'openai-compatible' && new URL(base).hostname === 'api.deepseek.com' && (options.model || s.model).startsWith('deepseek-v4')) body.thinking = { type: 'disabled' };
  // K2.6 rejects the generic 0.7 temperature. Bounded research/JSON calls use
  // instant mode so the output budget is available for the actual answer.
  // https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart
  if (s.provider === 'openai-compatible' && ['api.moonshot.cn', 'api.moonshot.ai'].includes(new URL(base).hostname) && /^kimi-k2\.6(?:-|$)/.test(options.model || s.model)) {
    body.thinking = { type: 'disabled' };
    body.temperature = 0.6;
  }
  if (options.jsonMode) body.response_format = { type: 'json_object' };
  return { url: s.provider === 'cloud-proxy' ? base : s.provider === 'trial' ? `${base}/api/chat` : /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`, headers, body };
}

export function parseModelResponse(data: any, provider: LLMSettings['provider']): LLMResult {
  if (provider === 'anthropic') {
    if (data.stop_reason === 'max_tokens') throw new Error('Claude 输出达到长度限制，请缩短任务材料后重试');
    return { content: (Array.isArray(data.content) ? data.content : []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), usage: { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0 } };
  }
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到长度限制，请缩短任务材料后重试');
  return { content: data.choices?.[0]?.message?.content || data.content || '', usage: data.usage, trial: data._trial };
}
