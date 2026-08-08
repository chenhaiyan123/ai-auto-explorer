/**
 * DemoPreview - Demo 预览组件
 */

import React, { useMemo, useState } from 'react';

interface DemoPreviewProps {
  code: string;
  title: string;
  onClose: () => void;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DemoPreview: React.FC<DemoPreviewProps> = ({ code, title, onClose }) => {
  const [error, setError] = useState<string | null>(null);

  /**
   * 安全说明：这里渲染的是模型生成的 HTML，属于不可信内容。
   * - 用 srcDoc 而不是 blob: URL —— blob: 会继承本站源，等于让任意代码跑在本站域下。
   * - sandbox 只给 allow-scripts，**不给 allow-same-origin**（两者同时给等于沙箱失效，
   *   iframe 可反过来操作父页面 / 本站 localStorage）。这样它运行在不透明源里。
   * - 不再注入 cdn.tailwindcss.com 等远程脚本，改为内联最小样式。
   */
  const srcDoc = useMemo(() => {
    try {
      setError(null);
      if (code.includes('<html')) return code;
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
  </style>
</head>
<body>
${code}
</body>
</html>`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览加载失败');
      return '';
    }
  }, [code, title]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full h-[85vh] flex flex-col shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400">
              ▶️
            </div>
            <div>
              <h3 className="font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-500">实时预览</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 预览区域 */}
        <div className="flex-1 overflow-hidden bg-slate-950 rounded-b-2xl">
          {error ? (
            <div className="h-full flex items-center justify-center text-red-400">
              <div className="text-center">
                <div className="text-4xl mb-4">⚠️</div>
                <div className="text-sm">{error}</div>
              </div>
            </div>
          ) : (
            <iframe
              className="w-full h-full border-0"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={srcDoc}
              title={title}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DemoPreview;
