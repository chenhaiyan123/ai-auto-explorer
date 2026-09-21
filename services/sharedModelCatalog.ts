import type { SharedModel, TokenBalance } from './sharedModelsClient';

// Presets contain no credentials and do not enable a model. IDs are entered from the provider console.
export const SHARED_MODEL_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', deferred: false, hint: '填写 DeepSeek 模型 ID' },
  { id: 'qwen', label: '通义千问', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', deferred: false, hint: '默认北京接口；Key 与接口地域须一致，业务空间专属域名需加入后台白名单' },
  { id: 'doubao', label: '豆包', provider: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', deferred: false, hint: '填写火山方舟支持的模型 ID 或推理接入点 ID（ep-…）' },
  { id: 'kimi', label: 'Kimi', provider: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', deferred: false, hint: '填写 Kimi 开放平台支持的模型 ID' },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', deferred: true, hint: '预留接口，默认不开放' },
  { id: 'claude', label: 'Claude', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', deferred: true, hint: '预留接口，默认不开放' },
  { id: 'gemini', label: 'Gemini', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', deferred: true, hint: '预留兼容接口，默认不开放' },
  { id: 'grok', label: 'Grok', provider: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', deferred: true, hint: '预留接口，默认不开放' },
  { id: 'zhipu', label: '智谱', provider: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', deferred: true, hint: '其他可扩展接口，默认不开放' },
];

export function sharedModelStatus(model?: SharedModel, balance?: TokenBalance) {
  if (!model?.hasKey) return { available: false, label: '未配置 Key' };
  if (!model.enabled) return { available: false, label: '已暂停' };
  if (!model.model.trim()) return { available: false, label: '未配置模型' };
  if (model.dailyTokens <= model.usedToday) return { available: false, label: '今日额度受限' };
  if (balance && balance.available <= 0) return { available: false, label: balance.held > 0 ? '额度已预留，等待结算' : '个人额度不足' };
  return { available: true, label: '可用 · 已配置 Key' };
}

export function missingSharedPresets(models: SharedModel[]) {
  return SHARED_MODEL_PRESETS.filter(p => !models.some(m => {
    try { return new URL(m.baseUrl).hostname === new URL(p.baseUrl).hostname || (p.id === 'qwen' && new URL(m.baseUrl).hostname.endsWith('.maas.aliyuncs.com')); }
    catch { return false; }
  }));
}
