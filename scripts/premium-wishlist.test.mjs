import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPremiumWishes, removePremiumWish, parsePremiumWishes, WishlistRequestError } from "../src/wishlist-session.ts";
import { wishlistCopy } from "../src/wishlist-copy.ts";

const sample = { appId: "4115450", name: "Game", coverUrl: "https://cdn.example/game.jpg", comingSoon: 1, email: "player@example.com", phone: null, createdAt: "2026-11-02" };

test("wishlist is read only from the authenticated session without browser cache", async () => {
  const controller = new AbortController();
  const wishes = await getPremiumWishes(controller.signal, async (url, options) => {
    assert.equal(url, "/api/public/access/session/premium/wishlist");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, controller.signal);
    return Response.json({ success: true, wishes: [sample] });
  });
  assert.equal(wishes.length, 1);
  assert.equal(wishes[0].comingSoon, true);
  assert.equal(wishes[0].email, sample.email);
});

test("removing a wish requires session credentials and the existing CSRF token", async () => {
  let calls = 0;
  await removePremiumWish(sample.appId, "csrf-value", async (url, options) => {
    calls++;
    assert.equal(url, `/api/public/access/session/premium/wishlist/${sample.appId}`);
    assert.equal(options.method, "DELETE");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["x-merlin-access-csrf"], "csrf-value");
    return Response.json({ success: true, removed: true });
  });
  await assert.rejects(removePremiumWish("../other", "csrf", async () => { calls++; }), WishlistRequestError);
  await assert.rejects(removePremiumWish(sample.appId, "", async () => { calls++; }), WishlistRequestError);
  assert.equal(calls, 1);
});

test("failed removal stays a failure, and expired sessions can be identified", async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(removePremiumWish(sample.appId, "csrf", async () => Response.json({ success: false }, { status })), (error) => error instanceof WishlistRequestError && error.status === status);
  }
  await assert.rejects(getPremiumWishes(undefined, async () => Response.json({ success: false }, { status: 401 })), (error) => error.status === 401);
});

test("invalid responses do not masquerade as an empty wishlist", async () => {
  for (const payload of [{ success: true }, { success: false, wishes: [] }]) {
    await assert.rejects(getPremiumWishes(undefined, async () => Response.json(payload)), WishlistRequestError);
  }
  await assert.rejects(getPremiumWishes(undefined, async () => new Response("broken")), WishlistRequestError);
});

test("available games remain on the wishlist and unsafe image URLs are omitted", () => {
  const wishes = parsePremiumWishes([{ ...sample, comingSoon: 0 }, { ...sample }, { ...sample, appId: "123", coverUrl: "javascript:bad" }, { ...sample, appId: "bad" }, null]);
  assert.equal(wishes.length, 2);
  assert.equal(wishes[0].comingSoon, false);
  assert.equal(wishes[1].coverUrl, "");
});

test("wishlist messages and interpolation are available in every supported language", () => {
  for (const [locale, copy] of Object.entries(wishlistCopy)) {
    for (const key of Object.keys(wishlistCopy.en)) {
      assert.ok(copy[key]?.trim(), `${locale}: ${key}`);
      const vars = (text) => (text.match(/\{[^}]+\}/g) || []).sort();
      assert.deepEqual(vars(copy[key]), vars(wishlistCopy.en[key]), `${locale}: ${key} placeholders`);
    }
  }
});

test("account tabs expose selection, panels, and arrow/Home/End keyboard navigation", async () => {
  const component = await readFile(new URL("../src/AccountPremiumTabs.tsx", import.meta.url), "utf8");
  for (const role of ["tablist", "tab", "tabpanel", "status", "alert"]) assert.ok(component.includes(`role="${role}"`));
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(component.includes(`event.key === "${key}"`));
  assert.match(component, /aria-selected=\{tab === value\}/);
  assert.match(component, /aria-controls=/);
  assert.match(component, /hidden=\{tab !== "access"\}/);
  assert.match(component, /hidden=\{tab !== "wishlist"\}/);
  assert.match(component, /controller.abort\(\)/);
  assert.match(component, /removeButtons.current.get\(target.appId\)\?\.focus\(\)/);
});
