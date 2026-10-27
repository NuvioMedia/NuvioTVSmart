import assert from "node:assert/strict";
import {
  parseMatroskaAudioTracks,
  fetchMatroskaAudioTracks
} from "../js/data/repository/matroskaAudioMetadata.js";

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
const entry = (id, type, language, codec, ietf = "") =>
  element(
    "ae",
    Buffer.concat([
      number("d7", id),
      number("83", type),
      element("86", codec),
      ...(language === null ? [] : [element("22b59c", language)]),
      ...(ietf ? [element("22b59d", ietf)] : [])
    ])
  );
const video = entry(1, 1, null, "V_MPEGH/ISO/HEVC");
const czech = entry(2, 2, "cze", "A_EAC3");
const english = entry(3, 2, "eng", "A_EAC3");
const header = element("1a45dfa3", element("4282", "matroska"));
const fixture = (entries, unknown = false) => {
  const data = element("1654ae6b", Buffer.concat(entries));
  return Buffer.concat([
    header,
    unknown
      ? Buffer.concat([Buffer.from("1853806701ffffffffffffff", "hex"), data])
      : element("18538067", data)
  ]);
};
const bytes = fixture([video, czech, english]);
const tracks = parseMatroskaAudioTracks(bytes);
assert.deepEqual(
  tracks.map(({ id, language, containerStreamIndex, codec }) => ({
    id,
    language,
    containerStreamIndex,
    codec
  })),
  [
    { id: 2, language: "cze", containerStreamIndex: 1, codec: "A_EAC3" },
    { id: 3, language: "eng", containerStreamIndex: 2, codec: "A_EAC3" }
  ]
);
assert.deepEqual(parseMatroskaAudioTracks(fixture([video, czech, english], true)), tracks);
assert.equal(
  parseMatroskaAudioTracks(fixture([entry(7, 2, "eng", "A_AC3", "pt-BR")]))[0].language,
  "pt-BR"
);
assert.equal(parseMatroskaAudioTracks(fixture([entry(7, 2, null, "A_AC3")]))[0].language, "");
assert.deepEqual(
  parseMatroskaAudioTracks(fixture([czech, czech])),
  [],
  "duplicate track IDs are rejected"
);
for (let end = 0; end < bytes.length; end += 1) {
  assert.deepEqual(
    parseMatroskaAudioTracks(bytes.subarray(0, end)),
    [],
    `truncated header at ${end}`
  );
}
assert.deepEqual(parseMatroskaAudioTracks(Buffer.from("not an MKV")), []);

const originalFetch = globalThis.fetch;
let cancels = 0;
let reads = 0;
let fetches = 0;
const reply = (
  body = bytes,
  status = 206,
  range = `bytes 0-${body.length - 1}/${body.length}`
) => ({
  status,
  headers: { get: () => range },
  body: {
    getReader: () => {
      let sent = false;
      return {
        read: async () => {
          reads += 1;
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: body };
        },
        cancel: async () => {
          cancels += 1;
        }
      };
    }
  }
});
globalThis.fetch = async (_url, options) => {
  fetches += 1;
  assert.equal(options.headers.Range, "bytes=0-1048575");
  assert.equal(options.credentials, "omit");
  return reply();
};
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/movie.mkv"), tracks);
assert.equal(reads, 2, "read only the requested header response");
assert.equal(cancels, 1);
globalThis.fetch = async () => reply(bytes, 200);
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/ignored-range"), []);
assert.equal(reads, 2, "never consume a server's full-file response");
globalThis.fetch = async () => reply(bytes, 206, "bytes 50-100/200");
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/wrong-range"), []);
globalThis.fetch = async () => reply(new Uint8Array(1048577));
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/oversized"), []);
globalThis.fetch = async () => {
  throw new TypeError("CORS");
};
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/cors"), []);
assert.deepEqual(await fetchMatroskaAudioTracks("file:///movie.mkv"), []);

