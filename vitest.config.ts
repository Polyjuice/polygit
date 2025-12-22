import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file patterns
    include: ["tests/**/*.test.ts"],

    // Global timeout for integration tests (60 seconds per test)
    testTimeout: 60000,

    // Hook timeout (for setup/teardown) - creating git repos with branches takes time
    hookTimeout: 60000,

    // Run tests sequentially to avoid git conflicts
    sequence: {
      concurrent: false,
    },

    // Ensure clean state between test files
    isolate: true,

    // Pool settings for integration tests
    pool: "forks",

    // Globals for describe, it, expect
    globals: true,
  },

  // TypeScript handling
  esbuild: {
    target: "node18",
  },
});
