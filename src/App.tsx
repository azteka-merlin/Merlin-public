import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Clock, Menu, X, Zap } from "lucide-react";
import { FaTiktok, FaTwitch, FaYoutube } from "react-icons/fa6";
import { dictionaries, initialLocale, type Locale } from "./i18n";
import {
  ChangeView,
  Overview,
  PreviewView,
  StateBanner,
  StatusPill,
} from "./poc/MeuAcessoPoc";
import type {
  PocPeriod,
  PocScenario,
  PocStatus,
  PocTier,
} from "./poc/accessScenarios";
import {
  ASSET_BASE,
  DOWNLOAD_URL,
  Button,
  FormField,
  SectionTitle,
  cx,
  formatMoney,
  normalizeEmail,
  postJson,
  scrollToId,
  validEmail,
  type BillingPrice,
} from "./ui";

type PlanType = "monthly" | "annual" | "lifetime";
type PlanTier = "bronze" | "prata" | "ouro";
type BillingPeriod = "monthly" | "annual";
type PaymentMethod = "card" | "pix";
type FlowMode =
  | "register"
  | "recover"
  | "payment-status"
  | "billing-portal"
  | "verify"
  | "success"
  | "payment-result"
  | "pix";
type PendingMode = "register" | "recover" | "payment-status" | "billing-portal";

type BillingState = {
  signupEnabled: boolean;
  billingEnabled: boolean;
  plansEnabled: boolean;
  monthlyEnabled: boolean;
  annualEnabled: boolean;
  lifetimeEnabled: boolean;
  monthlyCardTrial: { enabled: boolean; days: number };
  paymentMethods: {
    card: boolean;
    pix: boolean;
    pixMonthly: boolean;
    pixAnnual: boolean;
    pixLifetime: boolean;
  };
  prices: Record<PlanType, BillingPrice | null> & {
    pixAnnual: BillingPrice | null;
    pixLifetime: BillingPrice | null;
  };
  planPrices: PlanPrice[];
  loaded: boolean;
};

type PlanPrice = {
  paymentMethod: PaymentMethod;
  planTier: PlanTier;
  billingPeriod: BillingPeriod;
  amountCents: number;
  currency: string;
  active: boolean;
};

type PendingAction = {
  mode: PendingMode;
  data: Record<string, string | boolean>;
  verified?: boolean;
};
type StatusModal = {
  title: string;
  text: string;
  tone: "ok" | "warn" | "error";
} | null;
type PaymentResult = {
  status: string;
  title: string;
  text: string;
  licenseKey: string;
};
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
    kind: "monthly" | "annual" | "lifetime" | "active";
    name?: string;
    current?: boolean;
    accessType?: string;
    planTier?: PlanTier;
    billingStatus?: string;
    expiresAt?: string | null;
    subscription?: {
      status?: string;
      currentPeriodEnd?: string | null;
      cancelAtPeriodEnd?: boolean;
      canManage?: boolean;
    } | null;
    upgrade?: {
      available: boolean;
      reason?: string | null;
      price?: BillingPrice | null;
    };
    renewal?: {
      available: boolean;
      card?: boolean;
      pix?: boolean;
      price?: BillingPrice | null;
    };
    planChange?: {
      status: "pending_payment" | "scheduled" | "not_completed";
      targetTier: PlanTier;
      targetPeriod: BillingPeriod;
      timing: "immediate" | "period_end";
      effectiveAt?: string | null;
      canCancel?: boolean;
    } | null;
  };
};
type AccessStep = "identify" | "verify" | "details" | "upgrade-status";
type AccessPlanChangeView = "overview" | "change" | "preview" | "replace";
type PublicPlanChangePreview = {
  currentTier: PlanTier;
  currentPeriod: BillingPeriod;
  targetTier: PlanTier;
  targetPeriod: BillingPeriod;
  targetAmountCents: number;
  amountDueNowCents: number | null;
  targetCurrency: string;
  changeType: "upgrade" | "downgrade" | "interval_change";
  timing: "immediate" | "period_end";
  requiresPaymentConfirmation: boolean;
};

type PublicPlanChangeResponse<
  T extends
    | PublicPlanChangePreview
    | {
        status: "pending_payment" | "scheduled" | "applied";
        checkoutUrl?: string;
      },
> = {
  success: true;
  planChange: T;
};

function isAcceptedVerificationCode(value: string) {
  return /^\d{6}$/.test(value) || value === "12345";
}
type TFn = (key: string, vars?: Record<string, string | number>) => string;

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
  }
}
const INITIAL_BILLING_STATE: BillingState = {
  signupEnabled: false,
  billingEnabled: false,
  plansEnabled: false,
  monthlyEnabled: false,
  annualEnabled: false,
  lifetimeEnabled: false,
  monthlyCardTrial: { enabled: false, days: 30 },
  paymentMethods: {
    card: true,
    pix: false,
    pixMonthly: false,
    pixAnnual: false,
    pixLifetime: false,
  },
  prices: {
    monthly: null,
    annual: null,
    lifetime: null,
    pixAnnual: null,
    pixLifetime: null,
  },
  planPrices: [],
  loaded: false,
};

function parseBillingPayload(
  payload: any,
  planPrices: PlanPrice[] = [],
): BillingState {
  return {
    signupEnabled: Boolean(payload?.settings?.enabled),
    billingEnabled: Boolean(payload?.billing?.billingEnabled),
    plansEnabled: Boolean(payload?.billing?.plansEnabled),
    monthlyEnabled: Boolean(payload?.billing?.monthlyEnabled),
    annualEnabled: Boolean(payload?.billing?.annualEnabled),
    lifetimeEnabled: Boolean(payload?.billing?.lifetimeEnabled),
    monthlyCardTrial: {
      enabled: Boolean(payload?.billing?.monthlyCardTrial?.enabled),
      days: Number(payload?.billing?.monthlyCardTrial?.days) || 30,
    },
    paymentMethods: {
      card: payload?.billing?.paymentMethods?.card !== false,
      pix: Boolean(payload?.billing?.paymentMethods?.pix),
      pixMonthly:
        payload?.billing?.paymentMethods?.pixMonthly !== undefined
          ? Boolean(payload?.billing?.paymentMethods?.pixMonthly)
          : Boolean(payload?.billing?.paymentMethods?.pix),
      pixAnnual:
        payload?.billing?.paymentMethods?.pixAnnual !== undefined
          ? Boolean(payload?.billing?.paymentMethods?.pixAnnual)
          : Boolean(payload?.billing?.paymentMethods?.pix),
      pixLifetime:
        payload?.billing?.paymentMethods?.pixLifetime !== undefined
          ? Boolean(payload?.billing?.paymentMethods?.pixLifetime)
          : Boolean(payload?.billing?.paymentMethods?.pix),
    },
    prices: {
      monthly: payload?.billing?.prices?.monthly || null,
      annual: payload?.billing?.prices?.annual || null,
      lifetime: payload?.billing?.prices?.lifetime || null,
      pixAnnual: payload?.billing?.prices?.pixAnnual || null,
      pixLifetime: payload?.billing?.prices?.pixLifetime || null,
    },
    planPrices,
    loaded: true,
  };
}

function planPriceToBillingPrice(price: PlanPrice | null): BillingPrice | null {
  if (!price) return null;
  return {
    amountCents: price.amountCents,
    currency: price.currency || "brl",
    recurringInterval: price.billingPeriod === "annual" ? "year" : "month",
    active: price.active,
  };
}

function getTierPrice(
  billing: BillingState,
  paymentMethod: PaymentMethod,
  planTier: PlanTier | null,
  billingPeriod: BillingPeriod | null,
) {
  if (!planTier || !billingPeriod) return null;
  const price = billing.planPrices.find(
    (row) =>
      row.active &&
      row.paymentMethod === paymentMethod &&
      row.planTier === planTier &&
      row.billingPeriod === billingPeriod,
  );
  return planPriceToBillingPrice(price || null);
}

function tierCanBeSold(
  billing: BillingState,
  planTier: PlanTier | null,
  billingPeriod: BillingPeriod | null,
) {
  if (
    !billing.loaded ||
    !billing.signupEnabled ||
    !billing.billingEnabled ||
    !billing.plansEnabled ||
    !planTier ||
    !billingPeriod
  )
    return false;
  if (billingPeriod === "monthly" && !billing.monthlyEnabled) return false;
  if (billingPeriod === "annual" && !billing.annualEnabled) return false;
  const hasCard =
    billing.paymentMethods.card &&
    Boolean(getTierPrice(billing, "card", planTier, billingPeriod));
  const hasPix =
    billing.paymentMethods.pix &&
    (billingPeriod === "monthly"
      ? billing.paymentMethods.pixMonthly
      : billing.paymentMethods.pixAnnual) &&
    Boolean(getTierPrice(billing, "pix", planTier, billingPeriod));
  return hasCard || hasPix;
}

function planCanBeSold(billing: BillingState, plan: PlanType | null) {
  if (
    !billing.loaded ||
    !billing.signupEnabled ||
    !billing.billingEnabled ||
    !plan
  )
    return false;
  if (billing.plansEnabled && plan !== "lifetime") {
    return (["bronze", "prata", "ouro"] as PlanTier[]).some((tier) =>
      tierCanBeSold(billing, tier, plan),
    );
  }
  if (plan === "monthly")
    return billing.monthlyEnabled && Boolean(billing.prices.monthly);
  if (plan === "annual")
    return billing.annualEnabled && Boolean(billing.prices.annual);
  return billing.lifetimeEnabled && Boolean(billing.prices.lifetime);
}

function getPaymentPrice(
  billing: BillingState,
  plan: PlanType | null,
  paymentMethod: PaymentMethod | null,
  planTier: PlanTier | null = null,
) {
  if (
    billing.plansEnabled &&
    plan !== "lifetime" &&
    planTier &&
    (plan === "monthly" || plan === "annual")
  ) {
    const method =
      paymentMethod ||
      (getTierPrice(billing, "card", planTier, plan) ? "card" : "pix");
    return getTierPrice(billing, method, planTier, plan);
  }
  if (plan === "monthly") return billing.prices.monthly;
  if (plan === "annual" && paymentMethod === "pix")
    return billing.prices.pixAnnual || billing.prices.annual;
  if (plan === "annual") return billing.prices.annual;
  if (plan === "lifetime" && paymentMethod === "pix")
    return billing.prices.pixLifetime || billing.prices.lifetime;
  if (plan === "lifetime") return billing.prices.lifetime;
  return null;
}

function priceAmountCents(price: BillingPrice | null) {
  return Number(price?.amountCents) || 0;
}

function lifetimePixDiscountCents(prices: BillingState["prices"]) {
  const cardAmount = priceAmountCents(prices.lifetime);
  const pixAmount = priceAmountCents(prices.pixLifetime);
  return cardAmount > 0 && pixAmount > 0 && pixAmount < cardAmount
    ? cardAmount - pixAmount
    : 0;
}

function annualPixDiscountCents(prices: BillingState["prices"]) {
  const cardAmount = priceAmountCents(prices.annual);
  const pixAmount = priceAmountCents(prices.pixAnnual);
  return cardAmount > 0 && pixAmount > 0 && pixAmount < cardAmount
    ? cardAmount - pixAmount
    : 0;
}

function formatCents(locale: Locale, amountCents: number, currency = "brl") {
  return new Intl.NumberFormat(
    locale === "ptbr"
      ? "pt-BR"
      : locale === "de"
        ? "de-DE"
        : locale === "fr"
          ? "fr-FR"
          : locale === "es"
            ? "es-ES"
            : "en-US",
    {
      style: "currency",
      currency: currency.toUpperCase(),
    },
  ).format(amountCents / 100);
}

function getMercadoPagoDeviceId() {
  return typeof window !== "undefined" &&
    typeof window.MP_DEVICE_SESSION_ID === "string"
    ? window.MP_DEVICE_SESSION_ID.trim()
    : "";
}

function hasPaidPlans(billing: BillingState) {
  return (
    planCanBeSold(billing, "monthly") ||
    planCanBeSold(billing, "annual") ||
    planCanBeSold(billing, "lifetime")
  );
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
  return new Intl.DateTimeFormat(
    locale === "ptbr"
      ? "pt-BR"
      : locale === "de"
        ? "de-DE"
        : locale === "fr"
          ? "fr-FR"
          : locale === "es"
            ? "es-ES"
            : "en-US",
  ).format(date);
}

function accessStatusLabel(t: TFn, status?: string) {
  const value = String(status || "active").toLowerCase();
  if (value === "past_due") return t("statusPastDue");
  if (value === "canceled" || value === "cancelled") return t("statusCanceled");
  if (value === "expired") return t("statusExpired");
  if (value === "none") return t("statusNone");
  return t("statusActive");
}
type FeedbackItem = {
  id: string;
  src: string;
  title: string;
};

type Partner = {
  id: number;
  name: string;
  imageUrl: string | null;
  imageCropX: number | null;
  imageCropY: number | null;
  imageCropWidth: number | null;
  imageCropHeight: number | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  twitchUrl: string | null;
  sortOrder: number;
};

