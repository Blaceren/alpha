import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-[#06080c] font-semibold hover:brightness-110 shadow-[0_10px_30px_-12px_var(--path-glow)]",
  secondary:
    "bg-surface-4 text-ink border border-line hover:bg-surface-3",
  ghost: "bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-danger text-[#0a0d13] font-semibold hover:brightness-110",
};

const SIZE: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-lg gap-1.5",
  md: "h-11 px-5 text-[0.95rem] rounded-xl gap-2",
  lg: "h-[52px] px-6 text-base rounded-xl gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap",
        "transition-[background-color,color,filter,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "active:translate-y-px disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
