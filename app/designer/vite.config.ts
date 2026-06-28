import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the CAP server at /designer in production builds.
export default defineConfig({
  plugins: [react()],
  base: '/designer/',
  server: {
    proxy: {
      '/odata': 'http://localhost:4004',
      '/api': 'http://localhost:4004'
    }
  }
});
