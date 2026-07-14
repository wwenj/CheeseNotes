import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const noteServiceRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../server/public', emptyOutDir: true },
  define: {
    // 生产构建可部署在独立静态站点，接口仍固定指向正式服务。
    // 开发/测试模式保持相对路径，由下方代理转发到本地服务。
    __NOTE_SERVICE_BASE_URL__: JSON.stringify(mode === 'production' ? 'https://note.wwenj.com' : ''),
  },
  server: {
    // 工作目录包含 `:`，Vite 7 会将 index.html 误判为 allow list 外的文件。
    // 仅开发服务器关闭严格检查；生产环境由 NestJS 直接托管构建产物。
    fs: { strict: false, allow: [noteServiceRoot] },
    proxy: { '/api': 'http://localhost:3000' },
  },
}));
