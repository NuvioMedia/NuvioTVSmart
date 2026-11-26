import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

globalThis.document = {
  createElement: (tag) => (tag === "canvas" ? { getContext: () => ({}) } : {})
};

const wasmBytes = await readFile(
  new URL("../../../node_modules/libbitsub/pkg/libbitsub_bg.wasm", import.meta.url)
);
let resolveWasmFetch;
const wasmFetchPromise = new Promise((resolve) => {
  resolveWasmFetch = resolve;
});

globalThis.fetch = async (url) => {
  if (String(url).includes("libbitsub_bg.wasm")) {
    await wasmFetchPromise;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
    };
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

const { BitmapSubtitleDecoder } = await import("./bitmapSubtitleDecoder.js");

test("BitmapSubtitleDecoder ignores stale in-flight load after dispose()", async () => {
  const decoder = new BitmapSubtitleDecoder();
  const pendingLoad = decoder.load({ format: "pgs", data: new Uint8Array([0x50, 0x47]) });
  decoder.dispose();
  resolveWasmFetch();
  const cueCount = await pendingLoad;
  assert.equal(cueCount, 0);
  assert.equal(decoder.parser, null);
});
