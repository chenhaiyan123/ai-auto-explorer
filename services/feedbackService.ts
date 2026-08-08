/**
 * 用户反馈通道。
 *
 * 设计取舍：
 * 1. 首选后端 `/api/feedback`（复用已部署的阿里云 FC + Resend，反馈直接落到邮箱，
 *    邮箱本身就是持久化，不引入任何新基础设施）。
 * 2. 后端没配 FEEDBACK_TO / 请求失败时，**降级**成预填好的 GitHub Issue 链接，
 *    保证按钮永远不会点了没反应 —— 收不到反馈是推广期最亏的事。
 * 3. 自动附带诊断上下文。用户描述问题往往只有"卡住了"三个字，
 *    有上下文才可能复现（用了哪个模型、几个项目、多少节点、什么浏览器）。
 */

import { getDeviceId } from './llmProvider';

export type FeedbackKind = 'bug' | 'idea' | 'confused' | 'other';

export interface FeedbackContext {
  [k: string]: string | number | boolean;
}

const API_BASE = ((import.meta as any).env?.VITE_TRIAL_API
  || (import.meta as any).env?.VITE_AUTH_API || '').trim().replace(/\/+$/, '');

const REPO = 'chenhaiyan123/ai-auto-explorer';
/** 与 authService.TOKEN_KEY / llmProvider 保持一致：纯字符串，不是 JSON */
const TOKEN_KEY = 'aae-auth-token';

export const hasFeedbackBackend = (): boolean => !!API_BASE;

/** 取登录令牌；读失败就当匿名（匿名反馈按设备 ID 限量） */
function authToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

/** 降级方案：拼一个预填好正文的 GitHub Issue 链接 */
export function buildIssueUrl(kind: FeedbackKind, text: string, ctx: FeedbackContext): string {
  const labelMap: Record<FeedbackKind, string> = {
    bug: '报错', idea: '建议', confused: '没看懂', other: '反馈',
  };
  const title = `[${labelMap[kind]}] ${text.slice(0, 50)}`;
  const body = [
    text, '', '---', '运行环境（自动生成）：', '',
    ...Object.entries(ctx).map(([k, v]) => `- ${k}: ${v}`),
  ].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export interface SubmitResult {
  ok: boolean;
  /** 后端不可用时给出的降级链接 */
  fallbackUrl?: string;
  error?: string;
}

export async function submitFeedback(
  kind: FeedbackKind,
  text: string,
  contact: string,
  ctx: FeedbackContext,
): Promise<SubmitResult> {
  const fallbackUrl = buildIssueUrl(kind, text, ctx);
  if (!API_BASE) return { ok: false, fallbackUrl, error: '未配置反馈后端' };

  try {
    const token = authToken();
    const r = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ kind, text, contact, context: ctx }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true };
    // 429 是用户自己超限，不该降级到 GitHub（会重复提交），直接把原因告诉他
    if (r.status === 429) return { ok: false, error: data.error || '提交过于频繁' };
    return { ok: false, fallbackUrl, error: data.error || `提交失败(${r.status})` };
  } catch {
    return { ok: false, fallbackUrl, error: '网络异常' };
  }
}

/** 收集诊断上下文。只取能帮上复现的，不碰笔记正文等隐私内容。 */
export function collectContext(extra: FeedbackContext = {}): FeedbackContext {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : '其他';
  return {
    页面: location.pathname + location.hash,
    浏览器: browser,
    屏幕: `${window.innerWidth}x${window.innerHeight}`,
    语言: navigator.language,
    时间: new Date().toLocaleString('zh-CN'),
    ...extra,
  };
}
