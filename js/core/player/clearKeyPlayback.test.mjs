import { test } from "node:test";
import assert from "node:assert/strict";

import { createClearKeyPlaylistLoader } from "./clearKeyEme.js";
import { createPlayerControllerMethods18 } from "./playerControllerMethods-18-play.js";

const mimeContext = {
  normalizeMimeType: (value) =>
    String(value || "")
      .trim()
      .toLowerCase(),
  isLikelyDashMimeType: (value) => String(value || "").startsWith("application/dash+xml"),
  isLikelyHlsMimeType: (value) => String(value || "").includes("mpegurl")
};

test("clear key: DASH and HLS are forced onto their MSE engine", () => {
  const methods = createPlayerControllerMethods18();
  assert.equal(
    methods.chooseClearKeyPlaybackEngine.call(mimeContext, "application/dash+xml"),
    "dash.js"
  );
  assert.equal(
    methods.chooseClearKeyPlaybackEngine.call(mimeContext, "application/vnd.apple.mpegurl"),
    "hls.js"
  );
  assert.equal(methods.chooseClearKeyPlaybackEngine.call(mimeContext, "video/mp4"), null);
  assert.equal(methods.chooseClearKeyPlaybackEngine.call(mimeContext, ""), null);
});

test("clear key: only CENC HLS key tags are stripped from the playlist", () => {
  class FakeLoader {
    load(context, config, callbacks) {
      callbacks.onSuccess({ data: context.data }, {}, context, null);
    }
  }
  const Loader = createClearKeyPlaylistLoader({ DefaultConfig: { loader: FakeLoader } });
  const playlist = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,AAAAMnBzc2g",KEYFORMAT="urn:uuid:edef8ba9"',
    '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI="https://example/key"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://example/aes.key"',
    "#EXTINF:2,",
    "segment.m4s"
  ].join("\n");

  let output = "";
  new Loader().load({ data: playlist }, {}, { onSuccess: (response) => (output = response.data) });
  assert.doesNotMatch(output, /SAMPLE-AES-CTR/);
  assert.match(output, /METHOD=AES-128/);
  assert.match(output, /segment\.m4s/);

  let untouched = "";
  new Loader().load(
    { data: "#EXTM3U\n#EXTINF:2,\nsegment.m4s" },
    {},
    { onSuccess: (response) => (untouched = response.data) }
  );
  assert.match(untouched, /segment\.m4s/);
});

test("clear key: the reuse-last-link cache keeps the pairs", async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const { cachedStreamLinkCandidate } = await import("../streams/streamLinkReuse.js");
  const candidate = cachedStreamLinkCandidate({
    streamId: "x",
    streamName: "ClearKey",
    sources: [],
    headers: {},
    clearKeys: "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100"
  });
  assert.equal(
    candidate.behaviorHints.clearKeys,
    "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100"
  );
});
