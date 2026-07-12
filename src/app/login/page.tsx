import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DemoBadge } from "@/components/crm-shell/demo-badge";

/**
 * Login placeholder. Phase 1A has NO real authentication (DECISIONS D-12).
 * Real employee SSO arrives with backend integration.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
            ATA
          </span>
          <DemoBadge />
        </div>
        <h1 className="text-base font-semibold text-text-primary">Alfa Trade Academy CRM</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Внутреннее рабочее пространство сотрудников. В demo-режиме аутентификация отключена —
          настоящий вход сотрудников появится вместе с интеграцией backend.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href="/today">Войти в demo</Link>
        </Button>
        <p className="mt-3 text-2xs text-text-muted">
          Демо-вход не является production-безопасностью и не использует реальные учётные данные.
        </p>
      </div>
    </div>
  );
}
