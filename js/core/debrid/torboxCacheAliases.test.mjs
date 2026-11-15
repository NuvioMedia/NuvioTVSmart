import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAlternativeHashMatches, torboxCachedEntries } from "./torboxCacheAliases.js";

const REQUESTED = "b72ca5570c56c2387526b6aab184f0cf0075cff0";
const CANONICAL = "7db44b3713094e622246b715de410bb9b6d91230";

test("torboxCachedEntries normalizes hashes and ignores empty payloads", () => {
  assert.deepEqual(
    torboxCachedEntries({
      data: { data: { [CANONICAL.toUpperCase()]: { name: "ep.mkv", size: 10 } } }
    }),
    { [CANONICAL]: { name: "ep.mkv", size: 10 } }
  );
  assert.deepEqual(torboxCachedEntries({ data: { data: null } }), {});
  assert.deepEqual(torboxCachedEntries({}), {});
});

test("exact matches are returned untouched without extra requests", async () => {
  const cached = { [REQUESTED]: { name: "ep.mkv", size: 10 } };
  let calls = 0;
  const resolved = await resolveAlternativeHashMatches(cached, [REQUESTED], async () => {
    calls += 1;
    return {};
  });
  assert.deepEqual(resolved, cached);
  assert.equal(calls, 0);
});

test("a single aliased answer maps back to the requested hash", async () => {
  const item = { name: "ep.mkv", size: 10 };
  const resolved = await resolveAlternativeHashMatches(
    { [CANONICAL]: item },
    [REQUESTED],
    async () => {
      throw new Error("no extra request expected");
    }
  );
  assert.deepEqual(resolved, { [REQUESTED]: item });
});

test("only the hashes missing from a batch are asked again", async () => {
  const exact = "3ef7fd158c6fb50734dad1774377b08991fae5a4";
  const exactItem = { name: "ep1.mkv", size: 20 };
  const aliasItem = { name: "ep2.mkv", size: 10 };
  const asked = [];
  const resolved = await resolveAlternativeHashMatches(
    { [exact]: exactItem, [CANONICAL]: aliasItem },
    [exact, REQUESTED],
    async (hash) => {
      asked.push(hash);
      return { [CANONICAL]: aliasItem };
    }
  );
  assert.deepEqual(asked, [REQUESTED]);
  assert.deepEqual(resolved, {
    [exact]: exactItem,
    [CANONICAL]: aliasItem,
    [REQUESTED]: aliasItem
  });
});

test("a batch without aliases marks the missing hashes as not cached", async () => {
  const exact = "3ef7fd158c6fb50734dad1774377b08991fae5a4";
  const resolved = await resolveAlternativeHashMatches(
    { [exact]: { name: "ep1.mkv", size: 20 } },
    [exact, REQUESTED],
    async () => {
      throw new Error("no extra request expected");
    }
  );
  assert.equal(resolved[REQUESTED], undefined);
  assert.deepEqual(resolved[exact], { name: "ep1.mkv", size: 20 });
});
