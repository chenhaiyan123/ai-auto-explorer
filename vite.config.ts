
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  envDir: mode === 'ios' ? false : undefined,
  plugins: [react()],
  base: './', // 使用相对路径，适配 OSS 静态托管环境
  server: {
    port: 3000
  },
  build: {
    outDir: mode === 'ios' ? 'dist-ios' : 'dist',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
}));
