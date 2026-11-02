import assert from "node:assert/strict";
import {
  parseMatroskaTracks,
  fetchMatroskaTracks
} from "../js/data/repository/matroskaTrackMetadata.js";

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
const tracks = parseMatroskaTracks(bytes);
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
assert.deepEqual(parseMatroskaTracks(fixture([video, czech, english], true)), tracks);
assert.equal(
  parseMatroskaTracks(fixture([entry(7, 2, "eng", "A_AC3", "pt-BR")]))[0].language,
  "pt-BR"
);
assert.equal(
  parseMatroskaTracks(fixture([entry(7, 2, null, "A_AC3", "en-US")]))[0].language,
  "en-US",
  "LanguageBCP47 alone is enough"
);
assert.equal(
  parseMatroskaTracks(fixture([entry(7, 2, null, "A_AC3")]))[0].language,
  "eng",
  "a missing Language follows the Matroska default"
);
assert.equal(
  parseMatroskaTracks(fixture([entry(7, 2, "und", "A_AC3")]))[0].language,
  "und",
  "an explicit und stays undetermined"
);
const subtitleTracks = parseMatroskaTracks(
  fixture([
    video,
    czech,
    english,
    entry(4, 17, "cze", "S_TEXT/UTF8"),
    entry(5, 17, null, "S_TEXT/UTF8")
  ])
).filter((track) => track.type === "subtitle");
assert.deepEqual(
  subtitleTracks.map(({ id, language, containerStreamIndex, codec }) => ({
    id,
    language,
    containerStreamIndex,
    codec
  })),
  [
    { id: 4, language: "cze", containerStreamIndex: 3, codec: "S_TEXT/UTF8" },
    { id: 5, language: "eng", containerStreamIndex: 4, codec: "S_TEXT/UTF8" }
  ],
  "subtitle tracks keep their container order and language"
);
assert.deepEqual(
  parseMatroskaTracks(fixture([czech, czech])),
  [],
  "duplicate track IDs are rejected"
);
for (let end = 0; end < bytes.length; end += 1) {
  assert.deepEqual(parseMatroskaTracks(bytes.subarray(0, end)), [], `truncated header at ${end}`);
}
assert.deepEqual(parseMatroskaTracks(Buffer.from("not an MKV")), []);

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
  assert.equal(options.headers.Range, "bytes=0-65535");
  assert.equal(options.credentials, "omit");
  return reply();
};
assert.deepEqual(await fetchMatroskaTracks("https://example.test/movie.mkv"), tracks);
assert.equal(reads, 2, "read only the requested header response");
assert.equal(cancels, 1);
globalThis.fetch = async () => reply(bytes, 200);
assert.deepEqual(await fetchMatroskaTracks("https://example.test/ignored-range"), []);
assert.equal(reads, 2, "never consume a server's full-file response");
globalThis.fetch = async () => reply(bytes, 206, "bytes 50-100/200");
assert.deepEqual(await fetchMatroskaTracks("https://example.test/wrong-range"), []);
let nonMatroskaRequests = 0;
globalThis.fetch = async () => {
  nonMatroskaRequests += 1;
  return reply(Buffer.from("not an MKV"));
};
assert.deepEqual(await fetchMatroskaTracks("https://example.test/not-matroska.mp4"), []);
assert.equal(nonMatroskaRequests, 1, "skip the larger read when the probe is not Matroska");
globalThis.fetch = async () => reply(new Uint8Array(1048577));
assert.deepEqual(await fetchMatroskaTracks("https://example.test/oversized"), []);
globalThis.fetch = async () => {
  throw new TypeError("CORS");
};
assert.deepEqual(await fetchMatroskaTracks("https://example.test/cors"), []);
assert.deepEqual(await fetchMatroskaTracks("file:///movie.mkv"), []);

