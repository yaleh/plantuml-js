import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Layout runs on the all-classes fixture (hundreds of entities, grid-routed
    // edges) take several seconds; the 5 s default is too tight for them.
    testTimeout: 60_000,
  },
});
