import React from 'react';
import { useLanguage } from '../services/language';
export default function IOSWelcome({ onContinue }: { onContinue: () => void }) {
  const { t } = useLanguage();
  return <main className="h-full overflow-y-auto bg-slate-950 text-slate-100 px-7 py-12 flex flex-col justify-center max-w-xl mx-auto">
    <div className="w-16 h-16 rounded-2xl bg-blue-950 flex items-center justify-center text-3xl font-bold mb-8 relative">A<span className="absolute top-2 right-2 w-3 h-3 rounded-full bg-emerald-400" /></div>
    <p className="text-emerald-400 text-sm mb-3">HiExplore · iOS</p>
    <h1 className="text-3xl font-semibold leading-tight">{t('让值得关心的问题，\n继续生长。', 'Keep your curiosity alive.')}</h1>
    <p className="mt-5 text-slate-300 leading-7">{t('随时查看项目、核对事实，与 AI 团队交流。开启云端长期关注后，即使退出 App，研究也会按计划继续。', 'Review projects and evidence, and talk with your AI team. Enable ongoing cloud research to keep watching while the app is closed.')}</p>
    <div className="mt-7 rounded-2xl border border-slate-800 p-4 text-sm text-slate-400 space-y-3">
      <p>{t('笔记目前保存在此设备，网页登录后的笔记不会自动同步到手机。请保留原设备的数据备份。', 'Notes currently stay on this device. Website notes do not automatically sync to your phone. Keep a backup on your original device.')}</p>
      <p>{t('重要变化可以发到登录邮箱。原生推送和应用内购买尚未开放。', 'Important updates can go to your login email. Native push and in-app purchases are not enabled yet.')}</p>
    </div>
    <button onClick={onContinue} className="mt-8 min-h-12 rounded-xl bg-blue-600 text-white font-medium py-3">{t('开始探索', 'Start exploring')}</button>
  </main>;
}