const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => originalTimeout(fn, ms === 3000 ? 5 : ms);
globalThis.fetch = async (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
assert.deepEqual(await fetchMatroskaTracks("https://example.test/stalled"), []);
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
const headerWithSubtitles = fixture([
  video,
  czech,
  english,
  entry(4, 17, "cze", "S_TEXT/UTF8"),
  entry(5, 17, null, "S_TEXT/UTF8")
]);
globalThis.fetch = async (url) =>
  url.startsWith("http://127.0.0.1:2710/tracks/")
    ? { ok: true, json: async () => tracks }
    : reply(headerWithSubtitles);
const serviceWithHeaderSubtitles = await localMediaTracksRepository.getTracks(
  "https://example.test/service-audio-only.mkv"
);
assert.deepEqual(
  serviceWithHeaderSubtitles
    .filter((track) => track.type === "subtitle")
    .map((track) => track.language),
  ["cze", "eng"],
  "append header subtitle metadata when the service returns only audio"
);

const serviceWithoutLanguages = [
  ...tracks.map((track) => ({ ...track, language: "" })),
  { id: 4, type: "text", language: "", codec: "S_TEXT/UTF8" }
];
globalThis.fetch = async (url) =>
  url.startsWith("http://127.0.0.1:2710/tracks/")
    ? { ok: true, json: async () => serviceWithoutLanguages }
    : reply();
const mergedServiceTracks = await localMediaTracksRepository.getTracks(
  "https://example.test/service-without-languages.mkv"
);
assert.deepEqual(
  mergedServiceTracks
    .filter((track) => String(track.type).toLowerCase() === "audio")
    .map((track) => track.language),
  ["cze", "eng"],
  "fill missing service languages from the Matroska header"
);
assert.equal(
  mergedServiceTracks.some((track) => String(track.type).toLowerCase() === "text"),
  true,
  "keep the service's subtitle metadata"
);

const hangingService = new Promise(() => {});
TizenEngineFsService.ensureStarted = async () => hangingService;
const originalProbeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => originalProbeTimeout(fn, ms === 2000 ? 5 : ms);
try {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Range, "bytes=0-65535");
    return reply();
  };
  const hangingTracks = await localMediaTracksRepository.getTracks(
    "https://example.test/service-hangs.mkv"
  );
  assert.deepEqual(
    hangingTracks.map(({ id, language, containerStreamIndex }) => ({
      id,
      language,
      containerStreamIndex
    })),
    [
      { id: 2, language: "cze", containerStreamIndex: 1 },
      { id: 3, language: "eng", containerStreamIndex: 2 }
    ],
    "the header answers without waiting for a stalled service"
  );
  globalThis.fetch = async () => reply(Buffer.from("not an MKV"));
  assert.deepEqual(
    await localMediaTracksRepository.getTracks(
      "https://example.test/service-hangs-without-header.mkv"
    ),
    [],
    "a stalled service cannot hold startup after the header is unusable"
  );
} finally {
  globalThis.setTimeout = originalProbeTimeout;
}

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
const noCodecNativeTracks = nativeTracks.map(({ codec, ...track }) => track);
PlayerController.getAvPlayAudioTracks = () => noCodecNativeTracks;
assert.equal(
  screen.getEmbeddedAudioTrackForAvPlayTrack(noCodecNativeTracks[1], 1)?.language,
  "en",
  "match by container stream index when AVPlay has no codec"
);
PlayerController.getAvPlayAudioTracks = () => nativeTracks;
screen.invalidateTrackDialogCaches = () => {
  screen.trackDialogCache = {};
};
screen.findRememberedAudioOption = () => null;
screen.getStartupPreferredAudioLanguageTargets = () => ["en"];
screen.startupAudioPreferenceApplied = true;
screen.getAudioEntries = () => [
  { id: "0", track: merged[0], selected: true, supported: true },
  { id: "1", track: merged[1], selected: false, supported: true }
];
assert.equal(
  screen.maybeReapplyTizenStartupAudioPreference(),
  true,
  "reopen the startup preference when metadata arrives after a fallback"
);
assert.equal(screen.startupAudioPreferenceApplied, false);
screen.startupAudioPreferenceApplied = true;
assert.equal(
  screen.maybeReapplyTizenStartupAudioPreference(),
  false,
  "retry the late correction only once per stream"
);
assert.equal(screen.startupAudioPreferenceApplied, true);
screen.tizenLateAudioPreferenceAttempted = false;
screen.userAudioTrackSelected = true;
assert.equal(
  screen.maybeReapplyTizenStartupAudioPreference(),
  false,
  "never override a manual audio selection"
);
assert.equal(screen.startupAudioPreferenceApplied, true);
screen.userAudioTrackSelected = false;
screen.tizenLateAudioPreferenceAttempted = false;
screen.getAudioEntries = () => [
  { id: "0", track: merged[0], selected: false, supported: true },
  { id: "1", track: merged[1], selected: true, supported: true }
];
assert.equal(
  screen.maybeReapplyTizenStartupAudioPreference(),
  false,
  "leave an already preferred selection untouched"
);
assert.equal(screen.startupAudioPreferenceApplied, true);
screen.findRememberedAudioOption = () => ({ entry: { selected: false } });
screen.startupAudioPreferenceApplied = true;
screen.tizenLateAudioPreferenceAttempted = false;
assert.equal(
  screen.maybeReapplyTizenStartupAudioPreference(),
  true,
  "reopen startup matching when a remembered track was not applied yet"
);
assert.equal(screen.startupAudioPreferenceApplied, false);
screen.findRememberedAudioOption = () => null;

