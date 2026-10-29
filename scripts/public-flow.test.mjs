import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../src/i18n.ts", import.meta.url), "utf8");
const accessPoc = await readFile(new URL("../src/poc/MeuAcessoPoc.tsx", import.meta.url), "utf8");

test("a delayed plan-change webhook is not shown as endless processing", () => {
  assert.match(app, /setCheckoutReturnStatus\(\(status\) => status === "completed" \|\| status === "expired" \? status : "delayed"\)/);
  assert.match(app, /checkoutReturnStatus === "delayed" \? t\("accessPlanChangeDelayed"\)/);
  assert.match(app, /label: t\("paymentStatusRetry"\), onClick: \(\) => window\.location\.reload\(\)/);
  assert.equal((i18n.match(/accessPlanChangeDelayed:/g) || []).length, 5);
});

test("Stripe checkout return preserves the license result anchor", () => {
  assert.match(app, /checkout === "success"/);
  assert.match(app, /id="resultado-acesso"/);
  assert.match(app, /pollCheckoutStatus\(params\.get\("session_id"\)\)/);
  assert.match(app, /focusResultPanelAfterRender/);
  assert.match(app, /buildResultAnchorUrl\(window\.location\.pathname, window\.location\.search\)/);
  assert.match(app, /if \(!success\?\.licenseKey\) return undefined/);
});

