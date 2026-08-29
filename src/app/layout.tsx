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

export const metadata: Metadata = {
  title: "Alfa Trade Academy",
  description:
    "Alfa Trade Academy — последовательная образовательная платформа по трейдингу.",
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
