import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const componentSource = app.slice(
  app.indexOf("function AccessDetailsPoc("),
  app.indexOf("function PixPlanTransitionSelector("),
);
const compiled = ts.transpileModule(componentSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Keep hooks across renders and inspect JSX without mounting unrelated public
// signup/payment flows. Callbacks and view conditions come from the real component.
function renderAccess(overrides = {}) {
  const state = [];
  let cursor = 0;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (next) => {
      state[index] = typeof next === "function" ? next(state[index]) : next;
    }];
  };
  const jsx = (type, props) => ({ type, props });
  const component = new Function("dependencies", `
    const { useState, useRef, formatDate, getTierPrice, tierDisplayName, StateBanner, Overview,
      StatusPill, ExpiredPixPlanSelector, PixPlanTransitionSelector } = dependencies;
    const exports = {};
    const require = () => ({ jsx: dependencies.jsx, jsxs: dependencies.jsx });
    ${compiled}
    return AccessDetailsPoc;
  `)({
    useState,
    useRef: (initial) => useState({ current: initial })[0],
    jsx,
    formatDate: () => "22/10/2026",
    getTierPrice: () => ({ amountCents: 3900, currency: "brl" }),
    tierDisplayName: (tier) => tier,
    ...Object.fromEntries(["StateBanner", "Overview", "StatusPill", "ExpiredPixPlanSelector", "PixPlanTransitionSelector"].map((name) => [name, name])),
  });
  const props = {
    access: {
      kind: "monthly", current: true, planTier: "bronze",
      subscription: { paymentMethod: "pix" },
      renewal: { earlyPix: true, pix: false, card: false },
    },
    billing: {
      plansEnabled: true, billingEnabled: true, signupEnabled: true,
      monthlyEnabled: true, semiannualEnabled: true, annualEnabled: true,
    },
    locale: "pt", t: (key) => key,
    onRenewPix: async () => {},
    renewingPix: false,
    ...overrides,
  };
  return {
    props,
    render: (nextProps = props) => {
      cursor = 0;
      return component(nextProps);
    },
  };
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findElement(node.props?.children, predicate);
}

test("active early Pix renewal opens its selector and submits the selected next plan", async () => {
  const renewals = [];
  const harness = renderAccess({ onRenewPix: async (target) => { renewals.push(target); } });
  const banner = findElement(harness.render(), (node) => node.type === "StateBanner" && node.props.title === "accessPixRenewalTitle");
  assert.ok(banner?.props.action, "early renewal must offer an actionable Pix renewal");

  banner.props.action.onClick();
  const selector = harness.render();
  assert.equal(selector.type, "ExpiredPixPlanSelector", "clicking renew must leave the overview");
  assert.equal(selector.props.scheduled, true, "active access schedules the next renewal");

  // A focus refresh replaces the access object; it must preserve the open selector.
  assert.equal(harness.render({ ...harness.props, access: { ...harness.props.access } }).type, "ExpiredPixPlanSelector");
  assert.equal(renewals.length, 0, "choosing a plan must precede payment generation");
  await selector.props.onGenerate({ tier: "prata", period: "semiannual" });
  assert.deepEqual(renewals, [{ tier: "prata", period: "semiannual" }]);
  assert.notEqual(harness.render().type, "ExpiredPixPlanSelector");
});

test("active Pix outside the early renewal window does not offer generation", () => {
  const harness = renderAccess({ access: {
    kind: "monthly", current: true, planTier: "bronze",
    subscription: { paymentMethod: "pix" }, renewal: { earlyPix: false },
  } });
  const banner = findElement(harness.render(), (node) => node.type === "StateBanner" && node.props.title === "accessPixRenewalTitle");
  assert.ok(banner);
  assert.equal(banner.props.action, undefined);
});

test("a confirmed Pix renewal closes a stale selector and removes its renewal action", () => {
  const harness = renderAccess();
  const banner = findElement(harness.render(), (node) => node.type === "StateBanner" && node.props.title === "accessPixRenewalTitle");
  banner.props.action.onClick();
  const refreshed = harness.render({ ...harness.props, access: {
    ...harness.props.access,
    pixRenewal: { effectiveAt: "2026-10-22", targetTier: "prata", targetPeriod: "monthly" },
  } });
  assert.notEqual(refreshed.type, "ExpiredPixPlanSelector");
  assert.equal(findElement(refreshed, (node) => node.type === "StateBanner" && node.props.title === "accessPixRenewalTitle"), undefined);
});

test("an active card origin cannot enter the early Pix renewal selector", () => {
  const harness = renderAccess();
  const banner = findElement(harness.render(), (node) => node.type === "StateBanner" && node.props.title === "accessPixRenewalTitle");
  banner.props.action.onClick();
  const refreshed = harness.render({ ...harness.props, access: {
    ...harness.props.access, subscription: { paymentMethod: "card" },
  } });
  assert.notEqual(refreshed.type, "ExpiredPixPlanSelector");
});

test("expired manual Pix access keeps its plan selector", () => {
  const harness = renderAccess({ access: {
    kind: "monthly", current: false, planTier: "bronze",
    subscription: { paymentMethod: "pix" }, renewal: { pix: true, card: false },
  } });
  const overview = findElement(harness.render(), (node) => node.type === "Overview");
  overview.props.onChange();
  const selector = harness.render();
  assert.equal(selector.type, "ExpiredPixPlanSelector");
  assert.equal(selector.props.scheduled, false);
});

test("expired canceled card access keeps its Pix reactivation selector", () => {
  const harness = renderAccess({ access: {
    kind: "monthly", current: false, planTier: "bronze", billingStatus: "canceled",
    subscription: { paymentMethod: "card" }, renewal: { pix: true, card: true },
  } });
  const banner = findElement(harness.render(), (node) => node.type === "StateBanner" && node.props.title === "Seu acesso expirou");
  const pixAction = banner.props.actions.find((action) => action.label === "accessRenewWithPix");
  pixAction.onClick();
  const selector = harness.render();
  assert.equal(selector.type, "ExpiredPixPlanSelector");
  assert.equal(selector.props.scheduled, false);
});
