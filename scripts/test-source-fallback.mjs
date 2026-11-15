import test from "node:test";
import assert from "node:assert/strict";

import {
  isSourceFallbackActive,
  nextSourceFallbackCandidate,
  sourceFallbackKey
} from "../js/core/player/sourceFallback.js";

const HASH = "0123456789abcdef0123456789abcdef01234567";
const settings = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlaySource: "ALL_SOURCES",
  streamAutoPlayRegex: "",
  streamAutoPlaySelectedAddons: [],
  streamAutoPlaySelectedPlugins: [],
  streamAutoPlayFallbackOnFailure: true
};
const stream = ({
  name = "Source",
  url = null,
  infoHash = null,
  addonName = "Addon",
  debridResolved = false
} = {}) => ({
  id: `${addonName}:${name}:${url || infoHash}`,
  name,
  url,
  infoHash,
  addonName,
  debridResolved
});
const candidates = [1, 2, 3, 4, 5].map((index) =>
  stream({ name: `Source ${index}`, url: `https://example.com/source-${index}.mkv` })
);
const next = ({
  streams = candidates,
  triedKeys = new Set(),
  failedInfoHash = "",
  currentSettings = settings
} = {}) =>
  nextSourceFallbackCandidate({
    streams,
    settings: currentSettings,
    installedAddonNames: new Set(["Addon"]),
    triedKeys,
    failedAddonName: "Addon",
    failedInfoHash
  });

test("a resolved debrid copy has the same key as the torrent", () => {
  const torrent = stream({ infoHash: "ABC" });
  const resolved = stream({
    url: "https://cdn.example.com/dld/file?token=1",
    infoHash: "abc",
    debridResolved: true
  });
  assert.equal(sourceFallbackKey(torrent), sourceFallbackKey(resolved));
});

test("different links have different keys", () => {
  assert.notEqual(
    sourceFallbackKey(stream({ url: "https://example.com/a.mkv" })),
    sourceFallbackKey(stream({ url: "https://example.com/b.mkv" }))
  );
});

test("fallback applies only with auto selection turned on", () => {
  assert.equal(isSourceFallbackActive(settings), true);
  assert.equal(isSourceFallbackActive({ ...settings, streamAutoPlayMode: "MANUAL" }), false);
  assert.equal(
    isSourceFallbackActive({ ...settings, streamAutoPlayFallbackOnFailure: false }),
    false
  );
});

test("the next candidate is the first match not tried yet", () => {
  assert.equal(next({ triedKeys: new Set([sourceFallbackKey(candidates[0])]) }), candidates[1]);
});

test("other copies of the failed torrent are skipped", () => {
  const sameTorrent = stream({ name: "Same", url: "https://example.com/same.mkv", infoHash: HASH });
  assert.equal(
    next({ streams: [sameTorrent, candidates[0]], failedInfoHash: HASH }),
    candidates[0]
  );
});

test("no candidate when every source was tried", () => {
  assert.equal(next({ triedKeys: new Set(candidates.map(sourceFallbackKey)) }), null);
});

test("regex mode only falls back to matching sources", () => {
  const regexSettings = {
    ...settings,
    streamAutoPlayMode: "REGEX_MATCH",
    streamAutoPlayRegex: "Source 3"
  };
  assert.equal(next({ currentSettings: regexSettings }), candidates[2]);
});
