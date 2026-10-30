"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { RiCloseLine, RiErrorWarningLine, RiCheckboxCircleLine, RiInformationLine } from "@remixicon/react";
import { twMerge } from "tailwind-merge";

export const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(" "));

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
const btn: Record<Variant, string> = {
  primary: "bg-yellow text-ink hover:bg-y200 active:bg-y100 shadow-[var(--shadow-cta)] font-semibold uppercase tracking-wide",
  secondary: "bg-white text-ink border border-ink hover:bg-n100 active:bg-n200 font-semibold uppercase tracking-wide",
  ghost: "text-ink hover:bg-n200 active:bg-n300 font-medium",
  danger: "bg-white text-red-a border border-red-b hover:bg-red-c font-semibold",
  dark: "bg-ink text-white hover:bg-ink-2 font-semibold uppercase tracking-wide",
};
const sizes = { sm: "h-9 px-3 text-xs", md: "h-11 px-5 text-sm", lg: "h-14 px-6 text-base", xl: "h-16 px-6 text-lg" };

export function Button({ variant = "primary", size = "md", className, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return (
    <button
      className={cx("inline-flex select-none items-center justify-center gap-2 rounded-md transition disabled:pointer-events-none disabled:opacity-40",
        sizes[size], btn[variant], className)}
      {...props}
    />
  );
}

export function IconButton({ className, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label}
      className={cx("inline-flex h-11 w-11 items-center justify-center rounded-md text-ink transition hover:bg-n200 active:bg-n300 disabled:opacity-40", className)}
      {...props} />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-n800">{children}</span>;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-2", className)}>
      <Label>{label}</Label>
      {children}
      {error ? <span className="text-xs font-medium text-red-a">{error}</span> : hint && <span className="text-xs text-n800">{hint}</span>}
    </label>
  );
}

const inputCls = "h-12 w-full rounded-xs border border-n500 bg-white px-3 text-base text-ink placeholder:text-n700 focus:border-ink focus:outline-none focus:ring-2 focus:ring-yellow/60 disabled:bg-n100";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cx(inputCls, className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, "h-auto min-h-20 py-2", className)} {...props} />;
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, "pr-8", className)} {...props}>{children}</select>;
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-n300 bg-white shadow-[var(--shadow-card)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-n300 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "yellow" | "blue" | "green" | "red" | "black";
const tones: Record<Tone, string> = {
  neutral: "bg-n200 text-n900",
  yellow: "bg-y50 text-y500 border border-y75",
  blue: "bg-b50 text-b500",
  green: "bg-green-c text-green-a",
  red: "bg-red-c text-red-a",
  black: "bg-ink text-white",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-xs px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tones[tone], className)}>
      {children}
    </span>
  );
}
const statusTone: Record<string, Tone> = {
  paid: "green", awaiting_payment: "yellow", needs_attention: "red", cancelled: "neutral", confirmed: "green", pending: "yellow",
  failed: "red", open: "green", closed: "neutral", refund: "blue", exchange: "blue",
};
const statusText: Record<string, string> = { awaiting_payment: "Unpaid", needs_attention: "Needs attention" };
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{statusText[status] ?? status.replace(/_/g, " ")}</Badge>;
}

export function Alert({ tone = "red", children, className }: { tone?: "red" | "yellow" | "blue" | "green"; children: ReactNode; className?: string }) {
  const map = {
    red: ["border-red-b/30 bg-red-c text-red-a", RiErrorWarningLine],
    yellow: ["border-y75 bg-y50 text-ink", RiInformationLine],
    blue: ["border-b100 bg-b50 text-b500", RiInformationLine],
    green: ["border-green-b/30 bg-green-c text-green-a", RiCheckboxCircleLine],
  } as const;
  const [cls, Icon] = map[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm", cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-5 w-5 animate-spin rounded-full border-2 border-n400 border-t-ink", className)} aria-label="Loading" />;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-n200 text-n800">{icon}</div>}
      <p className="text-base font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-n800">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="rounded-lg border border-n300 bg-white p-4 shadow-[var(--shadow-card)]">
      <Label>{label}</Label>
      <div className={cx("tabular mt-1 text-2xl font-semibold tracking-tight", tone === "red" && "text-red-a", tone === "green" && "text-green-a")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-n800">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }:
  { value: T; options: { value: T; label: ReactNode; disabled?: boolean }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-md bg-n200 p-1", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx("h-10 flex-1 whitespace-nowrap rounded-sm px-4 text-sm font-medium transition disabled:opacity-40",
            value === o.value ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-n900 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button"
      className={cx("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition",
        active ? "border-ink bg-ink text-white" : "border-n500 bg-white text-ink hover:border-ink", className)}
      {...props}>
      {children}
    </button>
  );
}

/** Centered dialog on tablets and desktops, bottom sheet on phones. */
export function Modal({ open, onClose, title, children, footer, wide, dismissable = true }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissable?: boolean }) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose, dismissable]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-6" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className={cx("flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-[var(--shadow-sheet)] sm:rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <header className="flex items-center justify-between gap-3 border-b border-n300 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          {dismissable && <IconButton label="Close" onClick={onClose}><RiCloseLine /></IconButton>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-n300 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts
type ToastT = { id: number; tone: "green" | "red" | "yellow"; text: string };
const ToastCtx = createContext<(text: string, tone?: ToastT["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((text: string, tone: ToastT["tone"] = "green") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "red" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-md px-4 py-3 text-sm font-medium shadow-[var(--shadow-sheet)]",
            t.tone === "red" ? "bg-red-a text-white" : t.tone === "yellow" ? "bg-yellow text-ink" : "bg-ink text-white")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