let lateAppliedIndex = -1;
screen.getAudioEntries = () => [
  { id: "0", track: merged[0], selected: lateAppliedIndex !== 1, supported: true },
  { id: "1", track: merged[1], selected: lateAppliedIndex === 1, supported: true }
];
screen.applyAudioTrack = (index) => {
  lateAppliedIndex = index;
};
screen.clearStartupAudioPreferenceRetry = () => {};
screen.isAudioPreferenceDiscoveryPending = () => false;
screen.startupAudioPreferenceApplied = false;
assert.equal(screen.applyStartupAudioPreference(), true);
assert.equal(lateAppliedIndex, 1, "late metadata applies English through the normal startup pass");
assert.equal(screen.startupAudioPreferenceApplied, true);

screen.embeddedAudioTracks[0].raw = {
  ...screen.embeddedAudioTracks[0].raw,
  containerStreamIndex: 3
};
screen.embeddedAudioTracks[1].raw = {
  ...screen.embeddedAudioTracks[1].raw,
  containerStreamIndex: 4
};
assert.deepEqual(
  nativeTracks.map(
    (track, index) => screen.getEmbeddedAudioTrackForAvPlayTrack(track, index)?.language
  ),
  ["cs", "en"],
  "match by codec occurrence when AVPlay renumbers around omitted unsupported tracks"
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
const { matroskaTracksOffset } = await import("../js/data/repository/matroskaTrackMetadata.js");
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
assert.deepEqual(parseMatroskaTracks(indexedHeader), []);
let ranges = [];
globalThis.fetch = async (_url, options) => {
  ranges.push(options.headers.Range);
  return ranges.length === 1 ? reply(indexedHeader) : reply(tracksElement, 206, null);
};
assert.deepEqual(
  await fetchMatroskaTracks("https://example.test/tracks-after-clusters.mkv"),
  tracks
);
assert.deepEqual(ranges, ["bytes=0-65535", `bytes=${absoluteTracks}-${absoluteTracks + 65535}`]);
const eightBytePosition = Buffer.alloc(8);
eightBytePosition.writeUInt32BE(0, 0);
eightBytePosition.writeUInt32BE(relativeTracks, 4);
const eightByteSeekHead = element(
  "114d9b74",
  element(
    "4dbb",
    Buffer.concat([
      element("53ab", Buffer.from("1654ae6b", "hex")),
      element("53ac", eightBytePosition)
    ])
  )
);
assert.equal(
  matroskaTracksOffset(Buffer.concat([prefix, eightByteSeekHead, clusterHeader])),
  absoluteTracks
);
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
  assert.deepEqual(await fetchMatroskaTracks("https://example.test/invalid-index.mkv"), []);
  assert.equal(request, 2, "never follow another index recursively");
}
for (let end = 0; end < seekHead.length; end++) {
  assert.equal(matroskaTracksOffset(Buffer.concat([prefix, seekHead.subarray(0, end)])), null);
}

// Attachments or cover art can push Tracks past the first 64 KiB chunk.
const padding = Buffer.concat(Array.from({ length: 700 }, () => element("ec", Buffer.alloc(100))));
const largeHeader = Buffer.concat([
  header,
  Buffer.from("1853806701ffffffffffffff", "hex"),
  padding,
  tracksElement
]);
const rangedReply = (body, start, size) => {
  const slice = body.subarray(start, start + size);
  return reply(slice, 206, `bytes ${start}-${start + slice.length - 1}/${body.length}`);
};
globalThis.fetch = async (_url, options) => {
  const match = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
  const start = Number(match[1]);
  const end = Number(match[2]);
  return rangedReply(largeHeader, start, end - start + 1);
};
assert.deepEqual(
  await fetchMatroskaTracks("https://example.test/large-header.mkv"),
  tracks,
  "read the second chunk when Tracks follows a large attachment"
);
globalThis.fetch = originalFetch;
console.log(
  "Indexed MKV Tracks: bounded offset, Cluster bypass, bad range and invalid target checks passed"
);

const { createPlayerScreenMethods11 } =
  await import("../js/ui/screens/player/playerScreenMethods-11-release-current-engine-fs-stream-best-effort.js");
