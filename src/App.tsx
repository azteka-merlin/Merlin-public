import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dictionaries, initialLocale, type Locale } from "./i18n";
import { ASSET_BASE, DOWNLOAD_URL, Button, FormField, SectionTitle, cx, formatMoney, normalizeEmail, postJson, scrollToId, validEmail, type BillingPrice } from "./ui";

type PlanType = "monthly" | "lifetime";
type PaymentMethod = "card" | "pix";
type FlowMode = "register" | "recover" | "payment-status" | "billing-portal" | "verify" | "success" | "payment-result" | "pix";
type PendingMode = "register" | "recover" | "payment-status" | "billing-portal";

type BillingState = {
  signupEnabled: boolean;
  billingEnabled: boolean;
  monthlyEnabled: boolean;
  lifetimeEnabled: boolean;
  monthlyCardTrial: { enabled: boolean; days: number };
  paymentMethods: { card: boolean; pix: boolean; pixMonthly: boolean; pixLifetime: boolean };
  prices: Record<PlanType, BillingPrice | null>;
  loaded: boolean;
};

type PendingAction = { mode: PendingMode; data: Record<string, string | boolean>; verified?: boolean };
type StatusModal = { title: string; text: string; tone: "ok" | "warn" | "error" } | null;
type PaymentResult = { status: string; title: string; text: string; licenseKey: string };
type PixOrder = {
  paymentIntentId: string;
  status: "awaiting_payment" | "paid" | "expired" | "failed";
  planType: PlanType;
  qrCode: string;
  qrCodeBase64?: string | null;
  ticketUrl?: string | null;
  expiresAt?: string | null;
};
type AccessDetailsPayload = {
  status: "found" | "not_found";
  access?: {
    kind: "monthly" | "lifetime" | "active";
    name?: string;
    current?: boolean;
    accessType?: string;
    billingStatus?: string;
    expiresAt?: string | null;
    subscription?: { status?: string; currentPeriodEnd?: string | null; cancelAtPeriodEnd?: boolean; canManage?: boolean } | null;
    upgrade?: { available: boolean; reason?: string | null; price?: BillingPrice | null };
    renewal?: { available: boolean; card?: boolean; pix?: boolean; price?: BillingPrice | null };
  };
};
type AccessStep = "identify" | "verify" | "details" | "upgrade-status";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
  }
}

const INITIAL_BILLING_STATE: BillingState = {
  signupEnabled: false,
  billingEnabled: false,
  monthlyEnabled: false,
  lifetimeEnabled: false,
  monthlyCardTrial: { enabled: false, days: 30 },
  paymentMethods: { card: true, pix: false, pixMonthly: false, pixLifetime: false },
  prices: { monthly: null, lifetime: null },
  loaded: false,
};

function parseBillingPayload(payload: any): BillingState {
  return {
    signupEnabled: Boolean(payload?.settings?.enabled),
    billingEnabled: Boolean(payload?.billing?.billingEnabled),
    monthlyEnabled: Boolean(payload?.billing?.monthlyEnabled),
    lifetimeEnabled: Boolean(payload?.billing?.lifetimeEnabled),
    monthlyCardTrial: {
      enabled: Boolean(payload?.billing?.monthlyCardTrial?.enabled),
      days: Number(payload?.billing?.monthlyCardTrial?.days) || 30,
    },
    paymentMethods: {
      card: payload?.billing?.paymentMethods?.card !== false,
      pix: Boolean(payload?.billing?.paymentMethods?.pix),
      pixMonthly: payload?.billing?.paymentMethods?.pixMonthly !== undefined ? Boolean(payload?.billing?.paymentMethods?.pixMonthly) : Boolean(payload?.billing?.paymentMethods?.pix),
      pixLifetime: payload?.billing?.paymentMethods?.pixLifetime !== undefined ? Boolean(payload?.billing?.paymentMethods?.pixLifetime) : Boolean(payload?.billing?.paymentMethods?.pix),
    },
    prices: {
      monthly: payload?.billing?.prices?.monthly || null,
      lifetime: payload?.billing?.prices?.lifetime || null,
    },
    loaded: true,
  };
}

function planCanBeSold(billing: BillingState, plan: PlanType | null) {
  if (!billing.loaded || !billing.signupEnabled || !billing.billingEnabled || !plan) return false;
  if (plan === "monthly") return billing.monthlyEnabled && Boolean(billing.prices.monthly);
  return billing.lifetimeEnabled && Boolean(billing.prices.lifetime);
}

function getMercadoPagoDeviceId() {
  return typeof window !== "undefined" && typeof window.MP_DEVICE_SESSION_ID === "string"
    ? window.MP_DEVICE_SESSION_ID.trim()
    : "";
}

function hasPaidPlans(billing: BillingState) {
  return planCanBeSold(billing, "monthly") || planCanBeSold(billing, "lifetime");
}

function canPurchaseAccess(billing: BillingState) {
  return hasPaidPlans(billing);
}

function sanitizeRecoverySecret(value: string) {
  return value.replace(/\s/g, "").slice(0, 8);
}

function validRecoverySecret(value: string) {
  return /^\S{4,8}$/.test(value.trim());
}

function formatDate(locale: Locale, value?: string | null) {
  if (!value) return "--";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale === "ptbr" ? "pt-BR" : locale === "de" ? "de-DE" : locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-US").format(date);
}

function accessStatusLabel(t: TFn, status?: string) {
  const value = String(status || "active").toLowerCase();
  if (value === "past_due") return t("statusPastDue");
  if (value === "canceled" || value === "cancelled") return t("statusCanceled");
  if (value === "expired") return t("statusExpired");
  if (value === "none") return t("statusNone");
  return t("statusActive");
}
const FEEDBACKS = [
  ["gris", "feedback-gris.jpeg"],
  ["007", "feedback-007.jpeg"],
  ["suporte", "feedback-suporte.jpeg"],
  ["crimson-simples", "feedback-crimson-simples.jpeg"],
  ["crimson-gameplay", "feedback-crimson-gameplay.jpeg"],
  ["black-flag", "feedback-black-flag.jpeg"],
] as const;

const COMPAT_CARDS = [
  { icon: `${ASSET_BASE}/assets/compatibility/icon-online.png`, title: "compatOnlineTitle", body: "compatOnlineBody", alt: "Controle de videogame com símbolo de conexão online" },
  { icon: `${ASSET_BASE}/assets/compatibility/icon-launchers.png`, title: "compatLauncherTitle", body: "compatLauncherBody", alt: "Janelas de aplicativo representando launchers externos" },
  { icon: `${ASSET_BASE}/assets/compatibility/icon-denuvo.png`, title: "compatDenuvoTitle", body: "compatDenuvoBody", alt: "Escudo com cadeado e circuitos representando proteção tecnológica", accent: true },
];

function AppHeader({ locale, setLocale, purchaseAvailable, t }: { locale: Locale; setLocale: (value: Locale) => void; purchaseAvailable: boolean; t: TFn }) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const nav = [["o-que-e", t("navWhat")], ["como-funciona", t("navHow")], ["seguranca", t("navSecurity")], ["feedbacks", t("navFeedbacks")], ["planos", t("navPlans")]];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const els = nav.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return undefined;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [locale]);

  return <header className={cx("sticky top-0 z-50 transition-colors duration-300", scrolled ? "bg-background/70 backdrop-blur-md" : "bg-background/40")}>
    <div className="container-merlin flex h-[74px] items-center justify-between gap-4 sm:h-[82px]">
      <a href="#top" className="flex min-w-0 items-center gap-3" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <img src={`${ASSET_BASE}/assets/branding/merlin-logo.png`} alt="Merlin" className="h-11 w-11 shrink-0 object-contain sm:h-12 sm:w-12" />
        <span className="font-display truncate text-xl font-bold tracking-tight sm:text-2xl">Merlin</span>
      </a>
      <nav className="hidden items-center gap-6 lg:flex xl:gap-8">
        {nav.map(([id, label]) => <button key={id} onClick={() => scrollToId(id)} className={cx("cursor-pointer whitespace-nowrap text-sm transition-colors duration-200 hover:text-primary", active === id ? "text-foreground" : "text-muted-foreground")}>{label}</button>)}
        <a href={DOWNLOAD_URL} className="whitespace-nowrap text-sm text-muted-foreground transition-colors duration-200 hover:text-primary">{t("download")}</a>
      </nav>
      <div className="flex items-center gap-3">
        <select className="language-select hidden sm:block" value={locale} aria-label="Language" onChange={(event) => setLocale(event.target.value as Locale)}>
          <option value="ptbr">PT</option><option value="en">EN</option><option value="es">ES</option><option value="fr">FR</option><option value="de">DE</option>
        </select>
        <MarketingCta purchaseAvailable={purchaseAvailable} t={t} className="shrink-0" />
      </div>
    </div>
  </header>;
}

