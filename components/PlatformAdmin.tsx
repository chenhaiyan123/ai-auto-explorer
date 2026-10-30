import React, { useEffect, useState } from 'react';
import { sharedRequest } from '../services/sharedModelsClient';
import { marketRequest, type MarketState } from '../services/serviceMarket';

/**
 * 平台代办服务：还没有开放接口的实物服务，先由平台（管理员账号）在服务广场挂出来，AI 下单后人工去办。
 * 拿到嘉立创 / 顺丰的接口权限后，这些单可以改成自动下单。
 */
const CONTACT = '平台客服（通过订单留言联系）';
export const CONCIERGE = [
  { title: 'PCB 打样代下单（嘉立创）', category: 'printing', priceCents: 6000, deliveryDays: 7, unit: '次', automation: 'assisted', availability: 'always',
    description: '把 AI 或你画好的 PCB 设计文件交给我们，平台在嘉立创代下单打样，顺丰寄到你手上。价格含 5 片 10×10cm 以内双层板和寄送；更大、更多层或要贴片的，先报价确认再做。',
    inputs: 'Gerber 文件（zip）、板子数量、收货地址和电话', deliverables: '实物 PCB 寄到你手上 + 嘉立创订单截图和快递单号', limits: '不做电路设计审核；文件有问题会退回让你改；超出标准规格先报价，取消不收费' },
  { title: '3D 打印代下单（嘉立创）', category: 'printing', priceCents: 8000, deliveryDays: 7, unit: '件', automation: 'assisted', availability: 'always',
    description: '上传 3D 模型，平台在嘉立创 3D 打印（树脂 / 尼龙 / 金属可选）代下单，寄到你手上。价格适合 10cm 以内的光敏树脂小件；大件或金属先报价。',
    inputs: 'STL / STEP 模型文件、材料和颜色、数量、收货地址', deliverables: '打印件寄到你手上 + 订单截图和快递单号', limits: '不负责模型设计和结构强度；超出尺寸或特殊材料先报价，取消不收费' },
  { title: '顺丰代寄 / 代收样品', category: 'other', priceCents: 3000, deliveryDays: 3, unit: '次', automation: 'assisted', availability: 'always',
    description: '寄样品给检测机构、打样厂或合作方，平台叫顺丰上门取件、全程跟踪单号。价格含 1kg 以内国内顺丰标快；更重或加急另报。',
    inputs: '寄件地址和联系人、收件地址和联系人、物品和重量', deliverables: '顺丰单号和签收记录', limits: '不寄违禁品、易燃易爆、液体和锂电池单独寄送需提前说明' },
  { title: '检测机构预约代办（材料 / 成分 / 性能测试）', category: 'lab', priceCents: 5000, deliveryDays: 10, unit: '次', automation: 'human', availability: 'by_appointment',
    description: '说清楚要测什么，平台帮你在科学指南针等第三方检测平台选机构、预约、寄样，拿回检测报告。这个价格是代办服务费，检测费按机构报价另付，下单前先报给你确认。',
    inputs: '要测的指标、样品情况（材质、数量、尺寸）、期望时间', deliverables: '检测机构出具的报告（PDF）+ 原始数据（如有）', limits: '检测费另计；平台不对检测结论负责，以机构报告为准' },
];
function ConciergeSetup() {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg('');
    try {
      const st = await marketRequest<MarketState>('/state');
      const mine = st.services.filter(x => x.mine);
      let made = 0;
      for (const t of CONCIERGE) {
        if (mine.some(x => x.title === t.title && x.published)) continue;
        await marketRequest('/services', 'PUT', { ...t, revision: 0, providerName: 'HiExplore 平台代办', location: '线上下单，全国寄送', contact: CONTACT, published: true, confirmed: true });
        made++;
      }
      setMsg(made ? `挂出了 ${made} 个代办服务，在服务广场「现成服务」里能看到；价格在「我的摊位」里改` : '都已经挂着了');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="rounded-xl border border-slate-700 p-3 space-y-2">
    <div className="font-semibold">平台代办服务（实物类，人工办理）</div>
    <p className="text-xs text-slate-400 leading-5">嘉立创、顺丰的开放接口要申请权限，科学指南针没有公开接口。先用管理员账号在服务广场挂 {CONCIERGE.length} 个代办服务：PCB 打样、3D 打印、顺丰寄样品、检测预约。AI 遇到这类事会直接下单（钱包担保），你收到订单后去对应平台办好、在订单里交付；用户验收后钱进你的钱包。</p>
    <button disabled={busy} onClick={() => void go()} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40">{busy ? '正在挂…' : '一键挂出代办服务'}</button>
    {msg && <p className="text-xs text-emerald-300">{msg}</p>}
  </div>;
}

/** 管理员：平台直连服务的密钥和价格（密钥只写不读，服务器加密保存） */
type Cfg = { wjx: boolean; tyc: boolean; asr?: boolean; asrOwn?: boolean; amap?: boolean; umami?: boolean; umamiSite?: string; prices: Record<string, number> };
const LABEL: Record<string, string> = { company_search: '企业搜索 / 次', company_info: '企业详情 / 次', survey_create: '发一份问卷', page_create: '做一个预售页', asr_file: '录音转文字 / 个', poi_search: '门店统计 / 次' };

export default function PlatformAdmin() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [wjx, setWjx] = useState(''), [tyc, setTyc] = useState(''), [asr, setAsr] = useState(''), [amap, setAmap] = useState(''), [umami, setUmami] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const load = () => sharedRequest<Cfg>('/admin/platform').then(c => { setCfg(c); setPrices(Object.fromEntries(Object.entries(c.prices).map(([k, v]) => [k, (v / 100).toFixed(2)]))); }).catch(e => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setMsg('');
    const body: Record<string, unknown> = { prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Math.round(Number(v) * 100)])) };
    if (wjx.trim()) body.wjxKey = wjx.trim();
    if (tyc.trim()) body.tycKey = tyc.trim();
    if (asr.trim()) body.asrKey = asr.trim();
    if (amap.trim()) body.amapKey = amap.trim();
    if (umami.trim()) body.umamiKey = umami.trim();
    try { setCfg(await sharedRequest<Cfg>('/admin/platform', 'PUT', body)); setWjx(''); setTyc(''); setAsr(''); setAmap(''); setUmami(''); setMsg('已保存'); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm';
  return <div className="space-y-4 text-sm">
    <p className="text-slate-400 leading-6">平台用自己的账号去调第三方，用户和 AI 按次从 AI 钱包付费（失败自动退回；每人每天最多 ¥50）。密钥只写不读，服务器加密保存；没填的服务对用户显示「待开通」。</p>
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="space-y-1"><div>问卷星 API Key {cfg && <span className={cfg.wjx ? 'text-emerald-400' : 'text-amber-300'}>{cfg.wjx ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={wjx} onChange={e => setWjx(e.target.value)} placeholder={cfg?.wjx ? '已配置，填新的会覆盖' : '问卷星后台 → 开放平台 → API Key'} className={field} autoComplete="off" /></label>
      <label className="space-y-1"><div>天眼查授权 {cfg && <span className={cfg.tyc ? 'text-emerald-400' : 'text-amber-300'}>{cfg.tyc ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={tyc} onChange={e => setTyc(e.target.value)} placeholder={cfg?.tyc ? '已配置，填新的会覆盖' : '天眼查 AI 开放平台的 API Key'} className={field} autoComplete="off" /></label>
      <label className="space-y-1 sm:col-span-2"><div>录音转文字（阿里云百炼 Key，选填） {cfg && <span className={cfg.asr ? 'text-emerald-400' : 'text-amber-300'}>{cfg.asr ? (cfg.asrOwn ? '· 已配置' : '· 已开通（借用通义千问的百炼 Key）') : '· 未配置'}</span>}</div><input type="password" value={asr} onChange={e => setAsr(e.target.value)} placeholder="留空就借用「共享模型」里通义千问的百炼 Key；想单独计费再填" className={field} autoComplete="off" /></label>
      <label className="space-y-1 sm:col-span-2"><div>高德地图 Web 服务 Key {cfg && <span className={cfg.amap ? 'text-emerald-400' : 'text-amber-300'}>{cfg.amap ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={amap} onChange={e => setAmap(e.target.value)} placeholder={cfg?.amap ? '已配置，填新的会覆盖' : 'lbs.amap.com → 控制台 → 应用管理 → 创建 Key（服务平台选「Web服务」）'} className={field} autoComplete="off" /></label>
      <label className="space-y-1 sm:col-span-2"><div>Umami API Key（网站访客统计，只读） {cfg && <span className={cfg.umami ? 'text-emerald-400' : 'text-amber-300'}>{cfg.umami ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={umami} onChange={e => setUmami(e.target.value)} placeholder={cfg?.umami ? '已配置，填新的会覆盖' : 'cloud.umami.is → 右上角头像 → Settings → API keys → Create key'} className={field} autoComplete="off" /><div className="text-[11px] text-slate-500">填好后在「用户数据」页能看到网站历史访客（网站 ID {cfg?.umamiSite?.slice(0, 8) || 'be74bdcf'}…）</div></label>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Object.keys(LABEL).map(k => <label key={k} className="space-y-1"><div className="text-slate-400 text-xs">{LABEL[k]}（元）</div><input type="number" min="0" step="0.01" value={prices[k] ?? ''} onChange={e => setPrices(p => ({ ...p, [k]: e.target.value }))} className={field} /></label>)}</div>
    <div className="flex items-center gap-3"><button onClick={() => void save()} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold">保存</button>{msg && <span className="text-slate-300">{msg}</span>}</div>
    <ConciergeSetup />
    <p className="text-xs text-slate-500 leading-5">价格建议：成本价上浮一点。问卷星样本（付费找人答）暂不自动下单，需要时人工代下。预售页由平台自建，公开在 pay.hiexplore.com/p/…，页脚会写明是用户创建、不收费。</p>
  </div>;
}
