import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: mode !== 'production',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-bootstrap') || id.includes('/bootstrap/')) return 'bootstrap';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router')) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
}));
