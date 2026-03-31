import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@lightninglabs/lnc-web'],
  },
  server: {
    port: 3000,
    host: true,   // bind to 0.0.0.0, accessible on the local network
  },
});
