import { defineConfig } from 'vite';

// JSX is compiled by Vite's built-in esbuild ("automatic" runtime = no `import React` needed).
// This avoids @vitejs/plugin-react, which is not in the allowed dependency list (docs/06).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: {
    port: 5173,
    // Forward /api calls to the Express server so the browser sees a single origin.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
