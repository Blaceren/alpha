"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormError } from "./affiliate-form-fields";

/**
 * AFD-5A — status transitions with an explicit archive confirmation.
 *
 * Two rules this component exists to hold:
 *
 *  1. NO OPTIMISTIC UI. A button never renders the new status on click. It
 *     awaits the backend, and the caller re-reads the authoritative row. A
 *     refused activation must look like a refusal, not like a success that
 *     reverts a moment later.
 *
 *  2. ARCHIVE IS CONFIRMED, because it is terminal. Pause and resume are
 *     reversible and are not.
 */

export type StatusActionResult = { ok: true } | { ok: false; message: string; requestId?: string };

export interface StatusActionProps {
  label: string;
  /** Announced while the request is in flight. */
  pendingLabel: string;
  onRun: () => Promise<StatusActionResult>;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Shown in the confirmation dialog. Omit for an unconfirmed action. */
  confirm?: { title: string; description: string; confirmLabel: string };
  onDone?: () => void;
}

export function StatusAction({
  label,
  pendingLabel,
  onRun,
  disabled,
  variant = "secondary",
  confirm,
  onDone,
}: StatusActionProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [open, setOpen] = React.useState(false);

  const run = React.useCallback(async () => {
    // Guard against a double submission: the second click is dropped entirely
    // rather than queued, so one archive click can never archive twice.
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await onRun();
    setPending(false);
    if (result.ok) {
      setOpen(false);
      onDone?.();
    } else {
      setError({ message: result.message, requestId: result.requestId });
    }
  }, [onDone, onRun, pending]);

  if (!confirm) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          variant={variant}
          disabled={disabled || pending}
          aria-busy={pending || undefined}
          onClick={run}
        >
          {pending ? pendingLabel : label}
        </Button>
        {error ? <FormError message={error.message} requestId={error.requestId} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent title={confirm.title} description={confirm.description}>
          {/* The consequence is stated in words, not implied by a red button. */}
          <div className="space-y-3">
            {error ? <FormError message={error.message} requestId={error.requestId} /> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="sm" disabled={pending}>
                  Отмена
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={run}
              >
                {pending ? pendingLabel : confirm.confirmLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
