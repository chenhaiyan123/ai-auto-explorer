import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { t as ui } from '../services/language';
import { acknowledgeSync, backupWorkspace, canonical, prepareSync, publishSync, resolveSync, restoreWorkspaceBackup, setSyncEnabled, syncSettings, type SyncPlan } from '../services/projectSync';

export default function ProjectSyncPanel({ owner, projects, busy, open, onClose, onStatus }: {
  owner: string; projects: Project[]; busy: boolean; open: boolean; onClose: () => void; onStatus: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(() => syncSettings(owner).enabled);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, 'local' | 'cloud'>>({});
  const current = useRef({ projects, busy, enabled, onStatus }); current.current = { projects, busy, enabled, onStatus };
  const running = useRef(false), alive = useRef(true), stopped = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const report = (text: string) => { if (alive.current) { setMessage(text); current.current.onStatus(text); } };
  async function check(manual: boolean) {
    if (running.current) return;
    const startedWith = current.current.projects;
    running.current = true; setWorking(true);
    try {
      const next = await prepareSync(owner, current.current.projects);
      if (!alive.current || stopped.current) return;
      if (canonical(current.current.projects) !== next.localDigest) { report(ui('本地有新编辑，稍后重试同步', 'Local edits changed. Retry sync.')); return; }
      if (manual) { setPlan(next); setChoices({}); report(ui('请核对下方同步预览', 'Review the sync preview below.')); }
      else if (next.conflicts.length || canonical(next.projects) !== next.localDigest) {
        report(ui('云端有更新，请打开项目同步载入', 'Cloud updates available. Open Project sync.'));
      } else {
        const cloud = await publishSync(next, next.projects);
        if (!alive.current || stopped.current) return;
        await acknowledgeSync(owner, cloud, current.current.projects);
        report(ui('项目已同步', 'Projects synced'));
      }
    } catch (e) { report(`${ui('同步未完成：', 'Sync incomplete: ')}${e instanceof Error ? e.message : String(e)}`); }
    finally {
      running.current = false;
      if (alive.current) {
        setWorking(false);
        if (!manual && !stopped.current && current.current.enabled && current.current.projects !== startedWith) setTimeout(() => { if (alive.current) void check(false); }, 2500);
      }
    }
  }
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => { void check(false); }, 2500);
    return () => clearTimeout(timer);
  }, [projects, enabled]);
  useEffect(() => {
    const refresh = () => { if (current.current.enabled) void check(false); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, []);
  async function apply() {
    if (!plan || running.current) return;
    if (current.current.busy) { report(ui('请先等待当前探索结束，再载入云端内容', 'Wait for the current exploration before loading cloud content.')); return; }
    if (canonical(current.current.projects) !== plan.localDigest) { setPlan(null); report(ui('预览后本地内容发生变化，请重新预览', 'Local content changed. Preview again.')); return; }
    running.current = true; setWorking(true);
    try {
      const merged = resolveSync(plan, choices);
      // A recoverable local copy is required before replacing either side.
      await backupWorkspace(owner, current.current.projects);
      const cloud = await publishSync(plan, merged);
      if (!alive.current) return;
      if (canonical(current.current.projects) !== plan.localDigest || current.current.busy) {
        await acknowledgeSync(owner, cloud, current.current.projects);
        setEnabled(true); setPlan(null); report(ui('已保存云端版本，本地新增编辑已保留，请重新预览', 'Cloud saved; newer local edits retained. Preview again.')); return;
      }
      await acknowledgeSync(owner, cloud, merged);
      // Reload only after the durable transaction commits. Never inject remote nodes
      // into an active editor/research run and let old hydration effects overwrite them.
      window.location.reload();
    } catch (e) { report(`${ui('同步未完成：', 'Sync incomplete: ')}${e instanceof Error ? e.message : String(e)}`); }
    finally { running.current = false; if (alive.current) setWorking(false); }
  }
  if (!open) return null;
  return <div className="fixed inset-0 z-[115] bg-black/70 p-4 flex items-center justify-center">
    <section role="dialog" aria-modal="true" aria-label={ui('项目同步', 'Project sync')} className="max-w-xl w-full max-h-[88dvh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-200">
      <div className="flex justify-between items-center"><h2 className="text-lg font-semibold">{ui('项目同步', 'Project sync')}</h2><button disabled={working} onClick={onClose} aria-label={ui('关闭', 'Close')}>✕</button></div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{ui('将项目、笔记、团队、事实与探索阶段树保存到你的 HiExplore 云端账号。其他设备使用同一邮箱登录后，在这里预览并载入。个人 API Key 不参与同步。', 'Save projects, notes, teams, facts and exploration stages to your HiExplore cloud account. Sign in with the same email on another device, then preview and load here. Personal API keys stay on each device.')}</p>
      <p className="mt-2 text-sm text-amber-300">{ui('首次请在有项目的原网页端完成同步，再到手机载入。网页旧版本需先刷新。', 'First sync from the original browser that holds your projects, then load them on your phone. Refresh older website versions first.')}</p>
      <p className="mt-3 text-xs break-all">{owner} · {ui('本地项目', 'Local projects')} {projects.length}</p>
      <p className="mt-2 text-xs text-slate-400">{enabled ? ui('已开启：编辑后自动上传；其他设备的更新需确认载入。', 'Enabled: edits upload automatically; loading other-device changes requires confirmation.') : ui('尚未开启云同步，确认预览后开启。', 'Cloud sync is off. Confirm a preview to enable it.')}</p>
      <div role="status" className="my-4 text-sm text-sky-300 break-words">{message}</div>
      <button disabled={working} onClick={() => { stopped.current = false; void check(true); }} className="rounded-lg bg-blue-600 px-4 py-3 disabled:opacity-50">{working ? ui('正在同步…', 'Syncing…') : ui('预览同步', 'Preview sync')}</button>
      {plan && <div className="mt-5 space-y-3 border-t border-slate-700 pt-4">
        <p className="text-sm">{ui('云端项目', 'Cloud projects')} {plan.remote.projects.length} · {ui('云端版本', 'Cloud revision')} {plan.remote.revision}</p>
        {plan.conflicts.length === 0 ? <p className="text-sm text-emerald-300">{ui('没有编辑冲突，合并后项目数：', 'No edit conflicts. Merged project count: ')}{plan.projects.length}</p> : <p className="text-sm text-amber-300">{ui('以下项目在两端都有变化，请逐项选择。未选版本会留在同步前的恢复副本中。', 'These projects changed on both devices. Choose each version. Pre-sync recovery copies retain the previous content.')}</p>}
        {plan.conflicts.map(id => <fieldset key={id} className="rounded-lg border border-slate-700 p-3"><legend className="px-1 text-sm">{plan.local.find(p => p.id === id)?.name || plan.remote.projects.find(p => p.id === id)?.name}</legend>{(['local', 'cloud'] as const).map(side => {
          const p = (side === 'local' ? plan.local : plan.remote.projects).find(p => p.id === id);
          return <label key={side} className="block text-sm py-2"><input type="radio" name={id} checked={choices[id] === side} onChange={() => setChoices(c => ({ ...c, [id]: side }))} /> {side === 'local' ? ui('保留本机', 'Keep this device') : ui('保留云端', 'Keep cloud')} · {p ? `${p.nodes.length} ${ui('篇笔记', 'notes')}` : ui('已删除', 'Deleted')}</label>;
        })}</fieldset>)}
        <p className="text-xs text-slate-400">{ui('确认后保存本地恢复副本，并重新载入页面。不会自动启动云端研究。', 'Confirmation saves a local recovery copy and reloads the app. It does not start cloud research.')}</p>
        <button disabled={working || busy || plan.conflicts.some(id => !choices[id])} onClick={() => void apply()} className="w-full rounded-lg bg-emerald-700 p-3 disabled:opacity-40">{busy ? ui('等待当前探索结束', 'Wait for exploration') : ui('确认同步并载入', 'Confirm sync and load')}</button>
      </div>}
      {enabled && <button disabled={working} className="mt-5 text-sm text-slate-400" onClick={async () => {
        try { stopped.current = true; await setSyncEnabled(owner, false, current.current.projects); setEnabled(false); setPlan(null); report(ui('已关闭自动上传，云端副本保留', 'Automatic upload off; cloud copy retained')); }
        catch { report(ui('设置保存失败，请重试', 'Could not save the setting. Retry.')); }
      }}>{ui('关闭自动上传', 'Turn off automatic upload')}</button>}
      <button disabled={working || busy} className="mt-4 block text-xs text-slate-400 disabled:opacity-40" onClick={async () => {
        if (!window.confirm(ui('恢复最近一次同步前的本地副本？当前本地内容将被替换，自动上传将关闭；云端不变。', 'Restore the last pre-sync local copy? This replaces current local content and turns off automatic upload. The cloud stays unchanged.'))) return;
        try { stopped.current = true; await restoreWorkspaceBackup(owner); window.location.reload(); }
        catch (e) { stopped.current = false; report(e instanceof Error ? e.message : String(e)); }
      }}>{ui('恢复本机同步前的副本', 'Restore the local pre-sync copy')}</button>
    </section>
  </div>;
}
