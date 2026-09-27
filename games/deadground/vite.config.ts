import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    // authoring tools (course sweep / freeze) run only with AUTHORING=1
    include: process.env.AUTHORING ? ['tools/**/*.test.ts'] : ['tests/**/*.test.ts'],
  },
});
