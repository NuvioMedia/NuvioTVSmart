import assert from "node:assert/strict";
import { test } from "node:test";
import { tizenAdapter } from "./tizenAdapter.js";

// The packaged Tizen main.js registers the remote keys before the bundle loads
// and sets a flag; the adapter must not repeat the synchronous WRT calls.

function installTvInputDevice() {
  const calls = [];
  globalThis.tizen = {
    tvinputdevice: {
      registerKeyBatch(keys) {
        calls.push(["batch", keys.slice()]);
      },
      registerKey(key) {
        calls.push(["single", key]);
      }
    }
  };
  return calls;
}

test("without the main.js flag the adapter registers the media keys once, in a batch", () => {
  delete globalThis.__NUVIO_TIZEN_MEDIA_KEYS_REGISTERED__;
  const calls = installTvInputDevice();
  tizenAdapter.init();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "batch");
  assert.ok(calls[0][1].includes("MediaPlayPause"));
  assert.ok(calls[0][1].includes("Info"));
});

test("with the main.js flag the adapter skips key registration", () => {
  globalThis.__NUVIO_TIZEN_MEDIA_KEYS_REGISTERED__ = true;
  const calls = installTvInputDevice();
  tizenAdapter.init();
  assert.equal(calls.length, 0);
  delete globalThis.__NUVIO_TIZEN_MEDIA_KEYS_REGISTERED__;
});

test.after(() => {
  delete globalThis.tizen;
});
