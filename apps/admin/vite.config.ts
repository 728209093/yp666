import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  server: {host: '127.0.0.1', port: Number(process.env.ADMIN_PORT || 5174), strictPort: true, proxy: {'/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001', '/uploads': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001'}},
  build: {rollupOptions: {output: {manualChunks(id) {
    if (id.includes('node_modules') && (id.includes('/vue/') || id.includes('/@vue/') || id.includes('\\vue\\') || id.includes('\\@vue\\'))) return 'vue';
  }}}},
});
