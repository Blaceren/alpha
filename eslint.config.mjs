import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      ".tools/**",
      "next-env.d.ts",
      "tradingcomunity/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // PRODUCT-RC-1 — `scripts/ops/flag-policy-eval.js` is a RUNTIME artifact
    // that happens to live in the repository so it can be reviewed and tested.
    // It is executed by the operational control plane as `node
    // flag-policy-eval.js <policy.json>`, with no build step, no bundler and no
    // dependencies — deliberately, because it is the gate that decides whether a
    // deployment's environment file is allowed to exist, and a gate that needs a
    // toolchain to run is a gate that gets skipped.
    //
    // This package has no `"type": "module"`, so a `.js` file here IS CommonJS
    // and `require` is the correct — indeed the only working — spelling.
    // Rewriting it as ESM to satisfy the rule would break the caller.
    files: ["scripts/ops/flag-policy-eval.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;
