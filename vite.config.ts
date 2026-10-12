import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端开发服务器 + 自建后端（server/index.mjs）
// 开发时 /api 代理到本地后端；生产由后端一并托管 dist（同源，无需代理）
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: (globalThis as any).process?.env?.API_PROXY || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    // 注意：不要用 dist / build 这类名字——发布平台会把它们当作构建产物过滤掉，
    // 导致线上只剩后端、页面 404。这里输出到 webui，随源码一起上传。
    outDir: 'webui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2400,
  },
})
