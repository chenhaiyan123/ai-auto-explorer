import React, { useEffect, useState } from 'react';
import { sharedRequest, SHARED_API, type SharedCatalog, type SharedModel } from '../services/sharedModelsClient';
import { loadLLMSettings, saveLLMSettings } from '../services/llmProvider';
import { BILLING_CHANGED } from '../services/billingClient';

/**
 * AI 用哪个模型干活、给模型充 API 额度。
 * 平台共享模型按「钱包价」从 AI 钱包扣钱；用自己 API Key 的不走这里。
 * 「让 AI 自己挑」= 在能用钱包的模型里挑最便宜的那个当默认（之后可以随时改）。
 */
const yuanPerM = (cents?: number) => (cents ? `¥${(cents / 100).toFixed(2)} / 百万 Token` : '未开放钱包');
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);

export const cheapestWalletModel = (models: SharedModel[]): SharedModel | undefined =>
  models.filter(m => m.enabled && m.hasKey && (m.priceCentsPerM || 0) > 0 && m.dailyTokens - m.usedToday > 20000).sort((a, b) => (a.priceCentsPerM || 0) - (b.priceCentsPerM || 0))[0];

const WalletModels: React.FC = () => {
  const [cat, setCat] = useState<SharedCatalog | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [current, setCurrent] = useState(() => loadLLMSettings());
  const load = () => sharedRequest<SharedCatalog>('/shared/catalog').then(c => { setCat(c); setErr(''); }).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { if (SHARED_API) void load(); }, []);

  const use = (m: SharedModel, auto = false) => {
    const next = { ...loadLLMSettings(), provider: 'platform' as const, model: m.id };
    saveLLMSettings(next); setCurrent(next);
    setMsg(auto ? `AI 选了最省钱的「${m.label}」当默认模型（${yuanPerM(m.priceCentsPerM)}）` : `之后 AI 默认用「${m.label}」干活`);
  };
  const charge = async (m: SharedModel, cents: number) => {
    setBusy(m.id); setMsg('');
    try {
      await sharedRequest('/shared/wallet-convert', 'POST', { modelId: m.id, cents, requestId: crypto.randomUUID() });
      setMsg(`已从 AI 钱包充 ¥${cents / 100} 到「${m.label}」`);
      window.dispatchEvent(new Event(BILLING_CHANGED));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  if (!SHARED_API) return null;
  const models = (cat?.models || []).filter(m => m.enabled && m.hasKey);
  const pick = cheapestWalletModel(models);
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-2" aria-label="AI 用的模型">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-slate-200">🧠 AI 用的模型 · API 额度</span>
        <span className="text-[11px] text-slate-500">额度不够时会自动从钱包兑换；也可以先充好</span>
        {pick && <button onClick={() => use(pick, true)} className="ml-auto text-[12px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300">让 AI 自己挑（最省钱）</button>}
      </div>
      {err && <p className="text-[12px] text-slate-500">模型列表暂时读不到（登录正式网站后可见）。</p>}
      {!err && !models.length && cat && <p className="text-[12px] text-slate-500">平台还没有开放共享模型。</p>}
      <ul className="divide-y divide-slate-800">
        {models.map(m => {
          const b = cat?.balances[m.id];
          const isDefault = current.provider === 'platform' && current.model === m.id;
          return (
            <li key={m.id} className="py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <div className="min-w-0 flex-1">
                <div className="text-slate-200 font-medium">{m.label}{isDefault && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-700 text-white">默认</span>}</div>
                <div className="text-[11px] text-slate-500">{yuanPerM(m.priceCentsPerM)} · 可用 {tokens(b?.available || 0)} Token</div>
              </div>
              {!isDefault && <button onClick={() => use(m)} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">设为默认</button>}
              {!!m.priceCentsPerM && [1000, 3000].map(c => (
                <button key={c} disabled={!!busy || (cat?.walletCents || 0) < c} onClick={() => void charge(m, c)} className="px-2 py-1 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white disabled:opacity-40" title={(cat?.walletCents || 0) < c ? '钱包余额不够' : ''}>充 ¥{c / 100}</button>
              ))}
            </li>
          );
        })}
      </ul>
      {msg && <p role="status" className="text-[12px] text-emerald-300">{msg}</p>}
      <p className="text-[11px] text-slate-500">AI 团队里每个角色也可以单独选模型（「AI 团队」→ 团队设置）。</p>
    </section>
  );
};

export default WalletModels;
