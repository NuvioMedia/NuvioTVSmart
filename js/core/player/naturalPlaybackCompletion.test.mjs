import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isShortPlaceholderDuration,
  shouldTreatAsNaturalPlaybackCompletion
} from "./naturalPlaybackCompletion.js";

test("a real episode end is a natural completion", () => {
  assert.equal(
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: true,
      hasFatalError: false,
      durationMs: 2_400_000
    }),
    true
  );
});

test("short debrid placeholder clips are not a natural completion", () => {
  for (const durationMs of [5_000, 30_000, 120_999]) {
    assert.equal(
      shouldTreatAsNaturalPlaybackCompletion({
        hasRenderedFirstFrame: true,
        hasFatalError: false,
        durationMs
      }),
      false
    );
  }
});

test("just over the placeholder threshold is a natural completion", () => {
  assert.equal(
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: true,
      hasFatalError: false,
      durationMs: 121_000
    }),
    true
  );
});

test("no first frame is not a natural completion", () => {
  assert.equal(
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: false,
      hasFatalError: false,
      durationMs: 2_400_000
    }),
    false
  );
});

test("a fatal error is not a natural completion", () => {
  assert.equal(
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: true,
      hasFatalError: true,
      durationMs: 2_400_000
    }),
    false
  );
});

test("unknown duration is still allowed when the first frame rendered", () => {
  assert.equal(
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: true,
      hasFatalError: false,
      durationMs: 0
    }),
    true
  );
});

test("isShortPlaceholderDuration covers error and cache-sync clips", () => {
  assert.equal(isShortPlaceholderDuration(1), true);
  assert.equal(isShortPlaceholderDuration(5_000), true);
  assert.equal(isShortPlaceholderDuration(120_999), true);
  assert.equal(isShortPlaceholderDuration(0), false);
  assert.equal(isShortPlaceholderDuration(121_000), false);
  assert.equal(isShortPlaceholderDuration(2_400_000), false);
});
