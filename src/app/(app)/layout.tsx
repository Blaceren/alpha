import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import "@/features/home/home.css";

/**
 * Authenticated app shell for the (app) route group. In D1B only Главная (/) is a
 * full page. User is synthetic (no real auth / backend).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell userName="Артём" activeId="home">
      {children}
    </AppShell>
  );
}
