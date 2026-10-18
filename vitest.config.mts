import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: { shuffle: false },
    // Integration files share one PostgreSQL test database (each resets it in
    // beforeEach), so files must run sequentially, never in parallel workers.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
});
