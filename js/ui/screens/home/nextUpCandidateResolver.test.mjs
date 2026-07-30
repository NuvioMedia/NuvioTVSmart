import assert from "node:assert/strict";
import test from "node:test";

import { resolveNextUpCandidates } from "./nextUpCandidateResolver.js";

test("continues past candidates without a next episode until the lookup limit", async () => {
  const candidates = Array.from({ length: 10 }, (_, index) => index + 1);
  const visited = [];

  const resolved = await resolveNextUpCandidates(
    candidates,
    async (candidate) => {
      visited.push(candidate);
      return candidate > 8 ? `next-${candidate}` : null;
    },
    { maxLookups: 10, concurrency: 2 }
  );

  assert.deepEqual(visited.slice().sort((left, right) => left - right), candidates);
  assert.deepEqual(resolved, ["next-9", "next-10"]);
});

test("bounds concurrent candidate resolution", async () => {
  let active = 0;
  let peak = 0;

  await resolveNextUpCandidates(
    Array.from({ length: 12 }, (_, index) => index),
    async (candidate) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return candidate;
    },
    { maxLookups: 12, concurrency: 4 }
  );

  assert.equal(peak, 4);
});
