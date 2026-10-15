import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'roomsync-server-only-gemini', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/quick-add', async (req, res) => {
        const env = loadEnv('development', process.cwd(), '');
        const { createQuickAddHandler } = await import('./api/quick-add.js');
        const handler = createQuickAddHandler({ env: { ...process.env, NODE_ENV: 'development', GEMINI_API_KEY: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY, GEMINI_MODEL: env.GEMINI_MODEL || process.env.GEMINI_MODEL, VITE_FIREBASE_PROJECT_ID: env.VITE_FIREBASE_PROJECT_ID } });
        let text = '';
        try {
          for await (const chunk of req) { text += chunk; if (text.length > 16000) { res.statusCode = 413; res.end('Request too large'); return; } }
          req.body = text ? JSON.parse(text) : {};
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
          await handler(req, res);
        } catch { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Invalid request. No records saved.' })); }
      });
    },
  }],
  // Loopback only; never disable Vite's host validation.
  server: { host: 'localhost', port: 5173, strictPort: true ,allowedHosts: true},
  preview: { host: 'localhost', port: 5173, strictPort: true,allowedHosts: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/lib/__tests__/**/*.test.js', 'src/services/__tests__/firebase-*.test.js', 'server/__tests__/**/*.test.js'],
  },
});
