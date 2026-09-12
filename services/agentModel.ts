import { callLLM, loadLLMSettings, type LLMSettings } from './llmProvider';
import { validateAgentModel, type AgentModelConfig, type AgentProfiles, type AgentProfile } from './agentProfiles';
import type { InquiryModel } from './inquiry';
import { monitor } from './monitoringService';

const storageKey = (owner: string | undefined, id: string) => `hiexplore_agent_credential:${encodeURIComponent(owner || 'local')}:${id}`;
const binding = (c: AgentModelConfig) => `${c.provider}:${c.baseUrl.replace(/\/+$/, '')}`;
export function saveAgentCredential(owner: string | undefined, config: AgentModelConfig, secret: string): string {
  const id = crypto.randomUUID();
  localStorage.setItem(storageKey(owner, id), JSON.stringify({ binding: binding(config), secret }));
  return id;
}
function secretFor(owner: string | undefined, config: AgentModelConfig): string {
  if (!config.credentialId) return '';
  const raw = localStorage.getItem(storageKey(owner, config.credentialId));
  if (!raw) throw new Error('此 API 的密钥在当前浏览器或账号中不存在，请重新填写并保存');
  const entry = JSON.parse(raw);
  if (entry.binding !== binding(config)) throw new Error('API 地址或协议已变化，请为新地址重新填写密钥');
  return entry.secret;
}
export function hasAgentCredential(owner: string | undefined, config: AgentModelConfig): boolean {
  try { return !!secretFor(owner, config); } catch { return false; }
}
export function resolveAgentModel(config: AgentModelConfig, owner?: string): LLMSettings {
  if (config.provider === 'platform') { const clean = validateAgentModel(config); return { ...clean, provider: 'platform', apiKey: '' }; }
  if (config.provider === 'default') return { ...loadLLMSettings() };
  const clean = validateAgentModel(config);
  return { provider: clean.provider as LLMSettings['provider'], baseUrl: clean.baseUrl, model: clean.model, apiKey: secretFor(owner, clean) };
}
/** Freeze global defaults for this round without putting their API key into the project. */
export function snapshotAgentProfile(profile: AgentProfile, owner?: string): AgentProfile {
  if (profile.model.provider !== 'default') return { ...profile, model: validateAgentModel(profile.model) };
  const s = loadLLMSettings();
  const config = validateAgentModel({ provider: s.provider, baseUrl: s.baseUrl.replace(/\/+$/, ''), model: s.model });
  if (s.apiKey) config.credentialId = saveAgentCredential(owner, config, s.apiKey);
  return { ...profile, model: config };
}
export function snapshotAgentModels(agents: AgentProfiles, owner?: string): AgentProfiles {
  return Object.fromEntries(Object.entries(agents).map(([role, profile]) => [role, snapshotAgentProfile(profile, owner)])) as AgentProfiles;
}
export function agentModelCaller(owner?: string): InquiryModel {
  return async (messages, context) => {
    const settings = resolveAgentModel(context?.agent.model || { provider: 'default', baseUrl: '', model: '' }, owner);
    try {
      const result = await callLLM(messages, { jsonMode: true, maxTokens: 4096 }, settings);
      if (!result.content.trim()) throw new Error('模型未返回正文，请核对模型 ID、接口协议和输出额度');
      if (result.usage) monitor.recordTokenUsage(result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
      return result.content;
    } catch (e) {
      if (e instanceof TypeError) throw new Error('模型连接失败，请检查 API 地址、网络和服务端跨域设置；可使用支持浏览器访问的代理');
      throw e;
    }
  };
}
