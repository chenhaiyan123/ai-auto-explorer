import React from 'react';

/**
 * 客户端下载弹窗：网页访客在这里下载桌面客户端（mac / Windows / Linux）。
 * 安装包托管在 GitHub Releases；推一个 v* 标签会由 release 工作流自动构建并上传。
 */

const RELEASES_URL = 'https://github.com/chenhaiyan123/ai-auto-explorer/releases/latest';

type OS = 'mac' | 'windows' | 'linux' | 'other';
function detectOS(): OS {
  const ua = (navigator.userAgent || '').toLowerCase();
  const plat = ((navigator as any).platform || '').toLowerCase();
  if (/mac/.test(ua) || /mac/.test(plat)) return 'mac';
  if (/win/.test(ua) || /win/.test(plat)) return 'windows';
  if (/linux|x11/.test(ua) || /linux/.test(plat)) return 'linux';
  return 'other';
}

const PLATFORMS: { key: OS; icon: string; name: string; file: string }[] = [
  { key: 'mac', icon: '🍎', name: 'macOS', file: '.dmg' },
  { key: 'windows', icon: '🪟', name: 'Windows', file: '.exe' },
  { key: 'linux', icon: '🐧', name: 'Linux', file: '.AppImage' },
];

const DownloadModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const os = detectOS();
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">⬇ 下载 HiExplore 桌面客户端</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          桌面客户端可直接调用<b className="text-slate-200">本地模型(Ollama)</b>与局域网 IoT 设备(免跨域)，离线本地优先，并支持 <b className="text-slate-200">7×24 持续探索</b>。
        </p>

        <div className="grid grid-cols-3 gap-3">
          {PLATFORMS.map(p => {
            const recommended = p.key === os;
            return (
              <a
                key={p.key}
                href={RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all ${recommended ? 'bg-blue-600/15 border-blue-500/60 ring-1 ring-blue-500/40' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}`}
              >
                <span className="text-3xl">{p.icon}</span>
                <span className="text-sm font-bold text-slate-100">{p.name}</span>
                <span className="text-[10px] text-slate-500">{p.file}</span>
                {recommended && <span className="text-[9px] text-blue-400 font-bold">推荐你的系统</span>}
              </a>
            );
          })}
        </div>

        <div className="mt-6 text-[11px] text-slate-500 leading-relaxed">
          <p>· 点击进入 GitHub Releases 选择对应安装包下载。</p>
          <p>· macOS 首次打开如提示"身份不明的开发者"，右键 App → 打开。</p>
          <p>· 也可自行构建：<code className="bg-slate-800 text-emerald-400 px-1 rounded">npm install &amp;&amp; npm run app:dist</code></p>
        </div>
      </div>
    </div>
  );
};

export default DownloadModal;
