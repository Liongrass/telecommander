import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@lightninglabs/lnc-web'],
  },
  server: {
    port: 3000,
  },
});