test("launcher handoff is exchanged before loading Meu acesso", () => {
  assert.match(app, /window\.location\.hash\.replace\(\/\^#\/, ""\)/);
  assert.match(app, /handoffParams\.get\("handoff"\)/);
  assert.match(app, /\/api\/public\/access\/handoff\/consume/);
  assert.match(app, /window\.history\.replaceState\(\{\}, "", "\/meu-acesso"\)/);
});

test("header opens Meu acesso immediately and expired sessions use the existing login", () => {
  const header = app.slice(app.indexOf("function AppHeader("), app.indexOf("function MarketingCta("));
  assert.equal((header.match(/href="\/meu-acesso"/g) || []).length, 2);
  assert.doesNotMatch(header, /fetch\("\/api\/public\/access\/session"/);
  assert.match(app, /if \(response\.status === 401 && redirectToLogin\) \{\s*window\.location\.replace\("\/download\?access=me"\)/);
  assert.match(app, /void refreshAccess\(true\)/);
  assert.match(app, /t\("accessSessionLoading"\)/);
});

test("pending Meu acesso tab resolves its own session or leaves the loading state", () => {
  assert.match(app, /get\("pending"\) !== "1"/);
  assert.match(app, /window\.setInterval\(\(\) => \{ void checkSession\(\); \}, 1000\)/);
  assert.match(app, /if \(response\.status === 401\) return/);
  assert.match(app, /setPendingSessionReady\(true\)/);
  assert.match(app, /window\.setTimeout\(\(\) => finish\(t\("accessSessionExpired"\)\), 30000\)/);
  assert.match(app, /loading \|\| \(isPendingWindow && !pendingSessionReady\)/);
});

test("Meu acesso keeps translation props unambiguous", () => {
  const accessComponentTags = app.match(/<(?:ChangeView|PreviewView|Overview)\b[^>]*>/gs) || [];
  for (const tag of accessComponentTags) {
    assert.equal(
      (tag.match(/\bt=\{t\}/g) || []).length,
      1,
      `translation prop must be passed once: ${tag}`,
    );
  }
});

test("Meu acesso has an explicit exit action instead of an icon-only close control", () => {
  const accessHeaders = app.match(/<StatusPill status=\{status\} t=\{t\} \/>[\s\S]{0,600}?<\/button>/g) || [];
  assert.equal(accessHeaders.length, 4, "every Meu acesso view must render its status header");

  for (const header of accessHeaders) {
    assert.match(header, /onClick=\{onClose\}/);
    assert.match(header, /disabled=\{loggingOut\}/);
    assert.match(header, /t\("accessSigningOut"\) : t\("accessSignOut"\)/);
    assert.doesNotMatch(header, /aria-label=\{t\("close"\)\}/);
  }
});

test("Sair revokes the server session before leaving Meu acesso", () => {
  const signOut = app.slice(app.indexOf("async function signOut()"), app.indexOf("async function startPixRenewal("));
  assert.match(signOut, /\/api\/public\/access\/session\/logout/);
  assert.match(signOut, /"x-merlin-access-csrf": csrfToken/);
  assert.match(signOut, /if \(!response\.ok && response\.status !== 401\) throw/);
  assert.match(signOut, /setAccess\(null\);\s*setCsrfToken\(""\)/);
  assert.match(signOut, /window\.location\.replace\("\/download"\)/);
  assert.match(signOut, /setLogoutError\(t\("accessLogoutError"\)\)/);
  assert.match(app, /onClose=\{\(\) => \{\s*void signOut\(\)/);
});

test("plans and checkout explain that access is released after payment confirmation", () => {
  assert.match(app, /tierPlansBody[\s\S]{0,500}automaticAccessAfterPayment/);
  assert.match(app, /billing\.billingEnabled && plan && \([\s\S]{0,300}automaticAccessAfterPayment/);
});

test("Pix status polling hydrates QR, copy-and-paste code, and ticket URL when they arrive late", () => {
  assert.match(app, /function mergePixOrderDetails\(order: PixOrder, payload: Partial<PixOrder>\)/);
  assert.match(app, /qrCode: payload\.qrCode \|\| order\.qrCode/);
  assert.match(app, /qrCodeBase64: payload\.qrCodeBase64 \|\| order\.qrCodeBase64/);
  assert.match(app, /ticketUrl: payload\.ticketUrl \|\| order\.ticketUrl/);
  assert.equal((app.match(/set(?:Renewal)?PixOrder\(\(value\) => value \? mergePixOrderDetails\(value, payload\) : value\)/g) || []).length, 3);
});

test("Pix renewal is protected, can be scheduled before expiry, and confirms visibly after payment", () => {
  assert.match(app, /\/api\/public\/access\/session\/renewal\/pix/);
  assert.match(app, /access\.renewal\?\.earlyPix/);
  assert.match(app, /const canChangeExpiredPix = status === "expired" && isManualPixAccess && !access\.pixRenewal/);
  assert.match(app, /label: renewingPix \? t\("pixCreating"\) : t\("accessPixRenew"\)/);
  assert.match(app, /onClick: \(\) => void requestPixRenewal\(\)/);
  assert.match(app, /onRenewPix\(target\)/);
  assert.match(app, /planTier: target\.tier, planType: target\.period/);
  assert.match(app, /function ExpiredPixPlanSelector/);
  assert.match(app, /aria-label="Pagamento Pix"/);
  assert.match(app, /setRenewalPixOrder\(null\);[\s\S]{0,180}await refreshAccess\(\);/);
  assert.match(app, /t\("accessPixRenewalConfirmed"\)/);
  assert.match(app, /status === "active" && !access\.pixRenewal/);
  assert.match(app, /pixRenewalStarted\.current = false;\s*setRenewingPix\(false\);/);
  assert.match(app, /onChange=\{canChangeActivePix \|\| canChangeExpiredPixTransition \? \(\) => setPixTransitionOpen\(true\)\s*: canChangeExpiredPix && canRenewPix \? \(\) => setPixPlanSelectionOpen\(true\) : beginChange\}/);
  assert.match(app, /canChangeExpiredPixTransition[\s\S]{0,200}setPixTransitionOpen\(true\)/);
  assert.doesNotMatch(app, /<ChangeView[\s\S]{0,900}onRenewPix/);
});

test("Pix remains outside the active Stripe plan-change flow", () => {
  assert.match(app, /const canChange = Boolean\([\s\S]*isCardSubscription/);
  assert.match(app, /isManualPixAccess && status === "active"/);
  assert.match(app, /const subscriptionCanceled = isCardSubscription && \(/);
  assert.match(app, /isCardSubscription && access\.subscription\?\.cancelAtPeriodEnd/);
  assert.match(app, /access\.subscription\?\.canManage/);
});

test("expired canceled card access offers Pix only after expiry, using the existing renewal selector", () => {
  assert.match(app, /const isCardSubscription = access\.subscription\?\.paymentMethod === "card"/);
  assert.match(app, /const canSwitchCardToPix = status === "expired"[\s\S]{0,160}access\.subscription\?\.paymentMethod === "card"[\s\S]{0,100}access\.renewal\?\.pix/);
  assert.match(app, /pixPlanSelectionOpen && \(canSelectEarlyPixRenewal \|\| canChangeExpiredPix \|\| canSwitchCardToPix\)/);
  assert.match(app, /: canSwitchCardToPix\s*\? \{[\s\S]{0,180}setPixPlanSelectionOpen\(true\)/);
});

test("expired card renewal presents card and Pix choices together and labels the expired date accurately", () => {
  assert.match(app, /actions=\{canRenewCard && canSwitchCardToPix \? \[/);
  assert.match(app, /accessRenewWithCard/);
  assert.match(app, /accessRenewWithPix/);
  assert.doesNotMatch(app, /\{canSwitchCardToPix && \(/);
  assert.match(i18n, /accessExpiredOn: "Acesso expirou em"/);
  assert.match(i18n, /accessExpiredChooseRenewal: "Escolha como deseja reativar esta licença\."/);
  assert.match(accessPoc, /scenario\.status === "expired"\s*\?\s*t\("accessExpiredOn"\)/);
  assert.match(accessPoc, /scenario\.status !== "expired" && \(/);
});

test("Meu acesso displays billing dates in the Brazilian billing timezone", () => {
  assert.match(app, /new Intl\.DateTimeFormat\([\s\S]{0,400}timeZone: "America\/Sao_Paulo"/);
});

test("expired Stripe payment failures go to billing regularization", () => {
  assert.match(app, /const canRegularizeStripe = status === "expired"/);
  assert.match(app, /\["past_due", "unpaid"\]/);
  assert.match(app, /label: "Regularizar pagamento", onClick: onPortal/);
});

test("expired canceled Stripe access stays expired and keeps its card origin", () => {
  assert.match(app, /if \(status !== "expired"\)/);
  assert.match(app, /paymentMethod\?: "card" \| "pix"/);
  assert.match(app, /payment: access\.subscription\?\.paymentMethod/);
});

test("expired canceled Stripe access renews the same plan without reopening plan selection", () => {
  assert.match(app, /const canRenewCard = status === "expired"/);
  assert.match(app, /label: renewingCard \? t\("checkoutLoading"\) : "Renovar plano"/);
  assert.match(app, /\/api\/public\/access\/session\/renewal\/card/);
  assert.match(app, /status !== "canceling"/);
});

test("card renewal visibly enters a single-flight loading state before opening Stripe", () => {
  assert.match(app, /const \[renewingCard, setRenewingCard\] = useState\(false\)/);
  assert.match(app, /if \(cardRenewalStarted\.current\) return;/);
  assert.match(app, /cardRenewalStarted\.current = true;\s*setRenewingCard\(true\)/);
  assert.match(app, /label: renewingCard \? t\("checkoutLoading"\) : "Renovar plano"/);
  assert.match(app, /disabled: renewingCard/);
  assert.match(app, /cardRenewalStarted\.current = false;\s*setRenewingCard\(false\)/);
});

test("Pix renewal visibly enters a single-flight loading state and allows a retry only after its order ends", () => {
  assert.match(app, /const \[renewingPix, setRenewingPix\] = useState\(false\)/);
  assert.match(app, /if \(pixRenewalStarted\.current\) return;/);
  assert.match(app, /pixRenewalStarted\.current = true;\s*setRenewingPix\(true\)/);
  assert.match(app, /label: renewingPix \? t\("pixCreating"\) : t\("accessPixRenew"\)/);
  assert.match(app, /disabled: renewingPix/);
  assert.match(app, /function startNewPixRenewal\(\) \{\s*pixRenewalStarted\.current = false;/);
  assert.match(app, /await onRenewPix\(target\)/);
  assert.match(app, /busy=\{busy \|\| renewingPix\}/);
});

test("the legacy modal preserves the selected Pix tier and period through trusted renewal", () => {
  const modal = app.slice(app.indexOf("async function startRenewal("), app.indexOf("function StatusModalView("));
  assert.match(modal, /onRenewPix=\{async \(target\) => \{ await startRenewal\("pix", target \|\|/);
  assert.match(modal, /planType: target\?\.period \|\| renewalPlan/);
  assert.match(modal, /planTier: target\?\.tier \|\| current\.planTier/);
  assert.match(modal, /\/api\/public\/access\/session\/renewal\/pix/);
  assert.match(modal, /"x-merlin-access-csrf": session\.csrfToken/);
  assert.match(modal, /if \(target\) throw error/);
});

test("Meu acesso prices the actual payment method and handles direct renewal errors visibly", () => {
  assert.match(app, /getTierPrice\(billing, scenario\.payment, tier, period\)/);
  const handler = app.slice(app.indexOf("async function requestPixRenewal("), app.indexOf("function beginChange("));
  assert.match(handler, /await onRenewPix\(target\)/);
  assert.match(handler, /setError\(cause instanceof Error/);
  assert.match(handler, /setBusy\(false\)/);
});

test("Pix renewal filters disabled periods and translates every selection label", () => {
  const selector = app.slice(app.indexOf("function ExpiredPixPlanSelector("), app.indexOf("function StatusModalView("));
  assert.match(selector, /periodEnabled && pixEnabled/);
  assert.match(selector, /billing\.paymentMethods\.pixSemiannual/);
  assert.match(selector, /const availablePeriods = \(\["monthly", "semiannual", "annual"\] as PocPeriod\[\]\)\.filter/);
  assert.match(selector, /availablePeriods\.map\(\(candidate\) =>/);
  assert.doesNotMatch(selector, /\(\["monthly", "semiannual", "annual"\] as PocPeriod\[\]\)\.map/);
  assert.match(selector, /available\(candidate, period\) \? getTierPrice/);
  assert.match(selector, /t\("accessPixRenewalChoose"\)/);
  assert.match(selector, /t\("accessPixRenewalGenerate"\)/);
  assert.doesNotMatch(selector, />Semestral<|>Gerar Pix<|>Indisponível</);
});

test("Pix plan transition keeps its new layout isolated and its payment preview authoritative", () => {
  const selector = app.slice(app.indexOf("function PixPlanTransitionSelector("), app.indexOf("function ExpiredPixPlanSelector("));
  assert.match(selector, /accessPixTransitionCurrentAccess/);
  assert.match(selector, /accessPixTransitionPayment/);
  assert.match(selector, /accessPixTransitionPeriod/);
  assert.match(selector, /accessPixTransitionChoosePlan/);
  assert.match(selector, /currentPriceCents !== null/);
  assert.match(selector, /expired \? "accessPixTransitionExpired" : "accessPixTransitionActive"/);
  assert.match(selector, /getTierPrice\(billing, paymentMethod, candidate, period\)/);
  assert.match(selector, /paymentMethod === "pix" && tier === currentTier && period === currentPeriod/);
  assert.match(selector, /if \(!quote\) setQuote\(await onPreview\(target\)\)/);
  assert.match(selector, /else await onCreate\(target\)/);
  assert.match(selector, /className="w-full" disabled=\{busy \|\| !available\(tier, period\) \|\| samePixPlan\}/);
  for (const key of ["accessPixTransitionCurrentAccess", "accessPixTransitionPayment", "accessPixTransitionPeriod", "accessPixTransitionChoosePlan", "accessPixTransitionSelected", "accessPixTransitionSamePlan"]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) || []).length, 5, `${key} must be translated into all supported languages`);
  }
});
