export type PocTier = "bronze" | "prata" | "ouro";
export type PocPeriod = "monthly" | "annual";
export type PocPayment = "card" | "pix" | "none";
export type PocStatus =
  | "active"
  | "pending"
  | "failed"
  | "scheduled"
  | "canceling"
  | "canceled"
  | "expired"
  | "lifetime"
  | "test"
  | "manual"
  | "legacy"
  | "error"
  | "stale";

export type PocScenario = {
  id: string;
  label: string;
  tier?: PocTier;
  period?: PocPeriod;
  payment: PocPayment;
  status: PocStatus;
  renewalDate?: string;
  pendingTarget?: { tier: PocTier; period: PocPeriod };
  message?: string;
};

export const POC_PRICES = {
  bronze: { monthly: 1490, annual: 11990 },
  prata: { monthly: 1990, annual: 15990 },
  ouro: { monthly: 2490, annual: 19990 },
} as const;

export const POC_SCENARIOS: PocScenario[] = [
  {
    id: "ouro-monthly",
    label: "Ouro mensal",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
  },
  {
    id: "prata-monthly",
    label: "Prata mensal",
    tier: "prata",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
  },
  {
    id: "bronze-monthly",
    label: "Bronze mensal",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
  },
  {
    id: "bronze-annual",
    label: "Bronze anual",
    tier: "bronze",
    period: "annual",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2027",
  },
  {
    id: "prata-annual",
    label: "Prata anual",
    tier: "prata",
    period: "annual",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2027",
  },
  {
    id: "ouro-annual",
    label: "Ouro anual",
    tier: "ouro",
    period: "annual",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2027",
  },
  {
    id: "upgrade",
    label: "Upgrade Bronze → Ouro",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "processing",
    label: "Upgrade processando",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "pending",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "change-pending",
    label: "Alteração processando",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "pending",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "change-not-completed",
    label: "Alteração não concluída",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "failed",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "downgrade-scheduled",
    label: "Downgrade agendado",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "scheduled",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "bronze", period: "monthly" },
  },
  {
    id: "downgrade-replace",
    label: "Substituir downgrade",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "scheduled",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "bronze", period: "monthly" },
  },
  {
    id: "monthly-annual",
    label: "Prata mensal → anual",
    tier: "prata",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "prata", period: "annual" },
  },
  {
    id: "upgrade-annual",
    label: "Bronze mensal → Ouro anual",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "active",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "annual" },
  },
  {
    id: "annual-monthly",
    label: "Ouro anual → mensal",
    tier: "ouro",
    period: "annual",
    payment: "card",
    status: "scheduled",
    renewalDate: "20/05/2027",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "annual-downgrade",
    label: "Ouro anual → Bronze mensal",
    tier: "ouro",
    period: "annual",
    payment: "card",
    status: "scheduled",
    renewalDate: "20/05/2027",
    pendingTarget: { tier: "bronze", period: "monthly" },
  },
  {
    id: "canceling",
    label: "Cancelamento no fim do período",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "canceling",
    renewalDate: "17/09/2026",
  },
  {
    id: "expired",
    label: "Assinatura expirada",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "expired",
  },
  {
    id: "pix-monthly",
    label: "Pix mensal",
    tier: "prata",
    period: "monthly",
    payment: "pix",
    status: "active",
    renewalDate: "17/09/2026",
  },
  {
    id: "pix-upgrade",
    label: "Upgrade Pix pendente",
    tier: "bronze",
    period: "monthly",
    payment: "pix",
    status: "pending",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "pix-expired",
    label: "Upgrade Pix expirado",
    tier: "bronze",
    period: "monthly",
    payment: "pix",
    status: "failed",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
  {
    id: "pix-downgrade",
    label: "Downgrade Pix agendado",
    tier: "ouro",
    period: "annual",
    payment: "pix",
    status: "scheduled",
    renewalDate: "17/09/2027",
    pendingTarget: { tier: "prata", period: "annual" },
  },
  {
    id: "lifetime",
    label: "Vitalício legado",
    tier: "ouro",
    payment: "none",
    status: "lifetime",
  },
  { id: "test", label: "Licença de teste", payment: "none", status: "test" },
  {
    id: "manual",
    label: "Acesso gratuito/manual",
    payment: "none",
    status: "manual",
  },
  {
    id: "legacy",
    label: "Assinatura Stripe legada",
    tier: "ouro",
    period: "monthly",
    payment: "card",
    status: "legacy",
    renewalDate: "17/09/2026",
  },
  {
    id: "flag-off",
    label: "Feature flag desligada",
    payment: "card",
    status: "legacy",
    renewalDate: "17/09/2026",
  },
  {
    id: "load-error",
    label: "Erro ao carregar billing",
    payment: "none",
    status: "error",
    message: "Não foi possível carregar as informações do seu acesso agora.",
  },
  {
    id: "preview-error",
    label: "Preview de alteração falhou",
    tier: "prata",
    period: "monthly",
    payment: "card",
    status: "error",
    renewalDate: "17/09/2026",
    message: "Não foi possível calcular esta alteração agora.",
  },
  {
    id: "stale-preview",
    label: "Alteração não mais válida",
    tier: "bronze",
    period: "monthly",
    payment: "card",
    status: "stale",
    renewalDate: "17/09/2026",
    pendingTarget: { tier: "ouro", period: "monthly" },
  },
];
