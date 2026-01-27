
import React from 'react';
import ReactDOM from 'react-dom/client';
// 1. 注释原有 App 导入（新增这行注释，保留原代码）
// import App from './App';
// 2. 新增：导入测试页（路径是项目根目录的 TestMessageBoard.tsx）
import App from './App';
//import TestMessageBoard from './TestMessageBoard';
// 把第4行的 "../TestMessageBoard" 改成 "./TestMessageBoard"
//import TestMessageBoard from './TestMessageBoard';
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
      
    <App /> 
    // 4. 新增：渲染留言板测试页
      {/* 删除测试页渲染：<TestMessageBoard /> */}
  </React.StrictMode>
);
