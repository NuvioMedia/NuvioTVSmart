import test from "node:test";
import assert from "node:assert/strict";

// A media server stream carries no url. MediaServerRepository resolves one at
// play time from clientResolve.mediaServer, so every playability check has to
// recognise that shape. Where one does not, the stream silently disappears and
// the user is told "No streams found".

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true
  });
}
globalThis.window = globalThis.window || {
  addEventListener: () => {},
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener: () => {} })
};
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  addEventListener: () => {},
  documentElement: { style: {} },
  body: {}
};

const { streamMergeKey } =
  await import("../js/ui/screens/stream/streamScreenHelpers-01-stream-badge-limit.js");
const { flattenStreams, mergeStreamItems } =
  await import("../js/ui/screens/stream/streamScreenHelpers-02-flatten-streams.js");
const { streamMergeKey: playerStreamMergeKey } =
  await import("../js/ui/screens/player/playerScreenHelpers-10-format-subtitle-track-display.js");
const { flattenStreamGroups, mergeStreamItems: playerMergeStreamItems } =
  await import("../js/ui/screens/player/playerScreenHelpers-11-flatten-stream-groups.js");
const { createPlayerScreenMethods09 } =
  await import("../js/ui/screens/player/playerScreenMethods-09-render-skip-intro-button.js");
const { createPlayerScreenMethods72 } =
  await import("../js/ui/screens/player/playerScreenMethods-72-on-key-up.js");
const { canResolveMediaServerStream } =
  await import("../js/data/mediaserver/mediaServerRepository.js");
const { DirectDebridResolver } = await import("../js/core/debrid/directDebridResolver.js");

// The shape MediaServerRepository.streams() produces for a Jellyfin source.
function mediaServerStream({
  connectionId = "conn-1",
  itemId = "item-1",
  mediaSourceId = "src-1"
} = {}) {
  return {
    id: `${connectionId}:${itemId}:${mediaSourceId}`,
    name: "K12 Jellyfin",
    title: "4K HEVC Dolby Vision Profile 8.1 (HDR10)",
    description: "4K HEVC • TrueHD 7.1 • MKV",
    addonName: "K12 Jellyfin",
    clientResolve: { mediaServer: { connectionId, itemId, mediaSourceId } },
    behaviorHints: { filename: "Movie.2024.mkv", videoSize: 32750000000 }
  };
}

// The repository hands the screens a result envelope, not a bare array.
function streamResult(streams) {
  return {
    status: "success",
    data: [{ addonName: "K12 Jellyfin", addonBaseUrl: "mediaserver://conn-1", streams }]
  };
}

test("a media server stream gets a merge key instead of being dropped", () => {
  const stream = mediaServerStream();

  for (const [label, mergeKey] of [
    ["stream screen", streamMergeKey],
    ["player", playerStreamMergeKey]
  ]) {
    const key = mergeKey(stream);
    assert.notEqual(key, "", `${label}: a media server stream must produce a merge key`);
    assert.match(
      key,
      /^server::conn-1::item-1::src-1$/,
      `${label}: the key identifies what the stream resolves from`
    );
  }
});

test("the merge key reads clientResolve from a flattened entry's raw stream", () => {
  const entry = { addonName: "K12 Jellyfin", raw: mediaServerStream() };

  assert.notEqual(streamMergeKey(entry), "");
  assert.equal(streamMergeKey(entry), streamMergeKey(mediaServerStream()));
});

test("separate media sources on one item stay separate", () => {
  const sd = mediaServerStream({ mediaSourceId: "src-sd" });
  const uhd = mediaServerStream({ mediaSourceId: "src-uhd" });

  assert.notEqual(
    streamMergeKey(sd),
    streamMergeKey(uhd),
    "two files of the same title must not collapse into one row"
  );
  assert.equal(mergeStreamItems([], [sd, uhd]).length, 2);
});

test("the same media server stream seen twice still merges into one row", () => {
  const merged = mergeStreamItems([mediaServerStream()], [mediaServerStream()]);

  assert.equal(merged.length, 1, "deduplication must still work for media server streams");
});

test("a media server stream survives the stream screen list", () => {
  const result = streamResult([mediaServerStream()]);

  const flattened = flattenStreams(result);
  assert.equal(flattened.length, 1, "flattenStreams keeps media server streams");

  const listed = mergeStreamItems([], flattened);
  assert.equal(
    listed.length,
    1,
    "the stream screen must list the server stream rather than show No streams found"
  );
});

test("a media server stream survives the player's own list", () => {
  const result = streamResult([mediaServerStream()]);

  const flattened = flattenStreamGroups(result);
  assert.equal(flattened.length, 1, "the player's flatten must keep media server streams");

  assert.equal(playerMergeStreamItems([], flattened).length, 1);
});

test("the player keeps a media server stream as a candidate", () => {
  const methods = createPlayerScreenMethods09();

  const candidates = methods.normalizeStreamCandidates([mediaServerStream()]);

  assert.equal(candidates.length, 1, "normalizeStreamCandidates must keep media server streams");
  assert.ok(
    canResolveMediaServerStream(candidates[0]),
    "the candidate still carries what it resolves from"
  );
});

test("the player picks a media server stream when it is the only one", () => {
  const methods = {
    ...createPlayerScreenMethods09(),
    ...createPlayerScreenMethods72(),
    params: {}
  };

  const candidates = methods.normalizeStreamCandidates([mediaServerStream()]);
  const best = methods.selectBestStreamCandidate.call(methods, candidates);

  assert.ok(best, "selectBestStreamCandidate must not discard the only playable stream");
  assert.ok(canResolveMediaServerStream(best));
});

// playerScreenMethods-01-mount gates startup playback on the same kind of check
// before it calls playStreamCandidate. This is why the player sat on its
// loading screen with no request reaching the server.
test("only the media server check recognises a media server stream", () => {
  const stream = mediaServerStream();

  assert.equal(canResolveMediaServerStream(stream), true);
  assert.equal(
    Boolean(stream.url || stream.externalUrl),
    false,
    "there is no url for a url check to find"
  );
  assert.equal(
    DirectDebridResolver.canResolveStream(stream, {}),
    false,
    "the debrid check cannot stand in for it"
  );
});

test("streams that are not media server streams are unaffected", () => {
  const direct = { addonName: "Torrentio", url: "https://example.test/a.mkv", sourceType: "http" };
  const noLocator = { addonName: "Broken" };

  assert.match(streamMergeKey(direct), /^Torrentio::https:\/\/example\.test\/a\.mkv::http/);
  assert.equal(
    streamMergeKey(noLocator),
    "",
    "a stream with nothing to identify it is still dropped"
  );
  assert.equal(mergeStreamItems([], [direct, direct]).length, 1);
});
