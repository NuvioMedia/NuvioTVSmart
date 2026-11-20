import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const tx3g = require("../services/tizen/runtime/tx3g-subtitle-parser.cjs");

function mp4Box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function mp4FullBox(type, version, flags, payload) {
  const vf = Buffer.alloc(4);
  vf.writeUInt8(version, 0);
  vf.writeUInt8((flags >> 16) & 0xff, 1);
  vf.writeUInt8((flags >> 8) & 0xff, 2);
  vf.writeUInt8(flags & 0xff, 3);
  return mp4Box(type, Buffer.concat([vf, payload]));
}

function buildTx3gMoovAndSamples(sampleTexts, baseSampleOffset) {
  const timescale = 1000;
  const sampleChunks = sampleTexts.map((text) => {
    const textBuf = Buffer.from(text, "utf8");
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(textBuf.length, 0);
    return Buffer.concat([lenBuf, textBuf]);
  });
  const sampleOffsets = sampleChunks.map((_, i) => baseSampleOffset + i * 1024);

  const tkhdPayload = Buffer.alloc(80);
  tkhdPayload.writeUInt32BE(1, 8); // track_ID = 1
  const tkhd = mp4FullBox("tkhd", 0, 1, tkhdPayload);

  const mdhdPayload = Buffer.alloc(20);
  mdhdPayload.writeUInt32BE(timescale, 8);
  mdhdPayload.writeUInt32BE(sampleTexts.length * 1000, 12);
  const mdhd = mp4FullBox("mdhd", 0, 0, mdhdPayload);

  const hdlrPayload = Buffer.alloc(24);
  hdlrPayload.write("sbtl", 4, 4, "ascii");
  const hdlr = mp4FullBox("hdlr", 0, 0, hdlrPayload);

  const tx3gEntry = mp4Box("tx3g", Buffer.alloc(16));
  const stsdHeader = Buffer.alloc(4);
  stsdHeader.writeUInt32BE(1, 0);
  const stsd = mp4FullBox("stsd", 0, 0, Buffer.concat([stsdHeader, tx3gEntry]));

  const sttsHeader = Buffer.alloc(4);
  sttsHeader.writeUInt32BE(1, 0);
  const sttsEntry = Buffer.alloc(8);
  sttsEntry.writeUInt32BE(sampleTexts.length, 0);
  sttsEntry.writeUInt32BE(1000, 4);
  const stts = mp4FullBox("stts", 0, 0, Buffer.concat([sttsHeader, sttsEntry]));

  const stscHeader = Buffer.alloc(4);
  stscHeader.writeUInt32BE(1, 0);
  const stscEntry = Buffer.alloc(12);
  stscEntry.writeUInt32BE(1, 0);
  stscEntry.writeUInt32BE(1, 4);
  stscEntry.writeUInt32BE(1, 8);
  const stsc = mp4FullBox("stsc", 0, 0, Buffer.concat([stscHeader, stscEntry]));

  const stszPayload = Buffer.alloc(8 + sampleChunks.length * 4);
  stszPayload.writeUInt32BE(0, 0);
  stszPayload.writeUInt32BE(sampleChunks.length, 4);
  sampleChunks.forEach((chunk, idx) => {
    stszPayload.writeUInt32BE(chunk.length, 8 + idx * 4);
  });
  const stsz = mp4FullBox("stsz", 0, 0, stszPayload);

  const stcoPayload = Buffer.alloc(4 + sampleOffsets.length * 4);
  stcoPayload.writeUInt32BE(sampleOffsets.length, 0);
  sampleOffsets.forEach((off, idx) => {
    stcoPayload.writeUInt32BE(off, 4 + idx * 4);
  });
  const stco = mp4FullBox("stco", 0, 0, stcoPayload);

  const stbl = mp4Box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stco]));
  const minf = mp4Box("minf", stbl);
  const mdia = mp4Box("mdia", Buffer.concat([mdhd, hdlr, minf]));
  const trak = mp4Box("trak", Buffer.concat([tkhd, mdia]));
  const moov = mp4Box("moov", trak);

  return { moov, sampleChunks, sampleOffsets };
}

