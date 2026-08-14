import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Layout } from "@/components/Layout";

/**
 * POCKET-REG-SECURITY-CLOSURE-1 (F3/P2) — fonts are read from the repository,
 * never fetched at build time.
 *
 * These were `next/font/google`, which resolves each family during `next build`
 * by fetching Google's CSS and then hashed `.woff2` URLs from `fonts.gstatic.com`.
 * Google rotates those URLs, so the build was only as reproducible as a remote
 * asset host on the day — and when it failed, Next surfaced it as an unrelated
 * `<Html> should not be imported outside of pages/_document` prerender error.
 * The parent phase could only obtain a green build by reusing an older
 * release's already-resolved fonts.
 *
 * Same families, same subsets, same variable weight axes, same CSS variable
 * names — so nothing about the rendered page changes. What changes is that the
 * bytes come from `./fonts`. See `./fonts/README.md`.
 */
const bodyFont = localFont({
  src: [
    { path: "./fonts/PlusJakartaSans-latin.woff2", style: "normal" },
    { path: "./fonts/PlusJakartaSans-cyrillic-ext.woff2", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  // The vendored files are variable fonts spanning the family's whole axis;
  // declaring the range lets the browser synthesise nothing.
  weight: "200 800",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const monoFont = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-latin.woff2", style: "normal" },
    { path: "./fonts/JetBrainsMono-cyrillic.woff2", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "TradeQuest | Обучение трейдингу",
  description: "Образовательная платформа для обучения трейдингу через задания, уровни, награды и прогресс.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${bodyFont.variable} ${monoFont.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.classList.add(t==='dark'?'theme-dark':'theme-light');document.documentElement.dataset.theme=t}catch(e){document.documentElement.classList.add('theme-light')}})();",
          }}
        />
      </head>
      <body>
        <Layout>{children}</Layout>
      </body>
    </html>
  );
}
