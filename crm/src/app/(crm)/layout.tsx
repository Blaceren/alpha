import { AppShell } from "@/components/crm-shell/app-shell";
import { getServerRuntimeMode } from "@/config/server-runtime";

/**
 * All CRM sections render inside the shell (sidebar + topbar + content).
 *
 * This stays a server component so it can read the server-only runtime
 * configuration. Only the resolved mode ("mock" | "api") crosses into client
 * code; `CRM_BACKEND_ORIGIN` never leaves the server. A missing or unknown
 * CRM_MODE throws here rather than defaulting — see config/server-runtime.ts.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const mode = getServerRuntimeMode();

  return <AppShell mode={mode}>{children}</AppShell>;
}
