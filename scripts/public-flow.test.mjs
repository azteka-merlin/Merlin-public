import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("Stripe checkout return preserves the license result anchor", () => {
  assert.match(app, /checkout === "success"/);
  assert.match(app, /id="resultado-acesso"/);
  assert.match(app, /pollCheckoutStatus\(params\.get\("session_id"\)\)/);
  assert.match(app, /window\.setTimeout\(focus, 560\)/);
});

test("launcher handoff is exchanged before loading Meu acesso", () => {
  assert.match(app, /window\.location\.hash\.replace\(\/\^#\/, ""\)/);
  assert.match(app, /handoffParams\.get\("handoff"\)/);
  assert.match(app, /\/api\/public\/access\/handoff\/consume/);
  assert.match(app, /window\.history\.replaceState\(\{\}, "", "\/meu-acesso"\)/);
});
