import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESULT_ANCHOR_ID,
  buildResultAnchorUrl,
  focusResultPanelAfterRender,
} from "../src/result-anchor.ts";

test("Stripe checkout return retains its query and adds the result anchor", () => {
  assert.equal(
    buildResultAnchorUrl(
      "/download",
      "?checkout=success&session_id=cs_test_completed",
    ),
    `/download?checkout=success&session_id=cs_test_completed#${RESULT_ANCHOR_ID}`,
  );
});

test("the result focus waits for two rendered frames and refocuses after the panel transition", () => {
  const frames = [];
  const timers = [];
  const calls = [];
  const target = { scrollIntoView: (options) => calls.push(options) };

  focusResultPanelAfterRender(
    target,
    (callback) => (frames.push(callback), frames.length),
    (callback, delayMs) => (timers.push({ callback, delayMs }), timers.length),
  );

  assert.equal(calls.length, 0);
  frames.shift()();
  assert.equal(calls.length, 0);
  frames.shift()();
  assert.deepEqual(calls, [{ behavior: "smooth", block: "center" }]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 560);
  timers[0].callback();
  assert.equal(calls.length, 2);
});
