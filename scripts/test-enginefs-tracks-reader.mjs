import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

// /tracks never answered on a Tizen 5.0 TV: the vendored reader asked for
// "bytes=0-NaN" (no readableHighWaterMark before Node 9.3), and once fixed it
// re-read "bytes=16384-32767" forever because it stored the chunk length as
// the next offset. These checks run on the real vendored bundles.
const require = createRequire(import.meta.url);
const patchTracksReader = require("../services/tizen/runtime/enginefs-tracks-reader-patch.cjs");
const installNodeRuntimeCompat = require("../services/tizen/runtime/node-runtime-compat.cjs");

for (const platform of ["tizen", "webos"]) {
  test(`${platform} track reader fixes apply to the vendored bundle`, async () => {
    const bundle = await readFile(
      new URL(`../services/${platform}/runtime/media-http.cjs`, import.meta.url),
      "utf8"
    );
    const count = (text, pattern) => (text.match(pattern) || []).length;
    assert.equal(
      count(bundle, /\.bytesOffset=[A-Za-z_$][\w$]*\.length/g),
      2,
      "the HTTP and the file reader"
    );
    const patched = patchTracksReader(bundle);
    assert.equal(count(patched, /\.bytesOffset=[A-Za-z_$][\w$]*\.length/g), 0);
    assert.equal(count(patched, /\.bytesOffset\+=[A-Za-z_$][\w$]*\.length/g), 2);
    assert.equal(
      count(patched, /if\(!\([A-Za-z_$][\w$]*\.size>0\)\)break;/g),
      2,
      "Matroska and MP4 parse loops"
    );
    assert.equal(count(patched, /\.__nuvioDecoding=!1,/g), 1, "a seek re-arms decoding");
    assert.equal(count(patched, /\.__nuvioDecoding\|\|\(/g), 1, "one chunk is decoded at a time");
    assert.equal(patchTracksReader(patched), patched, "applying it twice changes nothing");
  });
}

test("stream high-water-mark getters exist on runtimes older than Node 9.3", () => {
  function Readable() {
    this._readableState = { highWaterMark: 16384 };
  }
  function Writable() {
    this._writableState = { highWaterMark: 8192 };
  }
  const stream = { Readable, Writable };
  assert.deepEqual(installNodeRuntimeCompat({ stream }), [
    "Readable#destroy",
    "readableHighWaterMark",
    "writableHighWaterMark"
  ]);
  assert.equal(new Readable().readableHighWaterMark, 16384);
  assert.equal(new Writable().writableHighWaterMark, 8192);
  assert.deepEqual(installNodeRuntimeCompat({ stream }), [], "never overrides an existing getter");
});

test("Buffer.from(string, encoding) returns a Buffer on Node 4.4 (Uint8Array.from)", (t) => {
  // Node 4.4.3 inherits Buffer.from from Uint8Array: emulate that runtime.
  function LegacyBuffer(value, encoding) {
    // new Buffer(size) and new Buffer(value, encoding), as on Node 4.
    return typeof value === "number" ? Buffer.alloc(value) : Buffer.from(value, encoding);
  }
  // As on Node 4.4.3, "from" is inherited read-only, so assignment is ignored.
  const fromDescriptor = Object.getOwnPropertyDescriptor(Uint8Array, "from");
  Object.setPrototypeOf(LegacyBuffer, Uint8Array);
  Object.defineProperty(Uint8Array, "from", {
    value: Uint8Array.from,
    writable: false,
    configurable: true
  });
  t.after(() => {
    if (fromDescriptor) Object.defineProperty(Uint8Array, "from", fromDescriptor);
    else delete Uint8Array.from;
  });
  assert.deepEqual(installNodeRuntimeCompat({ Buffer: LegacyBuffer }), [
    "Buffer.from",
    "Buffer.alloc",
    "Buffer.allocUnsafe"
  ]);
  const signature = LegacyBuffer.from("1A45DFA3", "hex");
  assert.ok(Buffer.isBuffer(signature));
  assert.equal(
    Buffer.compare(signature, Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    0,
    "the Matroska signature compares"
  );
  assert.equal(LegacyBuffer.from(new Uint8Array([1, 2, 3]).buffer, 1, 2).toString("hex"), "0203");
  assert.equal(LegacyBuffer.alloc(3, 7).toString("hex"), "070707");
  const chunk = Buffer.from("1a45dfa3ff", "hex");
  assert.ok(Buffer.isBuffer(chunk.subarray(0, 4)), "a modern subarray already returns a Buffer");
  assert.throws(() => LegacyBuffer.from(5), TypeError);
  assert.deepEqual(installNodeRuntimeCompat({ Buffer }), [], "a modern Buffer is left alone");
});

test("Buffer#subarray returns a Buffer where it returned a Uint8Array (Node 4)", () => {
  function LegacyBuffer(size) {
    const bytes = new Uint8Array(size);
    Object.setPrototypeOf(bytes, LegacyBuffer.prototype);
    return bytes;
  }
  LegacyBuffer.prototype = Object.create(Uint8Array.prototype);
  // Node 4's own slice() is built on this.subarray().
  LegacyBuffer.prototype.slice = function (start, end) {
    const view = this.subarray(start, end);
    Object.setPrototypeOf(view, LegacyBuffer.prototype);
    return view;
  };
  LegacyBuffer.isBuffer = (value) => value instanceof LegacyBuffer;
  LegacyBuffer.from = () => {};
  LegacyBuffer.alloc = () => {};
  LegacyBuffer.allocUnsafe = () => {};
  assert.deepEqual(installNodeRuntimeCompat({ Buffer: LegacyBuffer }), ["Buffer#subarray"]);
  const bytes = new LegacyBuffer(4);
  bytes[1] = 9;
  const view = bytes.subarray(1, 3);
  assert.ok(LegacyBuffer.isBuffer(view));
  assert.equal(view[0], 9);
  view[1] = 5;
  assert.equal(bytes[2], 5, "a shared view, like subarray");
  assert.ok(
    LegacyBuffer.isBuffer(bytes.slice(0, 2)),
    "slice() still works through the new subarray()"
  );
});

test("Readable#destroy stops reading where Node 4 lacks it", async () => {
  const { Readable } = await import("node:stream");
  function LegacyReadable() {
    Readable.call(this);
  }
  LegacyReadable.prototype = Object.create(Readable.prototype, {
    destroy: { value: undefined, writable: true, configurable: true }
  });
  LegacyReadable.prototype.constructor = LegacyReadable;
  assert.deepEqual(installNodeRuntimeCompat({ stream: { Readable: LegacyReadable } }), [
    "Readable#destroy"
  ]);
  let reads = 0;
  const source = new LegacyReadable();
  source._read = () => {
    reads += 1;
  };
  const closed = new Promise((resolve) => source.on("close", resolve));
  assert.equal(source.destroy(), source);
  source.read();
  await closed;
  assert.equal(source.destroyed, true);
  assert.equal(reads, 0, "no further reads after destroy()");
});
