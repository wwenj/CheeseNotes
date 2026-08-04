import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { loadNoteAiLocalEnv } from '../config/local-env.mjs';

const noteServiceRoot = fileURLToPath(new URL('..', import.meta.url));
loadNoteAiLocalEnv();
const allowedHost = process.env.NOTEAI_WEB_ORIGIN ? new URL(process.env.NOTEAI_WEB_ORIGIN).hostname : undefined;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../server/public', emptyOutDir: true },
  define: {
    // Web 由 NestJS 同域托管，始终请求当前域名下的 /api。
    __NOTE_SERVICE_BASE_URL__: JSON.stringify(''),
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: allowedHost ? [allowedHost] : [],
    // 工作目录包含 `:`，Vite 7 会将 index.html 误判为 allow list 外的文件。
    // 仅开发服务器关闭严格检查；生产环境由 NestJS 直接托管构建产物。
    fs: { strict: false, allow: [noteServiceRoot] },
    proxy: { '/api': 'http://localhost:3000' },
  },
}));
