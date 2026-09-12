"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-elevated p-4 shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-sm font-semibold text-text-primary">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Закрыть"
            className="rounded p-1 text-text-muted hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="mb-3 text-xs text-text-secondary">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
