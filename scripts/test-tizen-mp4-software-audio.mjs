import assert from "node:assert/strict";

const { buildAdtsHeader, buildAdtsChunk, resolveAacConfig, computeSchedule } =
  await import("../js/core/player/engines/mp4MseAudio.js");

assert.deepEqual(
  Array.from(
    buildAdtsHeader({ objectType: 2, frequencyIndex: 3, channelConfig: 1, frameLength: 100 })
  ),
  [0xff, 0xf1, 0x4c, 0x40, 0x0c, 0x9f, 0xfc]
);

assert.deepEqual(
  Array.from(
    buildAdtsHeader({ objectType: 2, frequencyIndex: 3, channelConfig: 2, frameLength: 0x1fff })
  ),
  [0xff, 0xf1, 0x4c, 0x83, 0xff, 0xff, 0xfc]
);

assert.throws(
  () =>
    buildAdtsHeader({ objectType: 2, frequencyIndex: 3, channelConfig: 1, frameLength: 0x2000 }),
  /AAC frame too large/
);

assert.deepEqual(
  resolveAacConfig({ codec: "mp4a.40.2", audio: { sample_rate: 48000, channel_count: 1 } }),
  { objectType: 2, frequencyIndex: 3, channelConfig: 1, sampleRate: 48000 }
);
assert.equal(
  resolveAacConfig({ codec: "mp4a.40.5", audio: { sample_rate: 48000, channel_count: 1 } }),
  null
);
assert.equal(
  resolveAacConfig({ codec: "mp4a.40.2", audio: { sample_rate: 12345, channel_count: 1 } }),
  null
);
assert.equal(
  resolveAacConfig({ codec: "mp4a.40.2", audio: { sample_rate: 48000, channel_count: 6 } }),
  null
);

const chunk = buildAdtsChunk(
  [
    { data: new Uint8Array(300), cts: 0, duration: 1024, timescale: 48000 },
    { data: new Uint8Array(301), cts: 1024, duration: 1024, timescale: 48000 },
    { data: new Uint8Array(302), cts: 2048, duration: 1024, timescale: 48000 }
  ],
  { objectType: 2, frequencyIndex: 3, channelConfig: 1, sampleRate: 48000 }
);
assert.equal(chunk.data.length, 924);
assert.equal(chunk.startTime, 0);
assert.equal(chunk.duration, 0.064);
assert.deepEqual(Array.from(chunk.data.slice(0, 7)), [0xff, 0xf1, 0x4c, 0x40, 0x26, 0x7f, 0xfc]);

assert.deepEqual(
  computeSchedule({
    anchorCtxTime: 10,
    anchorMediaTime: 100,
    mediaTime: 103,
    ctxTime: 10,
    rate: 1
  }),
  { when: 13, offset: 0, late: 0 }
);
assert.deepEqual(
  computeSchedule({
    anchorCtxTime: 10,
    anchorMediaTime: 100,
    mediaTime: 100,
    ctxTime: 10.5,
    rate: 1
  }),
  { when: 10.5, offset: 0.5, late: 0.5 }
);
assert.deepEqual(
  computeSchedule({
    anchorCtxTime: 10,
    anchorMediaTime: 100,
    mediaTime: 103,
    ctxTime: 10,
    rate: 2
  }),
  { when: 11.5, offset: 0, late: 0 }
);

console.log("tizen mp4 software audio tests passed");
