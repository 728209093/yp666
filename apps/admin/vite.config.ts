import { defineConfig, loadEnv, type ResolvedConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import {adminBasePath} from '../../deploy/admin-path.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({command, mode}) => {
  const env = loadEnv(mode, projectRoot, '');
  const base = command === 'serve' ? '/' : adminBasePath(process.env.ADMIN_BASE_PATH ?? env.ADMIN_BASE_PATH);
  return {
  base,
  plugins: [vue(), {
    name: 'configured-admin-base',
    configResolved(config: ResolvedConfig) {
      if (command === 'build' && config.base !== base) throw new Error('后台构建入口必须与 ADMIN_BASE_PATH 一致，请移除 --base 覆写');
    },
  }],
  server: {host: '127.0.0.1', port: Number(process.env.ADMIN_PORT || 5174), strictPort: true, proxy: {'/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001', '/uploads': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001'}},
  build: {rollupOptions: {output: {manualChunks(id) {
    if (id.includes('node_modules') && (id.includes('/vue/') || id.includes('/@vue/') || id.includes('\\vue\\') || id.includes('\\@vue\\'))) return 'vue';
  }}}},
  };
});
