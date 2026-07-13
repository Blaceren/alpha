import type { Config } from "tailwindcss";

/**
 * Provisional Tailwind theme.
 * All colors reference semantic CSS variables defined in src/styles/tokens.css.
 * When the prelanding palette arrives, only tokens.css changes — not this file
 * and not component classNames.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--background-base)",
        deep: "var(--background-deep)",
        "surface-1": "var(--surface-primary)",
        "surface-2": "var(--surface-secondary)",
        "surface-3": "var(--surface-elevated)",
        "surface-4": "var(--surface-interactive)",
        "line-subtle": "var(--border-subtle)",
        line: "var(--border-default)",
        ink: "var(--text-primary)",
        "ink-2": "var(--text-secondary)",
        "ink-3": "var(--text-muted)",
        accent: "var(--accent-primary)",
        "accent-2": "var(--accent-secondary)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        locked: "var(--locked)",
        completed: "var(--completed)",
        active: "var(--active)",
        suspended: "var(--suspended)",
        focusring: "var(--focus-ring)",
        overlay: "var(--overlay)",
        "path-line": "var(--path-line)",
        "path-glow": "var(--path-glow)",
      },
      fontFamily: {
        display: "var(--font-display)",
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
      },
      borderColor: {
        DEFAULT: "var(--border-default)",
      },
      ringColor: {
        DEFAULT: "var(--focus-ring)",
      },
      boxShadow: {
        elev1: "0 1px 0 0 var(--border-subtle), 0 8px 24px -12px rgba(0,0,0,0.55)",
        elev2: "0 1px 0 0 var(--border-subtle), 0 18px 48px -18px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px var(--border-subtle), 0 24px 80px -28px var(--path-glow)",
      },
      keyframes: {
        "soft-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "soft-in": "soft-in 240ms cubic-bezier(0.2,0,0,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
