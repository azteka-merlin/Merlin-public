import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

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
    assert.match(header, />\s*Sair\s*<\/button>/);
    assert.doesNotMatch(header, /aria-label=\{t\("close"\)\}/);
  }
});

test("plans and checkout explain that access is released after payment confirmation", () => {
  assert.match(app, /tierPlansBody[\s\S]{0,500}automaticAccessAfterPayment/);
  assert.match(app, /billing\.billingEnabled && plan && \([\s\S]{0,300}automaticAccessAfterPayment/);
});

test("expired Pix access can renew unchanged or select its next plan through the protected renewal route", () => {
  assert.match(app, /\/api\/public\/access\/session\/renewal\/pix/);
  assert.match(app, /const canRenewPix = status === "expired"/);
  assert.match(app, /const canChangeExpiredPix = canRenewPix && isManualPixAccess/);
  assert.match(app, /label: renewingPix \? t\("pixCreating"\) : "Renovar via Pix"/);
  assert.match(app, /onClick: \(\) => onRenewPix\(\)/);
  assert.match(app, /onRenewPix\(target\)/);
  assert.match(app, /planTier: target\.tier, planType: target\.period/);
  assert.match(app, /function ExpiredPixPlanSelector/);
  assert.match(app, /aria-label="Pagamento Pix"/);
  assert.match(app, /setRenewalPixOrder\(null\);\s*await refreshAccess\(\);/);
  assert.match(app, /onChange=\{canChangeExpiredPix \? \(\) => setPixPlanSelectionOpen\(true\) : beginChange\}/);
  assert.doesNotMatch(app, /<ChangeView[\s\S]{0,900}onRenewPix/);
});

test("Pix remains outside the active Stripe plan-change flow", () => {
  assert.match(app, /const canChange = Boolean\([\s\S]*isCardSubscription/);
  assert.match(app, /isManualPixAccess && status === "active"/);
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
  assert.match(app, /label: renewingPix \? t\("pixCreating"\) : "Renovar via Pix"/);
  assert.match(app, /disabled: renewingPix/);
  assert.match(app, /function startNewPixRenewal\(\) \{\s*pixRenewalStarted\.current = false;/);
  assert.match(app, /await onRenewPix\(target\)/);
  assert.match(app, /busy=\{busy \|\| renewingPix\}/);
});
