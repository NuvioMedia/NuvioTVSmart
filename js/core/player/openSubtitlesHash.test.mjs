import test from "node:test";
import assert from "node:assert/strict";

import { computeOpenSubtitlesHash, parseContentDispositionFilename } from "./openSubtitlesHash.js";

const CHUNK = 64 * 1024;

function makeHeaders(entries = {}) {
  const values = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { get: (name) => values[String(name).toLowerCase()] ?? null };
}

function makeResponse({ status = 200, headers = {}, bytes = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: makeHeaders(headers),
    body: bytes
      ? {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: bytes };
              },
              async cancel() {}
            };
          }
        }
      : null
  };
}

function expectedHash(size, first, last) {
  let hash = BigInt(size);
  for (const chunk of [first, last]) {
    for (let offset = 0; offset + 8 <= chunk.length; offset += 8) {
      let word = 0n;
      for (let index = 0; index < 8; index += 1) {
        word |= BigInt(chunk[offset + index]) << BigInt(index * 8);
      }
      hash += word;
    }
  }
  return BigInt.asUintN(64, hash).toString(16).padStart(16, "0");
}

function makeBytes(size) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) & 0xff;
  }
  return bytes;
}

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(url, options);
  };
  return calls;
}

function rangeStart(options) {
  const headers = options.headers || {};
  const value = headers.Range || headers.range || "";
  return Number(/^bytes=(\d+)-/.exec(value)?.[1] ?? NaN);
}

test("computes the Android OpenSubtitles hash from size and both 64 KB chunks", async () => {
  const size = 200000;
  const bytes = makeBytes(size);
  const calls = installFetch((_url, options) => {
    if (options.method === "HEAD") {
      return makeResponse({
        headers: {
          "Content-Length": size,
          "Content-Disposition": 'attachment; filename="movie.mkv"'
        }
      });
    }
    const start = rangeStart(options);
    const body = bytes.slice(start, start + CHUNK);
    return makeResponse({
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${start + CHUNK - 1}/${size}` },
      bytes: body
    });
  });

  const result = await computeOpenSubtitlesHash("https://files.example/movie", {
    Authorization: "Bearer token"
  });

  assert.deepEqual(result, {
    hash: expectedHash(size, bytes.slice(0, CHUNK), bytes.slice(size - CHUNK)),
    fileSize: size,
    filename: "movie.mkv"
  });
  assert.deepEqual(
    calls.map((call) => (call.options.method === "HEAD" ? "HEAD" : rangeStart(call.options))),
    ["HEAD", 0, size - CHUNK]
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
});

test("sends no hash for small files or when ranges are refused", async () => {
  let calls = installFetch(() => makeResponse({ headers: { "Content-Length": CHUNK + 10 } }));
  assert.equal(await computeOpenSubtitlesHash("https://files.example/small.mkv"), null);
  assert.equal(calls.length, 1);

  const size = 200000;
  calls = installFetch((_url, options) => {
    if (options.method === "HEAD") {
      return makeResponse({ headers: { "Content-Length": size } });
    }
    return makeResponse({ status: 200, bytes: makeBytes(CHUNK) });
  });
  assert.equal(await computeOpenSubtitlesHash("https://files.example/video.mkv"), null);
  assert.equal(calls.length, 2);
});

test("reads the size from Content-Range when HEAD is refused", async () => {
  const size = 200000;
  const bytes = makeBytes(size);
  installFetch((_url, options) => {
    if (options.method === "HEAD") {
      return makeResponse({ status: 405 });
    }
    const start = rangeStart(options);
    return makeResponse({
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${start + CHUNK - 1}/${size}` },
      bytes: bytes.slice(start, start + CHUNK)
    });
  });

  const result = await computeOpenSubtitlesHash("https://files.example/video.mkv");
  assert.equal(result?.fileSize, size);
  assert.equal(result?.hash, expectedHash(size, bytes.slice(0, CHUNK), bytes.slice(size - CHUNK)));
});

test("takes the server filename from the first range response when HEAD has none", async () => {
  const size = 200000;
  const bytes = makeBytes(size);
  installFetch((_url, options) => {
    if (options.method === "HEAD") {
      return makeResponse({ headers: { "Content-Length": size } });
    }
    const start = rangeStart(options);
    return makeResponse({
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${start + CHUNK - 1}/${size}`,
        ...(start === 0
          ? { "Content-Disposition": "attachment; filename*=UTF-8''My%20Movie.mkv" }
          : {})
      },
      bytes: bytes.slice(start, start + CHUNK)
    });
  });

  const result = await computeOpenSubtitlesHash("https://files.example/video");
  assert.equal(result?.filename, "My Movie.mkv");
});

test("ignores non-http urls and local proxy urls", async () => {
  const calls = installFetch(() => makeResponse());
  assert.equal(await computeOpenSubtitlesHash("blob:https://app/nope"), null);
  assert.equal(await computeOpenSubtitlesHash("http://127.0.0.1:1234/video.mkv"), null);
  assert.equal(await computeOpenSubtitlesHash("http://localhost:1234/video.mkv"), null);
  assert.equal(calls.length, 0);
});

test("parses plain and RFC 5987 Content-Disposition filenames", () => {
  assert.equal(parseContentDispositionFilename('attachment; filename="movie.mkv"'), "movie.mkv");
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''My%20Movie.mkv"),
    "My Movie.mkv"
  );
  assert.equal(parseContentDispositionFilename('attachment; filename="../movie.mkv"'), "movie.mkv");
  assert.equal(parseContentDispositionFilename(""), null);
});
