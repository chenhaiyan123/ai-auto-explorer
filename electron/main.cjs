// HiExplore 桌面客户端 · Electron 主进程
// 本地客户端的好处：页面不是 https，调用本地 Ollama / 局域网 IoT 不再受跨域和混合内容限制。
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: 'HiExplore',
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 窗口最小化/后台时不降频，保证持续探索循环全速运行
      backgroundThrottling: false,
      // 本地桌面应用：关闭 web 安全限制，让浏览器渲染层能直接访问
      // 本机 Ollama(http://localhost:11434) 与局域网 IoT 设备，无需处理 CORS / 混合内容。
      // 仅加载本地打包好的页面，不加载远程站点，故此设置在本场景是安全的。
      webSecurity: false,
    },
  });

  // 开发时若设置了 VITE_DEV_SERVER_URL，则连开发服务器；否则加载打包产物 dist/index.html
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 外部链接用系统浏览器打开，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
