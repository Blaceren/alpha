"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  createAffiliateCampaign,
  updateAffiliateCampaign,
  type AffiliateOutcome,
} from "@/application/api/affiliates-client";
import type { AffiliateCampaign } from "@/data/contracts/api/affiliates";
import { describeAffiliateFailure, failureRequestId } from "./affiliate-labels";
import { Field, FormError, TextArea, TextInput } from "./affiliate-form-fields";

/**
 * AFD-5A — create and edit a campaign.
 *
 * The owning affiliate is fixed at creation and never editable: the backend
 * enforces it through a composite foreign key, and offering a "move campaign"
 * control the contract refuses would be a lie. `code` is likewise create-only,
 * and is unique WITHIN one partner — two affiliates may each run `summer`.
 */

export interface CampaignFormProps {
  mode: "create" | "edit";
  /** Fixed owner for a new campaign. Immutable afterwards. */
  affiliatePartnerId: string;
  campaign?: AffiliateCampaign;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function CampaignFormDialog({
  mode,
  affiliatePartnerId,
  campaign,
  open,
  onOpenChange,
  onSaved,
}: CampaignFormProps) {
  const [code, setCode] = React.useState(campaign?.code ?? "");
  const [displayName, setDisplayName] = React.useState(campaign?.displayName ?? "");
  const [notes, setNotes] = React.useState(campaign?.notes ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setCode(campaign?.code ?? "");
    setDisplayName(campaign?.displayName ?? "");
    setNotes(campaign?.notes ?? "");
    setError(null);
    setFieldErrors({});
  }, [open, campaign]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === "create") {
      const trimmed = code.trim().toLowerCase();
      if (trimmed.length < 3 || trimmed.length > 64 || !/^[a-z0-9_-]+$/.test(trimmed)) {
        next.code = "3–64 символа: строчные латинские буквы, цифры, дефис или подчёркивание.";
      }
    }
    if (displayName.trim().length < 1 || displayName.trim().length > 160) {
      next.displayName = "Укажите название длиной от 1 до 160 символов.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!validate()) return;

    setPending(true);
    setError(null);

    const trimmedNotes = notes.trim();
    const outcome: AffiliateOutcome<AffiliateCampaign> =
      mode === "create"
        ? await createAffiliateCampaign({
            affiliatePartnerId,
            code: code.trim().toLowerCase(),
            displayName: displayName.trim(),
            notes: trimmedNotes === "" ? null : trimmedNotes,
          })
        : await updateAffiliateCampaign(campaign!.id, {
            displayName: displayName.trim(),
            notes: trimmedNotes === "" ? null : trimmedNotes,
          });

    setPending(false);

    if (outcome.status === "success") {
      onSaved();
      onOpenChange(false);
      return;
    }
    setError({ message: describeAffiliateFailure(outcome), requestId: failureRequestId(outcome) });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        title={mode === "create" ? "Новая кампания" : "Редактирование кампании"}
        description={
          mode === "create"
            ? "Кампания принадлежит текущему аффилейту; изменить владельца потом нельзя."
            : "Код кампании и её аффилейт неизменяемы."
        }
      >
        <form onSubmit={submit} className="space-y-3" noValidate>
          <FormError message={error?.message ?? null} requestId={error?.requestId} />

          {mode === "create" ? (
            <Field
              id="campaign-code"
              label="Код"
              required
              hint="Уникален в пределах одного аффилейта."
              error={fieldErrors.code}
            >
              {(aria) => (
                <TextInput
                  {...aria}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  maxLength={64}
                />
              )}
            </Field>
          ) : (
            <div className="space-y-1">
              <p className="block text-xs font-medium text-text-primary">Код</p>
              <code className="block rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text-secondary">
                {campaign?.code}
              </code>
              <p className="text-2xs text-text-secondary">Код неизменяем.</p>
            </div>
          )}

          <Field id="campaign-name" label="Название" required error={fieldErrors.displayName}>
            {(aria) => (
              <TextInput
                {...aria}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={160}
              />
            )}
          </Field>

          <Field id="campaign-notes" label="Заметки">
            {(aria) => (
              <TextArea
                {...aria}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            )}
          </Field>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm" disabled={pending}>
                Отмена
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
