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
  // 通义千问联网搜索：OpenAI 兼容接口不返回来源，所以走 DashScope 原生接口（同一个 Key、同一个域名）。
  // 来源链接是「AI 线索 ≠ 证据」这条规矩的底线：没有可点开的出处，就只能算推理。
  if (options.webSearch && isDashScope(base)) {
    const origin = new URL(base).origin;
    return { url: `${origin}/api/v1/services/aigc/text-generation/generation`, headers, body: {
      model: options.model || s.model,
      input: { messages },
      parameters: { result_format: 'message', enable_search: true, search_options: { enable_source: true }, enable_thinking: false, max_tokens: options.maxTokens ?? 1024, temperature: options.temperature ?? 0.3 },
    } };
  }
  let model = options.model || s.model;
  // 老配置里存的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用，请求会直接报错：自动换成新 ID
  const legacyDeepSeek = s.provider === 'openai-compatible' && new URL(base).hostname === 'api.deepseek.com' && /^deepseek-(chat|reasoner)$/.test(model);
  const wantReasoning = legacyDeepSeek && model === 'deepseek-reasoner';
  if (legacyDeepSeek) model = 'deepseek-flash';
  const body: Record<string, unknown> = { model, messages };
  if (s.provider === 'openai') body.max_completion_tokens = options.maxTokens ?? 4096;
  else { body.max_tokens = options.maxTokens ?? 2048; body.temperature = options.temperature ?? 0.7; }
  // Bounded JSON tasks use the non-thinking DeepSeek mode to reserve tokens for the answer.
  // deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用；新 ID 是 deepseek-flash / deepseek-v4-pro，默认会思考，这里关掉。
  if (s.provider === 'openai-compatible' && new URL(base).hostname === 'api.deepseek.com' && /^deepseek-(v4|flash)/.test(model)) body.thinking = { type: wantReasoning ? 'enabled' : 'disabled' };
  // 通义千问 qwen3.5 及以后的混合模型默认开思考：非流式调用要么报错、要么把输出额度花在隐藏思考上。
  // enable_thinking 对不支持思考的老模型无副作用。
  if (s.provider === 'openai-compatible' && isDashScope(base)) body.enable_thinking = false;
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

export const isDashScope = (base: string) => /(^|\.)dashscope(-intl)?\.aliyuncs\.com$/.test(new URL(base).hostname);

export function parseModelResponse(data: any, provider: LLMSettings['provider']): LLMResult {
  // DashScope 原生接口（联网搜索）
  if (data && data.output && !data.choices) {
    const choice = data.output.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('模型输出达到长度限制，请缩短任务材料后重试');
    const sources = (Array.isArray(data.output.search_info?.search_results) ? data.output.search_info.search_results : [])
      .filter((r: any) => r && typeof r.url === 'string' && /^https?:\/\//.test(r.url))
      .slice(0, 20)
      .map((r: any, i: number) => ({ index: Number.isInteger(r.index) ? r.index : i + 1, title: String(r.title || '').slice(0, 200), url: r.url.slice(0, 1000), site: r.site_name ? String(r.site_name).slice(0, 80) : undefined }));
    return { content: choice?.message?.content || data.output.text || '', usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens } : undefined, sources };
  }
  if (provider === 'anthropic') {
    if (data.stop_reason === 'max_tokens') throw new Error('Claude 输出达到长度限制，请缩短任务材料后重试');
    return { content: (Array.isArray(data.content) ? data.content : []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), usage: { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0 } };
  }
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到长度限制，请缩短任务材料后重试');
  return { content: data.choices?.[0]?.message?.content || data.content || '', usage: data.usage, trial: data._trial };
}
