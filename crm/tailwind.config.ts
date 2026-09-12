import type { Config } from "tailwindcss";

/**
 * Semantic design tokens map to CSS variables defined in src/styles/tokens.css.
 * Values are PROVISIONAL (no confirmed Alfa Trade Academy brand book yet) — see docs/DECISIONS.md.
 * Colors use `hsl(var(--token) / <alpha-value>)` so opacity utilities keep working.
 */
const config: Config = {
  darkMode: "media",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--color-background) / <alpha-value>)",
        surface: "hsl(var(--color-surface) / <alpha-value>)",
        elevated: "hsl(var(--color-elevated) / <alpha-value>)",
        border: "hsl(var(--color-border) / <alpha-value>)",
        input: "hsl(var(--color-border) / <alpha-value>)",
        ring: "hsl(var(--color-focus-ring) / <alpha-value>)",
        text: {
          primary: "hsl(var(--color-text-primary) / <alpha-value>)",
          secondary: "hsl(var(--color-text-secondary) / <alpha-value>)",
          muted: "hsl(var(--color-text-muted) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--color-accent) / <alpha-value>)",
          foreground: "hsl(var(--color-accent-foreground) / <alpha-value>)",
        },
        success: "hsl(var(--color-success) / <alpha-value>)",
        warning: "hsl(var(--color-warning) / <alpha-value>)",
        danger: "hsl(var(--color-danger) / <alpha-value>)",
        info: "hsl(var(--color-info) / <alpha-value>)",
        sidebar: {
          DEFAULT: "hsl(var(--color-sidebar) / <alpha-value>)",
          foreground: "hsl(var(--color-sidebar-foreground) / <alpha-value>)",
        },
        "row-hover": "hsl(var(--color-row-hover) / <alpha-value>)",
        selected: "hsl(var(--color-selected) / <alpha-value>)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Dense, operational scale
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