const FALLBACK_FEEDBACKS: FeedbackItem[] = [
  {
    id: "static-gris",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-gris.jpeg`,
    title: "Feedback real",
  },
  {
    id: "static-007",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-007.jpeg`,
    title: "Feedback real",
  },
  {
    id: "static-suporte",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-suporte.jpeg`,
    title: "Feedback real",
  },
  {
    id: "static-crimson-simples",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-crimson-simples.jpeg`,
    title: "Feedback real",
  },
  {
    id: "static-crimson-gameplay",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-crimson-gameplay.jpeg`,
    title: "Feedback real",
  },
  {
    id: "static-black-flag",
    src: `${ASSET_BASE}/assets/feedbacks/feedback-black-flag.jpeg`,
    title: "Feedback real",
  },
];

const COMPAT_CARDS = [
  {
    icon: `${ASSET_BASE}/assets/compatibility/icon-online.png`,
    title: "compatOnlineTitle",
    body: "compatOnlineBody",
    alt: "Controle de videogame com símbolo de conexão online",
  },
  {
    icon: `${ASSET_BASE}/assets/compatibility/icon-launchers.png`,
    title: "compatLauncherTitle",
    body: "compatLauncherBody",
    alt: "Janelas de aplicativo representando launchers externos",
  },
  {
    icon: `${ASSET_BASE}/assets/compatibility/icon-denuvo.png`,
    title: "compatDenuvoTitle",
    body: "compatDenuvoBody",
    alt: "Escudo com cadeado e circuitos representando proteção tecnológica",
    accent: true,
  },
];

function AppHeader({
  locale,
  setLocale,
  purchaseAvailable,
  t,
}: {
  locale: Locale;
  setLocale: (value: Locale) => void;
  purchaseAvailable: boolean;
  t: TFn;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const nav = [
    ["o-que-e", t("navWhat")],
    ["como-funciona", t("navHow")],
    ["seguranca", t("navSecurity")],
    ["feedbacks", t("navFeedbacks")],
    ["planos", t("navPlans")],
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const els = nav
      .map(([id]) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
    if (!els.length) return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [locale]);

  return (
    <header
      className={cx(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled ? "bg-background/70 backdrop-blur-md" : "bg-background/40",
      )}
    >
      <div className="container-merlin flex h-[74px] items-center justify-between gap-2 sm:h-[82px] lg:gap-4">
        <div className="flex min-w-0 items-center gap-2 lg:contents">
          <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/40 text-foreground transition-colors hover:border-primary/50 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
                aria-label={t("openMenu")}
              >
                <Menu aria-hidden="true" size={20} />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-[70] flex w-[min(22rem,calc(100vw-1rem))] flex-col border-r border-border bg-surface px-5 pb-6 pt-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in sm:px-6">
                <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
                  <Dialog.Title className="font-display text-xl font-bold tracking-tight">
                    Merlin
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    {t("menuDescription")}
                  </Dialog.Description>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("closeMenu")}
                    >
                      <X aria-hidden="true" size={20} />
                    </button>
                  </Dialog.Close>
                </div>
                <nav className="mt-5 flex flex-col" aria-label={t("mainNavigation")}>
                  {nav.map(([id, label]) => (
                    <Dialog.Close key={id} asChild>
                      <button
                        type="button"
                        onClick={() => scrollToId(id)}
                        className={cx(
                          "flex min-h-12 items-center border-b border-border/70 px-1 text-left text-base font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:text-primary",
                          active === id ? "text-primary" : "text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    </Dialog.Close>
                  ))}
                  <Dialog.Close asChild>
                    <a
                      href={DOWNLOAD_URL}
                      className="flex min-h-12 items-center border-b border-border/70 px-1 text-base font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:text-primary"
                    >
                      {t("downloadMerlin")}
                    </a>
                  </Dialog.Close>
                </nav>
                <div className="mt-auto border-t border-border pt-5">
                  <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="mobile-language">
                    {t("language")}
                  </label>
                  <select
                    id="mobile-language"
                    className="language-select w-full"
                    value={locale}
                    aria-label={t("language")}
                    onChange={(event) => setLocale(event.target.value as Locale)}
                  >
                    <option value="ptbr">PT</option>
                    <option value="en">EN</option>
                    <option value="es">ES</option>
                    <option value="fr">FR</option>
                    <option value="de">DE</option>
                  </select>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <a
            href="#top"
            className="flex min-w-0 items-center gap-2 lg:gap-3"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <img
              src={`${ASSET_BASE}/assets/branding/merlin-logo.png`}
              alt="Merlin"
              className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10 lg:h-11 lg:w-11"
            />
            <span className="font-display truncate text-lg font-bold tracking-tight sm:text-xl lg:text-xl xl:text-2xl">
              Merlin
            </span>
          </a>
        </div>
        <nav className="hidden items-center gap-6 lg:flex xl:gap-8">
          {nav.map(([id, label]) => (
            <button
              key={id}
              onClick={() => scrollToId(id)}
              className={cx(
                "cursor-pointer whitespace-nowrap text-sm transition-colors duration-200 hover:text-primary",
                active === id ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <a
            href={DOWNLOAD_URL}
            className="whitespace-nowrap text-sm text-muted-foreground transition-colors duration-200 hover:text-primary"
          >
            {t("download")}
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <select
            className="language-select hidden lg:block"
            value={locale}
            aria-label={t("language")}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            <option value="ptbr">PT</option>
            <option value="en">EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
            <option value="de">DE</option>
          </select>
          <MarketingCta
            purchaseAvailable={purchaseAvailable}
            t={t}
            className="shrink-0 px-3 text-xs sm:px-5 sm:text-sm"
          />
        </div>
      </div>
    </header>
  );
}

function Hero({
  purchaseAvailable,
  t,
}: {
  purchaseAvailable: boolean;
  t: TFn;
}) {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="container-merlin relative pb-16 pt-10 md:pb-24 md:pt-16">
        <div className="grid items-center gap-10 min-[900px]:grid-cols-[46fr_54fr] min-[1180px]:grid-cols-[43fr_57fr] min-[900px]:gap-12">
          <div className="max-w-[560px]">
            <h1 className="text-[clamp(2.6rem,9vw,3rem)] font-bold leading-[1.08] tracking-[-0.03em] min-[900px]:text-[clamp(3rem,4.4vw,4rem)]">
              {t("heroTitleA")}{" "}
              <span className="text-primary">{t("heroTitleGame")}</span>
              <br />
              {t("heroTitleB")}
            </h1>
            <p className="mt-7 max-w-[480px] text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("heroBody")}
            </p>
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
              <MarketingCta
                purchaseAvailable={purchaseAvailable}
                t={t}
                size="lg"
                className="w-full sm:w-auto"
              />
              <button
                onClick={() => scrollToId("como-funciona")}
                className="inline-flex items-center gap-2 self-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:self-auto"
              >
                <span aria-hidden className="text-primary">
                  ▶
                </span>
                {t("heroWatch")}
              </button>
            </div>
          </div>
          <div className="relative flex justify-center min-[900px]:justify-end">
            <div
              aria-hidden
              className="aura pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
            <img
              src={`${ASSET_BASE}/assets/branding/merlin-hero-official.png`}
              alt="Merlin"
              className="relative w-[min(78%,320px)] max-w-full object-contain min-[900px]:w-full min-[900px]:max-w-[520px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketingCta({
  purchaseAvailable,
  t,
  size = "md",
  className,
}: {
  purchaseAvailable: boolean;
  t: TFn;
  size?: "md" | "lg";
  className?: string;
}) {
  if (purchaseAvailable)
    return (
      <Button
        size={size}
        className={className}
        onClick={() => scrollToId("planos")}
      >
        {t("acquire")}
      </Button>
    );
  return (
    <a
      href={DOWNLOAD_URL}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[var(--glow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        size === "lg" ? "h-13 px-7 text-base" : "h-11 px-5 text-sm",
        className,
      )}
    >
      {t("downloadMerlin")}
    </a>
  );
}

function Feedbacks({
  purchaseAvailable,
  t,
}: {
  purchaseAvailable: boolean;
  t: TFn;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>("[data-card]");
    track?.scrollBy({
      left: dir * ((card?.offsetWidth ?? 280) + 16),
      behavior: "smooth",
    });
  };
  const move = useCallback(
    (dir: 1 | -1) =>
      setOpen((prev) =>
        prev === null || !feedbacks.length
          ? prev
          : (prev + dir + feedbacks.length) % feedbacks.length,
      ),
    [feedbacks.length],
  );
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/feedbacks")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.feedbacks)) return;
        const entries = payload.feedbacks
          .map((entry: { id?: number; imageUrl?: string; title?: string }) => ({
            id: `managed-${entry.id}`,
            src: String(entry.imageUrl || ""),
            title: String(entry.title || "Feedback real"),
          }))
          .filter(
            (entry: FeedbackItem) =>
              entry.id !== "managed-undefined" && entry.src,
          );
        setFeedbacks(entries.length ? entries : FALLBACK_FEEDBACKS);
      })
      .catch(() => {
        if (!cancelled) setFeedbacks(FALLBACK_FEEDBACKS);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("lightbox-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("lightbox-open");
    };
  }, [open, move]);

  return (
    <section id="feedbacks" className="section-y">
      <div className="container-merlin">
        <div className="flex items-end justify-between gap-6">
          <div>
            <SectionTitle>{t("feedbacksTitle")}</SectionTitle>
            <p className="mt-4 max-w-[520px] text-muted-foreground">
              {t("feedbacksBody")}
            </p>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              aria-label={t("previous")}
              onClick={() => scrollByCard(-1)}
              className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              ←
            </button>
            <button
              aria-label={t("next")}
              onClick={() => scrollByCard(1)}
              className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              →
            </button>
          </div>
        </div>
      </div>
      <div
        ref={trackRef}
        onScroll={() => {
          const track = trackRef.current;
          const card = track?.querySelector<HTMLElement>("[data-card]");
          const w = (card?.offsetWidth ?? 280) + 16;
          setActive(
            Math.max(
              0,
              Math.min(
                feedbacks.length - 1,
                Math.round((track?.scrollLeft ?? 0) / w),
              ),
            ),
          );
        }}
        className="no-scrollbar mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:px-8 lg:px-10 xl:px-[max(64px,calc((100vw-1200px)/2+64px))]"
      >
        {feedbacks.map((feedback, index) => (
          <button
            key={feedback.id}
            data-card
            type="button"
            aria-label={t("openFeedback", { number: index + 1 })}
            onClick={() => setOpen(index)}
            className="w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-primary/40 sm:w-[45%] lg:w-[31%]"
          >
            <div className="aspect-[4/5] bg-background/30 p-2">
              <img
                src={feedback.src}
                alt={`${feedback.title} ${index + 1}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full rounded-xl object-contain"
              />
            </div>
          </button>
        ))}
      </div>
      <div className="container-merlin mt-6 flex justify-center gap-1.5">
        {feedbacks.map((feedback, i) => (
          <span
            key={feedback.id}
            className={cx(
              "h-1.5 rounded-full transition-all",
              i === active ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30",
            )}
          />
        ))}
      </div>
      <div className="container-merlin mt-20">
        <div className="mx-auto max-w-[720px] text-center">
          <h3 className="text-2xl font-bold sm:text-3xl">
            {t("feedbackSupportTitle")}
          </h3>
          <p className="mt-4 text-muted-foreground">
            {t("feedbackSupportBody")}
          </p>
          <div className="mt-8 flex justify-center">
            <MarketingCta
              purchaseAvailable={purchaseAvailable}
              t={t}
              size="lg"
            />
          </div>
        </div>
      </div>
      {open !== null && feedbacks[open] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("feedbackDialog", { number: open + 1 })}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
          onClick={() => setOpen(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-[820px] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-primary/25 bg-card p-2">
              <img
                src={feedbacks[open].src}
                alt={`${feedbacks[open].title} ${open + 1}`}
                className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain"
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => move(-1)}
                className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
              >
                ←
              </button>
              <span className="text-sm text-muted-foreground">
                {open + 1} / {feedbacks.length}
              </span>
              <button
                type="button"
                onClick={() => move(1)}
                className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
              >
                →
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label={t("close")}
              className="absolute -top-12 right-0 grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const PARTNER_SOCIALS = [
  { id: "youtube", label: "YouTube", Icon: FaYoutube },
  { id: "tiktok", label: "TikTok", Icon: FaTiktok },
  { id: "twitch", label: "Twitch", Icon: FaTwitch },
] as const;

function readPartnerCropArea(partner: Partner) {
  const values = [partner.imageCropX, partner.imageCropY, partner.imageCropWidth, partner.imageCropHeight];
  if (values.some((value) => typeof value !== "number") || !partner.imageCropWidth || !partner.imageCropHeight) return null;
  if (partner.imageCropX! + partner.imageCropWidth > 100.0001 || partner.imageCropY! + partner.imageCropHeight > 100.0001) return null;
  return { x: partner.imageCropX!, y: partner.imageCropY!, width: partner.imageCropWidth, height: partner.imageCropHeight };
}

function PartnerPhoto({ partner }: { partner: Partner }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [layout, setLayout] = useState<React.CSSProperties | null>(null);
  const crop = readPartnerCropArea(partner);
  const updateLayout = useCallback(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image || !crop || !image.naturalWidth || !image.naturalHeight) return;
    const cropWidth = image.naturalWidth * (crop.width / 100);
    const cropHeight = image.naturalHeight * (crop.height / 100);
    const scale = Math.max(frame.clientWidth / cropWidth, frame.clientHeight / cropHeight);
    setLayout({ width: image.naturalWidth * scale, height: image.naturalHeight * scale, left: -image.naturalWidth * (crop.x / 100) * scale, top: -image.naturalHeight * (crop.y / 100) * scale });
  }, [crop]);
  useEffect(() => {
    if (!crop) return;
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, [crop, updateLayout, partner.imageUrl]);
  if (!partner.imageUrl) return <span className="font-display text-lg font-bold text-primary-foreground">{partner.name.slice(0, 2).toUpperCase()}</span>;
  if (!crop) return <img src={partner.imageUrl} alt={partner.name} loading="lazy" decoding="async" className="h-full w-full rounded-full object-cover transition-transform duration-200 group-hover:scale-105" />;
  return <div ref={frameRef} className="relative h-full w-full overflow-hidden rounded-full"><img ref={imageRef} src={partner.imageUrl} alt={partner.name} loading="lazy" decoding="async" onLoad={updateLayout} className="absolute max-w-none transition-transform duration-200 group-hover:scale-105" style={layout || { opacity: 0 }} /></div>;
}

function PartnersSection({ t }: { t: TFn }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const fitsDesktop = partners.length <= 6;
  const scrollByCard = (direction: 1 | -1) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>("[data-partner-card]");
    track?.scrollBy({ left: direction * ((card?.offsetWidth ?? 180) + 16), behavior: "smooth" });
  };
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/partners")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.partners)) return;
        setPartners(payload.partners.filter((partner: Partner) => partner?.id && partner?.name));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!partners.length) return null;
  return (
    <section id="parceiros" className="relative overflow-hidden border-y border-border/70 bg-surface/70 py-14 sm:py-16" style={{
      backgroundImage: `linear-gradient(180deg, rgba(11, 12, 21, 0.82), rgba(11, 12, 21, 0.7) 56%, rgba(11, 12, 21, 0.84)), url(${ASSET_BASE}/assets/partners/partners-ambient.png)`,
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
    }}>
      <div className="container-merlin relative">
        <div className="relative flex justify-center">
          <div className="max-w-2xl text-center">
            <span aria-hidden className="mx-auto block h-2 w-2 rotate-45 bg-primary shadow-[0_0_18px_rgba(139,92,246,0.9)]" />
            <h2 className="mt-4 font-display text-2xl font-bold sm:text-3xl">{t("partnersTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t("partnersBody")}</p>
          </div>
          {partners.length > 6 && <div className="absolute right-0 top-1/2 hidden -translate-y-1/2 shrink-0 gap-2 sm:flex">
            <button aria-label={t("previousPartner")} onClick={() => scrollByCard(-1)} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">←</button>
            <button aria-label={t("nextPartner")} onClick={() => scrollByCard(1)} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">→</button>
          </div>}
        </div>
      </div>
      <div ref={trackRef} className={cx("no-scrollbar mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:mx-auto sm:max-w-[900px] sm:px-8", fitsDesktop && "sm:justify-center")}>
        {partners.map((partner) => <article key={partner.id} data-partner-card className="group flex w-[44%] shrink-0 snap-start flex-col items-center text-center transition-transform duration-200 hover:-translate-y-0.5 sm:w-[136px]">
          <div className="flex h-[106px] w-[106px] items-center justify-center overflow-hidden rounded-full border-2 border-primary/45 bg-primary/10 p-[3px] shadow-[0_0_20px_rgba(139,92,246,0.16)] sm:h-[114px] sm:w-[114px] lg:h-[121px] lg:w-[121px]"><PartnerPhoto partner={partner} /></div>
          <h3 className="mt-4 w-full truncate text-[15px] font-semibold text-foreground sm:text-base">{partner.name}</h3>
          <div className="mt-2.5 flex min-h-8 items-center justify-center gap-2">{PARTNER_SOCIALS.map(({ id, label, Icon }) => {
            const url = partner[`${id}Url` as "youtubeUrl" | "tiktokUrl" | "twitchUrl"];
            if (!url) return null;
            return <a key={id} href={url} aria-label={t("partnerOnSocial", { partner: partner.name, social: label })} target="_blank" rel="noreferrer" className="grid h-[35px] w-[35px] place-items-center rounded-full border border-border bg-background/50 text-[14px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/15 hover:text-foreground"><Icon aria-hidden /></a>;
          })}</div>
        </article>)}
      </div>
    </section>
  );
}

const PLAN_TIERS: Array<{
  tier: PlanTier;
  name: string;
  badgeKey: string;
  emphasis: "base" | "medium" | "high";
  descriptionKey: string;
  benefits: Array<{
    textKey: string;
    icon: "check" | "clock" | "zap";
    tooltipKey?: string;
  }>;
}> = [
  {
    tier: "bronze",
    name: "Bronze",
    badgeKey: "tierBronzeBadge",
    emphasis: "base",
    descriptionKey: "tierBronzeDescription",
    benefits: [
      { textKey: "tierBenefitStandard", icon: "check" },
      { textKey: "tierBenefitPremiumTab", icon: "check" },
      {
        textKey: "tierBronzeActivations",
        icon: "check",
        tooltipKey: "tierBronzeActivationsTip",
      },
      { textKey: "tierBronzeCooldown", icon: "clock" },
      { textKey: "tierBronzeReleases", icon: "clock" },
    ],
  },
  {
    tier: "prata",
    name: "Prata",
    badgeKey: "tierPrataBadge",
    emphasis: "medium",
    descriptionKey: "tierPrataDescription",
    benefits: [
      { textKey: "tierBenefitStandard", icon: "check" },
      { textKey: "tierBenefitPremiumTab", icon: "check" },
      {
        textKey: "tierPrataActivations",
        icon: "check",
        tooltipKey: "tierPrataActivationsTip",
      },
      { textKey: "tierPrataCooldown", icon: "clock" },
      { textKey: "tierPrataReleases", icon: "clock" },
    ],
  },
  {
    tier: "ouro",
    name: "Ouro",
    badgeKey: "tierOuroBadge",
    emphasis: "high",
    descriptionKey: "tierOuroDescription",
    benefits: [
      { textKey: "tierBenefitStandard", icon: "check" },
      { textKey: "tierBenefitPremiumTab", icon: "check" },
      { textKey: "tierOuroActivations", icon: "check" },
      {
        textKey: "tierOuroCooldown",
        icon: "clock",
        tooltipKey: "tierOuroCooldownTip",
      },
      { textKey: "tierOuroReleases", icon: "zap" },
    ],
  },
];

function tierDisplayName(planTier: PlanTier | null) {
  return PLAN_TIERS.find((plan) => plan.tier === planTier)?.name || "";
}

function PlanBenefitIcon({ type }: { type: "check" | "clock" | "zap" }) {
  const Icon = type === "check" ? Check : type === "zap" ? Zap : Clock;
  return (
    <Icon
      aria-hidden
      className={cx(
        "h-4 w-4 shrink-0",
        type === "clock" ? "text-muted-foreground" : "text-primary",
      )}
      strokeWidth={2.2}
    />
  );
}

function BenefitInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Mais informações"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[10px] leading-none text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-white/20 bg-[oklch(0.22_0.018_283)] px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-lg shadow-black/40 transition-all duration-200",
          open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        )}
      >
        {text}
      </span>
    </span>
  );
}

