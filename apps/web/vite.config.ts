import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: false },
      '/uploads': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
});