test("findBoxTypeInBuffer locates unaligned tail moov using native Buffer#indexOf without per-byte toString", () => {
  const moovPayload = Buffer.from("tx3g-tail-test", "ascii");
  const moov = mp4Box("moov", moovPayload);
  const tailNoise = Buffer.alloc(128, 0x20);
  const buffer = Buffer.concat([Buffer.alloc(37, 0), moov, tailNoise]);

  let asciiToStringCalls = 0;
  const origToString = buffer.toString;
  buffer.toString = function (encoding, start, end) {
    if (encoding === "ascii") asciiToStringCalls += 1;
    return origToString.call(this, encoding, start, end);
  };

  const found = tx3g.findBoxTypeInBuffer(buffer, 1000, "moov");
  assert.ok(found);
  assert.equal(found.type, "moov");
  assert.equal(found.absoluteStart, 1037);
  assert.equal(asciiToStringCalls <= 1, true, "must not allocate per-byte ascii strings");
});

test("tx3g extractTx3gWindow bounds concurrent HTTP sample requests and enforces request timeout", async () => {
  const sampleTexts = Array.from({ length: 10 }, (_, i) => `Cue${i}`);
  const baseSampleOffset = 2 * 1024 * 1024;
  const totalSize = baseSampleOffset + 32 * 1024;
  const { moov, sampleChunks, sampleOffsets } = buildTx3gMoovAndSamples(
    sampleTexts,
    baseSampleOffset
  );
  const ftyp = mp4Box("ftyp", Buffer.from("isom\x00\x00\x02\x00", "ascii"));
  const headBuf = Buffer.concat([ftyp, moov]);

  let inFlightSamples = 0;
  let maxInFlightSamples = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/hang") {
      // Intentionally leave response hanging to trigger socket/request timeout.
      return;
    }
    const match = String(req.headers.range || "").match(/^bytes=(\d+)-(\d+)$/);
    if (!match) {
      res.writeHead(416);
      res.end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(totalSize - 1, Number(match[2]));
    if (start === 0) {
      const actualEnd = Math.min(end, 1024 * 1024 - 1);
      const slice = Buffer.alloc(actualEnd + 1);
      headBuf.copy(slice, 0);
      res.writeHead(206, {
        "Content-Range": `bytes 0-${actualEnd}/${totalSize}`,
        "Content-Length": String(slice.length)
      });
      res.end(slice);
      return;
    }

    const idx = sampleOffsets.indexOf(start);
    assert.notEqual(idx, -1, `Unexpected sample start offset ${start}`);
    const body = sampleChunks[idx];
    inFlightSamples += 1;
    maxInFlightSamples = Math.max(maxInFlightSamples, inFlightSamples);
    setTimeout(() => {
      inFlightSamples -= 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${start + body.length - 1}/${totalSize}`,
        "Content-Length": String(body.length)
      });
      res.end(body);
    }, 15);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const windowResult = await tx3g.extractTx3gWindow({
      url: `http://127.0.0.1:${port}/video.mp4`,
      trackNumber: 1,
      startSeconds: 0,
      endSeconds: 20
    });
    assert.equal(windowResult.cueCount, 10);
    assert.equal(windowResult.body.includes("Cue9"), true);
    assert.equal(
      maxInFlightSamples > 1 && maxInFlightSamples <= 4,
      true,
      `expected bounded concurrency <= 4, saw ${maxInFlightSamples}`
    );

    await assert.rejects(
      () =>
        tx3g.extractTx3gWindow({
          url: `http://127.0.0.1:${port}/hang`,
          trackNumber: 1,
          startSeconds: 0,
          endSeconds: 10,
          requestTimeoutMs: 60
        }),
      (err) => err && err.code === "TIMEOUT"
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("tx3g-subtitle-parser.cjs remains ES5", async () => {
  const tx3gSrc = await readFile(
    new URL("../services/tizen/runtime/tx3g-subtitle-parser.cjs", import.meta.url),
    "utf8"
  );
  assert.equal(
    !/\b(?:const|let|class)\b/.test(tx3gSrc),
    true,
    "tx3g-subtitle-parser.cjs must remain ES5"
  );
});
