import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Required accessible label (icon-only control). */
  label: string;
  children: ReactNode;
}

/** Icon-only button; always carries an accessible label and a 44px touch target. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-xl",
        "text-ink-2 hover:text-ink hover:bg-surface-2",
        "transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