const gateScreen = {
  ...createPlayerScreenMethods11(),
  getTrackProbeUrl: () => "https://example.test/gate.mkv",
  isCurrentSourceAdaptiveManifest: () => false
};
PlayerController.playbackEngine = "tizen-avplay";
PlayerController.avplayActive = true;
assert.equal(
  gateScreen.canDiscoverEmbeddedAudioTracks(),
  true,
  "Tizen AVPlay must expose embedded audio metadata"
);
assert.equal(
  gateScreen.canDiscoverEmbeddedSubtitleTracks(),
  true,
  "Tizen AVPlay must expose embedded subtitle metadata"
);
PlayerController.avplayActive = false;
assert.equal(gateScreen.canDiscoverEmbeddedAudioTracks(), false);
assert.equal(gateScreen.canDiscoverEmbeddedSubtitleTracks(), false);
PlayerController.avplayActive = true;
console.log("Tizen AVPlay metadata gate: accepts tizen-avplay for audio and subtitles");

const subtitleScreen = {
  ...createPlayerScreenMethods11(),
  ...createPlayerScreenMethods40(),
  ...createPlayerScreenMethods41()
};
subtitleScreen.embeddedSubtitleTracks = subtitleScreen.normalizeEmbeddedSubtitleTracks(
  parseMatroskaTracks(headerWithSubtitles)
);
assert.equal(
  subtitleScreen.mergeAvPlaySubtitleTrackMetadata(
    { avplayTrackIndex: 3, language: "", extraInfo: { track_num: "0" } },
    0
  ).language,
  "cs",
  "Czech subtitle language comes from the MKV header"
);
assert.equal(
  subtitleScreen.mergeAvPlaySubtitleTrackMetadata(
    { avplayTrackIndex: 4, language: "", extraInfo: { track_num: "1" } },
    1
  ).language,
  "en",
  "untagged English subtitle uses the Matroska default"
);

const { createPlayerVideoLifecycleHandlers } =
  await import("../js/ui/screens/player/playerVideoLifecycleHandlers.js");
const startupCalls = [];
const startupContext = {
  paused: false,
  isStartupErrorVisible: () => false,
  reapplyPendingWebOsAddonSubtitle: () => {},
  attemptPendingPlaybackRestore: () => {},
  loadEmbeddedSubtitleTracks: () => {
    startupCalls.push("load");
    return Promise.resolve();
  },
  refreshTrackDialogs: () => {
    startupCalls.push("refresh");
  },
  updateUiTick: () => {},
  markPlaybackProgress: () => {},
  applyAudioAmplification: () => {},
  applySubtitlePresentationSettings: () => {},
  applyAspectMode: () => {},
  ensureTrackDataWarmup: () => {},
  updateMediaSessionPositionState: () => {},
  schedulePauseOverlay: () => {},
  startTrackDiscoveryWindow: () => {},
  scheduleLoadingCompletionCheck: () => {},
  attemptSilentAudioRecovery: () => {}
};
PlayerController.getAvPlayAudioTracks = () => [{ avplayTrackIndex: 1, language: "" }];
const startupHandlers = createPlayerVideoLifecycleHandlers.call(startupContext, {}, () => true);
startupHandlers.onLoadedMetadata();
assert.deepEqual(
  startupCalls.slice(0, 2),
  ["load", "refresh"],
  "Tizen loads metadata before applying startup preferences"
);
startupCalls.length = 0;
PlayerController.getAvPlayAudioTracks = () => [{ avplayTrackIndex: 1, language: "eng" }];
startupHandlers.onLoadedMetadata();
assert.equal(
  startupCalls[0],
  "refresh",
  "known AVPlay audio languages keep the immediate startup path"
);
assert.equal(startupCalls.includes("load"), false);

const originalGetTracks = localMediaTracksRepository.getTracks;
let prefetchedUrl = "";
localMediaTracksRepository.getTracks = async (url) => {
  prefetchedUrl = url;
  return [];
};
const prefetchScreen = {
  ...gateScreen,
  getCurrentStreamCandidate: () => ({}),
  isCurrentSourceLikelyMkv: () => true
};
prefetchScreen.prefetchTizenEmbeddedAudioTracks("https://example.test/prefetch.mkv", {});
assert.equal(prefetchedUrl, "https://example.test/prefetch.mkv");
localMediaTracksRepository.getTracks = originalGetTracks;
console.log("Tizen MKV prefetch starts the shared header read before playback");
