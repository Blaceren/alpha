import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATA Affiliate Partners",
  description: "Alpha Trade Academy affiliate partner console",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
