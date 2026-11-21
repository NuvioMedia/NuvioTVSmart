import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
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

// The vendored reader parses the first range read only. On an anime MKV the
// Tracks element is larger than that read (every ASS track carries its own
// styles), so the Arabic track was never returned by /tracks. These checks run
// the real vendored reader over both the patched and the original bundle.
const SYNC_SUBTITLES = [
  ["eng", "English"],
  ["eng", "English[Signs]"],
  ["fre", "French"],
  ["ger", "German"],
  ["ita", "Italian"],
  ["spa", "Spanish[ESP]"],
  ["spa", "Spanish[LAT]"],
  ["por", "Portuguese[BR]"],
  ["rus", "Russian"],
  ["ara", "Arabic"]
];

function ebml(id, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let size;
  if (data.length < 127) size = Buffer.from([0x80 | data.length]);
  else if (data.length < 16383) size = Buffer.from([0x40 | (data.length >> 8), data.length & 255]);
  else
    size = Buffer.from([0x20 | (data.length >> 16), (data.length >> 8) & 255, data.length & 255]);
  return Buffer.concat([Buffer.from(id, "hex"), size, data]);
}

function matroskaSubtitleTrack(id, language, name, padding) {
  const fields = [
    ebml("d7", [id]),
    ebml("83", [17]),
    ebml("22b59c", language),
    ebml("536e", name),
    ebml("86", "S_TEXT/ASS")
  ];
  if (padding) fields.push(ebml("63a2", "[Script Info]\n".padEnd(padding, "x")));
  return ebml("ae", Buffer.concat(fields));
}

function matroskaTracks({ padding = 0, gap = 0 } = {}) {
  const tracks = [
    ebml("ae", Buffer.concat([ebml("d7", [1]), ebml("83", [1]), ebml("86", "V_MPEGH/ISO/HEVC")])),
    ebml(
      "ae",
      Buffer.concat([ebml("d7", [2]), ebml("83", [2]), ebml("22b59c", "jpn"), ebml("86", "A_AAC")])
    ),
    ebml(
      "ae",
      Buffer.concat([ebml("d7", [3]), ebml("83", [2]), ebml("22b59c", "eng"), ebml("86", "A_AAC")])
    )
  ];
  SYNC_SUBTITLES.forEach(([language, name], index) => {
    tracks.push(matroskaSubtitleTrack(4 + index, language, name, padding));
  });
  const segment = ebml(
    "18538067",
    Buffer.concat([
      gap ? ebml("ec", Buffer.alloc(gap)) : Buffer.alloc(0),
      ebml("1654ae6b", Buffer.concat(tracks))
    ])
  );
  return Buffer.concat([ebml("1a45dfa3", ebml("4282", "matroska")), segment]);
}

function serveRanges(body) {
  const requests = [];
  const server = createServer((request, response) => {
    const match = /bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
    assert.ok(match, "the reader sends a range request");
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    requests.push([start, end]);
    response.writeHead(206, {
      "Content-Type": "video/x-matroska",
      "Content-Range": `bytes ${start}-${end}/${body.length}`,
      "Content-Length": String(end - start + 1)
    });
    response.end(body.subarray(start, end + 1));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        requests,
        url: `http://127.0.0.1:${server.address().port}/episode.mkv`,
        close: () => new Promise((done) => server.close(done))
      })
    );
  });
}

async function loadTracksReader(platform, { patched = true } = {}) {
  const source = await readFile(
    new URL(`../services/${platform}/runtime/media-http.cjs`, import.meta.url),
    "utf8"
  );
  const moduleId = Number(/getTracksData=__webpack_require__\((\d+)\)\.default/.exec(source)[1]);
  const declared = source.indexOf("var modules = [");
  const table =
    declared >= 0
      ? source.slice(source.indexOf("[", declared), source.indexOf("\n];", declared) + 2)
      : source.slice(source.indexOf("})([function(module") + 3, source.lastIndexOf("]") + 1);
  assert.match(table, /^\[\s*function\(module/, "the vendored module table is found");
  const modules = new Function("require", "return " + (patched ? patchTracksReader(table) : table))(
    createRequire(import.meta.url)
  );
  const loaded = new Map();
  const load = (id) => {
    if (loaded.has(id)) return loaded.get(id).exports;
    const module = { exports: {} };
    loaded.set(id, module);
    modules[id].call(module.exports, module, module.exports, load);
    return module.exports;
  };
  load.o = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  load.d = (exports, name, getter) => {
    if (!load.o(exports, name))
      Object.defineProperty(exports, name, { enumerable: true, get: getter });
  };
  load.n = (module) => {
    const getter = module && module.__esModule ? () => module.default : () => module;
    load.d(getter, "a", getter);
    return getter;
  };
  return load(moduleId).default;
}

for (const platform of ["webos", "tizen"]) {
  test(`${platform}: a Tracks element larger than the first read still returns every track`, async (t) => {
    const reader = await loadTracksReader(platform);
    const body = matroskaTracks({ padding: 8000 });
    assert.ok(body.length > 65536, "the Tracks element must not fit the first read anywhere");
    const media = await serveRanges(body);
    t.after(media.close);

    const tracks = await reader(media.url, { maxBytesLimit: 26214400 });

    assert.equal(tracks.length, 13);
    assert.deepEqual(
      tracks.filter((track) => track.type === "text").map((track) => track.lang),
      SYNC_SUBTITLES.map(([language]) => language)
    );
    assert.equal(tracks.find((track) => track.label === "Arabic").id, 13);
    assert.deepEqual(
      media.requests.map(([start]) => start),
      [0, 0],
      "the prefix is read again from the file start, never from mid-element"
    );
    assert.equal(media.requests[1][1], body.length - 1, "the second read stops at the Tracks end");
  });
}

test("a Tracks list that fits the first read keeps its single request", async (t) => {
  const reader = await loadTracksReader("webos");
  const body = matroskaTracks();
  assert.ok(body.length < 16384, "the fixture must fit the smallest first read");
  const media = await serveRanges(body);
  t.after(media.close);

  const tracks = await reader(media.url, { maxBytesLimit: 26214400 });

  assert.equal(tracks.length, 13);
  assert.deepEqual(
    media.requests.map(([start]) => start),
    [0],
    "a complete Tracks element never adds a range request"
  );
});

test("Tracks placed after a large element is found with one bounded re-read", async (t) => {
  const reader = await loadTracksReader("webos");
  const body = matroskaTracks({ gap: 200 * 1024 });
  const media = await serveRanges(body);
  t.after(media.close);

  const tracks = await reader(media.url, { maxBytesLimit: 26214400 });

  assert.equal(tracks.length, 13);
  assert.equal(media.requests.length, 2);
  assert.equal(media.requests[1][0], 0);
  assert.ok(media.requests[1][1] - media.requests[1][0] < 1048576, "bounded to 1 MiB");
});

test("without the fix the vendored reader drops the tracks past the first read", async (t) => {
  const reader = await loadTracksReader("webos", { patched: false });
  const body = matroskaTracks({ padding: 8000 });
  const media = await serveRanges(body);
  t.after(media.close);

  const tracks = await reader(media.url, { maxBytesLimit: 26214400 });

  assert.ok(tracks.length > 0 && tracks.length < 13);
  assert.equal(
    tracks.some((track) => track.lang === "ara"),
    false,
    "this is the track the report was missing"
  );
});
