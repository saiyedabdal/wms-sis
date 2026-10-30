"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { twMerge } from "tailwind-merge";

const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(" "));

type Variant = "primary" | "secondary" | "ghost" | "danger";

const btn: Record<Variant, string> = {
  primary: "bg-yellow text-ink hover:bg-y200 shadow-[var(--shadow-cta)] font-semibold uppercase tracking-wide",
  secondary: "bg-white text-ink border border-ink hover:bg-n100 font-semibold uppercase tracking-wide",
  ghost: "text-ink hover:bg-n200 font-medium",
  danger: "bg-white text-red-a border border-red-b hover:bg-red-c font-semibold",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md transition disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-3 text-xs" : "h-11 px-5 text-sm",
        btn[variant],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: { href: string; variant?: Variant; size?: "sm" | "md"; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md transition",
        size === "sm" ? "h-8 px-3 text-xs" : "h-11 px-5 text-sm",
        btn[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-n800">{children}</span>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-2", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-xs text-n800">{hint}</span>}
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-xs border border-n500 bg-white px-3 text-sm text-ink placeholder:text-n700 focus:border-ink focus:outline-none focus:ring-2 focus:ring-yellow/60";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cx(inputCls, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, "h-auto min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, "pr-8", className)} {...props}>
      {children}
    </select>
  );
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

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-block text-xs font-medium text-n800 hover:text-ink">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-n800">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
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

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-xs px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  draft: "neutral",
  submitted: "yellow",
  pending_approval: "yellow",
  approved: "blue",
  rejected: "red",
  open: "yellow",
  partially_dispatched: "blue",
  dispatched: "blue",
  in_transit: "blue",
  received: "green",
  closed: "neutral",
  cancelled: "red",
  ok: "green",
  short: "red",
  excess: "yellow",
  damaged: "red",
  wrong_sku: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={cx("border-b border-n300 bg-n100 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-n800", right ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export function Td({ children, right, className, colSpan }: { children?: ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx("border-b border-n200 px-4 py-3 align-middle", right && "text-right tabular", className)}>
      {children}
    </td>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-n800">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "yellow" | "default" }) {
  return (
    <div className={cx("rounded-lg border p-5", tone === "yellow" ? "border-y75 bg-y50" : "border-n300 bg-white")}>
      <Label>{label}</Label>
      <div className="mt-2 text-[28px] font-semibold leading-none tabular">{value}</div>
      {hint && <div className="mt-2 text-xs text-n800">{hint}</div>}
    </div>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "green" | "yellow" | "blue"; children: ReactNode }) {
  const t = { red: "bg-red-c text-red-a", green: "bg-green-c text-green-a", yellow: "bg-y50 text-y500 border border-y75", blue: "bg-b50 text-b500" }[tone];
  return <div className={cx("rounded-md px-4 py-3 text-sm", t)}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-n300">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium",
            value === t.value ? "border-yellow text-ink" : "border-transparent text-n800 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Ready-to-paste email: subject + body with copy buttons. */
export function CopyBlock({ title, to, subject, body }: { title: string; to?: string; subject: string; body: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const CopyBtn = ({ what, text }: { what: string; text: string }) => (
    <Button variant="ghost" size="sm" onClick={() => copy(what, text)}>
      {copied === what ? <RiCheckLine size={14} /> : <RiFileCopyLine size={14} />}
      {copied === what ? "Copied" : "Copy"}
    </Button>
  );
  return (
    <Card title={title} actions={<CopyBtn what="all" text={`Subject: ${subject}\n\n${body}`} />}>
      <div className="flex flex-col gap-4">
        {to !== undefined && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <Label>To</Label>
              <p className="truncate text-sm">{to || <span className="text-n700">Add recipients in Facilities → contact email</span>}</p>
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Label>Subject</Label>
            <p className="text-sm font-medium">{subject}</p>
          </div>
          <CopyBtn what="subject" text={subject} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label>Body</Label>
            <CopyBtn what="body" text={body} />
          </div>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-n100 p-4 font-mono text-xs leading-relaxed">{body}</pre>
        </div>
      </div>
    </Card>
  );
}

export { cx };
