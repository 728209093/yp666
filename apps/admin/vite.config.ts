import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  server: {host: '127.0.0.1', port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3001', '/uploads': 'http://127.0.0.1:3001'}},
  build: {rollupOptions: {output: {manualChunks(id) {
    if (id.includes('node_modules') && (id.includes('/vue/') || id.includes('/@vue/') || id.includes('\\vue\\') || id.includes('\\@vue\\'))) return 'vue';
  }}}},
});
