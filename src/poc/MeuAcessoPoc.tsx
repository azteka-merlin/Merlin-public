import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  CreditCard,
  Crown,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { Button, cx } from "../ui";
import { dictionaries } from "../i18n";
import {
  POC_PRICES,
  POC_SCENARIOS,
  type PocPeriod,
  type PocScenario,
  type PocStatus,
  type PocTier,
} from "./accessScenarios";

type OperationResult = "success" | "pending" | "not_completed";
type PixResult = "paid" | "pending" | "expired";
type View = "overview" | "change" | "preview";
type TFn = (key: string, vars?: Record<string, string | number>) => string;
const demoT: TFn = (key) => dictionaries.ptbr[key] || dictionaries.en[key] || key;

const tierCopy: Record<
  PocTier,
  { name: string; description: string; benefits: string[] }
> = {
  bronze: {
    name: "Bronze",
    description: "Premium essencial para usar no seu ritmo.",
    benefits: [
      "3 ativações Premium por mês",
      "24h entre ativações Premium",
      "Lançamentos em até 7 dias",
    ],
  },
  prata: {
    name: "Prata",
    description: "Mais liberdade para aproveitar o Premium.",
    benefits: [
      "Premium ilimitado",
      "24h entre ativações Premium",
      "Lançamentos em até 5 dias",
    ],
  },
  ouro: {
    name: "Ouro",
    description: "A experiência completa do Merlin.",
    benefits: [
      "Premium ilimitado",
      "Premiums diferentes sem espera",
      "Lançamentos prioritários em até 48h",
    ],
  },
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function planPrice(tier: PocTier, period: PocPeriod) {
  return POC_PRICES[tier][period];
}

function periodLabel(t: TFn, period?: PocPeriod) {
  return period === "annual" ? t("accessPeriodAnnual") : t("accessPeriodMonthly");
}

function periodSuffix(t: TFn, period?: PocPeriod) {
  return period === "annual" ? t("accessPeriodAnnualSuffix") : t("accessPeriodMonthlySuffix");
}

function currentTier(scenario: PocScenario) {
  return scenario.tier || "ouro";
}

function isScheduled(status: PocStatus) {
  return status === "scheduled";
}

export function StatusPill({ status, t }: { status: PocStatus; t: TFn }) {
  const labels: Partial<Record<PocStatus, string>> = {
    active: t("activeAccessTitle"),
    legacy: t("activeAccessTitle"),
    pending: t("accessPocChangeProcessing"),
    failed: t("accessPocChangeNotCompleted"),
    scheduled: t("accessPocChangeScheduled"),
    canceling: t("accessPocCancellationScheduled"),
    canceled: t("accessPocSubscriptionCanceled"),
    expired: t("accessPocAccessExpired"),
    lifetime: t("accessPocPermanentAccess"),
    test: t("accessPocTestEnvironment"),
    manual: t("accessPocManualAccess"),
  };
  const tone =
    status === "failed" || status === "expired" || status === "error"
      ? "text-destructive border-destructive/30 bg-destructive/10"
      : status === "scheduled" || status === "canceling" || status === "canceled" || status === "pending"
        ? "text-primary border-primary/30 bg-primary/10"
        : "text-emerald-300 border-emerald-400/25 bg-emerald-400/10";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
        tone,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {labels[status] || t("accessPocUpdating")}
    </span>
  );
}

function TierMark({ tier }: { tier: PocTier }) {
  return (
    <div
      className={cx(
        "grid h-12 w-12 place-items-center rounded-xl border",
        tier === "ouro"
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-secondary/60 text-foreground",
      )}
    >
      <Crown className="h-5 w-5" />
    </div>
  );
}