const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => originalTimeout(fn, ms === 3000 ? 5 : ms);
globalThis.fetch = async (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/stalled"), []);
globalThis.setTimeout = originalTimeout;

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { Platform } = await import("../js/platform/index.js");
const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");
const { localMediaTracksRepository } =
  await import("../js/data/repository/localMediaTracksRepository.js");
Platform.isTizen = () => true;
Platform.isWebOS = () => false;
TizenEngineFsService.ensureStarted = async () => ({ status: "unsupported" });
globalThis.fetch = async () => {
  fetches += 1;
  return reply();
};
const recovered = await localMediaTracksRepository.getTracks("https://example.test/fallback.mkv");
assert.deepEqual(recovered, tracks);
const beforeCache = fetches;
await localMediaTracksRepository.getTracks("https://example.test/fallback.mkv");
assert.equal(fetches, beforeCache, "reuse the repository's metadata cache");
TizenEngineFsService.ensureStarted = async () => ({
  status: "success",
  baseUrl: "http://127.0.0.1:2710"
});
globalThis.fetch = async (url) => {
  assert.ok(
    url.startsWith("http://127.0.0.1:2710/tracks/"),
    "healthy service takes precedence over direct probing"
  );
  return { ok: true, json: async () => tracks };
};
assert.deepEqual(
  await localMediaTracksRepository.getTracks("https://example.test/service.mkv"),
  tracks
);

const { Environment } = await import("../js/platform/environment.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods12 } =
  await import("../js/ui/screens/player/playerScreenMethods-12-normalize-embedded-audio-tracks.js");
const { createPlayerScreenMethods40 } =
  await import("../js/ui/screens/player/playerScreenMethods-40-wait-for-initial-embedded-track-bootstrap.js");
const { createPlayerScreenMethods41 } =
  await import("../js/ui/screens/player/playerScreenMethods-41-build-subtitle-track-signature.js");
const { createPlayerScreenMethods51 } =
  await import("../js/ui/screens/player/playerScreenMethods-51-get-startup-preferred-subtitle-language-targets.js");
Environment.isTizen = () => true;
Environment.isWebOS = () => false;
const nativeTracks = [1, 2].map((index) => ({
  avplayTrackIndex: index,
  codec: "audio/x-eac3",
  language: ""
}));
PlayerController.getAvPlayAudioTracks = () => nativeTracks;
const screen = {
  ...createPlayerScreenMethods12(),
  ...createPlayerScreenMethods40(),
  ...createPlayerScreenMethods41(),
  ...createPlayerScreenMethods51()
};
screen.embeddedAudioTracks = screen.normalizeEmbeddedAudioTracks(recovered);
const merged = nativeTracks.map((track, index) =>
  screen.mergeAvPlayAudioTrackMetadata(track, index)
);
assert.deepEqual(
  merged.map((track) => track.language),
  ["cs", "en"]
);
screen.getAudioEntries = () => merged.map((track, index) => ({ track, id: String(index) }));
assert.equal(
  screen.findStartupPreferredAudioOption(["en"]).entryIndex,
  1,
  "select English instead of the first Czech track"
);
screen.embeddedAudioTracks[1].raw = {
  ...screen.embeddedAudioTracks[1].raw,
  containerStreamIndex: 4
};
assert.equal(
  screen.getEmbeddedAudioTrackForAvPlayTrack(nativeTracks[1], 1),
  null,
  "reject conflicting stream identity"
);
screen.embeddedAudioTracks.pop();
assert.equal(
  screen.getEmbeddedAudioTrackForAvPlayTrack(nativeTracks[0], 0),
  null,
  "reject mismatched codec counts"
);
globalThis.fetch = originalFetch;
console.log(
  "Tizen MKV audio metadata: parser, bounded range reads, repository fallback, mapping and English startup selection passed"
);

// SeekHead points beyond the first Cluster, without downloading Cluster data.
const { matroskaTracksOffset } = await import("../js/data/repository/matroskaAudioMetadata.js");
const tracksElement = element("1654ae6b", Buffer.concat([video, czech, english]));
const relativeTracks = 2000000;
const position = Buffer.alloc(4);
position.writeUInt32BE(relativeTracks);
const seekHead = element(
  "114d9b74",
  element(
    "4dbb",
    Buffer.concat([element("53ab", Buffer.from("1654ae6b", "hex")), element("53ac", position)])
  )
);
const prefix = Buffer.concat([header, Buffer.from("1853806701ffffffffffffff", "hex")]);
const clusterHeader = Buffer.from("1f43b67501ffffffffffffff", "hex");
const indexedHeader = Buffer.concat([prefix, seekHead, clusterHeader]);
const absoluteTracks = prefix.length + relativeTracks;
assert.equal(matroskaTracksOffset(indexedHeader), absoluteTracks);
assert.deepEqual(parseMatroskaAudioTracks(indexedHeader), []);
let ranges = [];
globalThis.fetch = async (_url, options) => {
  ranges.push(options.headers.Range);
  return ranges.length === 1
    ? reply(indexedHeader)
    : reply(
        tracksElement,
        206,
        `bytes ${absoluteTracks}-${absoluteTracks + tracksElement.length - 1}/5000000`
      );
};
assert.deepEqual(
  await fetchMatroskaAudioTracks("https://example.test/tracks-after-clusters.mkv"),
  tracks
);
assert.deepEqual(ranges, [
  "bytes=0-1048575",
  `bytes=${absoluteTracks}-${absoluteTracks + 1048575}`
]);
for (const response of [
  reply(tracksElement, 200),
  reply(tracksElement, 206, "bytes 0-100/5000000"),
  reply(
    indexedHeader,
    206,
    `bytes ${absoluteTracks}-${absoluteTracks + indexedHeader.length - 1}/5000000`
  )
]) {
  let request = 0;
  globalThis.fetch = async () => (++request === 1 ? reply(indexedHeader) : response);
  assert.deepEqual(await fetchMatroskaAudioTracks("https://example.test/invalid-index.mkv"), []);
  assert.equal(request, 2, "never follow another index recursively");
}
for (let end = 0; end < seekHead.length; end++) {
  assert.equal(matroskaTracksOffset(Buffer.concat([prefix, seekHead.subarray(0, end)])), null);
}
globalThis.fetch = originalFetch;
console.log(
  "Indexed MKV Tracks: bounded offset, Cluster bypass, bad range and invalid target checks passed"
);
