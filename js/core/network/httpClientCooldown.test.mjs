import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

function ensureMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    }
  };
}

ensureMemoryStorage();

const { httpRequest, resetHttpClientBackendCooldownForTests } = await import("./httpClient.js");

function jsonResponse(status, body = {}, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => normalizedHeaders.get(String(name || "").toLowerCase()) ?? null
    },
    text: async () => JSON.stringify(body)
  };
}

afterEach(() => {
  resetHttpClientBackendCooldownForTests();
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.localStorage = originalLocalStorage;
  ensureMemoryStorage();
});

test("3rd-party 429 Retry-After does not set global cooldown for Supabase or other addons", async () => {
  const scheduledDelays = [];
  globalThis.setTimeout = (fn, delay, ...args) => {
    scheduledDelays.push(delay);
    return originalSetTimeout(fn, 0, ...args);
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("addon.example")) {
      return jsonResponse(429, { error: "rate limited" }, { "retry-after": "3600" });
    }
    return jsonResponse(200, { ok: true });
  };

  await assert.rejects(
    httpRequest("https://addon.example/catalog/movie/top.json", {
      includeSessionAuth: false,
      timeoutMs: 0
    }),
    (error) => error?.status === 429
  );

  const supabaseResult = await httpRequest("https://db.supabase.co/rest/v1/profiles", {
    includeSessionAuth: false,
    timeoutMs: 0
  });
  const otherAddonResult = await httpRequest("https://second-provider.example/manifest.json", {
    includeSessionAuth: false,
    timeoutMs: 0
  });

  assert.deepEqual(supabaseResult, { ok: true });
  assert.deepEqual(otherAddonResult, { ok: true });
  assert.deepEqual(scheduledDelays, []);
});

test("Supabase 429 Retry-After caps backend cooldown to 30000 ms and does not block 3rd-party requests", async () => {
  const scheduledDelays = [];
  globalThis.setTimeout = (fn, delay, ...args) => {
    scheduledDelays.push(delay);
    return originalSetTimeout(fn, 0, ...args);
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("rpc/push_state")) {
      return jsonResponse(429, { message: "slow down" }, { "retry-after": "3600" });
    }
    return jsonResponse(200, { ok: true });
  };

  await assert.rejects(
    httpRequest("https://db.supabase.co/rest/v1/rpc/push_state", {
      method: "POST",
      body: { a: 1 },
      includeSessionAuth: false,
      timeoutMs: 0
    }),
    (error) => error?.status === 429
  );

  // 3rd-party addon requests must not wait on the Supabase cooldown.
  const addonResult = await httpRequest("https://addon.example/manifest.json", {
    includeSessionAuth: false,
    timeoutMs: 0
  });
  assert.deepEqual(addonResult, { ok: true });
  assert.deepEqual(scheduledDelays, []);

  // Subsequent Supabase requests wait on a capped (<= 30s) backend cooldown.
  const supabaseResult = await httpRequest("https://db.supabase.co/rest/v1/profiles", {
    includeSessionAuth: false,
    timeoutMs: 0
  });
  assert.deepEqual(supabaseResult, { ok: true });
  assert.equal(scheduledDelays.length, 1);
  assert.ok(
    scheduledDelays[0] > 0 && scheduledDelays[0] <= 30_000,
    `Expected <=30000, got ${scheduledDelays[0]}`
  );
});

test("requests without active cooldown avoid waitWithAbort timer allocation and honor aborted signals", async () => {
  const scheduledDelays = [];
  globalThis.setTimeout = (fn, delay, ...args) => {
    scheduledDelays.push(delay);
    return originalSetTimeout(fn, delay, ...args);
  };
  globalThis.fetch = async () => jsonResponse(200, { ok: true });

  const result = await httpRequest("https://addon.example/stream/movie/tt1.json", {
    includeSessionAuth: false,
    timeoutMs: 0
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(scheduledDelays, []);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    httpRequest("https://addon.example/stream/movie/tt2.json", {
      includeSessionAuth: false,
      timeoutMs: 0,
      signal: controller.signal
    }),
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(scheduledDelays, []);
});