function Hero({ purchaseAvailable, t }: { purchaseAvailable: boolean; t: TFn }) {
  return <section id="top" className="relative overflow-hidden">
    <div className="container-merlin relative pb-16 pt-10 md:pb-24 md:pt-16">
      <div className="grid items-center gap-10 min-[900px]:grid-cols-[46fr_54fr] min-[1180px]:grid-cols-[43fr_57fr] min-[900px]:gap-12">
        <div className="max-w-[560px]">
          <h1 className="text-[clamp(2.6rem,9vw,3rem)] font-bold leading-[1.08] tracking-[-0.03em] min-[900px]:text-[clamp(3rem,4.4vw,4rem)]">
            {t("heroTitleA")} <span className="text-primary">{t("heroTitleGame")}</span><br />{t("heroTitleB")}
          </h1>
          <p className="mt-7 max-w-[480px] text-base leading-relaxed text-muted-foreground sm:text-lg">{t("heroBody")}</p>
          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <MarketingCta purchaseAvailable={purchaseAvailable} t={t} size="lg" className="w-full sm:w-auto" />
            <button onClick={() => scrollToId("como-funciona")} className="inline-flex items-center gap-2 self-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:self-auto"><span aria-hidden className="text-primary">▶</span>{t("heroWatch")}</button>
          </div>
        </div>
        <div className="relative flex justify-center min-[900px]:justify-end">
          <div aria-hidden className="aura pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full" />
          <img src={`${ASSET_BASE}/assets/branding/merlin-hero-official.png`} alt="Merlin" className="relative w-[min(78%,320px)] max-w-full object-contain min-[900px]:w-full min-[900px]:max-w-[520px]" />
        </div>
      </div>
    </div>
  </section>;
}

function MarketingCta({ purchaseAvailable, t, size = "md", className }: { purchaseAvailable: boolean; t: TFn; size?: "md" | "lg"; className?: string }) {
  if (purchaseAvailable) return <Button size={size} className={className} onClick={() => scrollToId("planos")}>{t("acquire")}</Button>;
  return <a href={DOWNLOAD_URL} className={cx(
    "inline-flex select-none items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[var(--glow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    size === "lg" ? "h-13 px-7 text-base" : "h-11 px-5 text-sm",
    className,
  )}>{t("downloadMerlin")}</a>;
}

