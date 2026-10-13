import { defineConfig } from 'vite';

// Build flags (GDD 2.1): VITE_DEMO, VITE_STORE_URL, IGNORANCE_EPILOGUE.
// `vite build --mode demo` reads .env.demo (VITE_DEMO=true).
export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'IGNORANCE_'],
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
