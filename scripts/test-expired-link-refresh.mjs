import test from "node:test";
import assert from "node:assert/strict";

import {
  findSourceRefreshCandidate,
  hasLikelyExpiringPlaybackCredentials
} from "../js/core/player/playbackUrlCredentials.js";

test("links with expiring credentials are recognised like Android", () => {
  assert.equal(
    hasLikelyExpiringPlaybackCredentials(
      "https://example.com/playlist/1234.m3u8?token=abc&expires=1234"
    ),
    true
  );
  assert.equal(
    hasLikelyExpiringPlaybackCredentials("https://example.com/proxy?ext=m3u8&t=abc"),
    true
  );
  assert.equal(
    hasLikelyExpiringPlaybackCredentials(
      "https://example.com/video.mp4?expiresIn=300&signature=sig"
    ),
    true
  );
  assert.equal(hasLikelyExpiringPlaybackCredentials("https://example.com/proxy?ext=m3u8"), false);
  assert.equal(
    hasLikelyExpiringPlaybackCredentials("https://example.com/video.mp4?quality=1080p&format=mp4"),
    false
  );
  assert.equal(
    hasLikelyExpiringPlaybackCredentials("https://example.com/video.mkv?api_key=static"),
    false
  );
});

const failedUrl = "https://cdn.example.com/dld/old?token=expired";
const expected = { addonName: "Torrents", streamName: "4K" };
const stream = ({
  name = "4K",
  url = null,
  infoHash = null,
  addonName = "Torrents",
  filename = null,
  debridResolved = false
} = {}) => ({
  name,
  url,
  infoHash,
  addonName,
  behaviorHints: filename ? { filename } : null,
  debridResolved
});
const canResolve = (candidate) => Boolean(candidate.infoHash);

test("a torrent that needs a debrid resolve is a candidate", () => {
  const torrent = stream({ infoHash: "abc" });
  assert.equal(findSourceRefreshCandidate([torrent], failedUrl, expected, canResolve), torrent);
});

test("a prepared debrid stream with the failed URL is still a candidate", () => {
  const prepared = stream({ url: failedUrl, infoHash: "abc", debridResolved: true });
  assert.equal(findSourceRefreshCandidate([prepared], failedUrl, expected, canResolve), prepared);
});

test("an add-on stream with the failed URL is skipped", () => {
  assert.equal(
    findSourceRefreshCandidate([stream({ url: failedUrl })], failedUrl, expected, canResolve),
    null
  );
});

test("the same torrent wins over another stream with the same name", () => {
  const other = stream({ infoHash: "other" });
  const same = stream({ name: "4K HDR", infoHash: "abc", filename: "Movie.mkv" });
  const candidate = findSourceRefreshCandidate(
    [other, same],
    failedUrl,
    { ...expected, infoHash: "ABC", filename: "Movie.mkv" },
    canResolve
  );
  assert.equal(candidate, same);
});

test("another add-on is never a candidate", () => {
  const other = stream({ url: "https://other.example/new.mkv", addonName: "Other" });
  assert.equal(findSourceRefreshCandidate([other], failedUrl, expected, canResolve), null);
});