function TierPlanCards({
  locale,
  billing,
  billingPeriod,
  selectedTier,
  setBillingPeriod,
  onSelect,
  t,
}: {
  locale: Locale;
  billing: BillingState;
  billingPeriod: BillingPeriod;
  selectedTier: PlanTier | null;
  setBillingPeriod: (value: BillingPeriod) => void;
  onSelect: (tier: PlanTier, period: BillingPeriod) => void;
  t: TFn;
}) {
  const hasMonthly = PLAN_TIERS.some((plan) =>
    tierCanBeSold(billing, plan.tier, "monthly"),
  );
  const hasAnnual = PLAN_TIERS.some((plan) =>
    tierCanBeSold(billing, plan.tier, "annual"),
  );
  const activePeriod =
    billingPeriod === "annual" && hasAnnual
      ? "annual"
      : hasMonthly
        ? "monthly"
        : "annual";
  const [showComparison, setShowComparison] = useState(false);

  return (
    <div className="plans-poc mx-auto mt-12 max-w-[1180px]">
      <div className="flex flex-col items-center text-center">
        <span className="text-xs font-medium uppercase tracking-[0.28em] text-primary/80">
          {t("tierPlansEyebrow")}
        </span>
        <h3 className="plans-poc-display mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("tierPlansTitle")}
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("tierPlansBody")}
        </p>
        <div
          className="mt-8 inline-flex items-center gap-1 rounded-full border border-border bg-card/70 p-1"
          role="tablist"
          aria-label="Ciclo de cobrança"
        >
          {hasMonthly && (
            <button
              type="button"
              role="tab"
              aria-selected={activePeriod === "monthly"}
              onClick={() => setBillingPeriod("monthly")}
              className={cx(
                "relative z-10 w-[88px] rounded-full px-4 py-2 text-sm font-medium transition-colors",
                activePeriod === "monthly"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("monthlyTitle")}
            </button>
          )}
          {hasAnnual && (
            <button
              type="button"
              role="tab"
              aria-selected={activePeriod === "annual"}
              onClick={() => setBillingPeriod("annual")}
              className={cx(
                "relative z-10 flex w-[196px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                activePeriod === "annual"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("annualTitle")}{" "}
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  activePeriod === "annual"
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary/60 text-muted-foreground",
                )}
              >
                {t("tierSave")}
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="mt-16 grid items-stretch gap-6 lg:grid-cols-3 lg:gap-7">
        {PLAN_TIERS.map((plan) => {
          const cardPrice = getTierPrice(
            billing,
            "card",
            plan.tier,
            activePeriod,
          );
          const pixPrice = getTierPrice(
            billing,
            "pix",
            plan.tier,
            activePeriod,
          );
          const displayPrice =
            activePeriod === "annual"
              ? pixPrice || cardPrice
              : cardPrice || pixPrice;
          const disabled = !tierCanBeSold(billing, plan.tier, activePeriod);
          const selected =
            selectedTier === plan.tier && billingPeriod === activePeriod;
          const isHigh = plan.emphasis === "high";
          const isMedium = plan.emphasis === "medium";
          const annualSavings =
            cardPrice &&
            pixPrice &&
            cardPrice.amountCents > pixPrice.amountCents
              ? formatCents(
                  locale,
                  cardPrice.amountCents - pixPrice.amountCents,
                  cardPrice.currency,
                )
              : "";
          return (
            <div
              key={plan.tier}
              className={cx(
                "group relative flex h-full flex-col rounded-2xl border bg-card p-7 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 sm:p-9",
                isHigh
                  ? "border-primary/45 bg-[oklch(0.205_0.016_283)] shadow-[0_20px_70px_-35px_oklch(0.55_0.2_300/0.65)] hover:border-primary/70"
                  : isMedium
                    ? "border-primary/20 shadow-[0_10px_40px_-30px_oklch(0.55_0.2_300/0.4)] hover:border-primary/45"
                    : "border-border hover:border-white/20",
                selected && "ring-1 ring-primary/60",
                disabled && "opacity-45",
              )}
            >
              <span
                className={cx(
                  "absolute -top-3 left-7 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] sm:left-9",
                  isHigh
                    ? "bg-primary text-primary-foreground"
                    : "border border-primary/25 bg-[oklch(0.205_0.016_283)] text-primary",
                )}
              >
                {t(plan.badgeKey)}
              </span>
              <header>
                <h4 className="plans-poc-display text-xl font-semibold tracking-tight">
                  {plan.name}
                </h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t(plan.descriptionKey)}
                </p>
              </header>
              <div
                className={cx(
                  "mt-8",
                  activePeriod === "monthly" ? "min-h-[76px]" : "min-h-[118px]",
                )}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="plans-poc-display text-4xl font-semibold tracking-tight tabular-nums">
                    {formatMoney(locale, displayPrice)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {activePeriod === "annual"
                      ? t("annualPeriod")
                      : t("monthlyPeriod")}
                  </span>
                </div>
                {activePeriod === "monthly" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("tierMonthlyRenewal")}
                  </p>
                ) : (
                  <>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t("priceInPix")}
                    </p>
                    {annualSavings && (
                      <p className="mt-3 text-sm font-medium text-primary">
                        {t("saveAmount", { amount: annualSavings })}
                      </p>
                    )}
                    {cardPrice && (
                      <p className="mt-1.5 text-xs text-muted-foreground/70">
                        {t("orPriceOnCard", {
                          price: formatMoney(locale, cardPrice),
                        })}
                      </p>
                    )}
                  </>
                )}
              </div>
              <ul className="mb-10 mt-8 flex flex-col gap-4 border-t border-border pt-8 text-sm">
                {plan.benefits.map((benefit) => (
                  <li key={benefit.textKey} className="flex gap-2.5">
                    <PlanBenefitIcon type={benefit.icon} />
                    <span
                      className={cx(
                        "leading-relaxed",
                        benefit.icon === "clock"
                          ? "text-muted-foreground"
                          : "text-foreground/90",
                      )}
                    >
                      {t(benefit.textKey)}
                      {benefit.tooltipKey && (
                        <BenefitInfo text={t(benefit.tooltipKey)} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onSelect(plan.tier, activePeriod)}
                className={cx(
                  "mt-auto w-full rounded-xl px-4 py-3.5 text-sm font-medium transition-[background-color,border-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
                  isHigh
                    ? "bg-primary text-primary-foreground hover:bg-primary/85"
                    : isMedium
                      ? "border border-primary/35 bg-primary/10 text-foreground hover:border-primary/55 hover:bg-primary/20"
                      : "border border-white/20 bg-transparent text-foreground hover:bg-secondary/50",
                  selected && !isHigh && "border-primary bg-primary/20",
                )}
              >
                {t("tierChoosePlan", { name: plan.name })}
              </button>
            </div>
          );
        })}
      </div>
      <div aria-live="polite" className="mt-8 flex min-h-6 justify-center">
        {selectedTier && (
          <p className="text-sm text-muted-foreground">
            {t("tierSelectedPlan")}:{" "}
            <span className="font-medium text-foreground">
              {tierDisplayName(selectedTier)}
            </span>{" "}
            ·{" "}
            {activePeriod === "monthly" ? t("monthlyTitle") : t("annualTitle")}
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setShowComparison((value) => !value)}
          aria-expanded={showComparison}
          aria-controls="comparacao-planos"
          className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("tierCompareBenefits")}{" "}
          <ChevronDown
            className={cx(
              "h-4 w-4 transition-transform duration-300",
              showComparison && "rotate-180",
            )}
          />
        </button>
        <div
          id="comparacao-planos"
          className={cx(
            "grid w-full transition-[grid-template-rows,opacity] duration-500 ease-out",
            showComparison
              ? "mt-8 grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <TierComparison t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TierComparison({ t }: { t: TFn }) {
  const rows = [
    [
      "tierTableStandard",
      "tierTableUnlimited",
      "tierTableUnlimited",
      "tierTableUnlimited",
    ],
    ["tierTablePremiumTab", "tierTableYes", "tierTableYes", "tierTableYes"],
    [
      "tierTablePremiumActivations",
      "tierTableThreePerMonth",
      "tierTableUnlimited",
      "tierTableUnlimited",
    ],
    [
      "tierTableDifferentGames",
      "tierTable24h",
      "tierTable24h",
      "tierTableNoWait",
    ],
    ["tierTableSameGame", "tierTable24h", "tierTable24h", "tierTable24h"],
    [
      "tierTableNewReleases",
      "tierTableSevenDays",
      "tierTableFiveDays",
      "tierTable48Hours",
    ],
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card/60">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{t("tierCompareBenefits")}</caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="px-5 py-4 text-left text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground"
            >
              {t("tierTableBenefit")}
            </th>
            {["Bronze", "Prata", "Ouro"].map((name) => (
              <th
                key={name}
                scope="col"
                className={cx(
                  "plans-poc-display px-5 py-4 text-left text-sm font-semibold",
                  name === "Ouro" ? "text-primary" : "text-foreground",
                )}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, bronze, prata, ouro]) => (
            <tr
              key={label}
              className="border-b border-border/60 last:border-0 transition-colors hover:bg-secondary/25"
            >
              <th
                scope="row"
                className="px-5 py-4 text-left font-normal text-muted-foreground"
              >
                {t(label)}
              </th>
              <td className="px-5 py-4 text-foreground/85">{t(bronze)}</td>
              <td className="px-5 py-4 text-foreground/85">{t(prata)}</td>
              <td className="px-5 py-4 font-medium text-foreground">
                {t(ouro)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanCard({
  title,
  price,
  period,
  priceNote,
  description,
  note,
  cta,
  selected,
  featured,
  badge,
  disabled,
  onSelect,
  t,
}: {
  title: string;
  price: string;
  period: string;
  priceNote?: string;
  description: string;
  note?: string;
  cta: string;
  selected: boolean;
  featured?: boolean;
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
  t: TFn;
}) {
  return (
    <div
      className={cx(
        "flex flex-col rounded-2xl border bg-card p-7 transition-colors sm:p-8",
        featured ? "border-primary/40" : "border-border",
        selected && "border-primary shadow-[var(--glow-soft)]",
        disabled && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold">{title}</h3>
        {(badge || featured) && (
          <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
            {badge || t("bestValue")}
          </span>
        )}
      </div>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="font-display text-4xl font-bold">{price}</span>
        <span className="text-sm text-muted-foreground">{period}</span>
      </div>
      {priceNote && (
        <p className="mt-2 text-sm font-medium text-muted-foreground">
          {priceNote}
        </p>
      )}
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {note && (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground/70">
          {note}
        </p>
      )}
      <div className="mt-8 flex-1" />
      <Button
        size="lg"
        variant={featured ? "primary" : "outline"}
        className="w-full"
        disabled={disabled}
        onClick={onSelect}
      >
        {cta}
      </Button>
    </div>
  );
}

function ExistingAccessActions({
  t,
  onRecover,
  onAccess,
}: {
  t: TFn;
  onRecover: () => void;
  onAccess: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
      <span>{t("existingAccessPrompt")}</span>
      <a
        href={DOWNLOAD_URL}
        className="font-medium text-foreground/85 transition-colors hover:text-primary"
      >
        {t("downloadMerlin")}
      </a>
      <span aria-hidden className="text-muted-foreground/40">
        {"\u00B7"}
      </span>
      <button
        type="button"
        onClick={onRecover}
        className="font-medium text-foreground/85 transition-colors hover:text-primary"
      >
        {t("recoverMyKey")}
      </button>
      <span aria-hidden className="text-muted-foreground/40">
        {"\u00B7"}
      </span>
      <button
        type="button"
        onClick={onAccess}
        className="font-medium text-foreground/85 transition-colors hover:text-primary"
      >
        {t("myAccess")}
      </button>
    </div>
  );
}

function Plans({
  locale,
  t,
  billing,
  version,
}: {
  locale: Locale;
  t: TFn;
  billing: BillingState;
  version: string;
}) {
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [planTier, setPlanTier] = useState<PlanTier | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [mode, setMode] = useState<FlowMode>("register");
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    if (!billing.plansEnabled) return;
    const hasMonthly = PLAN_TIERS.some((tier) =>
      tierCanBeSold(billing, tier.tier, "monthly"),
    );
    const hasAnnual = PLAN_TIERS.some((tier) =>
      tierCanBeSold(billing, tier.tier, "annual"),
    );
    if (!hasMonthly && hasAnnual && billingPeriod !== "annual")
      setBillingPeriod("annual");
    if (!hasAnnual && hasMonthly && billingPeriod !== "monthly")
      setBillingPeriod("monthly");
  }, [billing, billingPeriod]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    recoveryPin: "",
    accepted: false,
    code: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState<{
    title: string;
    licenseKey: string;
    recoveryPin?: string | null;
  } | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(
    null,
  );
  const [pixOrder, setPixOrder] = useState<PixOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [pixChecking, setPixChecking] = useState(false);
  const [modal, setModal] = useState<StatusModal>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessSessionId, setAccessSessionId] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const externalRedirectStarted = useRef(false);

  function clearTransientFields(
    options: { keepEmail?: boolean; email?: string } = {},
  ) {
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
    window.setTimeout(
      () =>
        formRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      80,
    );
  }

  function showSuccess(
    next: { title: string; licenseKey: string; recoveryPin?: string | null },
    options: { keepEmail?: boolean; email?: string } = {},
  ) {
    setSuccess(next);
    setPaymentResult(null);
    setAccessOpen(false);
    setAccessNotice("");
    setMode("success");
    clearTransientFields(options);
    focusResultPanel();
  }

  function showPaymentResult(
    next: PaymentResult,
    options: { keepEmail?: boolean; email?: string } = {},
  ) {
    setPaymentResult(next);
    setSuccess(null);
    setMode("payment-result");
    clearTransientFields(options);
    focusResultPanel();
  }

  function pixAvailableForPlan(nextPlan: PlanType | null) {
    if (!nextPlan || !billing.paymentMethods.pix) return false;
    if (
      billing.plansEnabled &&
      nextPlan !== "lifetime" &&
      (nextPlan === "monthly" || nextPlan === "annual")
    ) {
      return (
        (nextPlan === "monthly"
          ? billing.paymentMethods.pixMonthly
          : billing.paymentMethods.pixAnnual) &&
        Boolean(planTier && getTierPrice(billing, "pix", planTier, nextPlan))
      );
    }
    if (nextPlan === "monthly") return billing.paymentMethods.pixMonthly;
    if (nextPlan === "annual") return billing.paymentMethods.pixAnnual;
    return billing.paymentMethods.pixLifetime;
  }

  function selectedPlanCanBeSold() {
    if (
      billing.plansEnabled &&
      plan !== "lifetime" &&
      (plan === "monthly" || plan === "annual")
    ) {
      return tierCanBeSold(billing, planTier, plan);
    }
    return planCanBeSold(billing, plan);
  }

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const access = params.get("access");
    if (checkout === "success") {
      const remembered = localStorage.getItem("merlin_checkout_email") || "";
      if (remembered) setForm((value) => ({ ...value, email: remembered }));
      setAccessNotice(t("checkoutAccessNotice"));
      setAccessOpen(true);
      void pollCheckoutStatus(params.get("session_id"));
    } else if (checkout === "cancel") {
      setModal({
        title: t("checkoutCanceledTitle"),
        text: t("checkoutCanceled"),
        tone: "warn",
      });
    } else if (access === "upgrade-success") {
      setAccessSessionId(params.get("session_id"));
      setAccessNotice("");
      setAccessOpen(true);
    } else if (access === "upgrade-cancel") {
      setModal({
        title: t("upgradeCanceledTitle"),
        text: t("upgradeCanceledText"),
        tone: "warn",
      });
    } else if (access === "plan-change-return") {
      setAccessNotice(
        "A Stripe confirmou o retorno. Consulte seu acesso para acompanhar a alteração.",
      );
      setAccessOpen(true);
    } else if (access === "plan-change-cancel") {
      setModal({
        title: "Alteração cancelada",
        text: "Nenhuma mudança foi aplicada ao seu plano.",
        tone: "warn",
      });
    } else if (access === "me") {
      setAccessNotice("");
      setAccessOpen(true);
    }
  }, [locale]);

  useEffect(() => {
    if (
      billing.signupEnabled &&
      billing.billingEnabled &&
      mode === "register" &&
      selectedPlanCanBeSold()
    )
      window.setTimeout(
        () =>
          formRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        120,
      );
  }, [
    plan,
    planTier,
    billing.signupEnabled,
    billing.billingEnabled,
    billing.monthlyEnabled,
    billing.annualEnabled,
    billing.lifetimeEnabled,
    billing.prices.monthly,
    billing.prices.annual,
    billing.prices.lifetime,
    billing.prices.pixAnnual,
    billing.prices.pixLifetime,
    billing.planPrices,
    mode,
  ]);

  function resetPanel(nextMode: FlowMode) {
    setMode(nextMode);
    setErrors({});
    setMessage("");
    setSuccess(null);
    setPaymentResult(null);
    setPixOrder(null);
    setPending(null);
    setCooldown(0);
    setForm((value) => ({
      ...value,
      code: "",
      recoveryPin: nextMode === "register" ? "" : value.recoveryPin,
      accepted: nextMode === "register" ? false : value.accepted,
    }));
  }

  function validateBase(
    includeName: boolean,
    includePin: boolean,
    includeNotice: boolean,
  ) {
    const next: Record<string, string> = {};
    if (includeName && !form.name.trim()) next.name = t("errorName");
    if (!validEmail(form.email)) next.email = t("errorEmail");
    if (includePin && !validRecoverySecret(form.recoveryPin))
      next.recoveryPin = t("errorPin");
    if (includeNotice && !form.accepted) next.accepted = t("errorNotice");
    if (includeName && billing.billingEnabled && !selectedPlanCanBeSold())
      next.plan = t("errorPlan");
    if (
      includeName &&
      billing.billingEnabled &&
      pixAvailableForPlan(plan) &&
      !paymentMethod
    )
      next.paymentMethod = t("errorPaymentMethod");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function sendVerification(action: PendingAction) {
    setLoading(true);
    setMessage(t("sendingCode"));
    try {
      const email = normalizeEmail(
        String(action.data.email || action.data.contact || ""),
      );
      const payload = await postJson<{
        cooldownSeconds?: number;
        deliveryMode?: "email" | "staging_test";
      }>("/api/public/email-verification/start", { email }, t("genericError"));
      setPending(action);
      setCooldown(Number(payload.cooldownSeconds || 60));
      setMode("verify");
      setMessage(
        payload.deliveryMode === "staging_test"
          ? t("stagingTestCode")
          : t("emailCodeSent"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    if (!pending) return resetPanel("register");
    if (!pending.verified && !isAcceptedVerificationCode(form.code.trim())) {
      setErrors({ code: t("errorCode") });
      return;
    }
    externalRedirectStarted.current = false;
    setLoading(true);
    setErrors({});
    setMessage(t("loading"));
    const email = normalizeEmail(
      String(pending.data.email || pending.data.contact || ""),
    );
    try {
      const verifiedPending = pending.verified
        ? pending
        : { ...pending, verified: true };
      if (!pending.verified) {
        await postJson(
          "/api/public/email-verification/verify",
          { email, code: form.code.trim() },
          t("genericError"),
        );
        setPending(verifiedPending);
      }
      if (verifiedPending.mode === "register")
        await createAccess(verifiedPending.data);
      if (verifiedPending.mode === "recover")
        await recoverAccess(verifiedPending.data);
      if (verifiedPending.mode === "payment-status")
        await checkPaymentStatus(email);
      if (verifiedPending.mode === "billing-portal")
        await openBillingPortal(
          email,
          String(verifiedPending.data.recoveryPin || ""),
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      if (!externalRedirectStarted.current) setLoading(false);
    }
  }

  async function createAccess(data: Record<string, string | boolean>) {
    if (billing.billingEnabled) {
      if (!selectedPlanCanBeSold()) {
        setErrors({ plan: t("errorPlan") });
        setMessage("");
        return;
      }
      if (pixAvailableForPlan(plan) && !paymentMethod) {
        setErrors({ paymentMethod: t("errorPaymentMethod") });
        setMessage("");
        return;
      }
      const planPayload =
        billing.plansEnabled && plan !== "lifetime" ? { planTier } : {};
      if (paymentMethod === "pix") {
        if (!pixAvailableForPlan(plan)) {
          setErrors({ paymentMethod: t("errorPaymentMethod") });
          setMessage("");
          return;
        }
        setMessage(t("pixCreating"));
        const payload = await postJson<PixOrder>(
          "/api/public/pix/orders",
          {
            name: data.name,
            contact: data.email,
            recoveryPin: data.recoveryPin,
            acceptedRecoveryNotice: data.accepted,
            planType: plan,
            ...planPayload,
            mercadoPagoDeviceId: getMercadoPagoDeviceId(),
          },
          t("genericError"),
        );
        localStorage.setItem(
          "merlin_checkout_email",
          normalizeEmail(String(data.email)),
        );
        setPixOrder(payload);
        setPixCopied(false);
        setMode("pix");
        setMessage("");
        return;
      }
      setMessage(t("checkoutLoading"));
      const payload = await postJson<{ checkoutUrl: string }>(
        "/api/public/checkout",
        {
          name: data.name,
          contact: data.email,
          recoveryPin: data.recoveryPin,
          acceptedRecoveryNotice: data.accepted,
          planType: plan,
          ...planPayload,
        },
        t("genericError"),
      );
      localStorage.setItem(
        "merlin_checkout_email",
        normalizeEmail(String(data.email)),
      );
      externalRedirectStarted.current = true;
      setMessage(t("checkoutRedirecting"));
      window.location.assign(payload.checkoutUrl);
      return;
    }
    const payload = await postJson<{
      created: boolean;
      license: { licenseKey: string };
    }>(
      "/api/public/access-keys/register",
      {
        name: data.name,
        contact: data.email,
        contactType: "email",
        recoveryPin: data.recoveryPin,
        acceptedRecoveryNotice: data.accepted,
      },
      t("genericError"),
    );
    showSuccess({
      title: payload.created ? t("successCreated") : t("successExisting"),
      licenseKey: payload.license.licenseKey,
      recoveryPin: payload.created ? String(data.recoveryPin) : null,
    });
  }

  async function recoverAccess(data: Record<string, string | boolean>) {
    const payload = await postJson<{ license: { licenseKey: string } }>(
      "/api/public/access-keys/recover",
      {
        contact: data.email,
        contactType: "email",
        recoveryPin: data.recoveryPin,
      },
      t("genericError"),
    );
    showSuccess({
      title: t("successRecovered"),
      licenseKey: payload.license.licenseKey,
    });
  }

  function renderPaymentStatus(payload: any, email: string) {
    const hasLicense = Boolean(payload.license?.licenseKey);
    const status = String(payload.status || "not_found");
    const title =
      status === "completed"
        ? t("paymentApprovedTitle")
        : status === "existing_license"
          ? t("paymentExistingTitle")
          : status === "processing"
            ? t("paymentProcessingTitle")
            : status === "expired"
              ? t("paymentExpiredTitle")
              : t("paymentMissingTitle");
    const text =
      status === "completed"
        ? t("paymentApprovedText")
        : status === "existing_license"
          ? t("paymentExistingText")
          : status === "processing"
            ? t("paymentProcessingText")
            : status === "expired"
              ? t("paymentExpiredText")
              : t("paymentMissingText");
    localStorage.setItem("merlin_checkout_email", email);
    showPaymentResult(
      {
        status,
        title,
        text,
        licenseKey: hasLicense ? payload.license.licenseKey : "",
      },
      { email },
    );
  }

  async function checkPaymentStatus(email: string) {
    setMessage(t("loading"));
    const payload = await postJson(
      "/api/public/payment-status",
      { email },
      t("genericError"),
    );
    renderPaymentStatus(payload, email);
  }

  async function openBillingPortal(email: string, recoveryPin = "") {
    const endpoint = recoveryPin
      ? "/api/public/access/billing-portal"
      : "/api/public/billing-portal";
    const body = recoveryPin ? { email, recoveryPin } : { email };
    const payload = await postJson<{ portalUrl?: string }>(
      endpoint,
      body,
      t("billingPortalUnavailable"),
    );
    if (!payload.portalUrl) throw new Error(t("billingPortalUnavailable"));
    externalRedirectStarted.current = true;
    window.location.assign(payload.portalUrl);
  }

  async function pollCheckoutStatus(sessionId: string | null) {
    if (!sessionId) return;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const payload = await fetch(
          `/api/public/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
        ).then((r) => r.json());
        if (
          payload?.success !== false &&
          payload.status === "completed" &&
          payload.license?.licenseKey
        ) {
          showSuccess({
            title: t("successCreated"),
            licenseKey: payload.license.licenseKey,
          });
          return;
        }
      } catch {
        /* webhook may still be processing */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    const email = localStorage.getItem("merlin_checkout_email") || "";
    setForm((value) => ({ ...value, email }));
    setAccessNotice(t("checkoutStillProcessingAccessNotice"));
    setAccessOpen(true);
  }

  async function checkPixStatus(order: PixOrder, manual = false) {
    if (manual) setPixChecking(true);
    try {
      const payload = await fetch(
        `/api/public/pix/orders/${encodeURIComponent(order.paymentIntentId)}/status`,
      ).then((r) => r.json());
      if (payload?.success === false)
        throw new Error(payload.error || t("genericError"));
      if (payload.status === "paid" && payload.license?.licenseKey) {
        showSuccess({
          title: t("paymentApprovedTitle"),
          licenseKey: payload.license.licenseKey,
        });
        return "done";
      }
      if (payload.status === "expired") {
        setPixOrder((value) =>
          value ? { ...value, status: "expired" } : value,
        );
        return "expired";
      }
      if (payload.status === "failed") {
        setPixOrder((value) =>
          value ? { ...value, status: "failed" } : value,
        );
        return "failed";
      }
      return "waiting";
    } finally {
      if (manual) setPixChecking(false);
    }
  }

  useEffect(() => {
    if (mode !== "pix" || !pixOrder || pixOrder.status !== "awaiting_payment")
      return undefined;
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
    void sendVerification({
      mode: "register",
      data: {
        name: form.name.trim(),
        email: normalizeEmail(form.email),
        recoveryPin: form.recoveryPin.trim(),
        accepted: form.accepted,
      },
    });
  }

  function submitSimple(
    event: React.FormEvent,
    modeName: "recover" | "payment-status" | "billing-portal",
  ) {
    event.preventDefault();
    if (
      !validateBase(
        false,
        modeName === "recover" || modeName === "billing-portal",
        false,
      )
    )
      return;
    void sendVerification({
      mode: modeName,
      data: {
        email: normalizeEmail(form.email),
        recoveryPin: form.recoveryPin.trim(),
      },
    });
  }

  const monthlyAvailable = planCanBeSold(billing, "monthly");
  const annualAvailable = planCanBeSold(billing, "annual");
  const lifetimeAvailable = planCanBeSold(billing, "lifetime");
  const paidPlansAvailable =
    monthlyAvailable || annualAvailable || lifetimeAvailable;
  const freeSignupAvailable =
    billing.loaded && billing.signupEnabled && !billing.billingEnabled;
  const monthlyPixAvailable = pixAvailableForPlan("monthly");
  const annualPixAvailable = pixAvailableForPlan("annual");
  const lifetimePixAvailable = pixAvailableForPlan("lifetime");
  const selectedPlanHasPix = pixAvailableForPlan(plan);
  const monthlyPrice = monthlyAvailable
    ? formatMoney(locale, billing.prices.monthly)
    : "";
  const annualPrice = annualAvailable
    ? formatMoney(locale, billing.prices.annual)
    : "";
  const annualPixPrice = annualAvailable
    ? formatMoney(locale, billing.prices.pixAnnual || billing.prices.annual)
    : "";
  const annualDiscountCents = annualPixDiscountCents(billing.prices);
  const annualDiscount =
    annualDiscountCents > 0
      ? formatCents(
          locale,
          annualDiscountCents,
          billing.prices.annual?.currency ||
            billing.prices.pixAnnual?.currency ||
            "brl",
        )
      : "";
  const lifetimePrice = lifetimeAvailable
    ? formatMoney(locale, billing.prices.lifetime)
    : "";
  const lifetimePixPrice = lifetimeAvailable
    ? formatMoney(locale, billing.prices.pixLifetime || billing.prices.lifetime)
    : "";
  const lifetimeDiscountCents = lifetimePixDiscountCents(billing.prices);
  const lifetimeDiscount =
    lifetimeDiscountCents > 0
      ? formatCents(
          locale,
          lifetimeDiscountCents,
          billing.prices.lifetime?.currency ||
            billing.prices.pixLifetime?.currency ||
            "brl",
        )
      : "";
  const selectedPlanPrice = plan
    ? formatMoney(
        locale,
        getPaymentPrice(billing, plan, paymentMethod, planTier),
      )
    : "";
  const showRegisterForm =
    mode === "register" &&
    billing.signupEnabled &&
    (freeSignupAvailable ||
      (billing.billingEnabled &&
        paidPlansAvailable &&
        selectedPlanCanBeSold()));
  const showUnavailableMessage =
    billing.loaded &&
    (!billing.signupEnabled || (billing.billingEnabled && !paidPlansAvailable));
  const activePlanCount = [
    monthlyAvailable,
    annualAvailable,
    lifetimeAvailable,
  ].filter(Boolean).length;
  const planGridClass =
    activePlanCount === 1
      ? "max-w-[440px]"
      : activePlanCount === 2
        ? "max-w-[680px] md:grid-cols-2"
        : "max-w-[980px] md:grid-cols-2 lg:grid-cols-3";

  return (
    <section id="planos" className="section-y">
      <div className="container-merlin">
        {!billing.plansEnabled && (
          <div className="mx-auto max-w-[760px] text-center">
            <SectionTitle center>{t("plansEntryTitle")}</SectionTitle>
            <p className="mx-auto mt-4 max-w-[680px] text-muted-foreground">
              {freeSignupAvailable ? t("freeAccessBody") : t("plansEntryBody")}
            </p>
            <ExistingAccessActions
              t={t}
              onRecover={() => resetPanel("recover")}
              onAccess={() => {
                setAccessSessionId(null);
                setAccessOpen(true);
              }}
            />
            {version && (
              <p className="mt-3 text-xs text-muted-foreground/70">
                v{version}
              </p>
            )}
          </div>
        )}
        {!billing.loaded ? (
          <div className="mx-auto mt-12 h-44 max-w-[900px] animate-pulse rounded-2xl border border-border bg-card" />
        ) : (
          <>
            {billing.signupEnabled &&
              billing.billingEnabled &&
              paidPlansAvailable &&
              (billing.plansEnabled ? (
                <TierPlanCards
                  locale={locale}
                  billing={billing}
                  billingPeriod={billingPeriod}
                  selectedTier={planTier}
                  t={t}
                  setBillingPeriod={(value) => {
                    setBillingPeriod(value);
                    setPlan(null);
                    setPlanTier(null);
                    setPaymentMethod(null);
                  }}
                  onSelect={(tier, period) => {
                    setBillingPeriod(period);
                    setPlan(period);
                    setPlanTier(tier);
                    setPaymentMethod(null);
                    resetPanel("register");
                  }}
                />
              ) : (
                <div className={cx("mx-auto mt-12 grid gap-5", planGridClass)}>
                  {monthlyAvailable && (
                    <PlanCard
                      badge={
                        billing.monthlyCardTrial.enabled
                          ? t("trialDaysFree", {
                              days: billing.monthlyCardTrial.days,
                            })
                          : undefined
                      }
                      title={t("monthlyTitle")}
                      price={monthlyPrice}
                      period={t("monthlyPeriod")}
                      description={
                        monthlyPixAvailable
                          ? t("monthlyPixHint")
                          : t("monthlyHint")
                      }
                      note={
                        monthlyPixAvailable
                          ? t("monthlyPixNote")
                          : t("monthlyNote")
                      }
                      cta={t("monthlyCta")}
                      selected={plan === "monthly"}
                      onSelect={() => {
                        setPlan("monthly");
                        setPlanTier(null);
                        setPaymentMethod(null);
                        resetPanel("register");
                      }}
                      t={t}
                    />
                  )}
                  {annualAvailable && (
                    <PlanCard
                      featured
                      title={t("annualTitle")}
                      price={annualDiscount ? annualPixPrice : annualPrice}
                      period={
                        annualDiscount ? t("priceInPix") : t("annualPeriod")
                      }
                      priceNote={
                        annualDiscount
                          ? t("orPriceOnCard", { price: annualPrice })
                          : undefined
                      }
                      badge={
                        annualDiscount
                          ? t("saveAmount", { amount: annualDiscount })
                          : t("bestValue")
                      }
                      description={t("annualHint")}
                      note={
                        annualPixAvailable
                          ? t("annualPixNote")
                          : t("annualNote")
                      }
                      cta={t("annualCta")}
                      selected={plan === "annual"}
                      onSelect={() => {
                        setPlan("annual");
                        setPlanTier(null);
                        setPaymentMethod(null);
                        resetPanel("register");
                      }}
                      t={t}
                    />
                  )}
                  {lifetimeAvailable && (
                    <PlanCard
                      title={t("lifetimeTitle")}
                      price={
                        lifetimeDiscount ? lifetimePixPrice : lifetimePrice
                      }
                      period={
                        lifetimeDiscount ? t("priceInPix") : t("lifetimePeriod")
                      }
                      priceNote={
                        lifetimeDiscount
                          ? t("orPriceOnCard", { price: lifetimePrice })
                          : undefined
                      }
                      badge={
                        lifetimeDiscount
                          ? t("saveAmount", { amount: lifetimeDiscount })
                          : undefined
                      }
                      description={t("lifetimeHint")}
                      note={
                        lifetimePixAvailable ? t("lifetimePixNote") : undefined
                      }
                      cta={t("lifetimeCta")}
                      selected={plan === "lifetime"}
                      onSelect={() => {
                        setPlan("lifetime");
                        setPlanTier(null);
                        setPaymentMethod(null);
                        resetPanel("register");
                      }}
                      t={t}
                    />
                  )}
                </div>
              ))}
            {billing.plansEnabled && (
              <div className="mx-auto max-w-[760px] text-center">
                <ExistingAccessActions
                  t={t}
                  onRecover={() => resetPanel("recover")}
                  onAccess={() => {
                    setAccessSessionId(null);
                    setAccessOpen(true);
                  }}
                />
                {version && (
                  <p className="mt-3 text-xs text-muted-foreground/70">
                    v{version}
                  </p>
                )}
              </div>
            )}
            {showUnavailableMessage && mode === "register" && (
              <p className="mx-auto mt-10 max-w-[560px] text-center text-sm text-muted-foreground">
                {t("newAccessUnavailable")}
              </p>
            )}
            <div
              ref={formRef}
              className={cx(
                "mx-auto grid max-w-[660px] transition-all duration-500",
                showRegisterForm || mode !== "register"
                  ? "mt-8 grid-rows-[1fr] opacity-100"
                  : "mt-0 grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
                  {mode === "register" && showRegisterForm && (
                    <form className="space-y-6" onSubmit={submitRegister}>
                      <div>
                        <h3 className="text-2xl font-bold">
                          {t("createAccess")}
                        </h3>
                        {billing.billingEnabled && plan && (
                          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-background/50 px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">
                                {t("selectedPlan")}
                              </p>
                              <p className="truncate text-sm font-medium">
                                {billing.plansEnabled && plan !== "lifetime"
                                  ? `${tierDisplayName(planTier)} ${plan === "annual" ? t("annualTitle").toLowerCase() : t("monthlyTitle").toLowerCase()} • ${selectedPlanPrice}`
                                  : plan === "monthly"
                                    ? `${t("monthlyTitle")} • ${selectedPlanPrice || monthlyPrice}`
                                    : plan === "annual"
                                      ? paymentMethod === "pix" &&
                                        annualDiscount
                                        ? `${t("annualTitle")} • ${selectedPlanPrice} ${t("priceInPix")}`
                                        : paymentMethod === "card" &&
                                            annualDiscount
                                          ? `${t("annualTitle")} • ${selectedPlanPrice} ${t("priceOnCard")}`
                                          : `${t("annualTitle")} • ${selectedPlanPrice || annualPrice}`
                                      : paymentMethod === "pix" &&
                                          lifetimeDiscount
                                        ? `${t("lifetimeTitle")} • ${selectedPlanPrice} ${t("priceInPix")}`
                                        : paymentMethod === "card" &&
                                            lifetimeDiscount
                                          ? `${t("lifetimeTitle")} • ${selectedPlanPrice} ${t("priceOnCard")}`
                                          : `${t("lifetimeTitle")} • ${selectedPlanPrice || lifetimePrice}`}
                              </p>
                              {plan === "annual" &&
                                annualDiscount &&
                                !paymentMethod && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {t("orPriceOnCard", { price: annualPrice })}
                                  </p>
                                )}
                              {plan === "lifetime" &&
                                lifetimeDiscount &&
                                !paymentMethod && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {t("orPriceOnCard", {
                                      price: lifetimePrice,
                                    })}
                                  </p>
                                )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setPlan(null);
                                setPlanTier(null);
                                setPaymentMethod(null);
                              }}
                              className="shrink-0 text-sm text-primary hover:underline"
                            >
                              {t("change")}
                            </button>
                          </div>
                        )}
                        {errors.plan && (
                          <p className="mt-2 text-xs text-destructive">
                            {errors.plan}
                          </p>
                        )}
                      </div>
                      {billing.billingEnabled && selectedPlanHasPix && plan && (
                        <PaymentMethodSelector
                          plan={plan}
                          planTier={planTier}
                          billing={billing}
                          locale={locale}
                          prices={billing.prices}
                          monthlyCardTrial={billing.monthlyCardTrial}
                          paymentMethod={paymentMethod}
                          setPaymentMethod={setPaymentMethod}
                          error={errors.paymentMethod}
                          t={t}
                        />
                      )}
                      <FormField
                        label={t("name")}
                        placeholder={t("namePlaceholder")}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        error={errors.name}
                      />
                      <FormField
                        label={t("email")}
                        type="email"
                        placeholder={t("emailPlaceholder")}
                        value={form.email}
                        onChange={(e) =>
                          setForm({ ...form, email: e.target.value })
                        }
                        error={errors.email}
                      />
                      <FormField
                        label={t("recoveryPin")}
                        type="password"
                        autoComplete="new-password"
                        placeholder={t("pinPlaceholder")}
                        value={form.recoveryPin}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            recoveryPin: sanitizeRecoverySecret(e.target.value),
                          })
                        }
                        error={errors.recoveryPin}
                        hint={t("pinHint")}
                      />
                      <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={form.accepted}
                          onChange={(e) =>
                            setForm({ ...form, accepted: e.target.checked })
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(0.55_0.2_300)]"
                        />
                        {t("notice")}
                      </label>
                      {errors.accepted && (
                        <p className="text-xs text-destructive">
                          {errors.accepted}
                        </p>
                      )}
                      <Button
                        size="lg"
                        className="w-full"
                        type="submit"
                        disabled={
                          loading ||
                          (billing.billingEnabled &&
                            selectedPlanHasPix &&
                            !paymentMethod)
                        }
                      >
                        {loading
                          ? t(
                              billing.billingEnabled
                                ? "checkoutLoading"
                                : "loading",
                            )
                          : billing.billingEnabled && selectedPlanHasPix
                            ? paymentMethod === "pix"
                              ? t("continueWithPix")
                              : paymentMethod === "card"
                                ? t("continueWithCard")
                                : t("choosePaymentMethodCta")
                            : billing.billingEnabled
                              ? t("continuePlan")
                              : t("createFree")}
                      </Button>
                    </form>
                  )}
                  {mode === "verify" && (
                    <form className="space-y-6" onSubmit={confirmCode}>
                      <div>
                        <h3 className="text-2xl font-bold">
                          {t("confirmEmailTitle")}
                        </h3>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {t("emailSent")}{" "}
                          <span className="text-foreground">
                            {normalizeEmail(form.email)}
                          </span>
                        </p>
                      </div>
                      <VerificationCodeInput
                        autoFocus
                        label={t("verificationCode")}
                        value={form.code}
                        onChange={(code) => setForm({ ...form, code })}
                        error={errors.code}
                      />
                      <Button
                        size="lg"
                        className="w-full"
                        type="submit"
                        disabled={loading}
                      >
                        {loading ? t("loading") : t("confirmCode")}
                      </Button>
                      <div className="space-y-2 text-center text-xs text-muted-foreground">
                        <button
                          type="button"
                          disabled={cooldown > 0 || loading || !pending}
                          onClick={() => pending && sendVerification(pending)}
                          className="text-foreground/80 disabled:text-muted-foreground"
                        >
                          {cooldown > 0
                            ? t("resendIn", { seconds: cooldown })
                            : t("resendCode")}
                        </button>
                        <br />
                        <button
                          type="button"
                          onClick={() =>
                            resetPanel(pending?.mode || "register")
                          }
                          className="text-primary hover:underline"
                        >
                          {t("changeEmail")}
                        </button>
                      </div>
                    </form>
                  )}
                  {mode === "recover" && (
                    <SimpleForm
                      title={t("recoverTitle")}
                      email={form.email}
                      pin={form.recoveryPin}
                      errors={errors}
                      t={t}
                      loading={loading}
                      submitText="recoverSubmit"
                      onBack={() => resetPanel("register")}
                      onEmail={(email) => setForm({ ...form, email })}
                      onPin={(recoveryPin) => setForm({ ...form, recoveryPin })}
                      onSubmit={(e) => submitSimple(e, "recover")}
                    />
                  )}
                  {mode === "payment-status" && (
                    <SimpleForm
                      title={t("paymentStatusTitle")}
                      email={form.email}
                      errors={errors}
                      t={t}
                      loading={loading}
                      submitText="paymentStatusSubmit"
                      hint={t("paymentStatusHint")}
                      onBack={() => resetPanel("register")}
                      onEmail={(email) => setForm({ ...form, email })}
                      onSubmit={(e) => submitSimple(e, "payment-status")}
                    />
                  )}
                  {mode === "billing-portal" && (
                    <SimpleForm
                      title={t("billingPortalTitle")}
                      email={form.email}
                      pin={form.recoveryPin}
                      errors={errors}
                      t={t}
                      loading={loading}
                      submitText="billingPortalSubmit"
                      hint={t("billingPortalHint")}
                      onBack={() => resetPanel("register")}
                      onEmail={(email) => setForm({ ...form, email })}
                      onPin={(recoveryPin) => setForm({ ...form, recoveryPin })}
                      onSubmit={(e) => submitSimple(e, "billing-portal")}
                    />
                  )}
                  {mode === "success" && success && (
                    <SuccessPanel
                      success={success}
                      copied={copied}
                      setCopied={setCopied}
                      t={t}
                    />
                  )}
                  {mode === "pix" && pixOrder && (
                    <PixPaymentPanel
                      order={pixOrder}
                      plan={plan || pixOrder.planType}
                      copied={pixCopied}
                      checking={pixChecking}
                      setCopied={setPixCopied}
                      t={t}
                      onRetry={() => checkPixStatus(pixOrder, true)}
                      onNewPix={() => {
                        setPixOrder(null);
                        setMode("verify");
                      }}
                    />
                  )}
                  {mode === "payment-result" && paymentResult && (
                    <PaymentResultPanel
                      paymentResult={paymentResult}
                      t={t}
                      onRetry={() =>
                        checkPaymentStatus(normalizeEmail(form.email))
                      }
                      onBack={() => resetPanel("register")}
                    />
                  )}
                  {message && (
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                      {message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <AccessModal
        open={accessOpen}
        sessionId={accessSessionId}
        notice={accessNotice}
        billing={billing}
        locale={locale}
        t={t}
        onClose={() => {
          setAccessOpen(false);
          setAccessSessionId(null);
          setAccessNotice("");
        }}
        onRecover={() => {
          setAccessOpen(false);
          setAccessSessionId(null);
          setAccessNotice("");
          resetPanel("recover");
          window.setTimeout(
            () =>
              formRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              }),
            80,
          );
        }}
        onBackToPlans={() => {
          setAccessOpen(false);
          setAccessSessionId(null);
          setAccessNotice("");
          scrollToId("planos");
        }}
      />
      {modal && (
        <StatusModalView modal={modal} t={t} onClose={() => setModal(null)} />
      )}
    </section>
  );
}

function VerificationCodeInput({
  label,
  value,
  onChange,
  error,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const setCode = (next: string, focusIndex?: number) => {
    const sanitized = next.replace(/\D/g, "").slice(0, 6);
    onChange(sanitized);
    if (typeof focusIndex === "number") {
      window.requestAnimationFrame(() =>
        refs.current[Math.max(0, Math.min(5, focusIndex))]?.focus(),
      );
    }
  };

  return (
    <div>
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div
        className="mt-3 grid grid-cols-6 gap-2 sm:gap-3"
        role="group"
        aria-label={label}
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            autoFocus={autoFocus && index === 0}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`${label} ${index + 1}`}
            value={digit.trim()}
            onChange={(event) => {
              const typed = event.target.value.replace(/\D/g, "");
              if (typed.length > 1) {
                setCode(
                  value.slice(0, index) + typed + value.slice(index + 1),
                  Math.min(5, index + typed.length),
                );
                return;
              }
              const chars = value.padEnd(6, " ").slice(0, 6).split("");
              chars[index] = typed;
              setCode(chars.join(""), typed ? index + 1 : index);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Backspace" &&
                !digits[index].trim() &&
                index > 0
              ) {
                refs.current[index - 1]?.focus();
              }
              if (event.key === "ArrowLeft" && index > 0)
                refs.current[index - 1]?.focus();
              if (event.key === "ArrowRight" && index < 5)
                refs.current[index + 1]?.focus();
            }}
            onPaste={(event) => {
              event.preventDefault();
              setCode(event.clipboardData.getData("text"), 5);
            }}
            className={cx(
              "h-12 rounded-xl border bg-background/70 text-center text-lg font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-14",
              error ? "border-destructive" : "border-border",
            )}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PaymentMethodSelector({
  plan,
  planTier,
  billing,
  locale,
  prices,
  monthlyCardTrial,
  paymentMethod,
  setPaymentMethod,
  error,
  t,
}: {
  plan: PlanType;
  planTier: PlanTier | null;
  billing: BillingState;
  locale: Locale;
  prices: BillingState["prices"];
  monthlyCardTrial: BillingState["monthlyCardTrial"];
  paymentMethod: PaymentMethod | null;
  setPaymentMethod: (value: PaymentMethod) => void;
  error?: string;
  t: TFn;
}) {
  const monthlyCardBody = monthlyCardTrial.enabled
    ? t("paymentCardMonthlyTrial", { days: monthlyCardTrial.days })
    : t("paymentCardMonthly");
  const cardPrice =
    billing.plansEnabled && plan !== "lifetime"
      ? getTierPrice(billing, "card", planTier, plan as BillingPeriod)
      : plan === "monthly"
        ? prices.monthly
        : plan === "annual"
          ? prices.annual
          : prices.lifetime;
  const pixPrice =
    billing.plansEnabled && plan !== "lifetime"
      ? getTierPrice(billing, "pix", planTier, plan as BillingPeriod)
      : plan === "monthly"
        ? prices.monthly
        : plan === "annual"
          ? prices.pixAnnual || prices.annual
          : prices.pixLifetime || prices.lifetime;
  const tierDiscountCents =
    billing.plansEnabled && plan !== "lifetime"
      ? Math.max(0, priceAmountCents(cardPrice) - priceAmountCents(pixPrice))
      : 0;
  const discountCents =
    billing.plansEnabled && plan !== "lifetime"
      ? tierDiscountCents
      : plan === "annual"
        ? annualPixDiscountCents(prices)
        : plan === "lifetime"
          ? lifetimePixDiscountCents(prices)
          : 0;
  const discountCurrency =
    billing.plansEnabled && plan !== "lifetime"
      ? cardPrice?.currency || pixPrice?.currency
      : plan === "annual"
        ? prices.annual?.currency || prices.pixAnnual?.currency
        : prices.lifetime?.currency || prices.pixLifetime?.currency;
  const discount =
    discountCents > 0
      ? formatCents(locale, discountCents, discountCurrency || "brl")
      : "";
  const cardBody =
    plan === "monthly"
      ? monthlyCardBody
      : plan === "annual"
        ? t("paymentCardAnnual")
        : discount
          ? t("cardRegularPayment")
          : t("paymentCardLifetime");
  const pixBody =
    plan === "monthly"
      ? t("paymentPixMonthly")
      : plan === "annual"
        ? discount
          ? t("pixDiscountApplied", { amount: discount })
          : t("paymentPixAnnual")
        : discount
          ? t("pixDiscountApplied", { amount: discount })
          : t("paymentPixLifetime");
  const methods: Array<{
    value: PaymentMethod;
    title: string;
    body: string;
    badge?: string;
  }> = [
    {
      value: "card",
      title: `${t("paymentCard")} • ${formatMoney(locale, cardPrice)}`,
      body: cardBody,
    },
    {
      value: "pix",
      title: `${t("paymentPix")} • ${formatMoney(locale, pixPrice)}`,
      body: pixBody,
      badge: discount ? t("bestPrice") : undefined,
    },
  ];

  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">
        {t("paymentMethodTitle")}
      </legend>
      <p className="mt-1 text-xs text-muted-foreground">
        {plan === "monthly"
          ? t("paymentMethodMonthlyHint")
          : plan === "annual"
            ? t("paymentMethodAnnualHint")
            : t("paymentMethodLifetimeHint")}
      </p>
      <div
        className="mt-4 grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t("paymentMethodTitle")}
      >
        {methods.map((method) => {
          const selected = paymentMethod === method.value;
          return (
            <button
              key={method.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPaymentMethod(method.value)}
              className={cx(
                "rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_oklch(0.55_0.2_300/14%)]"
                  : "border-border bg-background/35 hover:border-primary/30",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{method.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {method.badge && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
                      {method.badge}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cx(
                      "h-3.5 w-3.5 rounded-full border",
                      selected
                        ? "border-primary bg-primary shadow-[inset_0_0_0_3px_oklch(0.20_0.02_275)]"
                        : "border-muted-foreground/40",
                    )}
                  />
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {method.body}
              </p>
            </button>
          );
        })}
      </div>
      {(plan === "monthly" || plan === "annual") && paymentMethod === "pix" && (
        <div className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.045] px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("pixNoAutoTitle")}
            </span>{" "}
            {plan === "annual" ? t("pixNoAutoAnnualBody") : t("pixNoAutoBody")}
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

function PixPaymentPanel({
  order,
  plan,
  copied,
  checking,
  setCopied,
  t,
  onRetry,
  onNewPix,
}: {
  order: PixOrder;
  plan: PlanType;
  copied: boolean;
  checking: boolean;
  setCopied: (value: boolean) => void;
  t: TFn;
  onRetry: () => void;
  onNewPix: () => void;
}) {
  const isExpired = order.status === "expired";
  const isFailed = order.status === "failed";
  const qrSrc = order.qrCodeBase64
    ? `data:image/png;base64,${order.qrCodeBase64}`
    : "";

  return (
    <div>
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
          {t("paymentPix")}
        </p>
        <h3 className="mt-2 text-2xl font-bold">
          {isExpired
            ? t("pixExpiredTitle")
            : isFailed
              ? t("pixErrorTitle")
              : t("pixPayTitle")}
        </h3>
        <p className="mx-auto mt-3 max-w-[430px] text-sm leading-relaxed text-muted-foreground">
          {isExpired
            ? t("pixExpiredBody")
            : isFailed
              ? t("pixErrorBody")
              : plan === "monthly"
                ? t("pixMonthlyBody")
                : plan === "annual"
                  ? t("pixAnnualBody")
                  : t("pixLifetimeBody")}
        </p>
      </div>

      {!isExpired && !isFailed && (
        <div className="mx-auto mt-7 grid h-[210px] w-[210px] place-items-center rounded-2xl border border-border bg-white p-4">
          {qrSrc ? (
            <img
              src={qrSrc}
              alt={t("pixQrAlt")}
              className="h-full w-full object-contain"
            />
          ) : (
            <div
              className="h-full w-full rounded-lg bg-background/10"
              aria-label={t("pixQrAlt")}
            />
          )}
        </div>
      )}

      {!isExpired && !isFailed && (
        <div className="mt-6 rounded-xl border border-border bg-background/50 p-4">
          <p className="text-xs text-muted-foreground">{t("pixCopyLabel")}</p>
          <div className="mt-2 flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">
              {order.qrCode}
            </p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(order.qrCode);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              }}
              className="shrink-0 text-sm font-medium text-primary hover:underline"
            >
              {copied ? t("copiedShort") : t("copy")}
            </button>
          </div>
        </div>
      )}

      {!isExpired && !isFailed && (
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          {t("pixWaiting")}
        </div>
      )}
      {!isExpired && !isFailed && (plan === "monthly" || plan === "annual") && (
        <p className="mx-auto mt-4 max-w-[430px] text-center text-xs leading-relaxed text-muted-foreground/80">
          {plan === "annual" ? t("pixAnnualFootnote") : t("pixMonthlyFootnote")}
        </p>
      )}
      <div className="mt-6 grid gap-3">
        {isExpired ? (
          <Button size="lg" className="w-full" type="button" onClick={onNewPix}>
            {t("pixGenerateNew")}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            type="button"
            onClick={onRetry}
            disabled={checking}
          >
            {checking ? t("checkingPaymentStatus") : t("paymentStatusRetry")}
          </Button>
        )}
      </div>
    </div>
  );
}

function SimpleForm({
  title,
  email,
  pin,
  errors,
  hint,
  t,
  loading,
  submitText,
  onBack,
  onEmail,
  onPin,
  onSubmit,
}: {
  title: string;
  email: string;
  pin?: string;
  errors: Record<string, string>;
  hint?: string;
  t: TFn;
  loading: boolean;
  submitText: string;
  onBack: () => void;
  onEmail: (email: string) => void;
  onPin?: (pin: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <h3 className="text-2xl font-bold">{title}</h3>
      <FormField
        label={t("email")}
        type="email"
        value={email}
        placeholder={t("emailPlaceholder")}
        onChange={(e) => onEmail(e.target.value)}
        error={errors.email}
        hint={hint}
      />
      {onPin && (
        <FormField
          label={t("recoveryPin")}
          type="password"
          autoComplete="current-password"
          value={pin || ""}
          placeholder={t("pinPlaceholder")}
          onChange={(e) => onPin(sanitizeRecoverySecret(e.target.value))}
          error={errors.recoveryPin}
          hint={t("pinHint")}
        />
      )}
      <Button size="lg" className="w-full" type="submit" disabled={loading}>
        {loading ? t("loading") : t(submitText)}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        type="button"
        onClick={onBack}
      >
        {t("backToCreate")}
      </Button>
    </form>
  );
}

function SuccessPanel({
  success,
  copied,
  setCopied,
  t,
}: {
  success: { title: string; licenseKey: string; recoveryPin?: string | null };
  copied: boolean;
  setCopied: (value: boolean) => void;
  t: TFn;
}) {
  return (
    <div className="py-2 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-2xl text-primary">
        ✓
      </div>
      <h3 className="mt-6 text-2xl font-bold">{success.title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("successDescription")}
      </p>
      <div className="mt-8 rounded-xl border border-border bg-background/50 p-5 text-left">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {t("keyLabel")}
        </p>
        <p className="mt-3 break-all font-mono text-lg text-foreground">
          {success.licenseKey}
        </p>
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => {
            navigator.clipboard?.writeText(success.licenseKey);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? t("copied") : t("copyKey")}
        </Button>
      </div>
      {success.recoveryPin && (
        <div className="mt-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-left">
          <p className="text-xs text-yellow-200">{t("pinFinalNotice")}</p>
          <p className="mt-2 font-mono text-lg font-bold">
            {success.recoveryPin}
          </p>
        </div>
      )}
      <a
        className="mt-6 inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground"
        href={DOWNLOAD_URL}
      >
        {t("downloadMerlin")}
      </a>
    </div>
  );
}

function PaymentResultPanel({
  paymentResult,
  t,
  onRetry,
  onBack,
}: {
  paymentResult: PaymentResult;
  t: TFn;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="py-2 text-center">
      <div
        className={cx(
          "mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-xl text-primary",
          paymentResult.status === "processing" && "text-yellow-300",
          paymentResult.status === "not_found" && "text-muted-foreground",
        )}
      >
        {paymentResult.licenseKey
          ? "✓"
          : paymentResult.status === "processing"
            ? "..."
            : "!"}
      </div>
      <h3 className="mt-6 text-2xl font-bold">{paymentResult.title}</h3>
      <p className="mx-auto mt-3 max-w-[420px] text-sm text-muted-foreground">
        {paymentResult.text}
      </p>
      {paymentResult.licenseKey && (
        <div className="mt-8 rounded-xl border border-border bg-background/50 p-5 text-left">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {t("keyLabel")}
          </p>
          <p className="mt-3 break-all font-mono text-lg text-foreground">
            {paymentResult.licenseKey}
          </p>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() =>
              navigator.clipboard?.writeText(paymentResult.licenseKey)
            }
          >
            {t("copyKey")}
          </Button>
        </div>
      )}
      <div className="mt-6 grid gap-3">
        {paymentResult.licenseKey ? (
          <a
            className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground"
            href={DOWNLOAD_URL}
          >
            {t("downloadMerlin")}
          </a>
        ) : (
          <Button size="lg" className="w-full" onClick={onRetry}>
            {t("paymentStatusRetry")}
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={onBack}>
          {t("backToCreate")}
        </Button>
      </div>
    </div>
  );
}

function AccessModal({
  open,
  sessionId,
  notice,
  billing,
  locale,
  t,
  onClose,
  onRecover,
  onBackToPlans,
}: {
  open: boolean;
  sessionId: string | null;
  notice?: string;
  billing: BillingState;
  locale: Locale;
  t: TFn;
  onClose: () => void;
  onRecover: () => void;
  onBackToPlans: () => void;
}) {
  const [step, setStep] = useState<AccessStep>("identify");
  const [email, setEmail] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [access, setAccess] = useState<AccessDetailsPayload | null>(null);
  const [upgradeStatus, setUpgradeStatus] = useState<
    "processing" | "completed" | "expired"
  >("processing");
  const [renewalPixOrder, setRenewalPixOrder] = useState<PixOrder | null>(null);
  const [renewalPixCopied, setRenewalPixCopied] = useState(false);
  const [renewalPixChecking, setRenewalPixChecking] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage("");
    setLoading(false);
    setCode("");
    setAccess(null);
    setRenewalPixOrder(null);
    setRenewalPixCopied(false);
    setRememberDevice(false);
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
    const id = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [open, cooldown]);

  useEffect(() => {
    if (!open || !sessionId || step !== "upgrade-status") return undefined;
    let canceled = false;
    async function poll() {
      for (let attempt = 0; attempt < 15 && !canceled; attempt += 1) {
        try {
          const payload = await fetch(
            `/api/public/access/upgrade-status?session_id=${encodeURIComponent(sessionId)}`,
          ).then((r) => r.json());
          if (payload?.success !== false && payload.status === "completed") {
            setUpgradeStatus("completed");
            return;
          }
          if (payload?.success !== false && payload.status === "expired") {
            setUpgradeStatus("expired");
            return;
          }
        } catch {
          /* checkout may still be settling */
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      if (!canceled) setUpgradeStatus("processing");
    }
    void poll();
    return () => {
      canceled = true;
    };
  }, [open, sessionId, step]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    const next: Record<string, string> = {};
    if (!validEmail(email)) next.email = t("errorEmail");
    if (!validRecoverySecret(recoveryPin)) next.recoveryPin = t("errorPin");
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    setMessage(t("sendingCode"));
    try {
      const normalized = normalizeEmail(email);
      await postJson(
        "/api/public/access/identify",
        { email: normalized, recoveryPin },
        t("genericError"),
      );
      const payload = await postJson<{
        cooldownSeconds?: number;
        deliveryMode?: "email" | "staging_test";
      }>(
        "/api/public/email-verification/start",
        { email: normalized },
        t("genericError"),
      );
      setEmail(normalized);
      setCooldown(Number(payload.cooldownSeconds || 60));
      setStep("verify");
      setMessage(
        payload.deliveryMode === "staging_test"
          ? t("stagingTestCode")
          : t("emailCodeSent"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAccess() {
    const payload = await postJson<AccessDetailsPayload>(
      "/api/public/access/me",
      { email: normalizeEmail(email), recoveryPin },
      t("genericError"),
    );
    setAccess(payload);
    setStep("details");
    setMessage("");
  }

  async function confirmAccess(event: React.FormEvent) {
    event.preventDefault();
    if (!isAcceptedVerificationCode(code.trim())) {
      setErrors({ code: t("errorCode") });
      return;
    }
    const accessWindow = window.open("/meu-acesso?pending=1", "_blank");
    setLoading(true);
    setErrors({});
    setMessage(t("loading"));
    try {
      await postJson(
        "/api/public/email-verification/verify",
        { email: normalizeEmail(email), code: code.trim() },
        t("genericError"),
      );
      await postJson(
        "/api/public/access/session",
        { email: normalizeEmail(email), recoveryPin, rememberDevice },
        t("genericError"),
      );
      if (accessWindow) {
        accessWindow.opener = null;
        accessWindow.location.href = "/meu-acesso";
      } else window.location.assign("/meu-acesso");
      onClose();
    } catch (error) {
      accessWindow?.close();
      setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function startUpgrade() {
    setLoading(true);
    setMessage(t("checkoutLoading"));
    try {
      const payload = await postJson<{ checkoutUrl: string }>(
        "/api/public/access/upgrade-checkout",
        { email: normalizeEmail(email), recoveryPin },
        t("genericError"),
      );
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("genericError"));
      setLoading(false);
    }
  }

  async function openSubscriptionPortal() {
    const portal = window.open("/meu-acesso?opening-portal=1", "_blank");
    setLoading(true);
    setMessage(t("loading"));
    try {
      const payload = await postJson<{ portalUrl?: string }>(
        "/api/public/access/billing-portal",
        { email: normalizeEmail(email), recoveryPin },
        t("billingPortalUnavailable"),
      );
      if (!payload.portalUrl) throw new Error(t("billingPortalUnavailable"));
      if (portal) {
        portal.opener = null;
        portal.location.href = payload.portalUrl;
      } else {
        window.location.href = payload.portalUrl;
      }
      setLoading(false);
    } catch (error) {
      portal?.close();
      setMessage(
        error instanceof Error ? error.message : t("billingPortalUnavailable"),
      );
      setLoading(false);
    }
  }

  async function previewPlanChange(target: {
    tier: PlanTier;
    period: BillingPeriod;
  }) {
    const payload = await postJson<
      PublicPlanChangeResponse<PublicPlanChangePreview>
    >(
      "/api/public/access/plan-change/preview",
      {
        email: normalizeEmail(email),
        recoveryPin,
        targetTier: target.tier,
        targetPeriod: target.period,
      },
      t("genericError"),
    );
    return payload.planChange;
  }

  async function createPlanChange(target: {
    tier: PlanTier;
    period: BillingPeriod;
  }) {
    const payload = await postJson<
      PublicPlanChangeResponse<{
        status: "pending_payment" | "scheduled" | "applied";
        checkoutUrl?: string;
      }>
    >(
      "/api/public/access/plan-change",
      {
        email: normalizeEmail(email),
        recoveryPin,
        targetTier: target.tier,
        targetPeriod: target.period,
      },
      t("genericError"),
    );
    const planChange = payload.planChange;
    if (planChange.status === "pending_payment") {
      if (!planChange.checkoutUrl) throw new Error(t("genericError"));
      window.location.href = planChange.checkoutUrl;
      return planChange.status;
    }
    await loadAccess();
    return planChange.status;
  }

  async function cancelPlanChange() {
    await postJson(
      "/api/public/access/plan-change/cancel",
      {
        email: normalizeEmail(email),
        recoveryPin,
      },
      t("genericError"),
    );
    await loadAccess();
  }

  async function startRenewal(method: PaymentMethod) {
    const current = access?.access;
    if (!current?.name) return;
    const renewalPlan = current.kind === "annual" ? "annual" : "monthly";
    setLoading(true);
    setMessage(method === "pix" ? t("pixCreating") : t("checkoutLoading"));
    try {
      const body = {
        name: current.name,
        contact: normalizeEmail(email),
        recoveryPin,
        acceptedRecoveryNotice: true,
        planType: renewalPlan,
      };
      if (method === "pix") {
        const payload = await postJson<PixOrder>(
          "/api/public/pix/orders",
          { ...body, mercadoPagoDeviceId: getMercadoPagoDeviceId() },
          t("genericError"),
        );
        localStorage.setItem("merlin_checkout_email", normalizeEmail(email));
        setRenewalPixOrder(payload);
        setRenewalPixCopied(false);
        setMessage("");
        setLoading(false);
        return;
      }
      const payload = await postJson<{ checkoutUrl: string }>(
        "/api/public/checkout",
        body,
        t("genericError"),
      );
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
      const payload = await fetch(
        `/api/public/pix/orders/${encodeURIComponent(order.paymentIntentId)}/status`,
      ).then((r) => r.json());
      if (payload.status === "paid" && payload.license) {
        setAccess((value) =>
          value
            ? {
                ...value,
                access: value.access
                  ? {
                      ...value.access,
                      current: true,
                      billingStatus: "active",
                      expiresAt: payload.license.expiresAt,
                      renewal: {
                        ...(value.access.renewal || { available: false }),
                        available: false,
                      },
                    }
                  : value.access,
              }
            : value,
        );
        setRenewalPixOrder(null);
        setMessage(t("paymentApprovedText"));
        return "paid";
      }
      if (payload.status === "expired") {
        setRenewalPixOrder((value) =>
          value ? { ...value, status: "expired" } : value,
        );
        return "expired";
      }
      if (payload.status === "failed") {
        setRenewalPixOrder((value) =>
          value ? { ...value, status: "failed" } : value,
        );
        return "failed";
      }
    } catch (error) {
      if (manual)
        setMessage(error instanceof Error ? error.message : t("genericError"));
    } finally {
      if (manual) setRenewalPixChecking(false);
    }
    return "awaiting_payment";
  }

  useEffect(() => {
    if (
      !open ||
      !renewalPixOrder ||
      renewalPixOrder.status !== "awaiting_payment"
    )
      return undefined;
    let canceled = false;
    const id = window.setInterval(() => {
      if (!canceled) void checkRenewalPixStatus(renewalPixOrder);
    }, 3500);
    return () => {
      canceled = true;
      window.clearInterval(id);
    };
  }, [open, renewalPixOrder?.paymentIntentId, renewalPixOrder?.status]);

  if (!open) return null;
  const current = access?.access;
  const subscription = current?.subscription;
  const isMonthly = current?.kind === "monthly";
  const isAnnual = current?.kind === "annual";
  const isLifetime = current?.kind === "lifetime";
  const upgradePrice = current?.upgrade?.price
    ? formatMoney(locale, current.upgrade.price)
    : "";
  const currentTier = current?.planTier || "ouro";

  if (step === "details" && current && !renewalPixOrder) {
    return (
      <div
        className="fixed inset-0 z-[75] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="max-h-[calc(100vh-32px)] w-full max-w-[1040px] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-8"
          onClick={(event) => event.stopPropagation()}
        >
          <AccessDetailsPoc
            access={current}
            billing={billing}
            locale={locale}
            onClose={onClose}
            onBackToPlans={onBackToPlans}
            onPortal={openSubscriptionPortal}
            onPreview={previewPlanChange}
            onCreate={createPlanChange}
            onCancelChange={cancelPlanChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100vh-32px)] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
              {t("myAccess")}
            </p>
            <h3 className="mt-2 text-2xl font-bold">
              {step === "upgrade-status"
                ? t("upgradeStatusTitle")
                : t("accessModalTitle")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            x
          </button>
        </div>
        {step === "identify" && (
          <form className="mt-6 space-y-5" onSubmit={sendCode}>
            {notice && (
              <div className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                {notice}
              </div>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("accessIdentifyBody")}
            </p>
            <FormField
              label={t("email")}
              type="email"
              value={email}
              placeholder={t("emailPlaceholder")}
              onChange={(event) => setEmail(event.target.value)}
              error={errors.email}
            />
            <FormField
              label={t("recoveryPin")}
              type="password"
              autoComplete="current-password"
              value={recoveryPin}
              placeholder={t("pinPlaceholder")}
              onChange={(event) =>
                setRecoveryPin(sanitizeRecoverySecret(event.target.value))
              }
              error={errors.recoveryPin}
              hint={t("pinHint")}
            />
            <label className="flex cursor-pointer items-center gap-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-[oklch(0.55_0.2_300)]"
              />
              {t("rememberDeviceSevenDays")}
            </label>
            <Button
              size="lg"
              className="w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? t("loading") : t("accessContinue")}
            </Button>
          </form>
        )}
        {step === "verify" && (
          <form className="mt-6 space-y-5" onSubmit={confirmAccess}>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("emailSent")}{" "}
              <span className="text-foreground">{normalizeEmail(email)}</span>
            </p>
            <VerificationCodeInput
              autoFocus
              label={t("verificationCode")}
              value={code}
              onChange={setCode}
              error={errors.code}
            />
            <Button
              size="lg"
              className="w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? t("loading") : t("confirmCode")}
            </Button>
            <div className="space-y-2 text-center text-xs text-muted-foreground">
              <button
                type="button"
                disabled={cooldown > 0 || loading}
                onClick={() => sendCode()}
                className="text-foreground/80 disabled:text-muted-foreground"
              >
                {cooldown > 0
                  ? t("resendIn", { seconds: cooldown })
                  : t("resendCode")}
              </button>
              <br />
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setStep("identify");
                  setCode("");
                  setErrors({});
                  setMessage("");
                }}
                className="text-primary hover:underline"
              >
                {t("changeEmail")}
              </button>
            </div>
          </form>
        )}
        {step === "details" && access?.status === "not_found" && (
          <div className="mt-7 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-border bg-background/50 text-lg">
              !
            </div>
            <h4 className="mt-5 text-xl font-bold">
              {t("accessNotFoundTitle")}
            </h4>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t("accessNotFoundBody")}
            </p>
            <Button className="mt-6 w-full" onClick={onBackToPlans}>
              {t("backToCreate")}
            </Button>
          </div>
        )}
        {step === "details" && renewalPixOrder && (
          <div className="mt-7">
            <PixPaymentPanel
              order={renewalPixOrder}
              plan={renewalPixOrder.planType}
              copied={renewalPixCopied}
              checking={renewalPixChecking}
              setCopied={setRenewalPixCopied}
              t={t}
              onRetry={() => checkRenewalPixStatus(renewalPixOrder, true)}
              onNewPix={() => startRenewal("pix")}
            />
          </div>
        )}
        {step === "details" && current && !renewalPixOrder && (
          <div className="mt-7 space-y-5">
            <div className="rounded-xl border border-border bg-background/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("currentPlan")}
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {isMonthly || isAnnual
                      ? `${currentTier.charAt(0).toUpperCase()}${currentTier.slice(1)} ${isAnnual ? t("annualTitle") : t("monthlyTitle")}`
                      : isLifetime
                        ? t("lifetimeTitle")
                        : t("activeAccessTitle")}
                  </p>
                </div>
                <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {accessStatusLabel(
                    t,
                    current.current === false
                      ? "expired"
                      : current.billingStatus || subscription?.status,
                  )}
                </span>
              </div>
              {(isMonthly || isAnnual) && (
                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <InfoItem
                    label={
                      current.current === false ||
                      subscription?.cancelAtPeriodEnd
                        ? t("availableUntil")
                        : t("nextRenewal")
                    }
                    value={formatDate(
                      locale,
                      subscription?.currentPeriodEnd || current.expiresAt,
                    )}
                  />
                  <InfoItem
                    label={t("renewalLabel")}
                    value={
                      current.current === false
                        ? t("renewalExpired")
                        : subscription?.canManage
                          ? subscription?.cancelAtPeriodEnd
                            ? t("renewalCanceled")
                            : t("renewalAutomatic")
                          : t("renewalManual")
                    }
                  />
                </div>
              )}
              {isLifetime && (
                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                  {t("accessLifetimeBody")}
                </p>
              )}
              {isMonthly &&
                current.current !== false &&
                !subscription?.canManage && (
                  <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                    {t("monthlyActiveWaitBody")}
                  </p>
                )}
              {isAnnual &&
                current.current !== false &&
                !subscription?.canManage && (
                  <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                    {t("annualManualActiveBody")}
                  </p>
                )}
            </div>
            {(isMonthly || isAnnual) &&
              current.current === false &&
              current.renewal?.available && (
                <div className="rounded-xl border border-primary/35 bg-primary/10 p-5">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
                    {t("renewAccessEyebrow")}
                  </p>
                  <h4 className="mt-2 text-xl font-bold">
                    {t("renewAccessTitle")}
                  </h4>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {isAnnual
                      ? t("renewAnnualAccessBody")
                      : t("renewAccessBody")}
                  </p>
                  {current.renewal.price && (
                    <p className="mt-5 font-display text-3xl font-bold">
                      {formatMoney(locale, current.renewal.price)}
                    </p>
                  )}
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {current.renewal.card && (
                      <Button
                        size="lg"
                        onClick={() => startRenewal("card")}
                        disabled={loading}
                      >
                        {loading ? t("loading") : t("continueWithCard")}
                      </Button>
                    )}
                    {current.renewal.pix && (
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => startRenewal("pix")}
                        disabled={loading}
                      >
                        {loading ? t("loading") : t("continueWithPix")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            {(isMonthly || isAnnual) &&
              current.current === false &&
              !current.renewal?.available && (
                <div className="rounded-xl border border-border bg-background/50 p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t("renewUnavailableBody")}
                  </p>
                </div>
              )}
            {isMonthly && current.upgrade?.available && (
              <div className="rounded-xl border border-primary/35 bg-primary/10 p-5">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
                  {t("upgradeCardEyebrow")}
                </p>
                <h4 className="mt-2 text-xl font-bold">
                  {t("upgradeCardTitle")}
                </h4>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t("upgradeCardBody")}
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-display text-3xl font-bold">
                    {upgradePrice}
                  </p>
                  <Button size="lg" onClick={startUpgrade} disabled={loading}>
                    {loading ? t("loading") : t("upgradeCta")}
                  </Button>
                </div>
              </div>
            )}
            {(isMonthly || isAnnual) &&
              current.current !== false &&
              subscription?.canManage && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={openSubscriptionPortal}
                  disabled={loading}
                >
                  {t("openSubscriptionOptions")}
                </Button>
              )}
            {isLifetime && (
              <div className="grid gap-3 sm:grid-cols-2">
                <a
                  className="inline-flex h-13 items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground"
                  href={DOWNLOAD_URL}
                >
                  {t("downloadMerlin")}
                </a>
                <Button variant="outline" onClick={onRecover}>
                  {t("recoverMyKey")}
                </Button>
              </div>
            )}
          </div>
        )}
        {step === "upgrade-status" && (
          <div className="mt-7 text-center">
            <div
              className={cx(
                "mx-auto grid h-14 w-14 place-items-center rounded-full border border-primary/40 bg-primary/10 text-lg text-primary",
                upgradeStatus === "processing" && "text-yellow-300",
                upgradeStatus === "expired" && "text-muted-foreground",
              )}
            >
              {upgradeStatus === "completed"
                ? "OK"
                : upgradeStatus === "expired"
                  ? "!"
                  : "..."}
            </div>
            <h4 className="mt-5 text-xl font-bold">
              {upgradeStatus === "completed"
                ? t("upgradeApprovedTitle")
                : upgradeStatus === "expired"
                  ? t("upgradeExpiredTitle")
                  : t("upgradeProcessingTitle")}
            </h4>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {upgradeStatus === "completed"
                ? t("upgradeApprovedBody")
                : upgradeStatus === "expired"
                  ? t("upgradeExpiredBody")
                  : t("upgradeProcessingBody")}
            </p>
            <div className="mt-6 grid gap-3">
              {upgradeStatus === "completed" && (
                <a
                  className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-7 font-medium text-primary-foreground"
                  href={DOWNLOAD_URL}
                >
                  {t("downloadMerlin")}
                </a>
              )}
              <Button variant="outline" className="w-full" onClick={onClose}>
                {t("modalClose")}
              </Button>
            </div>
          </div>
        )}
        {message && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function AccessDetailsPoc({
  access,
  billing,
  locale,
  t,
  onClose,
  onBackToPlans,
  onPortal,
  onPreview,
  onCreate,
  onCancelChange,
}: {
  access: NonNullable<AccessDetailsPayload["access"]>;
  billing: BillingState;
  locale: Locale;
  t: TFn;
  onClose: () => void;
  onBackToPlans: () => void;
  onPortal: () => void;
  onPreview: (target: {
    tier: PlanTier;
    period: BillingPeriod;
  }) => Promise<PublicPlanChangePreview>;
  onCreate: (target: {
    tier: PlanTier;
    period: BillingPeriod;
  }) => Promise<"pending_payment" | "scheduled" | "applied">;
  onCancelChange: () => Promise<void>;
}) {
  const [view, setView] = useState<AccessPlanChangeView>("overview");
  const [target, setTarget] = useState<{
    tier: PocTier;
    period: PocPeriod;
  } | null>(null);
  const [preview, setPreview] = useState<PublicPlanChangePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const externalRedirectStarted = useRef(false);

  const period: PocPeriod = access.kind === "annual" ? "annual" : "monthly";
  const tier: PocTier = access.planTier || "ouro";
  const planChange = access.planChange;
  const subscriptionCanceled =
    access.billingStatus === "canceled" ||
    access.subscription?.status === "canceled";
  let status: PocStatus = access.current === false ? "expired" : "active";
  if (access.kind === "lifetime") status = "lifetime";
  else if (access.accessType === "test") status = "test";
  else if (["free", "manual"].includes(access.accessType || ""))
    status = "manual";
  else if (planChange?.status === "scheduled") status = "scheduled";
  else if (planChange?.status === "pending_payment") status = "pending";
  else if (planChange?.status === "not_completed") status = "failed";
  else if (subscriptionCanceled) status = "canceled";
  else if (access.subscription?.cancelAtPeriodEnd) status = "canceling";

  const renewal = formatDate(
    locale,
    planChange?.effectiveAt ||
      access.subscription?.currentPeriodEnd ||
      access.expiresAt,
  );
  const scenario: PocScenario = {
    id: "real-access",
    label: t("accessPortalTitle"),
    tier,
    period,
    payment: access.subscription?.canManage ? "card" : "pix",
    status,
    renewalDate: renewal,
    pendingTarget: planChange
      ? { tier: planChange.targetTier, period: planChange.targetPeriod }
      : undefined,
  };
  const isCardSubscription = Boolean(access.subscription?.canManage);
  const isRecurring = access.kind === "monthly" || access.kind === "annual";
  const isManualPixAccess = isRecurring && !isCardSubscription;
  const periodEnabled = (candidate: PocPeriod) =>
    candidate === "monthly" ? billing.monthlyEnabled : billing.annualEnabled;
  const availablePeriods = (["monthly", "annual"] as PocPeriod[]).filter(
    (candidate) =>
      periodEnabled(candidate) &&
      (["bronze", "prata", "ouro"] as PocTier[]).some((candidateTier) =>
        Boolean(getTierPrice(billing, "card", candidateTier, candidate)),
      ),
  );
  const isAvailable = (candidateTier: PocTier, candidatePeriod: PocPeriod) =>
    periodEnabled(candidatePeriod) &&
    Boolean(getTierPrice(billing, "card", candidateTier, candidatePeriod));
  const canChange = Boolean(
    billing.plansEnabled &&
    billing.billingEnabled &&
    isRecurring &&
    access.current !== false &&
    isCardSubscription &&
    status !== "pending" &&
    status !== "scheduled" &&
    status !== "canceled",
  );
  const currentPrice =
    getTierPrice(billing, "card", tier, period)?.amountCents ??
    getTierPrice(billing, "pix", tier, period)?.amountCents ??
    null;

  function beginChange() {
    if (!canChange) return;
    setTarget(null);
    setPreview(null);
    setError("");
    setView("change");
  }

  async function requestPreview() {
    if (busy || !target || !isAvailable(target.tier, target.period)) return;
    setBusy(true);
    setError("");
    try {
      const next = await onPreview({
        tier: target.tier,
        period: target.period,
      });
      setPreview(next);
      setView("preview");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("accessPlanChangePreviewError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange() {
    if (busy || !target) return;
    externalRedirectStarted.current = false;
    setBusy(true);
    setError("");
    try {
      const result = await onCreate({
        tier: target.tier,
        period: target.period,
      });
      if (result === "pending_payment") {
        externalRedirectStarted.current = true;
        return;
      }
      if (result === "scheduled") {
        setView("overview");
        setTarget(null);
        setPreview(null);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("accessPlanChangeConfirmError"),
      );
      setView("change");
    } finally {
      if (!externalRedirectStarted.current) setBusy(false);
    }
  }

  async function cancelScheduledChange() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onCancelChange();
      setView("overview");
      setTarget(null);
      setPreview(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("accessPlanChangeCancelError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmReplacement() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onCancelChange();
      setTarget(null);
      setPreview(null);
      setView("change");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("accessPlanChangeCancelError"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (view === "replace") {
    return (
      <div className="px-1 pb-2 sm:px-2">
        <header className="mb-10 flex flex-col gap-5 border-b border-border pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Merlin
            </p>
            <h3 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {t("accessPortalTitle")}
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("accessPortalBody")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <StatusPill status={status} t={t} />
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("close")}
            >
              ×
            </button>
          </div>
        </header>
        <section className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Alteração agendada
            </p>
            <h2 className="mt-3 text-3xl font-semibold">
              Escolher outra alteração
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Para escolher outro plano, vamos cancelar a alteração agendada
              atual. Sua assinatura e seu acesso continuam iguais.
            </p>
            {error && (
              <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setView("overview")}
                disabled={busy}
              >
                Voltar
              </Button>
              <Button size="lg" onClick={confirmReplacement} disabled={busy}>
                {busy ? "Cancelando..." : "Cancelar e escolher plano"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (view === "change") {
    return (
      <div className="px-1 pb-2 sm:px-2">
        <header className="mb-10 flex flex-col gap-5 border-b border-border pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Merlin
            </p>
            <h3 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {t("accessPortalTitle")}
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("accessPortalBody")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <StatusPill status={status} t={t} />
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("close")}
            >
              ×
            </button>
          </div>
        </header>
        {error && (
          <StateBanner
            tone="error"
            title={t("accessPlanChangePreviewError")}
            body={error}
          />
        )}
        <ChangeView
          scenario={scenario}
          tier={tier}
          period={period}
          flagOff={false}
          target={target}
          onBack={() => {
            setError("");
            setView("overview");
          }}
          onTarget={setTarget}
          onPreview={requestPreview}
          periods={availablePeriods}
          priceFor={(candidateTier, candidatePeriod) =>
            getTierPrice(billing, "card", candidateTier, candidatePeriod)
              ?.amountCents ?? null
          }
          isAvailable={isAvailable}
        />
      </div>
    );
  }

  if (view === "preview" && preview && target) {
    return (
      <div className="px-1 pb-2 sm:px-2">
        <header className="mb-10 flex flex-col gap-5 border-b border-border pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Merlin
            </p>
            <h3 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {t("accessPortalTitle")}
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("accessPortalBody")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <StatusPill status={status} t={t} />
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("close")}
            >
              ×
            </button>
          </div>
        </header>
        <PreviewView
          scenario={scenario}
          tier={tier}
          period={period}
          target={target}
          dueNow={
            preview.requiresPaymentConfirmation
              ? (preview.amountDueNowCents ?? 0)
              : 0
          }
          isDowngrade={preview.timing === "period_end"}
          scheduled={preview.timing === "period_end"}
          targetPriceCents={preview.targetAmountCents}
          busy={busy}
          onBack={() => {
            setError("");
            setView("change");
          }}
          onConfirm={confirmChange}
        />
      </div>
    );
  }

  return (
    <div className="px-1 pb-2 sm:px-2">
      <header className="mb-10 flex flex-col gap-5 border-b border-border pb-9 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Merlin
          </p>
          <h3 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("accessPortalTitle")}
          </h3>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("accessPortalBody")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StatusPill status={status} t={t} />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
      </header>
      {error && (
        <StateBanner
          tone="error"
          title={t("accessChangeUpdateError")}
          body={error}
        />
      )}
      {isManualPixAccess && status === "active" && (
        <StateBanner
          tone="pending"
          title="Renovação Pix"
          body={`Seu acesso continua no plano atual até ${renewal}. Nessa data, você poderá escolher outro plano para renovar.`}
        />
      )}
      {status === "canceling" && (
        <StateBanner
          tone="pending"
          title="Cancelamento agendado"
          body={`Seu acesso continua ativo até ${renewal}. Para retomar a assinatura, use o portal da Stripe.`}
          action={
            access.subscription?.canManage
              ? { label: "Gerenciar cobrança", onClick: onPortal }
              : undefined
          }
        />
      )}
      {status === "canceled" && (
        <StateBanner
          tone="pending"
          title="Assinatura cancelada"
          body={`Seu acesso continua ativo até ${renewal}. Após essa data, escolha um novo plano para continuar usando o Merlin.`}
        />
      )}
      {status === "pending" && (
        <StateBanner
          tone="pending"
          title="Alteração processando"
          body="Estamos aguardando a confirmação da Stripe. Seu plano atual continua ativo até a confirmação."
        />
      )}
      {status === "failed" && (
        <StateBanner
          tone="error"
          title="Alteração não concluída"
          body="Seu plano atual continua ativo. Você pode iniciar uma nova alteração quando quiser."
          action={
            canChange
              ? { label: "Tentar novamente", onClick: beginChange }
              : undefined
          }
        />
      )}
      {status === "expired" && (
        <StateBanner
          tone="error"
          title="Seu acesso expirou"
          body="Escolha um novo plano para continuar usando o Merlin."
          action={{ label: "Ver planos", onClick: onBackToPlans }}
        />
      )}
      <Overview
        scenario={scenario}
        tier={tier}
        period={period}
        cardEnding={scenario.payment === "card" ? "Cartão cadastrado" : "Pix"}
        canChange={canChange}
        flagOff={!billing.plansEnabled}
        priceCents={currentPrice}
        onChange={beginChange}
        onPortal={onPortal}
        onCancelScheduled={cancelScheduledChange}
        onReplaceScheduled={() => setView("replace")}
      />
    </div>
  );
}
function StatusModalView({
  modal,
  t,
  onClose,
}: {
  modal: NonNullable<StatusModal>;
  t: TFn;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cx(
            "mx-auto grid h-13 w-13 place-items-center rounded-full bg-primary text-lg font-bold",
            modal.tone === "warn" && "bg-yellow-500",
            modal.tone === "error" && "bg-red-500",
          )}
        >
          {modal.tone === "ok" ? "✓" : "!"}
        </div>
        <h3 className="mt-5 text-2xl font-bold">{modal.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {modal.text}
        </p>
        <Button className="mt-6 w-full" onClick={onClose}>
          {t("modalClose")}
        </Button>
      </div>
    </div>
  );
}

function MyAccessPage({
  billing,
  locale,
  t,
}: {
  billing: BillingState;
  locale: Locale;
  t: TFn;
}) {
  const [access, setAccess] = useState<AccessDetailsPayload | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isPendingWindow = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("pending") === "1" || params.get("opening-portal") === "1";
  }, []);

  const refreshAccess = useCallback(async () => {
    const response = await fetch("/api/public/access/session", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false)
      throw new Error(
        payload.error || t("accessSessionError"),
      );
    setAccess(payload as AccessDetailsPayload);
    setCsrfToken(String(payload.csrfToken || ""));
    setError("");
  }, [t]);

  useEffect(() => {
    if (isPendingWindow) return undefined;
    void refreshAccess()
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : t("accessSessionError"),
        ),
      )
      .finally(() => setLoading(false));
    const onFocus = () => {
      void refreshAccess().catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const params = new URLSearchParams(window.location.search);
    if (params.get("access") === "plan-change-return")
      setNotice(t("accessPlanChangeUpdating"));
    if (params.get("access") === "plan-change-cancel")
      setNotice(t("accessPlanChangeCanceled"));
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isPendingWindow, refreshAccess, t]);

  async function postSession<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-merlin-access-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false)
      throw new Error(
        payload.error || t("accessChangeUpdateError"),
      );
    return payload as T;
  }

  async function openPortal() {
    const portal = window.open("/meu-acesso?opening-portal=1", "_blank");
    try {
      const payload = await postSession<{ portalUrl?: string }>(
        "/api/public/access/session/billing-portal",
        {},
      );
      if (!payload.portalUrl)
        throw new Error(t("accessPortalOpenError"));
      if (portal) {
        portal.opener = null;
        portal.location.href = payload.portalUrl;
      } else window.location.assign(payload.portalUrl);
    } catch (reason) {
      portal?.close();
      throw reason;
    }
  }

  if (loading || isPendingWindow)
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 text-sm text-muted-foreground">
        {t("accessSessionLoading")}
      </div>
    );
  if (error || !access?.access)
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">{t("accessModalTitle")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {error || t("accessSessionExpired")}
          </p>
          <Button
            className="mt-7 w-full"
            onClick={() => {
              window.location.href = "/download";
            }}
          >
            {t("accessReturn")}
          </Button>
        </div>
      </div>
    );

  const returnNotice =
    new URLSearchParams(window.location.search).get("access") ===
    "plan-change-return"
      ? access.access.planChange?.status === "pending_payment"
        ? t("accessPlanChangeUpdating")
        : access.access.planChange?.status === "not_completed"
          ? t("accessPlanChangeNotCompleted")
          : t("accessPlanChangeCompleted")
      : notice;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-[1040px] px-5 py-10 sm:px-8 sm:py-16">
        {returnNotice && (
          <StateBanner tone="pending" title={t("accessPortalTitle")} body={returnNotice} />
        )}
        <AccessDetailsPoc
          access={access.access}
          billing={billing}
          locale={locale}
          t={t}
          onClose={() => {
            if (window.opener) window.close();
            else window.location.href = "/download";
          }}
          onBackToPlans={() => {
            window.location.href = "/download#planos";
          }}
          onPortal={() => {
            void openPortal().catch((reason) =>
              setError(
                reason instanceof Error
                  ? reason.message
                  : t("accessPortalOpenError"),
              ),
            );
          }}
          onPreview={async (target) => {
            const payload = await postSession<
              PublicPlanChangeResponse<PublicPlanChangePreview>
            >("/api/public/access/session/plan-change/preview", {
              targetTier: target.tier,
              targetPeriod: target.period,
            });
            return payload.planChange;
          }}
          onCreate={async (target) => {
            const payload = await postSession<
              PublicPlanChangeResponse<{
                status: "pending_payment" | "scheduled" | "applied";
                checkoutUrl?: string;
              }>
            >("/api/public/access/session/plan-change", {
              targetTier: target.tier,
              targetPeriod: target.period,
            });
            const planChange = payload.planChange;
            if (planChange.status === "pending_payment") {
              if (!planChange.checkoutUrl)
                throw new Error(t("accessPlanChangeStartError"));
              window.location.assign(planChange.checkoutUrl);
            }
            if (
              planChange.status === "scheduled" ||
              planChange.status === "applied"
            )
              window.location.reload();
            return planChange.status;
          }}
          onCancelChange={async () => {
            await postSession(
              "/api/public/access/session/plan-change/cancel",
              {},
            );
            window.location.reload();
          }}
        />
      </main>
    </div>
  );
}

export function App() {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());
  const [billing, setBilling] = useState<BillingState>(INITIAL_BILLING_STATE);
  const [version, setVersion] = useState("");
  const dict = useMemo(
    () => ({ ...dictionaries.en, ...dictionaries[locale] }),
    [locale],
  );
  const t = useCallback(
    (key: string, vars: Record<string, string | number> = {}) => {
      let value = dict[key] || dictionaries.en[key] || key;
      Object.entries(vars).forEach(([name, replacement]) => {
        value = value.replace(`{${name}}`, String(replacement));
      });
      return value;
    },
    [dict],
  );
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    localStorage.setItem("merlin_public_language", value);
  };
  const purchaseAvailable = canPurchaseAccess(billing);

  useEffect(() => {
    Promise.all([
      fetch("/api/billing/settings-public").then((r) => r.json()),
      fetch("/api/billing/plan-prices-public")
        .then((r) => r.json())
        .catch(() => ({ prices: [] })),
    ])
      .then(([payload, pricesPayload]) =>
        setBilling(
          parseBillingPayload(
            payload,
            Array.isArray(pricesPayload?.prices) ? pricesPayload.prices : [],
          ),
        ),
      )
      .catch(() => setBilling((value) => ({ ...value, loaded: true })));
    fetch("/api/updates/latest")
      .then((r) => r.json())
      .then((payload) =>
        setVersion(payload?.version ? String(payload.version) : ""),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ptbr" ? "pt-BR" : locale;
    document.title = t("metaTitle");
  }, [locale, t]);

  useEffect(() => {
    if (
      window.location.pathname === "/meu-acesso" ||
      window.location.pathname === "/meu-acesso/"
    )
      return undefined;

    let firstFrame = 0;
    let secondFrame = 0;
    const focusRequestedSection = () => {
      const query = new URLSearchParams(window.location.search);
      const hashId = decodeURIComponent(
        window.location.hash.replace(/^#/, ""),
      ).trim();
      const id = hashId || query.get("focus") || "";
      if (!id) return;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => scrollToId(id));
      });
    };

    focusRequestedSection();
    window.addEventListener("hashchange", focusRequestedSection);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.removeEventListener("hashchange", focusRequestedSection);
    };
  }, [billing.loaded]);

  if (
    window.location.pathname === "/meu-acesso" ||
    window.location.pathname === "/meu-acesso/"
  ) {
    return <MyAccessPage billing={billing} locale={locale} t={t} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        locale={locale}
        setLocale={setLocale}
        purchaseAvailable={purchaseAvailable}
        t={t}
      />
      <main>
        <Hero purchaseAvailable={purchaseAvailable} t={t} />
        <section
          id="o-que-e"
          className="relative overflow-hidden bg-surface section-y"
        >
          <div className="container-merlin relative">
            <div
              aria-hidden
              className="aura pointer-events-none absolute -right-24 top-1/2 hidden h-72 w-72 -translate-y-1/2 rounded-full md:block"
            />
            <div className="relative max-w-[640px]">
              <SectionTitle>{t("whatTitle")}</SectionTitle>
              <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
                {t("whatBody1")}
              </p>
              <p className="mt-5 text-base leading-relaxed text-foreground/80 sm:text-lg">
                {t("whatBody2")}
              </p>
            </div>
          </div>
        </section>
        <section id="como-funciona" className="section-y">
          <div className="container-merlin">
            <div className="mx-auto max-w-[640px] text-center">
              <SectionTitle center>{t("videoTitle")}</SectionTitle>
              <p className="mt-4 text-muted-foreground">{t("videoBody")}</p>
            </div>
            <div className="mx-auto mt-12 w-full max-w-[390px] sm:max-w-[420px]">
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-[0_18px_70px_rgba(124,58,237,0.08)]">
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src="https://www.youtube-nocookie.com/embed/VDDSgNpHqeo?rel=0"
                  title={t("videoIframeTitle")}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            </div>
            <div className="mt-10 flex justify-center">
              <MarketingCta
                purchaseAvailable={purchaseAvailable}
                t={t}
                size="lg"
              />
            </div>
          </div>
        </section>
        <section id="seguranca" className="bg-surface section-y">
          <div className="container-merlin">
            <SectionTitle>{t("securityTitle")}</SectionTitle>
            <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-14">
              <div>
                <h3 className="text-xl font-bold">
                  {t("securityTransparencyTitle")}
                </h3>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  {t("securityTransparencyBody")}
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold">{t("securityBanTitle")}</h3>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  {t("securityBanBody")}
                </p>
              </div>
            </div>
            <div className="mt-12">
              <MarketingCta
                purchaseAvailable={purchaseAvailable}
                t={t}
                size="lg"
              />
            </div>
          </div>
        </section>
        <section className="section-y">
          <div className="container-merlin">
            <SectionTitle className="max-w-[620px]">
              {t("compatibilityTitle")}
            </SectionTitle>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {COMPAT_CARDS.map((card) => (
                <div
                  key={card.title}
                  className={cx(
                    "flex h-full flex-col rounded-2xl border bg-card p-7 sm:p-8",
                    card.accent ? "border-primary/25" : "border-border",
                  )}
                >
                  <div
                    className={cx(
                      "flex h-[74px] w-[74px] items-center justify-center rounded-2xl border p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_30px_rgba(0,0,0,0.25)]",
                      card.accent
                        ? "border-primary/35 bg-primary/10"
                        : "border-primary/20 bg-white/[0.035]",
                    )}
                  >
                    <img
                      src={card.icon}
                      alt={card.alt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain [filter:drop-shadow(0_0_10px_rgba(139,92,246,0.18))_brightness(1.14)_contrast(1.12)_saturate(1.08)]"
                    />
                  </div>
                  <h3 className="mt-6 text-lg font-bold">{t(card.title)}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(card.body)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <div className="bg-surface">
          <Feedbacks purchaseAvailable={purchaseAvailable} t={t} />
        </div>
        <PartnersSection t={t} />
        <Plans locale={locale} t={t} billing={billing} version={version} />
        <section className="relative overflow-hidden section-y">
          <div
            aria-hidden
            className="aura pointer-events-none absolute left-1/2 top-1/2 h-64 w-[min(90%,640px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
          <div className="container-merlin relative">
            <div className="mx-auto max-w-[680px] text-center">
              <SectionTitle center>{t("finalTitle")}</SectionTitle>
              <p className="mt-5 text-muted-foreground">{t("finalBody")}</p>
              <div className="mt-9 flex justify-center">
                <MarketingCta
                  purchaseAvailable={purchaseAvailable}
                  t={t}
                  size="lg"
                />
              </div>
            </div>
          </div>
        </section>
        <footer className="border-t border-border py-10">
          <div className="container-merlin flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <img
                src={`${ASSET_BASE}/assets/branding/merlin-logo.png`}
                alt="Merlin"
                className="h-8 w-8 object-contain object-top sm:h-9 sm:w-9"
              />
              <span className="font-display text-base font-bold sm:text-lg">
                Merlin
              </span>
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <a
                href={DOWNLOAD_URL}
                className="transition-colors hover:text-foreground"
              >
                Download
              </a>
              <a
                href="https://www.instagram.com/merlin.launcher/"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Instagram
              </a>
              <a
                href="https://www.tiktok.com/@merlin.launcher"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                TikTok
              </a>
              <a
                href="https://github.com/azteka-merlin/"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                GitHub
              </a>
            </nav>
            <p className="text-xs text-muted-foreground">{t("footerRights")}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
