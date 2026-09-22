import { defineConfig } from "vitest/config";

// These contracts do not touch product data or require a database/browser.
export default defineConfig({ test: { include: ["tests/tasks-*.test.ts"], maxWorkers: 4 } });
