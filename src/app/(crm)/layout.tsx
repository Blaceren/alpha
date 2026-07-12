import { AppShell } from "@/components/crm-shell/app-shell";

/** All CRM sections render inside the shell (sidebar + topbar + content). */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
