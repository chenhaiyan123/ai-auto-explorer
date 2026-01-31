/**
 * ArtifactViewer - 产出物查看器组件
 */

import React, { useState } from 'react';
import { Artifact } from '../types';

interface ArtifactViewerProps {
  artifact: Artifact;
  allVersions: Artifact[];
  onClose: () => void;
  onRunDemo?: (code: string) => void;
}

const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  artifact,
  allVersions,
  onClose,
  onRunDemo
}) => {
  const [currentVersion, setCurrentVersion] = useState(artifact);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentVersion.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canRunDemo = currentVersion.type === 'code' || 
                     currentVersion.type === 'component' ||
                     (currentVersion.content?.includes('<') && currentVersion.content?.includes('>'));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center text-emerald-400">
              {currentVersion.type === 'code' ? '📄' : 
               currentVersion.type === 'component' ? '🧩' : 
               currentVersion.type === 'style' ? '🎨' : '📦'}
            </div>
            <div>
              <h3 className="font-bold text-white">{currentVersion.title}</h3>
              <p className="text-xs text-slate-500">{currentVersion.type} · v{currentVersion.version || 1}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* 版本选择 */}
        {allVersions.length > 1 && (
          <div className="flex gap-2 p-3 border-b border-slate-800 overflow-x-auto">
            {allVersions.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setCurrentVersion(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  currentVersion.id === v.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                v{v.version || i + 1}
              </button>
            ))}
          </div>
        )}

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-4">
          {currentVersion.description && (
            <p className="text-sm text-slate-400 mb-4">{currentVersion.description}</p>
          )}
          <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-auto text-sm text-slate-300 font-mono">
            <code>{currentVersion.content || '// 暂无内容'}</code>
          </pre>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800">
          <div className="text-xs text-slate-500">
            创建于 {new Date(currentVersion.createdAt || Date.now()).toLocaleString()}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-all"
            >
              {copied ? '✓ 已复制' : '📋 复制代码'}
            </button>
            {canRunDemo && onRunDemo && (
              <button
                onClick={() => onRunDemo(currentVersion.content || '')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all"
              >
                ▶️ 运行预览
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactViewer;
