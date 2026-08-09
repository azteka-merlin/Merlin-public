import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { Locale } from "./i18n";

export const ASSET_BASE = "/download-assets";
export const DOWNLOAD_URL = "https://api-merlin.com/api/updates/download";

export type BillingPrice = {
  productName?: string;
  amountCents: number;
  currency: string;
  recurringInterval?: string | null;
  active?: boolean;
  stale?: boolean;
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(normalizeEmail(value));
}

export async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || fallback);
  }
  return payload as T;
}

export function formatMoney(locale: Locale, price: BillingPrice | null) {
  if (!price) return "--";
  return new Intl.NumberFormat(locale === "ptbr" ? "pt-BR" : locale === "de" ? "de-DE" : locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-US", {
    style: "currency",
    currency: String(price.currency || "brl").toUpperCase(),
  }).format((Number(price.amountCents) || 0) / 100);
}

export function Button({ children, variant = "primary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost"; size?: "md" | "lg" }) {
  return <button {...props} className={cx(
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    size === "lg" ? "h-13 px-7 text-base" : "h-11 px-5 text-sm",
    variant === "primary" && "bg-primary text-primary-foreground hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[var(--glow-soft)]",
    variant === "outline" && "border border-border bg-transparent text-foreground hover:-translate-y-0.5 hover:border-primary/50 hover:bg-secondary/60",
    variant === "ghost" && "text-muted-foreground hover:text-foreground",
    className,
  )}>{children}</button>;
}

export function SectionTitle({ children, center, className }: { children: ReactNode; center?: boolean; className?: string }) {
  return <h2 className={cx("text-3xl font-bold leading-[1.15] text-foreground sm:text-4xl md:text-[2.75rem]", center && "text-center", className)}>{children}</h2>;
}

export function FormField({ label, error, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return <div>
    <label className="mb-2 block text-sm font-medium text-foreground">{label}</label>
    <input {...props} className={cx("form-input", error && "is-error")} />
    {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
  </div>;
}
