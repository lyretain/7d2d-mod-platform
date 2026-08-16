import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type ProxyOptions } from 'vite';

const apiProxy: ProxyOptions = {
  target: 'http://127.0.0.1:8080',
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.setHeader('origin', 'http://127.0.0.1:8080');
    });
  }
};

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiProxy,
      '/status': apiProxy,
      '/guide': apiProxy,
      '/admin-i18n.js': apiProxy,
      '/health': apiProxy
    }
  }
});