export function MeuAcessoPoc() {
  const [scenario, setScenario] = useState<PocScenario>(POC_SCENARIOS[0]);
  const [view, setView] = useState<View>("overview");
  const [target, setTarget] = useState<{
    tier: PocTier;
    period: PocPeriod;
  } | null>(null);
  const [operation, setOperation] = useState<OperationResult>("success");
  const [pixOutcome, setPixOutcome] = useState<PixResult>("paid");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenarioOpen, setScenarioOpen] = useState(false);

  const isFlagOff = scenario.id === "flag-off";
  const tier = currentTier(scenario);
  const period = scenario.period || "monthly";
  const canChange = ![
    "lifetime",
    "test",
    "manual",
    "expired",
    "error",
  ].includes(scenario.status);
  const cardEnding =
    scenario.payment === "card"
      ? "Cartão •••• 4242"
      : scenario.payment === "pix"
        ? "Pix"
        : "Sem cobrança";
  const resolvedTarget = target || scenario.pendingTarget || null;
  const targetIsDowngrade = resolvedTarget
    ? ["bronze", "prata", "ouro"].indexOf(resolvedTarget.tier) <
        ["bronze", "prata", "ouro"].indexOf(tier) ||
      (period === "annual" && resolvedTarget.period === "monthly")
    : false;
  const dueNow = resolvedTarget
    ? targetIsDowngrade
      ? 0
      : scenario.payment === "pix"
        ? Math.max(
            250,
            planPrice(resolvedTarget.tier, resolvedTarget.period) -
              planPrice(tier, period),
          )
        : 743
    : 0;

  function pickScenario(next: PocScenario) {
    setScenario(next);
    setTarget(null);
    setView("overview");
    setBusy(false);
    setNotice(null);
    setScenarioOpen(false);
  }

  function beginChange() {
    setTarget(scenario.pendingTarget || null);
    setView("change");
    setNotice(null);
  }

  function confirmChange() {
    if (!resolvedTarget || busy) return;
    if (targetIsDowngrade) {
      setScenario((current) => ({
        ...current,
        status: "scheduled",
        pendingTarget: resolvedTarget,
      }));
      setNotice(
        "Alteração agendada. Seu plano atual continua disponível até a próxima renovação.",
      );
      setView("overview");
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      if (
        (scenario.payment === "pix" && pixOutcome === "pending") ||
        (scenario.payment !== "pix" && operation === "pending")
      ) {
        setScenario((current) => ({
          ...current,
          status: "pending",
          pendingTarget: resolvedTarget,
        }));
        setNotice(
          "Estamos confirmando sua alteração. Seu plano atual segue ativo até a confirmação.",
        );
      } else if (
        (scenario.payment === "pix" && pixOutcome === "expired") ||
        (scenario.payment !== "pix" && operation === "not_completed")
      ) {
        setScenario((current) => ({
          ...current,
          status: "failed",
          pendingTarget: resolvedTarget,
        }));
        setNotice(
          "A alteração não foi concluída. Seu plano atual foi preservado.",
        );
      } else {
        setScenario((current) => ({
          ...current,
          tier: resolvedTarget.tier,
          period: resolvedTarget.period,
          status: "active",
          pendingTarget: undefined,
        }));
        setNotice("Plano atualizado com sucesso.");
      }
      setBusy(false);
      setView("overview");
    }, 900);
  }

  function cancelScheduled() {
    setScenario((current) => ({
      ...current,
      status: "active",
      pendingTarget: undefined,
    }));
    setTarget(null);
    setNotice(
      "A alteração agendada foi cancelada. Seu plano atual continua o mesmo.",
    );
  }

  if (scenario.status === "error") {
    return (
      <PocShell
        scenario={scenario}
        scenarioOpen={scenarioOpen}
        setScenarioOpen={setScenarioOpen}
        onScenario={pickScenario}
        operation={operation}
        setOperation={setOperation}
        pixOutcome={pixOutcome}
        setPixOutcome={setPixOutcome}
      >
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center">
          <div className="w-full rounded-2xl border border-border bg-card p-7 text-center shadow-2xl sm:p-10">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlert />
            </div>
            <h1 className="mt-6 text-3xl font-semibold">
              Não foi possível abrir seu acesso
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {scenario.message}
            </p>
            <Button
              className="mt-8"
              onClick={() => pickScenario(POC_SCENARIOS[0])}
            >
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        </div>
      </PocShell>
    );
  }

  return (
    <PocShell
      scenario={scenario}
      scenarioOpen={scenarioOpen}
      setScenarioOpen={setScenarioOpen}
      onScenario={pickScenario}
      operation={operation}
      setOperation={setOperation}
      pixOutcome={pixOutcome}
      setPixOutcome={setPixOutcome}
    >
      <main className="mx-auto max-w-[1040px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
        <header className="mb-10 flex flex-col gap-5 border-b border-border pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Merlin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              Meu acesso
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Gerencie seu plano e suas informações de cobrança.
            </p>
          </div>
          <StatusPill status={scenario.status} t={demoT} />
        </header>

        {notice && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {notice}
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setNotice(null)}
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {scenario.status === "failed" && (
          <StateBanner
            tone="error"
            title={
              scenario.payment === "pix"
                ? "O Pix expirou"
                : "Alteração não concluída"
            }
            body="Seu plano atual continua ativo. Você pode iniciar uma nova alteração quando quiser."
            action={
              canChange
                ? { label: "Tentar novamente", onClick: beginChange }
                : undefined
            }
          />
        )}
        {scenario.status === "pending" && (
          <StateBanner
            tone="pending"
            title={
              scenario.payment === "pix"
                ? "Aguardando pagamento Pix"
                : "Alteração processando"
            }
            body="Estamos aguardando a confirmação da Stripe. O novo plano só ficará ativo depois disso."
          />
        )}
        {(scenario.status === "canceling" || scenario.status === "canceled") && (
          <StateBanner
            tone="pending"
            title="Cancelamento agendado"
            body={`Seu acesso continua ativo até ${scenario.renewalDate}. Para retomar a assinatura, use o portal da Stripe.`}
            action={{
              label: "Gerenciar cobrança",
              onClick: () =>
                setNotice("Nesta POC, o portal da Stripe não é aberto."),
            }}
          />
        )}
        {scenario.status === "expired" && (
          <StateBanner
            tone="error"
            title="Seu acesso expirou"
            body="Escolha um novo plano para continuar usando o Merlin."
            action={{ label: "Ver planos", onClick: beginChange }}
          />
        )}

        {view === "overview" ? (
          <Overview
            scenario={scenario}
            tier={tier}
            period={period}
            cardEnding={cardEnding}
            canChange={canChange}
            flagOff={isFlagOff}
            onChange={beginChange}
            onPortal={() =>
              setNotice("Nesta POC, o Customer Portal é apenas simulado.")
            }
            onCancelScheduled={cancelScheduled}
            onReplaceScheduled={beginChange}
          />
        ) : view === "change" ? (
          <ChangeView
            scenario={scenario}
            tier={tier}
            period={period}
            flagOff={isFlagOff}
            target={target}
            onBack={() => setView("overview")}
            onTarget={setTarget}
            onPreview={() => setView("preview")}
          />
        ) : (
          <PreviewView
            scenario={scenario}
            tier={tier}
            period={period}
            target={resolvedTarget}
            dueNow={dueNow}
            isDowngrade={targetIsDowngrade}
            busy={busy}
            onBack={() => setView("change")}
            onConfirm={confirmChange}
          />
        )}
      </main>
    </PocShell>
  );
}

