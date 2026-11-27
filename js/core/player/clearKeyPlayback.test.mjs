import { test } from "node:test";
import assert from "node:assert/strict";

import {
  attachClearKeyMediaKeys,
  createClearKeyPlaylistLoader,
  releaseClearKeyGuard
} from "./clearKeyEme.js";
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

test("clear key: a device without the CDM fails cleanly and a clear stream leaves the keys alone", async () => {
  const video = {
    mediaKeys: {},
    detached: "untouched",
    setMediaKeys: async (value) => (video.detached = value)
  };
  assert.equal(await attachClearKeyMediaKeys(video, null), null);
  assert.equal(
    video.detached,
    "untouched",
    "a re-play without pairs must not remove the keys mid-playback"
  );

  await assert.rejects(
    () =>
      attachClearKeyMediaKeys(
        { setMediaKeys: async () => {} },
        "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100"
      ),
    /ClearKey EME is not available/
  );
});

function installFakeEme({ usable }) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousMediaKeys = globalThis.MediaKeys;
  const listeners = new Set();
  const keyStatuses = new Map();
  const session = {
    keyStatuses,
    addEventListener(type, handler) {
      if (type === "keystatuseschange") listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "keystatuseschange") listeners.delete(handler);
    },
    async generateRequest() {},
    async update() {
      keyStatuses.set("00112233445566778899aabbccddeeff", usable ? "usable" : "output-restricted");
      if (usable) setTimeout(() => listeners.forEach((handler) => handler()), 0);
    }
  };
  const mediaKeys = { createSession: () => session };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { requestMediaKeySystemAccess: async () => ({ createMediaKeys: async () => mediaKeys }) }
  });
  globalThis.MediaKeys = function MediaKeys() {};
  return {
    mediaKeys,
    restore() {
      globalThis.MediaKeys = previousMediaKeys;
      if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
      else delete globalThis.navigator;
    }
  };
}

test("clear key: player key systems are ignored only while our keys are usable", async () => {
  const keyString = "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100";
  const fake = installFakeEme({ usable: true });
  try {
    const video = {
      src: "",
      mediaKeys: null,
      calls: [],
      setMediaKeys(keys) {
        this.calls.push(keys);
        this.mediaKeys = keys;
        return Promise.resolve();
      }
    };
    await attachClearKeyMediaKeys(video, keyString);
    assert.equal(video.mediaKeys, fake.mediaKeys);

    const foreign = { other: true };
    const before = video.calls.length;
    await video.setMediaKeys(foreign);
    assert.equal(
      video.calls.length,
      before,
      "the player key system is ignored while ClearKey is usable"
    );
    assert.equal(video.mediaKeys, fake.mediaKeys);
  } finally {
    fake.restore();
  }
});

test("clear key: a wrong key set leaves the player free to try its own DRM", async () => {
  const keyString = "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100";
  const fake = installFakeEme({ usable: false });
  try {
    const video = {
      src: "",
      mediaKeys: null,
      calls: [],
      setMediaKeys(keys) {
        this.calls.push(keys);
        this.mediaKeys = keys;
        return Promise.resolve();
      }
    };
    await attachClearKeyMediaKeys(video, keyString);
    const foreign = { other: true };
    await video.setMediaKeys(foreign);
    assert.equal(video.mediaKeys, foreign, "a non-usable key set must not block the player DRM");
  } finally {
    fake.restore();
  }
});

test("clear key: another source releases the guard so its own DRM can take over", async () => {
  const keyString = "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100";
  const fake = installFakeEme({ usable: true });
  try {
    const prototype = {
      setMediaKeys(keys) {
        this.calls.push(keys);
        this.mediaKeys = keys;
        return Promise.resolve();
      }
    };
    const video = Object.create(prototype);
    video.src = "";
    video.mediaKeys = null;
    video.calls = [];
    await attachClearKeyMediaKeys(video, keyString);
    releaseClearKeyGuard(video);
    const foreign = { widevine: true };
    await video.setMediaKeys(foreign);
    assert.equal(
      video.mediaKeys,
      foreign,
      "after a different source the player DRM must be allowed"
    );
  } finally {
    fake.restore();
  }
});
