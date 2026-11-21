import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

test("debrid requests abort a stalled fetch and settle with a timeout error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestSignal = null;
  globalThis.fetch = (_url, init) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  };
  const { DebridApi } = await import("./debridApi.js");

  const pending = DebridApi.torboxListCloudItems("api-key", "v1/api/torrents/mylist");
  await flushTasks();
  t.mock.timers.tick(30000);
  const response = await pending;

  assert.equal(response.ok, false);
  assert.equal(response.status, 0);
  assert.equal(response.data, null);
  assert.equal(response.error?.name, "TimeoutError");
  assert.equal(requestSignal?.aborted, true);
});

test("debrid requests settle when only the response body stalls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });
  const { DebridApi } = await import("./debridApi.js");

  const pending = DebridApi.torboxListCloudItems("api-key", "v1/api/torrents/mylist");
  await flushTasks();
  t.mock.timers.tick(30000);
  const response = await pending;

  assert.equal(response.ok, false);
  assert.equal(response.status, 0);
  assert.equal(response.error?.name, "TimeoutError");
});

test("device authorization keeps parsing successful responses", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, data: { device_code: "code" } }), { status: 200 });
  const { DebridApi } = await import("./debridApi.js");

  const response = await DebridApi.startTorboxDeviceAuthorization("Nuvio");

  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { success: true, data: { device_code: "code" } });
});
