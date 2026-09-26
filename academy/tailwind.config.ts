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
  /**
   * The `container` utility is off. It shipped a second responsive ladder -
   * 640/768/1024/1280/1536 - that no stylesheet in this repo wrote and that
   * styled nothing: `.container` matched zero elements on /, /login and
   * /register at every width from 429 to 1181, no component asks for the class,
   * and no `sm:`/`md:`/`lg:` prefix exists anywhere in the product. Ten rules
   * were being served on every page to reach no element at all.
   *
   * This disables that one plugin and nothing else. The theme, the utility
   * ladder and the plugin list are untouched.
   */
  corePlugins: {
    container: false,
  },
  plugins: [],
};

export default config;
