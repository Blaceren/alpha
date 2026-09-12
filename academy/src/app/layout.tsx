import type { Metadata, Viewport } from "next";
/*
 * Brand faces are bound locally in src/styles/fonts.css over woff2 files
 * vendored under public/fonts/ata/ from the accepted design authority. They
 * replace the previous @fontsource-variable imports (Manrope/Inter/JetBrains
 * Mono), which are no longer referenced by any role.
 *
 * The packages stay in package.json deliberately: this phase is not authorised
 * to change a dependency, and the release manifest binds package-lock.json by
 * sha256. Removing an import costs nothing; removing a dependency would
 * invalidate that hash and require an install this phase may not run.
 *
 * No external font fetch exists in either arrangement.
 */
import "@/styles/fonts.css";
import "@/styles/globals.css";

/**
 * ONE FAVICON AUTHORITY, FOR EVERY DOCUMENT THE ACADEMY SERVES.
 *
 * WHAT WAS WRONG. There were two. `src/app/icon.svg` was a file-based metadata
 * icon, so Next emitted it for every route in the app — and it was the old
 * navy/blue chart mark (#10141c ground, #4c8dff polyline, #34e1ce dot), the
 * same provisional language already removed from the shell. Public Home alone
 * overrode it in its own route metadata, which is why exactly one page showed
 * the right icon and every other page — /login, /register and the whole
 * authenticated product — showed the old one.
 *
 * Measured on the live release before this change:
 *   /          -> <link rel="icon" href="/brand/favicon.svg">
 *   /login     -> <link rel="icon" href="/icon.svg?icon.0hm0qgnk_e5ws.svg">
 *   /register  -> the same /icon.svg
 *
 * WHAT IT IS NOW. The declaration lives here, in the root layout, so every
 * document inherits it, and `src/app/icon.svg` is deleted so nothing can
 * compete for the browser's choice. The asset is the vendored ATA favicon —
 * byte-identical to HomeATA's `assets/favicon.svg`: Ink #0B0D0A ground, Signal
 * #C7F76D mark, no wordmark, legible at 16px.
 *
 * Public Home's own route-level override is removed too. It said the same
 * thing, but two declarations of one authority is how this drifted apart in the
 * first place.
 *
 * This changes the favicon and nothing else. The logo and the wordmark are
 * untouched.
 */
export const metadata: Metadata = {
  title: "Alfa Trade Academy",
  description:
    "Alfa Trade Academy — последовательная образовательная платформа по трейдингу.",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }] },
};

export const viewport: Viewport = {
  // Ink 900 — the accepted deepest ground.
  themeColor: "#0b0d0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="font-ui text-ink antialiased">{children}</body>
    </html>
  );
}
