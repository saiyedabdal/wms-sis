import { cx } from "./ui";

export const APP_NAME = "Frido CDN";
export const APP_FULL_NAME = "Frido Care Distribution Network";

/** "frido" wordmark + CDN tag, used on the sidebar, login and password pages. */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cx("flex items-baseline gap-2", className)} title={APP_FULL_NAME}>
      <span className={cx("font-bold lowercase tracking-tight", size === "lg" ? "text-3xl" : "text-2xl")}>frido</span>
      <span className="rounded-xs bg-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">CDN</span>
    </span>
  );
}
