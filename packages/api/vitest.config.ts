import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 60000,
    testTimeout: 60000,
    environment: 'node',
    // Each test file gets a fresh module graph. With isolate:false (an old
    // vitest-1.x workaround for axios DataCloneError) files sharing a worker
    // leaked real modules into each other and defeated their vi.mock factories,
    // so results depended on file order (e.g. health -> sweeper, e2e -> health).
    isolate: true,
    setupFiles: ['./vitest.setup.ts']
  }
})
