import { useSyncExternalStore } from 'react';
import { EN_UI } from './translations.en';
export type Language = 'zh-CN' | 'en';
const KEY = 'hiexplore-language';
const listeners = new Set<() => void>();
export function getLanguage(): Language { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh-CN'; } catch { return 'zh-CN'; } }
export function setLanguage(value: Language) {
  localStorage.setItem(KEY, value);
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  for (const notify of listeners) notify();
}
export function useLanguage() {
  const language = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, getLanguage, () => 'zh-CN' as Language);
  return { language, setLanguage, t };
}
export function t(zh: string, en?: string) { return getLanguage() === 'en' ? en || EN_UI[zh] || zh : zh; }
export const displayDate = (at: number) => new Date(at).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'zh-CN');
if (typeof window !== 'undefined') {
  document.documentElement.lang = getLanguage();
  window.addEventListener('storage', e => { if (e.key === KEY) { document.documentElement.lang = getLanguage(); for (const notify of listeners) notify(); } });
}
