import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Loopback only; never disable Vite's host validation.
  server: { host: 'localhost', port: 5173, strictPort: true ,allowedHosts: true},
  preview: { host: 'localhost', port: 5173, strictPort: true,allowedHosts: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/lib/__tests__/**/*.test.js', 'src/services/__tests__/firebase-*.test.js'],
  },
});
