import assert from "node:assert/strict";

// Chromium keeps 6 connections per host: plugin fetches must leave one free
// per host for /health and /cancel, and the service must not be probed per fetch.
globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = "DemoPkg.PluginService";
globalThis.tizen = {
  systeminfo: {
    getCapability: (name) => (name.includes("platform.version") ? "6.0" : false)
  },
  application: { launch: (_id, onSuccess) => onSuccess?.() }
};

const active = new Map();
const pending = [];
const sent = [];
let healthCalls = 0;
globalThis.fetch = (url, options = {}) => {
  const { origin, pathname } = new URL(url);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (pathname === "/health") {
    healthCalls += 1;
    return Promise.resolve(
      ok({ returnValue: true, service: "nuvio-plugin-network", protocolVersion: 1 })
    );
  }
  if (pathname === "/cancel") return Promise.resolve(ok({ returnValue: true }));
  sent.push(JSON.parse(options.body).requestId);
  active.set(origin, (active.get(origin) || 0) + 1);
  assert.ok(active.get(origin) <= 5, `${origin} holds more than 5 fetches`);
  return new Promise((resolve) => {
    pending.push(() => {
      active.set(origin, active.get(origin) - 1);
      resolve(ok({ returnValue: true }));
    });
  });
};

const { TizenPluginService } = await import("../js/platform/tizen/tizenPluginService.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const aborted = new AbortController();
const fetches = Array.from({ length: 12 }, (_, i) =>
  TizenPluginService.fetch(
    { requestId: `r${i}` },
    i === 11 ? { signal: aborted.signal } : {}
  ).catch((error) => error)
);
await tick();
assert.deepEqual([...active.values()], [5, 5]);
const probesAfterBurst = healthCalls;
assert.ok(probesAfterBurst <= 2, "fetches must reuse the cached probe");
// /cancel still gets through while every fetch slot is busy.
assert.equal((await TizenPluginService.cancel({ requestId: "r0" })).returnValue, true);

aborted.abort();
while (pending.length) {
  pending.shift()();
  await tick();
}
const results = await Promise.all(fetches);
assert.equal(results[11].name, "AbortError");
assert.ok(!sent.includes("r11"), "an aborted queued fetch must never be sent");
assert.equal(sent.length, 11);
assert.equal(healthCalls, probesAfterBurst);

console.log("tizen plugin fetch slots test passed");
