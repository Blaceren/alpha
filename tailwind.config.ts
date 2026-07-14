import type { Config } from "tailwindcss";

/**
 * Provisional Tailwind theme (Phase D1B). Colors reference the semantic CSS
 * variables in src/styles/tokens.css. The Route Field Home is styled mostly via
 * a dedicated feature stylesheet (features/home/home.css); Tailwind here backs
 * the app shell and utility usage. Swap only tokens.css when the palette lands.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--background-base)",
        field: "var(--background-field)",
        surface: "var(--surface-context)",
        ink: "var(--text-primary)",
        "ink-2": "var(--text-secondary)",
        "ink-3": "var(--text-muted)",
        signal: "var(--signal-active)",
        cold: "var(--gate-boundary)",
        "route-completed": "var(--route-completed)",
        "route-current": "var(--route-current)",
        "route-upcoming": "var(--route-upcoming)",
        "route-locked": "var(--route-locked)",
        divider: "var(--divider)",
        focusring: "var(--focus-ring)",
      },
      fontFamily: {
        display: "var(--font-display)",
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};

export default config;
