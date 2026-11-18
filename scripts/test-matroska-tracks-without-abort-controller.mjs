import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchMatroskaTracks } from "../js/data/repository/matroskaTrackMetadata.js";

// Tizen 5.0 and older ship Chromium < 66, which has no AbortController. The
// embedded track probe must still read the Matroska header there (before, it
// returned [] at once and AVPlay's truncated language codes were all that was
// left), and a source that never answers must still settle within its timeout.

const element = (id, payload) => {
  const key = Buffer.from(id, "hex");
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const size =
    data.length < 127
      ? Buffer.from([128 + data.length])
      : Buffer.from([64 + (data.length >> 8), data.length & 255]);
  return Buffer.concat([key, size, data]);
};
const number = (id, value) => element(id, [value]);
const track = (id, type, language, codec, name) =>
  element(
    "ae",
    Buffer.concat([
      number("d7", id),
      number("83", type),
      element("86", codec),
      element("22b59c", language),
      element("536e", name)
    ])
  );
const mkv = Buffer.concat([
  element("1a45dfa3", element("4282", "matroska")),
  element(
    "18538067",
    element(
      "1654ae6b",
      Buffer.concat([
        track(2, 2, "ita", "A_EAC3", "Italiano"),
        track(3, 17, "rum", "S_TEXT/UTF8", "Romana")
      ])
    )
  )
]);

function rangeReply(body) {
  return {
    status: 206,
    headers: {
      get: (name) => (name === "content-range" ? `bytes 0-${body.length - 1}/${body.length}` : null)
    },
    body: {
      getReader() {
        let sent = false;
        return {
          read: async () =>
            sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(body) }),
          cancel: async () => {}
        };
      }
    }
  };
}

async function withoutAbortController(run) {
  const saved = { abort: globalThis.AbortController, fetch: globalThis.fetch };
  delete globalThis.AbortController;
  try {
    await run();
  } finally {
    globalThis.AbortController = saved.abort;
    globalThis.fetch = saved.fetch;
  }
}

test("reads names, codecs and full languages without AbortController", async () => {
  await withoutAbortController(async () => {
    const seen = [];
    globalThis.fetch = async (_url, options) => {
      seen.push(options);
      return rangeReply(mkv);
    };
    const tracks = await fetchMatroskaTracks("http://127.0.0.1:2710/hash/0");
    assert.deepEqual(
      tracks.map(({ type, language, codec, name }) => ({ type, language, codec, name })),
      [
        { type: "audio", language: "ita", codec: "A_EAC3", name: "Italiano" },
        { type: "subtitle", language: "rum", codec: "S_TEXT/UTF8", name: "Romana" }
      ]
    );
    assert.equal(seen[0].signal, undefined, "no signal is passed where AbortController is missing");
  });
});

test("a source that never answers still settles without AbortController", async () => {
  await withoutAbortController(async () => {
    globalThis.fetch = () => new Promise(() => {});
    const started = Date.now();
    assert.deepEqual(await fetchMatroskaTracks("http://127.0.0.1:2710/hash/0"), []);
    assert.ok(Date.now() - started < 4500, "bounded by the probe timeout");
  });
});