function Feedbacks({ purchaseAvailable, t }: { purchaseAvailable: boolean; t: TFn }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>("[data-card]");
    track?.scrollBy({ left: dir * ((card?.offsetWidth ?? 280) + 16), behavior: "smooth" });
  };
  const move = useCallback((dir: 1 | -1) => setOpen((prev) => prev === null ? prev : (prev + dir + FEEDBACKS.length) % FEEDBACKS.length), []);
  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); if (event.key === "ArrowRight") move(1); if (event.key === "ArrowLeft") move(-1); };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("lightbox-open");
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("lightbox-open"); };
  }, [open, move]);

  return <section id="feedbacks" className="section-y">
    <div className="container-merlin"><div className="flex items-end justify-between gap-6"><div><SectionTitle>{t("feedbacksTitle")}</SectionTitle><p className="mt-4 max-w-[520px] text-muted-foreground">{t("feedbacksBody")}</p></div><div className="hidden shrink-0 gap-2 sm:flex"><button aria-label="Anterior" onClick={() => scrollByCard(-1)} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">←</button><button aria-label="Próximo" onClick={() => scrollByCard(1)} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">→</button></div></div></div>
    <div ref={trackRef} onScroll={() => { const track = trackRef.current; const card = track?.querySelector<HTMLElement>("[data-card]"); const w = (card?.offsetWidth ?? 280) + 16; setActive(Math.max(0, Math.min(FEEDBACKS.length - 1, Math.round((track?.scrollLeft ?? 0) / w)))); }} className="no-scrollbar mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:px-8 lg:px-10 xl:px-[max(64px,calc((100vw-1200px)/2+64px))]">
      {FEEDBACKS.map(([id, file], index) => <button key={id} data-card type="button" aria-label={`Abrir feedback ${index + 1}`} onClick={() => setOpen(index)} className="w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-primary/40 sm:w-[45%] lg:w-[31%]"><div className="aspect-[4/5] bg-background/30 p-2"><img src={`${ASSET_BASE}/assets/feedbacks/${file}`} alt={`Feedback real ${index + 1}`} loading="lazy" decoding="async" className="h-full w-full rounded-xl object-contain" /></div></button>)}
    </div>
    <div className="container-merlin mt-6 flex justify-center gap-1.5">{FEEDBACKS.map(([id], i) => <span key={id} className={cx("h-1.5 rounded-full transition-all", i === active ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30")} />)}</div>
    <div className="container-merlin mt-20"><div className="mx-auto max-w-[720px] text-center"><h3 className="text-2xl font-bold sm:text-3xl">{t("feedbackSupportTitle")}</h3><p className="mt-4 text-muted-foreground">{t("feedbackSupportBody")}</p><div className="mt-8 flex justify-center"><MarketingCta purchaseAvailable={purchaseAvailable} t={t} size="lg" /></div></div></div>
    {open !== null && <div role="dialog" aria-modal="true" aria-label={`Feedback ${open + 1}`} className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm" onClick={() => setOpen(null)}><div className="relative flex max-h-[92vh] w-full max-w-[820px] flex-col" onClick={(event) => event.stopPropagation()}><div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-primary/25 bg-card p-2"><img src={`${ASSET_BASE}/assets/feedbacks/${FEEDBACKS[open][1]}`} alt={`Feedback real ${open + 1}`} className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain" /></div><div className="mt-4 flex items-center justify-between"><button type="button" onClick={() => move(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground">←</button><span className="text-sm text-muted-foreground">{open + 1} / {FEEDBACKS.length}</span><button type="button" onClick={() => move(1)} className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground">→</button></div><button type="button" onClick={() => setOpen(null)} aria-label="Fechar" className="absolute -top-12 right-0 grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground">×</button></div></div>}
  </section>;
}

function PlanCard({ title, price, period, description, note, cta, selected, featured, badge, disabled, onSelect, t }: { title: string; price: string; period: string; description: string; note?: string; cta: string; selected: boolean; featured?: boolean; badge?: string; disabled?: boolean; onSelect: () => void; t: TFn }) {
  return <div className={cx("flex flex-col rounded-2xl border bg-card p-7 transition-colors sm:p-8", featured ? "border-primary/40" : "border-border", selected && "border-primary shadow-[var(--glow-soft)]", disabled && "opacity-50")}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-bold">{title}</h3>{(badge || featured) && <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">{badge || t("bestValue")}</span>}</div>
    <div className="mt-6 flex items-baseline gap-2"><span className="font-display text-4xl font-bold">{price}</span><span className="text-sm text-muted-foreground">{period}</span></div>
    <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{description}</p>{note && <p className="mt-4 text-xs leading-relaxed text-muted-foreground/70">{note}</p>}
    <div className="mt-8 flex-1" /><Button size="lg" variant={featured ? "primary" : "outline"} className="w-full" disabled={disabled} onClick={onSelect}>{cta}</Button>
  </div>;
}

function ExistingAccessActions({ t, onRecover, onAccess }: { t: TFn; onRecover: () => void; onAccess: () => void }) {
  return <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
    <span>{t("existingAccessPrompt")}</span>
    <a href={DOWNLOAD_URL} className="font-medium text-foreground/85 transition-colors hover:text-primary">{t("downloadMerlin")}</a>
    <span aria-hidden className="text-muted-foreground/40">{"\u00B7"}</span>
    <button type="button" onClick={onRecover} className="font-medium text-foreground/85 transition-colors hover:text-primary">{t("recoverMyKey")}</button>
    <span aria-hidden className="text-muted-foreground/40">{"\u00B7"}</span>
    <button type="button" onClick={onAccess} className="font-medium text-foreground/85 transition-colors hover:text-primary">{t("myAccess")}</button>
  </div>;
}

function Plans({ locale, t, billing, version }: { locale: Locale; t: TFn; billing: BillingState; version: string }) {
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [mode, setMode] = useState<FlowMode>("register");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [form, setForm] = useState({ name: "", email: "", recoveryPin: "", accepted: false, code: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState<{ title: string; licenseKey: string; recoveryPin?: string | null } | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [pixOrder, setPixOrder] = useState<PixOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [pixChecking, setPixChecking] = useState(false);
  const [modal, setModal] = useState<StatusModal>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessSessionId, setAccessSessionId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function clearTransientFields(options: { keepEmail?: boolean; email?: string } = {}) {
    setPending(null);
    setErrors({});
    setMessage("");
    setCooldown(0);
    setPixOrder(null);
    setPixCopied(false);
    setPixChecking(false);
    setForm((value) => ({
      name: "",
      email: options.email ?? (options.keepEmail ? value.email : ""),
      recoveryPin: "",
      accepted: false,
      code: "",
    }));
  }

  function focusResultPanel() {
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function showSuccess(next: { title: string; licenseKey: string; recoveryPin?: string | null }, options: { keepEmail?: boolean; email?: string } = {}) {
    setSuccess(next);
    setPaymentResult(null);
    setMode("success");
    clearTransientFields(options);
    focusResultPanel();
  }

  function showPaymentResult(next: PaymentResult, options: { keepEmail?: boolean; email?: string } = {}) {
    setPaymentResult(next);
    setSuccess(null);
    setMode("payment-result");
    clearTransientFields(options);
    focusResultPanel();
  }

  function pixAvailableForPlan(nextPlan: PlanType | null) {
    if (!nextPlan || !billing.paymentMethods.pix) return false;
    return nextPlan === "monthly" ? billing.paymentMethods.pixMonthly : billing.paymentMethods.pixLifetime;
  }


  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const access = params.get("access");
    if (checkout === "success") {
      setModal({ title: t("checkoutReceivedTitle"), text: t("checkoutSuccessPending"), tone: "ok" });
      void pollCheckoutStatus(params.get("session_id"));
    } else if (checkout === "cancel") {
      setModal({ title: t("checkoutCanceledTitle"), text: t("checkoutCanceled"), tone: "warn" });
    } else if (access === "upgrade-success") {
      setAccessSessionId(params.get("session_id"));
      setAccessOpen(true);
    } else if (access === "upgrade-cancel") {
      setModal({ title: t("upgradeCanceledTitle"), text: t("upgradeCanceledText"), tone: "warn" });
    } else if (access === "me") {
      setAccessOpen(true);
    }
  }, [locale]);

  useEffect(() => {
    if (billing.signupEnabled && billing.billingEnabled && mode === "register" && planCanBeSold(billing, plan)) window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  }, [plan, billing.signupEnabled, billing.billingEnabled, billing.monthlyEnabled, billing.lifetimeEnabled, billing.prices.monthly, billing.prices.lifetime, mode]);

  function resetPanel(nextMode: FlowMode) {
    setMode(nextMode); setErrors({}); setMessage(""); setSuccess(null); setPaymentResult(null); setPixOrder(null); setPending(null); setCooldown(0); setForm((value) => ({ ...value, code: "", recoveryPin: nextMode === "register" ? "" : value.recoveryPin, accepted: nextMode === "register" ? false : value.accepted }));
  }

  function validateBase(includeName: boolean, includePin: boolean, includeNotice: boolean) {
    const next: Record<string, string> = {};
    if (includeName && !form.name.trim()) next.name = t("errorName");
    if (!validEmail(form.email)) next.email = t("errorEmail");
    if (includePin && !validRecoverySecret(form.recoveryPin)) next.recoveryPin = t("errorPin");
    if (includeNotice && !form.accepted) next.accepted = t("errorNotice");
    if (includeName && billing.billingEnabled && !planCanBeSold(billing, plan)) next.plan = t("errorPlan");
    if (includeName && billing.billingEnabled && pixAvailableForPlan(plan) && !paymentMethod) next.paymentMethod = t("errorPaymentMethod");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function sendVerification(action: PendingAction) {
    setLoading(true); setMessage(t("sendingCode"));
    try {
      const email = normalizeEmail(String(action.data.email || action.data.contact || ""));
      const payload = await postJson<{ cooldownSeconds?: number }>("/api/public/email-verification/start", { email }, t("genericError"));
      setPending(action); setCooldown(Number(payload.cooldownSeconds || 60)); setMode("verify"); setMessage(t("emailCodeSent"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("genericError")); }
    finally { setLoading(false); }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    if (!pending) return resetPanel("register");
    if (!pending.verified && !/^\d{6}$/.test(form.code.trim())) { setErrors({ code: t("errorCode") }); return; }
    setLoading(true); setErrors({}); setMessage(t("loading"));
    const email = normalizeEmail(String(pending.data.email || pending.data.contact || ""));
    try {
      const verifiedPending = pending.verified ? pending : { ...pending, verified: true };
      if (!pending.verified) {
        await postJson("/api/public/email-verification/verify", { email, code: form.code.trim() }, t("genericError"));
        setPending(verifiedPending);
      }
      if (verifiedPending.mode === "register") await createAccess(verifiedPending.data);
      if (verifiedPending.mode === "recover") await recoverAccess(verifiedPending.data);
      if (verifiedPending.mode === "payment-status") await checkPaymentStatus(email);
      if (verifiedPending.mode === "billing-portal") await openBillingPortal(email, String(verifiedPending.data.recoveryPin || ""));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("genericError")); }
    finally { setLoading(false); }
  }

  async function createAccess(data: Record<string, string | boolean>) {
    if (billing.billingEnabled) {
      if (!planCanBeSold(billing, plan)) { setErrors({ plan: t("errorPlan") }); setMessage(""); return; }
      if (pixAvailableForPlan(plan) && !paymentMethod) { setErrors({ paymentMethod: t("errorPaymentMethod") }); setMessage(""); return; }
      if (paymentMethod === "pix") {
        if (!pixAvailableForPlan(plan)) { setErrors({ paymentMethod: t("errorPaymentMethod") }); setMessage(""); return; }
        setMessage(t("pixCreating"));
        const payload = await postJson<PixOrder>("/api/public/pix/orders", { name: data.name, contact: data.email, recoveryPin: data.recoveryPin, acceptedRecoveryNotice: data.accepted, planType: plan, mercadoPagoDeviceId: getMercadoPagoDeviceId() }, t("genericError"));
        localStorage.setItem("merlin_checkout_email", normalizeEmail(String(data.email)));
        setPixOrder(payload);
        setPixCopied(false);
        setMode("pix");
        setMessage("");
        return;
      }
      setMessage(t("checkoutLoading"));
      const payload = await postJson<{ checkoutUrl: string }>("/api/public/checkout", { name: data.name, contact: data.email, recoveryPin: data.recoveryPin, acceptedRecoveryNotice: data.accepted, planType: plan }, t("genericError"));
      localStorage.setItem("merlin_checkout_email", normalizeEmail(String(data.email)));
      setMessage(t("checkoutRedirecting")); window.location.href = payload.checkoutUrl; return;
    }
    const payload = await postJson<{ created: boolean; license: { licenseKey: string } }>("/api/public/access-keys/register", { name: data.name, contact: data.email, contactType: "email", recoveryPin: data.recoveryPin, acceptedRecoveryNotice: data.accepted }, t("genericError"));
    showSuccess({ title: payload.created ? t("successCreated") : t("successExisting"), licenseKey: payload.license.licenseKey, recoveryPin: payload.created ? String(data.recoveryPin) : null });
  }

  async function recoverAccess(data: Record<string, string | boolean>) {
    const payload = await postJson<{ license: { licenseKey: string } }>("/api/public/access-keys/recover", { contact: data.email, contactType: "email", recoveryPin: data.recoveryPin }, t("genericError"));
    showSuccess({ title: t("successRecovered"), licenseKey: payload.license.licenseKey });
  }

  function renderPaymentStatus(payload: any, email: string) {
    const hasLicense = Boolean(payload.license?.licenseKey);
    const status = String(payload.status || "not_found");
    const title = status === "completed" ? t("paymentApprovedTitle") : status === "existing_license" ? t("paymentExistingTitle") : status === "processing" ? t("paymentProcessingTitle") : status === "expired" ? t("paymentExpiredTitle") : t("paymentMissingTitle");
    const text = status === "completed" ? t("paymentApprovedText") : status === "existing_license" ? t("paymentExistingText") : status === "processing" ? t("paymentProcessingText") : status === "expired" ? t("paymentExpiredText") : t("paymentMissingText");
    localStorage.setItem("merlin_checkout_email", email);
    showPaymentResult({ status, title, text, licenseKey: hasLicense ? payload.license.licenseKey : "" }, { email });
  }

  async function checkPaymentStatus(email: string) {
    setMessage(t("loading"));
    const payload = await postJson("/api/public/payment-status", { email }, t("genericError"));
    renderPaymentStatus(payload, email);
  }

  async function openBillingPortal(email: string, recoveryPin = "") {
    const endpoint = recoveryPin ? "/api/public/access/billing-portal" : "/api/public/billing-portal";
    const body = recoveryPin ? { email, recoveryPin } : { email };
    const payload = await postJson<{ portalUrl?: string }>(endpoint, body, t("billingPortalUnavailable"));
    if (!payload.portalUrl) throw new Error(t("billingPortalUnavailable"));
    window.location.href = payload.portalUrl;
  }

  async function pollCheckoutStatus(sessionId: string | null) {
    if (!sessionId) return;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const payload = await fetch(`/api/public/checkout-status?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json());
        if (payload?.success !== false && payload.status === "completed" && payload.license?.licenseKey) {
          showSuccess({ title: t("successCreated"), licenseKey: payload.license.licenseKey });
          return;
        }
      } catch { /* webhook may still be processing */ }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    const email = localStorage.getItem("merlin_checkout_email") || "";
    setForm((value) => ({ ...value, email })); setMode("payment-status");
    setModal({ title: t("checkoutStillProcessingTitle"), text: t("checkoutStillProcessing"), tone: "warn" });
  }

  async function checkPixStatus(order: PixOrder, manual = false) {
    if (manual) setPixChecking(true);
    try {
      const payload = await fetch(`/api/public/pix/orders/${encodeURIComponent(order.paymentIntentId)}/status`).then((r) => r.json());
      if (payload?.success === false) throw new Error(payload.error || t("genericError"));
      if (payload.status === "paid" && payload.license?.licenseKey) {
        showSuccess({ title: t("paymentApprovedTitle"), licenseKey: payload.license.licenseKey });
        return "done";
      }
      if (payload.status === "expired") {
        setPixOrder((value) => value ? { ...value, status: "expired" } : value);
        return "expired";
      }
      if (payload.status === "failed") {
        setPixOrder((value) => value ? { ...value, status: "failed" } : value);
        return "failed";
      }
      return "waiting";
    } finally {
      if (manual) setPixChecking(false);
    }
  }

  useEffect(() => {
    if (mode !== "pix" || !pixOrder || pixOrder.status !== "awaiting_payment") return undefined;
    let stopped = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const result = await checkPixStatus(pixOrder);
        if (stopped || result !== "waiting") return;
      } catch {
        // Keep polling; temporary network failure is not a payment failure.
      }
      if (!stopped) timer = window.setTimeout(poll, 4000);
    }
    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [mode, pixOrder?.paymentIntentId, pixOrder?.status]);

  function submitRegister(event: React.FormEvent) {
    event.preventDefault();
    if (!validateBase(true, true, true)) return;
    void sendVerification({ mode: "register", data: { name: form.name.trim(), email: normalizeEmail(form.email), recoveryPin: form.recoveryPin.trim(), accepted: form.accepted } });
  }

  function submitSimple(event: React.FormEvent, modeName: "recover" | "payment-status" | "billing-portal") {
    event.preventDefault();
    if (!validateBase(false, modeName === "recover" || modeName === "billing-portal", false)) return;
    void sendVerification({ mode: modeName, data: { email: normalizeEmail(form.email), recoveryPin: form.recoveryPin.trim() } });
  }

  const monthlyAvailable = planCanBeSold(billing, "monthly");
  const lifetimeAvailable = planCanBeSold(billing, "lifetime");
  const paidPlansAvailable = monthlyAvailable || lifetimeAvailable;
  const freeSignupAvailable = billing.loaded && billing.signupEnabled && !billing.billingEnabled;
  const monthlyPixAvailable = pixAvailableForPlan("monthly");
  const lifetimePixAvailable = pixAvailableForPlan("lifetime");
  const selectedPlanHasPix = pixAvailableForPlan(plan);
  const monthlyPrice = monthlyAvailable ? formatMoney(locale, billing.prices.monthly) : "";
  const lifetimePrice = lifetimeAvailable ? formatMoney(locale, billing.prices.lifetime) : "";
  const showRegisterForm = mode === "register" && billing.signupEnabled && (freeSignupAvailable || (billing.billingEnabled && paidPlansAvailable && planCanBeSold(billing, plan)));
  const showUnavailableMessage = billing.loaded && (!billing.signupEnabled || (billing.billingEnabled && !paidPlansAvailable));

  return <section id="planos" className="section-y"><div className="container-merlin">
    <div className="mx-auto max-w-[760px] text-center"><SectionTitle center>{t("plansEntryTitle")}</SectionTitle><p className="mx-auto mt-4 max-w-[680px] text-muted-foreground">{freeSignupAvailable ? t("freeAccessBody") : t("plansEntryBody")}</p><ExistingAccessActions t={t} onRecover={() => resetPanel("recover")} onAccess={() => { setAccessSessionId(null); setAccessOpen(true); }} />{version && <p className="mt-3 text-xs text-muted-foreground/70">v{version}</p>}</div>
    {!billing.loaded ? <div className="mx-auto mt-12 h-44 max-w-[900px] animate-pulse rounded-2xl border border-border bg-card" /> : <>
      {billing.signupEnabled && billing.billingEnabled && paidPlansAvailable && <div className={cx("mx-auto mt-12 grid gap-5", monthlyAvailable && lifetimeAvailable ? "max-w-[900px] md:grid-cols-2" : "max-w-[440px]")}>{monthlyAvailable && <PlanCard badge={billing.monthlyCardTrial.enabled ? t("trialDaysFree", { days: billing.monthlyCardTrial.days }) : undefined} title={t("monthlyTitle")} price={monthlyPrice} period={t("monthlyPeriod")} description={monthlyPixAvailable ? t("monthlyPixHint") : t("monthlyHint")} note={monthlyPixAvailable ? t("monthlyPixNote") : t("monthlyNote")} cta={t("monthlyCta")} selected={plan === "monthly"} onSelect={() => { setPlan("monthly"); setPaymentMethod(null); resetPanel("register"); }} t={t} />}{lifetimeAvailable && <PlanCard featured title={t("lifetimeTitle")} price={lifetimePrice} period={t("lifetimePeriod")} description={t("lifetimeHint")} note={lifetimePixAvailable ? t("lifetimePixNote") : undefined} cta={t("lifetimeCta")} selected={plan === "lifetime"} onSelect={() => { setPlan("lifetime"); setPaymentMethod(null); resetPanel("register"); }} t={t} />}</div>}
      {showUnavailableMessage && mode === "register" && <p className="mx-auto mt-10 max-w-[560px] text-center text-sm text-muted-foreground">{t("newAccessUnavailable")}</p>}
      <div ref={formRef} className={cx("mx-auto grid max-w-[660px] transition-all duration-500", showRegisterForm || mode !== "register" ? "mt-8 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0")}><div className="overflow-hidden"><div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        {mode === "register" && showRegisterForm && <form className="space-y-6" onSubmit={submitRegister}>
          <div>
            <h3 className="text-2xl font-bold">{t("createAccess")}</h3>
            {billing.billingEnabled && plan && <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-background/50 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("selectedPlan")}</p>
                <p className="truncate text-sm font-medium">{plan === "monthly" ? `${t("monthlyTitle")} • ${monthlyPrice}` : `${t("lifetimeTitle")} • ${lifetimePrice}`}</p>
              </div>
              <button type="button" onClick={() => { setPlan(null); setPaymentMethod(null); }} className="shrink-0 text-sm text-primary hover:underline">{t("change")}</button>
            </div>}
            {errors.plan && <p className="mt-2 text-xs text-destructive">{errors.plan}</p>}
          </div>
          {billing.billingEnabled && selectedPlanHasPix && plan && <PaymentMethodSelector plan={plan} monthlyCardTrial={billing.monthlyCardTrial} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} error={errors.paymentMethod} t={t} />}
          <FormField label={t("name")} placeholder={t("namePlaceholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <FormField label={t("email")} type="email" placeholder={t("emailPlaceholder")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
          <FormField label={t("recoveryPin")} type="password" autoComplete="new-password" placeholder={t("pinPlaceholder")} value={form.recoveryPin} onChange={(e) => setForm({ ...form, recoveryPin: sanitizeRecoverySecret(e.target.value) })} error={errors.recoveryPin} hint={t("pinHint")} />
          <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground"><input type="checkbox" checked={form.accepted} onChange={(e) => setForm({ ...form, accepted: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(0.55_0.2_300)]" />{t("notice")}</label>
          {errors.accepted && <p className="text-xs text-destructive">{errors.accepted}</p>}
          <Button size="lg" className="w-full" type="submit" disabled={loading || (billing.billingEnabled && selectedPlanHasPix && !paymentMethod)}>
            {loading ? t(billing.billingEnabled ? "checkoutLoading" : "loading") : billing.billingEnabled && selectedPlanHasPix ? paymentMethod === "pix" ? t("continueWithPix") : paymentMethod === "card" ? t("continueWithCard") : t("choosePaymentMethodCta") : billing.billingEnabled ? t("continuePlan") : t("createFree")}
          </Button>
        </form>}
        {mode === "verify" && <form className="space-y-6" onSubmit={confirmCode}><div><h3 className="text-2xl font-bold">{t("confirmEmailTitle")}</h3><p className="mt-3 text-sm text-muted-foreground">{t("emailSent")} <span className="text-foreground">{normalizeEmail(form.email)}</span></p></div><VerificationCodeInput autoFocus label={t("verificationCode")} value={form.code} onChange={(code) => setForm({ ...form, code })} error={errors.code} /><Button size="lg" className="w-full" type="submit" disabled={loading}>{loading ? t("loading") : t("confirmCode")}</Button><div className="space-y-2 text-center text-xs text-muted-foreground"><button type="button" disabled={cooldown > 0 || loading || !pending} onClick={() => pending && sendVerification(pending)} className="text-foreground/80 disabled:text-muted-foreground">{cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resendCode")}</button><br /><button type="button" onClick={() => resetPanel(pending?.mode || "register")} className="text-primary hover:underline">{t("changeEmail")}</button></div></form>}
        {mode === "recover" && <SimpleForm title={t("recoverTitle")} email={form.email} pin={form.recoveryPin} errors={errors} t={t} loading={loading} submitText="recoverSubmit" onBack={() => resetPanel("register")} onEmail={(email) => setForm({ ...form, email })} onPin={(recoveryPin) => setForm({ ...form, recoveryPin })} onSubmit={(e) => submitSimple(e, "recover")} />}
        {mode === "payment-status" && <SimpleForm title={t("paymentStatusTitle")} email={form.email} errors={errors} t={t} loading={loading} submitText="paymentStatusSubmit" hint={t("paymentStatusHint")} onBack={() => resetPanel("register")} onEmail={(email) => setForm({ ...form, email })} onSubmit={(e) => submitSimple(e, "payment-status")} />}
        {mode === "billing-portal" && <SimpleForm title={t("billingPortalTitle")} email={form.email} pin={form.recoveryPin} errors={errors} t={t} loading={loading} submitText="billingPortalSubmit" hint={t("billingPortalHint")} onBack={() => resetPanel("register")} onEmail={(email) => setForm({ ...form, email })} onPin={(recoveryPin) => setForm({ ...form, recoveryPin })} onSubmit={(e) => submitSimple(e, "billing-portal")} />}
        {mode === "success" && success && <SuccessPanel success={success} copied={copied} setCopied={setCopied} t={t} />}
        {mode === "pix" && pixOrder && <PixPaymentPanel order={pixOrder} plan={plan || pixOrder.planType} copied={pixCopied} checking={pixChecking} setCopied={setPixCopied} t={t} onRetry={() => checkPixStatus(pixOrder, true)} onNewPix={() => { setPixOrder(null); setMode("verify"); }} />}
        {mode === "payment-result" && paymentResult && <PaymentResultPanel paymentResult={paymentResult} t={t} onRetry={() => checkPaymentStatus(normalizeEmail(form.email))} onBack={() => resetPanel("register")} />}
        {message && <p className="mt-4 text-center text-sm text-muted-foreground">{message}</p>}
      </div></div></div>
    </>}
  </div><AccessModal open={accessOpen} sessionId={accessSessionId} locale={locale} t={t} onClose={() => { setAccessOpen(false); setAccessSessionId(null); }} onRecover={() => { setAccessOpen(false); setAccessSessionId(null); resetPanel("recover"); window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }} onBackToPlans={() => { setAccessOpen(false); setAccessSessionId(null); scrollToId("planos"); }} />{modal && <StatusModalView modal={modal} t={t} onClose={() => setModal(null)} />}</section>;
}

function VerificationCodeInput({ label, value, onChange, error, autoFocus }: { label: string; value: string; onChange: (value: string) => void; error?: string; autoFocus?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const setCode = (next: string, focusIndex?: number) => {
    const sanitized = next.replace(/\D/g, "").slice(0, 6);
    onChange(sanitized);
    if (typeof focusIndex === "number") {
      window.requestAnimationFrame(() => refs.current[Math.max(0, Math.min(5, focusIndex))]?.focus());
    }
  };

  return <div>
    <label className="text-sm font-medium text-foreground">{label}</label>
    <div className="mt-3 grid grid-cols-6 gap-2 sm:gap-3" role="group" aria-label={label}>
      {digits.map((digit, index) => <input
        key={index}
        ref={(node) => { refs.current[index] = node; }}
        autoFocus={autoFocus && index === 0}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={index === 0 ? "one-time-code" : "off"}
        aria-label={`${label} ${index + 1}`}
        value={digit.trim()}
        onChange={(event) => {
          const typed = event.target.value.replace(/\D/g, "");
          if (typed.length > 1) {
            setCode(value.slice(0, index) + typed + value.slice(index + 1), Math.min(5, index + typed.length));
            return;
          }
          const chars = value.padEnd(6, " ").slice(0, 6).split("");
          chars[index] = typed;
          setCode(chars.join(""), typed ? index + 1 : index);
        }}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && !digits[index].trim() && index > 0) {
            refs.current[index - 1]?.focus();
          }
          if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
          if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
        }}
        onPaste={(event) => {
          event.preventDefault();
          setCode(event.clipboardData.getData("text"), 5);
        }}
        className={cx(
          "h-12 rounded-xl border bg-background/70 text-center text-lg font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-14",
          error ? "border-destructive" : "border-border",
        )}
      />)}
    </div>
    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
  </div>;
}

function PaymentMethodSelector({ plan, monthlyCardTrial, paymentMethod, setPaymentMethod, error, t }: { plan: PlanType; monthlyCardTrial: BillingState["monthlyCardTrial"]; paymentMethod: PaymentMethod | null; setPaymentMethod: (value: PaymentMethod) => void; error?: string; t: TFn }) {
  const monthlyCardBody = monthlyCardTrial.enabled
    ? t("paymentCardMonthlyTrial", { days: monthlyCardTrial.days })
    : t("paymentCardMonthly");
  const methods: Array<{ value: PaymentMethod; title: string; body: string }> = [
    { value: "card", title: t("paymentCard"), body: plan === "monthly" ? monthlyCardBody : t("paymentCardLifetime") },
    { value: "pix", title: t("paymentPix"), body: plan === "monthly" ? t("paymentPixMonthly") : t("paymentPixLifetime") },
  ];

  return <fieldset>
    <legend className="text-sm font-medium text-foreground">{t("paymentMethodTitle")}</legend>
    <p className="mt-1 text-xs text-muted-foreground">{plan === "monthly" ? t("paymentMethodMonthlyHint") : t("paymentMethodLifetimeHint")}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("paymentMethodTitle")}>
      {methods.map((method) => {
        const selected = paymentMethod === method.value;
        return <button
          key={method.value}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => setPaymentMethod(method.value)}
          className={cx(
            "rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            selected ? "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_oklch(0.55_0.2_300/14%)]" : "border-border bg-background/35 hover:border-primary/30",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">{method.title}</span>
            <span aria-hidden className={cx("h-3.5 w-3.5 rounded-full border", selected ? "border-primary bg-primary shadow-[inset_0_0_0_3px_oklch(0.20_0.02_275)]" : "border-muted-foreground/40")} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{method.body}</p>
        </button>;
      })}
    </div>
    {plan === "monthly" && paymentMethod === "pix" && <div className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.045] px-4 py-3"><p className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">{t("pixNoAutoTitle")}</span> {t("pixNoAutoBody")}</p></div>}
    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
  </fieldset>;
}

function PixPaymentPanel({ order, plan, copied, checking, setCopied, t, onRetry, onNewPix }: { order: PixOrder; plan: PlanType; copied: boolean; checking: boolean; setCopied: (value: boolean) => void; t: TFn; onRetry: () => void; onNewPix: () => void }) {
  const isExpired = order.status === "expired";
  const isFailed = order.status === "failed";
  const qrSrc = order.qrCodeBase64 ? `data:image/png;base64,${order.qrCodeBase64}` : "";

  return <div>
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">{t("paymentPix")}</p>
      <h3 className="mt-2 text-2xl font-bold">{isExpired ? t("pixExpiredTitle") : isFailed ? t("pixErrorTitle") : t("pixPayTitle")}</h3>
      <p className="mx-auto mt-3 max-w-[430px] text-sm leading-relaxed text-muted-foreground">{isExpired ? t("pixExpiredBody") : isFailed ? t("pixErrorBody") : plan === "monthly" ? t("pixMonthlyBody") : t("pixLifetimeBody")}</p>
    </div>

    {!isExpired && !isFailed && <div className="mx-auto mt-7 grid h-[210px] w-[210px] place-items-center rounded-2xl border border-border bg-white p-4">
      {qrSrc ? <img src={qrSrc} alt={t("pixQrAlt")} className="h-full w-full object-contain" /> : <div className="h-full w-full rounded-lg bg-background/10" aria-label={t("pixQrAlt")} />}
    </div>}

    {!isExpired && !isFailed && <div className="mt-6 rounded-xl border border-border bg-background/50 p-4">
      <p className="text-xs text-muted-foreground">{t("pixCopyLabel")}</p>
      <div className="mt-2 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">{order.qrCode}</p>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(order.qrCode); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }} className="shrink-0 text-sm font-medium text-primary hover:underline">{copied ? t("copiedShort") : t("copy")}</button>
      </div>
    </div>}

    {!isExpired && !isFailed && <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" />{t("pixWaiting")}</div>}
    {!isExpired && !isFailed && plan === "monthly" && <p className="mx-auto mt-4 max-w-[430px] text-center text-xs leading-relaxed text-muted-foreground/80">{t("pixMonthlyFootnote")}</p>}
    <div className="mt-6 grid gap-3">
      {isExpired ? <Button size="lg" className="w-full" type="button" onClick={onNewPix}>{t("pixGenerateNew")}</Button> : <Button variant="outline" className="w-full" type="button" onClick={onRetry} disabled={checking}>{checking ? t("checkingPaymentStatus") : t("paymentStatusRetry")}</Button>}
    </div>
  </div>;
}

function SimpleForm({ title, email, pin, errors, hint, t, loading, submitText, onBack, onEmail, onPin, onSubmit }: { title: string; email: string; pin?: string; errors: Record<string, string>; hint?: string; t: TFn; loading: boolean; submitText: string; onBack: () => void; onEmail: (email: string) => void; onPin?: (pin: string) => void; onSubmit: (event: React.FormEvent) => void }) {
  return <form className="space-y-6" onSubmit={onSubmit}>
    <h3 className="text-2xl font-bold">{title}</h3>
    <FormField label={t("email")} type="email" value={email} placeholder={t("emailPlaceholder")} onChange={(e) => onEmail(e.target.value)} error={errors.email} hint={hint} />
    {onPin && <FormField label={t("recoveryPin")} type="password" autoComplete="current-password" value={pin || ""} placeholder={t("pinPlaceholder")} onChange={(e) => onPin(sanitizeRecoverySecret(e.target.value))} error={errors.recoveryPin} hint={t("pinHint")} />}
    <Button size="lg" className="w-full" type="submit" disabled={loading}>{loading ? t("loading") : t(submitText)}</Button>
    <Button variant="outline" className="w-full" type="button" onClick={onBack}>{t("backToCreate")}</Button>
  </form>;
}

function SuccessPanel({ success, copied, setCopied, t }: { success: { title: string; licenseKey: string; recoveryPin?: string | null }; copied: boolean; setCopied: (value: boolean) => void; t: TFn }) {
  return <div className="py-2 text-center">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-2xl text-primary">✓</div>
    <h3 className="mt-6 text-2xl font-bold">{success.title}</h3>
    <p className="mt-3 text-sm text-muted-foreground">{t("successDescription")}</p>
    <div className="mt-8 rounded-xl border border-border bg-background/50 p-5 text-left"><p className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("keyLabel")}</p><p className="mt-3 break-all font-mono text-lg text-foreground">{success.licenseKey}</p><Button variant="outline" className="mt-4 w-full" onClick={() => { navigator.clipboard?.writeText(success.licenseKey); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}>{copied ? t("copied") : t("copyKey")}</Button></div>
    {success.recoveryPin && <div className="mt-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-left"><p className="text-xs text-yellow-200">{t("pinFinalNotice")}</p><p className="mt-2 font-mono text-lg font-bold">{success.recoveryPin}</p></div>}
    <a className="mt-6 inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground" href={DOWNLOAD_URL}>{t("downloadMerlin")}</a>
  </div>;
}

function PaymentResultPanel({ paymentResult, t, onRetry, onBack }: { paymentResult: PaymentResult; t: TFn; onRetry: () => void; onBack: () => void }) {
  return <div className="py-2 text-center">
    <div className={cx("mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-xl text-primary", paymentResult.status === "processing" && "text-yellow-300", paymentResult.status === "not_found" && "text-muted-foreground")}>{paymentResult.licenseKey ? "✓" : paymentResult.status === "processing" ? "..." : "!"}</div>
    <h3 className="mt-6 text-2xl font-bold">{paymentResult.title}</h3><p className="mx-auto mt-3 max-w-[420px] text-sm text-muted-foreground">{paymentResult.text}</p>
    {paymentResult.licenseKey && <div className="mt-8 rounded-xl border border-border bg-background/50 p-5 text-left"><p className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("keyLabel")}</p><p className="mt-3 break-all font-mono text-lg text-foreground">{paymentResult.licenseKey}</p><Button variant="outline" className="mt-4 w-full" onClick={() => navigator.clipboard?.writeText(paymentResult.licenseKey)}>{t("copyKey")}</Button></div>}
    <div className="mt-6 grid gap-3">{paymentResult.licenseKey ? <a className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground" href={DOWNLOAD_URL}>{t("downloadMerlin")}</a> : <Button size="lg" className="w-full" onClick={onRetry}>{t("paymentStatusRetry")}</Button>}<Button variant="outline" className="w-full" onClick={onBack}>{t("backToCreate")}</Button></div>
  </div>;
}

function AccessModal({ open, sessionId, locale, t, onClose, onRecover, onBackToPlans }: { open: boolean; sessionId: string | null; locale: Locale; t: TFn; onClose: () => void; onRecover: () => void; onBackToPlans: () => void }) {
  const [step, setStep] = useState<AccessStep>("identify");
  const [email, setEmail] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [access, setAccess] = useState<AccessDetailsPayload | null>(null);
  const [upgradeStatus, setUpgradeStatus] = useState<"processing" | "completed" | "expired">("processing");
  const [renewalPixOrder, setRenewalPixOrder] = useState<PixOrder | null>(null);
  const [renewalPixCopied, setRenewalPixCopied] = useState(false);
  const [renewalPixChecking, setRenewalPixChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage("");
    setLoading(false);
    setCode("");
    setAccess(null);
    setRenewalPixOrder(null);
    setRenewalPixCopied(false);
    if (sessionId) {
      setStep("upgrade-status");
      setUpgradeStatus("processing");
    } else {
      setStep("identify");
      const remembered = localStorage.getItem("merlin_checkout_email") || "";
      setEmail((value) => value || remembered);
    }
  }, [open, sessionId]);

  useEffect(() => {
    if (!open || cooldown <= 0) return undefined;
    const id = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [open, cooldown]);

  useEffect(() => {
    if (!open || !sessionId || step !== "upgrade-status") return undefined;
    let canceled = false;
    async function poll() {
      for (let attempt = 0; attempt < 15 && !canceled; attempt += 1) {
        try {
          const payload = await fetch(`/api/public/access/upgrade-status?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json());
          if (payload?.success !== false && payload.status === "completed") { setUpgradeStatus("completed"); return; }
          if (payload?.success !== false && payload.status === "expired") { setUpgradeStatus("expired"); return; }
        } catch { /* checkout may still be settling */ }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      if (!canceled) setUpgradeStatus("processing");
    }
    void poll();
    return () => { canceled = true; };
  }, [open, sessionId, step]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    const next: Record<string, string> = {};
    if (!validEmail(email)) next.email = t("errorEmail");
    if (!validRecoverySecret(recoveryPin)) next.recoveryPin = t("errorPin");
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true); setMessage(t("sendingCode"));
    try {
      const normalized = normalizeEmail(email);
      const payload = await postJson<{ cooldownSeconds?: number }>("/api/public/email-verification/start", { email: normalized }, t("genericError"));
      setEmail(normalized); setCooldown(Number(payload.cooldownSeconds || 60)); setStep("verify"); setMessage(t("emailCodeSent"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("genericError")); }
    finally { setLoading(false); }
  }

  async function loadAccess() {
    const payload = await postJson<AccessDetailsPayload>("/api/public/access/me", { email: normalizeEmail(email), recoveryPin }, t("genericError"));
    setAccess(payload); setStep("details"); setMessage("");
  }

  async function confirmAccess(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setErrors({ code: t("errorCode") }); return; }
    setLoading(true); setErrors({}); setMessage(t("loading"));
    try {
      await postJson("/api/public/email-verification/verify", { email: normalizeEmail(email), code: code.trim() }, t("genericError"));
      await loadAccess();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("genericError")); }
    finally { setLoading(false); }
  }

  async function startUpgrade() {
    setLoading(true); setMessage(t("checkoutLoading"));
    try {
      const payload = await postJson<{ checkoutUrl: string }>("/api/public/access/upgrade-checkout", { email: normalizeEmail(email), recoveryPin }, t("genericError"));
      window.location.href = payload.checkoutUrl;
    } catch (error) { setMessage(error instanceof Error ? error.message : t("genericError")); setLoading(false); }
  }

  async function openMonthlyPortal() {
    setLoading(true); setMessage(t("loading"));
    try {
      const payload = await postJson<{ portalUrl?: string }>("/api/public/access/billing-portal", { email: normalizeEmail(email), recoveryPin }, t("billingPortalUnavailable"));
      if (!payload.portalUrl) throw new Error(t("billingPortalUnavailable"));
      window.location.href = payload.portalUrl;
    } catch (error) { setMessage(error instanceof Error ? error.message : t("billingPortalUnavailable")); setLoading(false); }
  }

  async function startMonthlyRenewal(method: PaymentMethod) {
    const current = access?.access;
    if (!current?.name) return;
    setLoading(true); setMessage(method === "pix" ? t("pixCreating") : t("checkoutLoading"));
    try {
      const body = {
        name: current.name,
        contact: normalizeEmail(email),
        recoveryPin,
        acceptedRecoveryNotice: true,
        planType: "monthly" as const,
      };
      if (method === "pix") {
        const payload = await postJson<PixOrder>("/api/public/pix/orders", { ...body, mercadoPagoDeviceId: getMercadoPagoDeviceId() }, t("genericError"));
        localStorage.setItem("merlin_checkout_email", normalizeEmail(email));
        setRenewalPixOrder(payload);
        setRenewalPixCopied(false);
        setMessage("");
        setLoading(false);
        return;
      }
      const payload = await postJson<{ checkoutUrl: string }>("/api/public/checkout", body, t("genericError"));
      localStorage.setItem("merlin_checkout_email", normalizeEmail(email));
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("genericError"));
      setLoading(false);
    }
  }

  async function checkRenewalPixStatus(order: PixOrder, manual = false) {
    if (manual) setRenewalPixChecking(true);
    try {
      const payload = await fetch(`/api/public/pix/orders/${encodeURIComponent(order.paymentIntentId)}/status`).then((r) => r.json());
      if (payload.status === "paid" && payload.license) {
        setAccess((value) => value ? {
          ...value,
          access: value.access ? {
            ...value.access,
            current: true,
            billingStatus: "active",
            expiresAt: payload.license.expiresAt,
            renewal: { ...(value.access.renewal || { available: false }), available: false },
          } : value.access,
        } : value);
        setRenewalPixOrder(null);
        setMessage(t("paymentApprovedText"));
        return "paid";
      }
      if (payload.status === "expired") {
        setRenewalPixOrder((value) => value ? { ...value, status: "expired" } : value);
        return "expired";
      }
      if (payload.status === "failed") {
        setRenewalPixOrder((value) => value ? { ...value, status: "failed" } : value);
        return "failed";
      }
    } catch (error) {
      if (manual) setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      if (manual) setRenewalPixChecking(false);
    }
    return "awaiting_payment";
  }

  useEffect(() => {
    if (!open || !renewalPixOrder || renewalPixOrder.status !== "awaiting_payment") return undefined;
    let canceled = false;
    const id = window.setInterval(() => {
      if (!canceled) void checkRenewalPixStatus(renewalPixOrder);
    }, 3500);
    return () => { canceled = true; window.clearInterval(id); };
  }, [open, renewalPixOrder?.paymentIntentId, renewalPixOrder?.status]);

  if (!open) return null;
  const current = access?.access;
  const subscription = current?.subscription;
  const isMonthly = current?.kind === "monthly";
  const isLifetime = current?.kind === "lifetime";
  const upgradePrice = current?.upgrade?.price ? formatMoney(locale, current.upgrade.price) : "";

  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
    <div className="max-h-[calc(100vh-32px)] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">{t("myAccess")}</p><h3 className="mt-2 text-2xl font-bold">{step === "upgrade-status" ? t("upgradeStatusTitle") : t("accessModalTitle")}</h3></div><button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" aria-label="Fechar">x</button></div>
      {step === "identify" && <form className="mt-6 space-y-5" onSubmit={sendCode}><p className="text-sm leading-relaxed text-muted-foreground">{t("accessIdentifyBody")}</p><FormField label={t("email")} type="email" value={email} placeholder={t("emailPlaceholder")} onChange={(event) => setEmail(event.target.value)} error={errors.email} /><FormField label={t("recoveryPin")} type="password" autoComplete="current-password" value={recoveryPin} placeholder={t("pinPlaceholder")} onChange={(event) => setRecoveryPin(sanitizeRecoverySecret(event.target.value))} error={errors.recoveryPin} hint={t("pinHint")} /><Button size="lg" className="w-full" type="submit" disabled={loading}>{loading ? t("loading") : t("accessContinue")}</Button></form>}
      {step === "verify" && <form className="mt-6 space-y-5" onSubmit={confirmAccess}><p className="text-sm leading-relaxed text-muted-foreground">{t("emailSent")} <span className="text-foreground">{normalizeEmail(email)}</span></p><VerificationCodeInput autoFocus label={t("verificationCode")} value={code} onChange={setCode} error={errors.code} /><Button size="lg" className="w-full" type="submit" disabled={loading}>{loading ? t("loading") : t("confirmCode")}</Button><div className="text-center text-xs text-muted-foreground"><button type="button" disabled={cooldown > 0 || loading} onClick={() => sendCode()} className="text-foreground/80 disabled:text-muted-foreground">{cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resendCode")}</button></div></form>}
      {step === "details" && access?.status === "not_found" && <div className="mt-7 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-border bg-background/50 text-lg">!</div><h4 className="mt-5 text-xl font-bold">{t("accessNotFoundTitle")}</h4><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("accessNotFoundBody")}</p><Button className="mt-6 w-full" onClick={onBackToPlans}>{t("backToCreate")}</Button></div>}
      {step === "details" && renewalPixOrder && <div className="mt-7"><PixPaymentPanel order={renewalPixOrder} plan="monthly" copied={renewalPixCopied} checking={renewalPixChecking} setCopied={setRenewalPixCopied} t={t} onRetry={() => checkRenewalPixStatus(renewalPixOrder, true)} onNewPix={() => startMonthlyRenewal("pix")} /></div>}
      {step === "details" && current && !renewalPixOrder && <div className="mt-7 space-y-5">
        <div className="rounded-xl border border-border bg-background/50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs text-muted-foreground">{t("currentPlan")}</p><p className="mt-1 text-lg font-bold">{isMonthly ? t("monthlyTitle") : isLifetime ? t("lifetimeTitle") : t("activeAccessTitle")}</p></div>
            <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{accessStatusLabel(t, current.current === false ? "expired" : current.billingStatus || subscription?.status)}</span>
          </div>
          {isMonthly && <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><InfoItem label={current.current === false || subscription?.cancelAtPeriodEnd ? t("availableUntil") : t("nextRenewal")} value={formatDate(locale, subscription?.currentPeriodEnd || current.expiresAt)} /><InfoItem label={t("renewalLabel")} value={current.current === false ? t("renewalExpired") : subscription?.canManage ? subscription?.cancelAtPeriodEnd ? t("renewalCanceled") : t("renewalAutomatic") : t("renewalManual") } /></div>}
          {isLifetime && <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{t("accessLifetimeBody")}</p>}
          {isMonthly && current.current !== false && !subscription?.canManage && <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{t("monthlyActiveWaitBody")}</p>}
        </div>
        {isMonthly && current.current === false && current.renewal?.available && <div className="rounded-xl border border-primary/35 bg-primary/10 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">{t("renewAccessEyebrow")}</p>
          <h4 className="mt-2 text-xl font-bold">{t("renewAccessTitle")}</h4>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("renewAccessBody")}</p>
          {current.renewal.price && <p className="mt-5 font-display text-3xl font-bold">{formatMoney(locale, current.renewal.price)}</p>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {current.renewal.card && <Button size="lg" onClick={() => startMonthlyRenewal("card")} disabled={loading}>{loading ? t("loading") : t("continueWithCard")}</Button>}
            {current.renewal.pix && <Button variant="outline" size="lg" onClick={() => startMonthlyRenewal("pix")} disabled={loading}>{loading ? t("loading") : t("continueWithPix")}</Button>}
          </div>
        </div>}
        {isMonthly && current.current === false && !current.renewal?.available && <div className="rounded-xl border border-border bg-background/50 p-5"><p className="text-sm leading-relaxed text-muted-foreground">{t("renewUnavailableBody")}</p></div>}
        {isMonthly && current.upgrade?.available && <div className="rounded-xl border border-primary/35 bg-primary/10 p-5"><p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">{t("upgradeCardEyebrow")}</p><h4 className="mt-2 text-xl font-bold">{t("upgradeCardTitle")}</h4><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("upgradeCardBody")}</p><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="font-display text-3xl font-bold">{upgradePrice}</p><Button size="lg" onClick={startUpgrade} disabled={loading}>{loading ? t("loading") : t("upgradeCta")}</Button></div></div>}
        {isMonthly && current.current !== false && subscription?.canManage && <Button variant="outline" className="w-full" onClick={openMonthlyPortal} disabled={loading}>{t("openMonthlyOptions")}</Button>}
        {isLifetime && <div className="grid gap-3 sm:grid-cols-2"><a className="inline-flex h-13 items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground" href={DOWNLOAD_URL}>{t("downloadMerlin")}</a><Button variant="outline" onClick={onRecover}>{t("recoverMyKey")}</Button></div>}
      </div>}
      {step === "upgrade-status" && <div className="mt-7 text-center"><div className={cx("mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-lg text-primary", upgradeStatus === "processing" && "text-yellow-300", upgradeStatus === "expired" && "text-muted-foreground")}>{upgradeStatus === "completed" ? "OK" : upgradeStatus === "expired" ? "!" : "..."}</div><h4 className="mt-5 text-xl font-bold">{upgradeStatus === "completed" ? t("upgradeApprovedTitle") : upgradeStatus === "expired" ? t("upgradeExpiredTitle") : t("upgradeProcessingTitle")}</h4><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{upgradeStatus === "completed" ? t("upgradeApprovedBody") : upgradeStatus === "expired" ? t("upgradeExpiredBody") : t("upgradeProcessingBody")}</p><div className="mt-6 grid gap-3">{upgradeStatus === "completed" && <a className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground" href={DOWNLOAD_URL}>{t("downloadMerlin")}</a>}<Button variant="outline" className="w-full" onClick={onClose}>{t("modalClose")}</Button></div></div>}
      {message && <p className="mt-5 text-center text-sm text-muted-foreground">{message}</p>}
    </div>
  </div>;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card/60 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-foreground">{value}</p></div>;
}
function StatusModalView({ modal, t, onClose }: { modal: NonNullable<StatusModal>; t: TFn; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}><div className="w-full max-w-[390px] rounded-2xl border border-border bg-card p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}><div className={cx("mx-auto grid h-13 w-13 place-items-center rounded-full bg-primary text-lg font-bold", modal.tone === "warn" && "bg-yellow-500", modal.tone === "error" && "bg-red-500")}>{modal.tone === "ok" ? "✓" : "!"}</div><h3 className="mt-5 text-2xl font-bold">{modal.title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{modal.text}</p><Button className="mt-6 w-full" onClick={onClose}>{t("modalClose")}</Button></div></div>;
}

export function App() {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());
  const [billing, setBilling] = useState<BillingState>(INITIAL_BILLING_STATE);
  const [version, setVersion] = useState("");
  const dict = useMemo(() => ({ ...dictionaries.en, ...dictionaries[locale] }), [locale]);
  const t = useCallback((key: string, vars: Record<string, string | number> = {}) => {
    let value = dict[key] || dictionaries.en[key] || key;
    Object.entries(vars).forEach(([name, replacement]) => { value = value.replace(`{${name}}`, String(replacement)); });
    return value;
  }, [dict]);
  const setLocale = (value: Locale) => { setLocaleState(value); localStorage.setItem("merlin_public_language", value); };
  const purchaseAvailable = canPurchaseAccess(billing);

  useEffect(() => {
    fetch("/api/billing/settings-public").then((r) => r.json()).then((payload) => setBilling(parseBillingPayload(payload))).catch(() => setBilling((value) => ({ ...value, loaded: true })));
    fetch("/api/updates/latest").then((r) => r.json()).then((payload) => setVersion(payload?.version ? String(payload.version) : "")).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ptbr" ? "pt-BR" : locale;
    document.title = t("metaTitle");
  }, [locale, t]);

  return <div className="min-h-screen bg-background"><AppHeader locale={locale} setLocale={setLocale} purchaseAvailable={purchaseAvailable} t={t} /><main>
    <Hero purchaseAvailable={purchaseAvailable} t={t} />
    <section id="o-que-e" className="relative overflow-hidden bg-surface section-y"><div className="container-merlin relative"><div aria-hidden className="aura pointer-events-none absolute -right-24 top-1/2 hidden h-72 w-72 -translate-y-1/2 rounded-full md:block" /><div className="relative max-w-[640px]"><SectionTitle>{t("whatTitle")}</SectionTitle><p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">{t("whatBody1")}</p><p className="mt-5 text-base leading-relaxed text-foreground/80 sm:text-lg">{t("whatBody2")}</p></div></div></section>
    <section id="como-funciona" className="section-y"><div className="container-merlin"><div className="mx-auto max-w-[640px] text-center"><SectionTitle center>{t("videoTitle")}</SectionTitle><p className="mt-4 text-muted-foreground">{t("videoBody")}</p></div><div className="mx-auto mt-12 w-full max-w-[390px] sm:max-w-[420px]"><div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-[0_18px_70px_rgba(124,58,237,0.08)]"><iframe className="absolute inset-0 h-full w-full" src="https://www.youtube-nocookie.com/embed/QjFRHpB16DY?rel=0" title={t("videoIframeTitle")} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div></div><div className="mt-10 flex justify-center"><MarketingCta purchaseAvailable={purchaseAvailable} t={t} size="lg" /></div></div></section>
    <section id="seguranca" className="bg-surface section-y"><div className="container-merlin"><SectionTitle>{t("securityTitle")}</SectionTitle><div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-14"><div><h3 className="text-xl font-bold">{t("securityTransparencyTitle")}</h3><p className="mt-4 leading-relaxed text-muted-foreground">{t("securityTransparencyBody")}</p></div><div><h3 className="text-xl font-bold">{t("securityBanTitle")}</h3><p className="mt-4 leading-relaxed text-muted-foreground">{t("securityBanBody")}</p></div></div><div className="mt-12"><MarketingCta purchaseAvailable={purchaseAvailable} t={t} size="lg" /></div></div></section>
    <section className="section-y"><div className="container-merlin"><SectionTitle className="max-w-[620px]">{t("compatibilityTitle")}</SectionTitle><div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{COMPAT_CARDS.map((card) => <div key={card.title} className={cx("flex h-full flex-col rounded-2xl border bg-card p-7 sm:p-8", card.accent ? "border-primary/25" : "border-border")}><div className={cx("flex h-[74px] w-[74px] items-center justify-center rounded-2xl border p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_30px_rgba(0,0,0,0.25)]", card.accent ? "border-primary/35 bg-primary/10" : "border-primary/20 bg-white/[0.035]")}><img src={card.icon} alt={card.alt} loading="lazy" decoding="async" className="h-full w-full object-contain [filter:drop-shadow(0_0_10px_rgba(139,92,246,0.18))_brightness(1.14)_contrast(1.12)_saturate(1.08)]" /></div><h3 className="mt-6 text-lg font-bold">{t(card.title)}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(card.body)}</p></div>)}</div></div></section>
    <div className="bg-surface"><Feedbacks purchaseAvailable={purchaseAvailable} t={t} /></div><Plans locale={locale} t={t} billing={billing} version={version} />
    <section className="relative overflow-hidden section-y"><div aria-hidden className="aura pointer-events-none absolute left-1/2 top-1/2 h-64 w-[min(90%,640px)] -translate-x-1/2 -translate-y-1/2 rounded-full" /><div className="container-merlin relative"><div className="mx-auto max-w-[680px] text-center"><SectionTitle center>{t("finalTitle")}</SectionTitle><p className="mt-5 text-muted-foreground">{t("finalBody")}</p><div className="mt-9 flex justify-center"><MarketingCta purchaseAvailable={purchaseAvailable} t={t} size="lg" /></div></div></div></section>
    <footer className="border-t border-border py-10"><div className="container-merlin flex flex-col items-center gap-6 sm:flex-row sm:justify-between"><div className="flex items-center gap-2"><img src={`${ASSET_BASE}/assets/branding/merlin-logo.png`} alt="Merlin" className="h-8 w-8 object-contain object-top sm:h-9 sm:w-9" /><span className="font-display text-base font-bold sm:text-lg">Merlin</span></div><nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground"><a href={DOWNLOAD_URL} className="transition-colors hover:text-foreground">Download</a><a href="https://www.instagram.com/merlin.launcher/" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">Instagram</a><a href="https://www.tiktok.com/@merlin.launcher" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">TikTok</a><a href="https://github.com/azteka-merlin/" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">GitHub</a></nav><p className="text-xs text-muted-foreground">{t("footerRights")}</p></div></footer>
  </main></div>;
}