function PocShell({
  children,
  scenario,
  scenarioOpen,
  setScenarioOpen,
  onScenario,
  operation,
  setOperation,
  pixOutcome,
  setPixOutcome,
}: {
  children: ReactNode;
  scenario: PocScenario;
  scenarioOpen: boolean;
  setScenarioOpen: (value: boolean) => void;
  onScenario: (scenario: PocScenario) => void;
  operation: OperationResult;
  setOperation: (value: OperationResult) => void;
  pixOutcome: PixResult;
  setPixOutcome: (value: PixResult) => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,oklch(0.55_0.2_300/0.13),transparent_62%)]" />
      {children}
      <aside className="fixed bottom-4 left-4 right-4 z-50 rounded-xl border border-border bg-[oklch(0.175_0.012_283/0.96)] p-2 shadow-2xl backdrop-blur sm:left-auto sm:w-80">
        <button
          type="button"
          onClick={() => setScenarioOpen(!scenarioOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-secondary"
        >
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Cenários
          </span>
          <ChevronDown
            className={cx(
              "h-4 w-4 transition-transform",
              scenarioOpen && "rotate-180",
            )}
          />
        </button>
        {scenarioOpen && (
          <div className="border-t border-border px-2 pb-2 pt-3">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Estado da tela
            </label>
            <select
              value={scenario.id}
              onChange={(event) => {
                const next = POC_SCENARIOS.find(
                  (item) => item.id === event.target.value,
                );
                if (next) onScenario(next);
              }}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <optgroup label="Assinaturas">
                {POC_SCENARIOS.slice(0, 6).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Alterações e pagamento">
                {POC_SCENARIOS.slice(6, 23).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Legados e erros">
                {POC_SCENARIOS.slice(23).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Control
                label="Retorno Stripe"
                value={operation}
                values={["success", "pending", "not_completed"]}
                onChange={setOperation}
              />
              <Control
                label="Pix"
                value={pixOutcome}
                values={["paid", "pending", "expired"]}
                onChange={setPixOutcome}
              />
            </div>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
              Controle exclusivo da POC. Nenhuma API, Stripe ou cobrança real é
              chamada.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Control<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
      >
        <>
          {values.map((item) => (
            <option key={item} value={item}>
              {item === "success"
                ? "Sucesso"
                : item === "pending"
                  ? "Pendente"
                  : item === "not_completed"
                    ? "Não concluída"
                      : item === "paid"
                        ? "Pago"
                        : "Expirado"}
            </option>
          ))}
        </>
      </select>
    </label>
  );
}

export function StateBanner({
  tone,
  title,
  body,
  action,
}: {
  tone: "error" | "pending";
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = tone === "error" ? CircleAlert : Clock3;
  return (
    <div
      className={cx(
        "mb-6 rounded-xl border p-4 sm:flex sm:items-center sm:justify-between",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10"
          : "border-primary/25 bg-primary/10",
      )}
    >
      <div className="flex gap-3">
        <Icon
          className={cx(
            "mt-0.5 h-5 w-5 shrink-0",
            tone === "error" ? "text-destructive" : "text-primary",
          )}
        />
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
      {action && (
        <Button
          variant="outline"
          className="mt-4 sm:mt-0"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function Overview({
  scenario,
  tier,
  period,
  t = demoT,
  cardEnding,
  canChange,
  flagOff,
  onChange,
  onPortal,
  onCancelScheduled,
  onReplaceScheduled,
  priceCents,
}: {
  scenario: PocScenario;
  tier: PocTier;
  period: PocPeriod;
  t?: TFn;
  cardEnding: string;
  canChange: boolean;
  flagOff: boolean;
  onChange: () => void;
  onPortal: () => void;
  onCancelScheduled: () => void;
  onReplaceScheduled: () => void;
  priceCents?: number | null;
}) {
  const price = priceCents === undefined ? planPrice(tier, period) : priceCents;
  const permanent = scenario.status === "lifetime";
  const test = scenario.status === "test";
  const manual = scenario.status === "manual";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-42px_rgba(0,0,0,.9)] sm:p-8">
        <div className="flex flex-col gap-6 border-b border-border pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <TierMark tier={tier} />
            <div>
              <p className="text-sm text-muted-foreground">Plano atual</p>
              <h2 className="mt-1 text-3xl font-semibold">
                {test
                  ? "Teste"
                  : manual
                    ? "Acesso manual"
                    : flagOff
                      ? periodLabel(t, period)
                      : tierCopy[tier].name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {permanent
                  ? "Vitalício"
                  : test || manual
                    ? "Sem assinatura recorrente"
                    : periodLabel(t, period)}
              </p>
            </div>
          </div>
          {!test && !manual && (
            <div className="sm:text-right">
              <p className="text-sm text-muted-foreground">
                {permanent ? "Acesso" : "Valor atual"}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {permanent ? "Vitalício" : price === null ? "--" : money(price)}
              </p>
              {!permanent && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {periodSuffix(t, period)}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-5 py-7 sm:grid-cols-2">
          <Info
            icon={CalendarDays}
            label={
              permanent
                ? "Renovação"
                : scenario.status === "canceling" || scenario.status === "canceled"
                  ? "Acesso até"
                  : "Próxima renovação"
            }
            value={
              permanent ? "Não é necessária" : scenario.renewalDate || "--"
            }
          />
          <Info
            icon={scenario.payment === "pix" ? Smartphone : CreditCard}
            label="Pagamento"
            value={cardEnding}
          />
        </div>
        {isScheduled(scenario.status) && scenario.pendingTarget && (
          <div className="rounded-xl border border-primary/25 bg-primary/10 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Alteração agendada
            </p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              Seu {tierCopy[tier].name} continua ativo até{" "}
              <strong>{scenario.renewalDate}</strong>. Depois disso, você
              passará para{" "}
              <strong>
                {tierCopy[scenario.pendingTarget.tier].name}{" "}
                {periodLabel(t, scenario.pendingTarget.period).toLowerCase()}
              </strong>
              .
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" onClick={onReplaceScheduled}>
                Alterar mudança
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onCancelScheduled}
              >
                Cancelar mudança
              </Button>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row">
          <Button size="lg" disabled={!canChange} onClick={onChange}>
            {canChange ? "Alterar plano" : "Ver planos"}
            <ArrowUpRight className="h-4 w-4" />
          </Button>
          {scenario.payment === "card" && !isScheduled(scenario.status) && (
            <Button size="lg" variant="outline" onClick={onPortal}>
              Gerenciar cobrança
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          )}
        </div>
        {scenario.payment === "card" && !isScheduled(scenario.status) && (
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            Pagamento, cartão e cancelamento são gerenciados com segurança pela
            Stripe.
          </p>
        )}
      </section>
      <aside className="rounded-2xl border border-border bg-card/60 p-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Seu plano
        </p>
        <h3 className="mt-3 text-xl font-semibold">
          {test ? "Teste" : manual ? "Acesso liberado" : tierCopy[tier].name}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {test
            ? "Visibilidade Premium equivalente ao Ouro, sem assinatura comercial."
            : manual
              ? "Acesso concedido manualmente, sem cobrança recorrente."
              : tierCopy[tier].description}
        </p>
        {!test && !manual && (
          <ul className="mt-6 space-y-3 border-t border-border pt-5 text-sm text-muted-foreground">
            {tierCopy[tier].benefits.map((item) => (
              <li key={item} className="flex gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export function ChangeView({
  scenario,
  tier,
  period,
  t = demoT,
  flagOff,
  target,
  onBack,
  onTarget,
  onPreview,
  periods,
  priceFor,
  isAvailable,
}: {
  scenario: PocScenario;
  tier: PocTier;
  period: PocPeriod;
  t?: TFn;
  flagOff: boolean;
  target: { tier: PocTier; period: PocPeriod } | null;
  onBack: () => void;
  onTarget: (value: { tier: PocTier; period: PocPeriod }) => void;
  onPreview: () => void;
  periods?: PocPeriod[];
  priceFor?: (tier: PocTier, period: PocPeriod) => number | null;
  isAvailable?: (tier: PocTier, period: PocPeriod) => boolean;
}) {
  const activePeriod =
    target?.period || scenario.pendingTarget?.period || period;
  return (
    <section>
      <button
        className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar ao meu acesso
      </button>
      <div className="max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          Alterar plano
        </p>
        <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">
          Escolha como continuar no Merlin
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Você verá todos os detalhes antes de confirmar qualquer alteração.
        </p>
        <div className="mt-8 inline-flex rounded-lg border border-border bg-card p-1">
          {(periods || (["monthly", "annual"] as PocPeriod[])).map((item) => (
            <button
              key={item}
              className={cx(
                "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                activePeriod === item
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() =>
                onTarget({ tier: target?.tier || tier, period: item })
              }
            >
              {periodLabel(t, item)}
            </button>
          ))}
        </div>
        <div
          className={cx(
            "mt-7 grid gap-3",
            flagOff ? "max-w-sm" : "md:grid-cols-3",
          )}
        >
          {(flagOff ? [tier] : (["bronze", "prata", "ouro"] as PocTier[])).map(
            (candidate) => {
              const same = candidate === tier && activePeriod === period;
              const selected =
                target?.tier === candidate && target?.period === activePeriod;
              const available = isAvailable ? isAvailable(candidate, activePeriod) : true;
              const price = priceFor ? priceFor(candidate, activePeriod) : planPrice(candidate, activePeriod);
              return (
                <button
                  key={candidate}
                  disabled={same || !available}
                  onClick={() =>
                    onTarget({ tier: candidate, period: activePeriod })
                  }
                  className={cx(
                    "min-h-[190px] rounded-xl border p-5 text-left transition-all duration-200",
                    same
                      ? "cursor-default border-primary/25 bg-primary/10"
                      : !available
                        ? "cursor-not-allowed border-border bg-card opacity-45"
                      : selected
                        ? "border-primary bg-secondary/70 shadow-[var(--glow-soft)]"
                        : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/45",
                    "disabled:opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <TierMark tier={candidate} />
                    {same && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-primary">
                        Plano atual
                      </span>
                    )}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">
                    {flagOff
                      ? periodLabel(t, activePeriod)
                      : tierCopy[candidate].name}
                  </h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {price === null ? "Indisponível" : money(price)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {periodSuffix(t, activePeriod)}
                    </span>
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {flagOff
                      ? "Modelo tradicional, sem seletor de tiers."
                      : tierCopy[candidate].description}
                  </p>
                </button>
              );
            },
          )}
        </div>
        <div className="mt-8 flex justify-end">
          <Button size="lg" disabled={!target || (target ? !(isAvailable ? isAvailable(target.tier, target.period) : true) : false)} onClick={onPreview}>
            Ver alteração
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

export function PreviewView({
  scenario,
  tier,
  period,
  t = demoT,
  target,
  dueNow,
  isDowngrade,
  busy,
  onBack,
  onConfirm,
  scheduled,
  targetPriceCents,
  stale,
}: {
  scenario: PocScenario;
  tier: PocTier;
  period: PocPeriod;
  t?: TFn;
  target: { tier: PocTier; period: PocPeriod } | null;
  dueNow: number;
  isDowngrade: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
  scheduled?: boolean;
  targetPriceCents?: number | null;
  stale?: boolean;
}) {
  if (!target) return null;
  const previewStale = stale || scenario.status === "stale";
  const targetPrice = targetPriceCents ?? planPrice(target.tier, target.period);
  const isScheduledChange = scheduled ?? isDowngrade;
  return (
    <section className="mx-auto max-w-2xl">
      <button
        className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar aos planos
      </button>
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          Revisar alteração
        </p>
        <h2 className="mt-3 text-3xl font-semibold">
          {isDowngrade
            ? `Alterar para ${tierCopy[target.tier].name}`
            : `Upgrade para ${tierCopy[target.tier].name}`}
        </h2>
        {previewStale ? (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <h3 className="font-medium text-destructive">
              Essa alteração não está mais válida
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Os dados da sua assinatura mudaram. Calcule novamente antes de
              confirmar.
            </p>
            <Button className="mt-4" variant="outline" onClick={onBack}>
              <RefreshCw className="h-4 w-4" />
              Calcular novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <PreviewStat
                label="Plano atual"
                value={`${tierCopy[tier].name} ${periodLabel(t, period).toLowerCase()}`}
              />
              <PreviewStat
                label="Novo plano"
                value={`${tierCopy[target.tier].name} ${periodLabel(t, target.period).toLowerCase()}`}
              />
              {!isScheduledChange && (
                <PreviewStat label="Você paga agora" value={money(dueNow)} />
              )}
              <PreviewStat
                label={isScheduledChange ? "Alteração em" : "Próxima renovação"}
                value={scenario.renewalDate || "17/09/2026"}
              />
            </div>
            {isScheduledChange ? (
              <p className="mt-6 rounded-xl bg-secondary/70 p-4 text-sm leading-relaxed text-muted-foreground">
                Seu {tierCopy[tier].name} continua ativo até{" "}
                <strong className="text-foreground">
                  {scenario.renewalDate}
                </strong>
                . Depois disso, você passa para {tierCopy[target.tier].name} por{" "}
                  {money(targetPrice)}{" "}
                  {periodSuffix(t, target.period)}.
              </p>
            ) : (
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                {scenario.payment === "card"
                  ? "Na Stripe, você revisará o valor final e confirmará a alteração."
                  : "Nesta simulação, o plano só muda depois da confirmação do Pix."}
              </p>
            )}
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onBack} disabled={busy}>
                Voltar
              </Button>
              <Button size="lg" onClick={onConfirm} disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Confirmando...
                  </>
                ) : isScheduledChange ? (
                  "Confirmar alteração"
                ) : scenario.payment === "card" ? (
                  "Revisar na Stripe"
                ) : (
                  "Gerar Pix"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}
