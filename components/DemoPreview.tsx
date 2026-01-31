/**
 * DemoPreview - Demo 预览组件
 */

import React, { useEffect, useRef, useState } from 'react';

interface DemoPreviewProps {
  code: string;
  title: string;
  onClose: () => void;
}

const DemoPreview: React.FC<DemoPreviewProps> = ({ code, title, onClose }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!iframeRef.current) return;

    try {
      // 创建完整的 HTML 文档
      const htmlContent = code.includes('<html') ? code : `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { 
      margin: 0; 
      padding: 16px; 
      background: #0f172a; 
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body>
  ${code}
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;

      return () => URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览加载失败');
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
              ref={iframeRef}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin"
              title={title}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DemoPreview;
