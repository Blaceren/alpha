import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors the "@/*" -> "./src/*" path mapping already declared in
// tsconfig.json. Vitest does not read tsconfig `paths` on its own, and no
// test file existed anywhere in this repo before this change, so nothing
// depended on this alias resolving until now.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
