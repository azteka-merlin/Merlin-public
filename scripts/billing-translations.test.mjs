import { test } from "node:test";
import assert from "node:assert/strict";
import { dictionaries } from "../src/i18n.ts";

test("semiannual and Pix renewal copy is complete in every supported language", () => {
  const keys = Object.keys(dictionaries.ptbr).filter((key) => /semiannual/i.test(key) || /^accessPixRenew/.test(key));
  assert.ok(keys.length >= 20);
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const key of keys) {
      assert.ok(dictionary[key]?.trim(), `${locale}: ${key} must exist`);
      const placeholders = (text) => (text.match(/\{[^}]+\}/g) || []).sort();
      assert.deepEqual(placeholders(dictionary[key]), placeholders(dictionaries.ptbr[key]), `${locale}: ${key} placeholders`);
    }
  }
});
