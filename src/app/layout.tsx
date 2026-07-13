import type { Metadata, Viewport } from "next";
// Self-hosted variable fonts (bundled — no external font fetch).
import "@fontsource-variable/manrope";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Alfa Trade Academy",
  description:
    "Alfa Trade Academy — последовательная образовательная платформа по трейдингу.",
};

export const viewport: Viewport = {
  themeColor: "#0a0d13",
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
