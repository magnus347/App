import { defineConfig } from 'vite';

// BASE_PATH settes av GitHub Pages-bygget slik at appen også fungerer
// når den ligger i en undermappe (…/github.io/varelager/).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
