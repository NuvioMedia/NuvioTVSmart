// The first torrent playback starts the webOS companion service and its local
// media runtime on demand. That cold start can take longer than a single Luna
// probe, and the resolver must wait for it instead of failing the playback.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_PLATFORM__ = "webos";
globalThis.localStorage = {
  getItem: (key) => (key === "torrentSettings" ? JSON.stringify({ p2pEnabled: true }) : null),
  setItem() {},
  removeItem() {}
};

let companionRequests = [];
globalThis.webOS = {
  service: {
    request(serviceUrl, options = {}) {
      companionRequests.push({ serviceUrl, options });
      return { cancel() {} };
    }
  }
};

globalThis.fetch = async (url) => {
  if (String(url).endsWith("/stats.json")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ streamName: "video.mkv", downloaded: 8 * 1024 * 1024, streamLen: 1024 })
    };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => "1024" },
    arrayBuffer: async () => new ArrayBuffer(1024)
  };
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const { WebOsEngineFsResolver } = await import("../js/core/p2p/webosEngineFsResolver.js");

function requestStream() {
  companionRequests = [];
  return WebOsEngineFsResolver.resolve({ infoHash: "a".repeat(40), fileIdx: 0 });
}

function getStatusRequest() {
  return companionRequests.find((entry) => entry.options.method === "status") || null;
}

test("resolves a torrent when the companion service cold start exceeds five seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const resolving = requestStream();
  await flushMicrotasks();

  const statusRequest = getStatusRequest();
  assert.ok(statusRequest, "status request was sent");

  t.mock.timers.tick(6000);
  statusRequest.options.onSuccess({
    returnValue: true,
    url: "http://127.0.0.1:2710",
    settingsReachable: true,
    settingsBody: "{}"
  });
  await flushMicrotasks();

  const result = await resolving;
  assert.equal(result.status, "success");
  assert.equal(result.stream.url, `http://127.0.0.1:2710/${"a".repeat(40)}/0`);
});

test("still fails when the companion service never responds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const resolving = requestStream();
  await flushMicrotasks();

  assert.equal(companionRequests.length, 1, "a timed-out start is not retried");
  t.mock.timers.tick(30001);

  const result = await resolving;
  assert.equal(result.status, "unavailable");
  assert.equal(result.detail, "Luna request timed out");
});
