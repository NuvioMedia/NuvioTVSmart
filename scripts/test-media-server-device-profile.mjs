import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.window = {
  addEventListener() {},
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener() {} })
};
globalThis.document = {
  addEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  documentElement: { style: {} },
  body: {}
};
const { Platform } = await import("../js/platform/index.js");
const { MediaServerRepository, buildServerDeviceProfile } =
  await import("../js/data/mediaserver/mediaServerRepository.js");
const { createPlayerScreenMethods35 } =
  await import("../js/ui/screens/player/playerScreenMethods-35-play-stream-candidate.js");

function stream() {
  return {
    id: "connection:movie:source",
    clientResolve: {
      mediaServer: { connectionId: "connection", itemId: "movie", mediaSourceId: "source" }
    }
  };
}
function supports(profile, container, video, audio) {
  return profile.DirectPlayProfiles.some(
    (entry) =>
      entry.Container.split(",").includes(container) &&
      entry.VideoCodec.split(",").includes(video) &&
      entry.AudioCodec.split(",").includes(audio)
  );
}

for (const name of ["webos", "tizen"]) {
  test(`${name}: native MKV/HEVC and Dolby audio are not limited to the browser profile`, () => {
    Platform.current = { name };
    const profile = buildServerDeviceProfile();
    for (const container of ["mkv", "mp4", "ts"]) {
      for (const codec of ["h264", "hevc"]) {
        for (const audio of ["aac", "mp3", "ac3", "eac3"]) {
          assert.equal(supports(profile, container, codec, audio), true);
        }
      }
    }
    for (const audio of ["dts", "truehd", "flac"]) {
      assert.equal(supports(profile, "mkv", "hevc", audio), false);
    }
    assert.equal(supports(profile, "mkv", "av1", "aac"), false);
    assert.equal(supports(profile, "mov", "hevc", "eac3"), false);
    assert.equal(
      profile.DirectPlayProfiles[0].MaxAudioChannels,
      undefined,
      "the stereo transcode limit must not restrict original Dolby direct play"
    );
    assert.deepEqual(
      profile.TranscodingProfiles,
      buildServerDeviceProfile({ allowDirectPlay: false }).TranscodingProfiles
    );
    const fallback = buildServerDeviceProfile({ allowDirectPlay: false });
    assert.equal(supports(fallback, "mp4", "hevc", "eac3"), false);
    assert.equal(supports(fallback, "mp4", "h264", "aac"), true);
  });
}
test("browser and unknown platforms keep the original negotiation profile", () => {
  for (const name of ["browser", "unknown"]) {
    Platform.current = { name };
    assert.deepEqual(buildServerDeviceProfile().DirectPlayProfiles, [
      { Type: "Video", Container: "mp4,m4v,mov", VideoCodec: "h264", AudioCodec: "aac,mp3" }
    ]);
  }
});

for (const providerId of ["jellyfin", "emby"]) {
  test(`${providerId}: real resolver sends the profile, preserves direct play and honors a bounded server fallback`, async () => {
    Platform.current = { name: "webos" };
    const originalConnection = MediaServerRepository.connection;
    const originalFetch = globalThis.fetch;
    MediaServerRepository.connection = () => ({
      id: "connection",
      enabled: true,
      providerId,
      address: "https://server.test",
      remoteUserId: "user",
      token: "fixture-token"
    });
    const requests = [];
    let resumeReads = 0;
    let supportsDirectPlay = true;
    let transcodingUrl = "/Videos/movie/master.m3u8?fixture=true";
    globalThis.fetch = async (value, options) => {
      const url = new URL(value);
      const isPlayback = url.pathname.endsWith("/PlaybackInfo");
      if (!isPlayback) resumeReads++;
      if (isPlayback) requests.push({ url, body: JSON.parse(options.body) });
      const body = isPlayback
        ? {
            PlaySessionId: "session",
            MediaSources: [
              {
                Id: "source",
                SupportsDirectPlay: supportsDirectPlay,
                SupportsDirectStream: false,
                TranscodingUrl: transcodingUrl,
                Path: "/Movie.mkv",
                MediaStreams: []
              }
            ]
          }
        : { Id: "movie", UserData: { PlaybackPositionTicks: 0 } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    try {
      const direct = await MediaServerRepository.resolve(stream());
      assert.equal(direct.status, "success");
      assert.equal(direct.stream.serverPlayback.playMethod, "DirectPlay");
      assert.equal(new URL(direct.stream.url).searchParams.get("static"), "true");
      assert.equal(supports(requests[0].body.DeviceProfile, "mkv", "hevc", "eac3"), true);
      assert.equal(requests[0].body.EnableDirectPlay, true);
      assert.equal(
        requests[0].url.pathname,
        `${providerId === "emby" ? "/emby" : ""}/Items/movie/PlaybackInfo`
      );

      const fallback = await MediaServerRepository.resolve(direct.stream, {
        allowDirectPlay: false
      });
      assert.equal(
        resumeReads,
        1,
        "fallback must preserve local resume without another UserData request"
      );
      assert.equal(requests[1].body.EnableDirectPlay, false);
      assert.equal(requests[1].url.searchParams.get("enableDirectPlay"), "false");
      assert.equal(supports(requests[1].body.DeviceProfile, "mkv", "hevc", "eac3"), false);
      assert.equal(
        fallback.stream.serverPlayback.playMethod,
        "Transcode",
        "ignore SupportsDirectPlay when the caller explicitly disabled it"
      );
      assert.equal(fallback.stream.mimeType, "application/x-mpegURL");
      assert.equal(new URL(fallback.stream.url).searchParams.get("api_key"), "fixture-token");

      supportsDirectPlay = false;
      assert.equal(
        (await MediaServerRepository.resolve(stream())).stream.serverPlayback.playMethod,
        "Transcode"
      );
      transcodingUrl = null;
      assert.deepEqual(await MediaServerRepository.resolve(stream(), { allowDirectPlay: false }), {
        status: "unavailable"
      });
    } finally {
      MediaServerRepository.connection = originalConnection;
      globalThis.fetch = originalFetch;
    }
  });
}

function screen(candidate) {
  return {
    ...createPlayerScreenMethods35(),
    streamCandidates: [candidate],
    playerMountToken: 1,
    activePlaybackUrl: candidate.url,
    pendingPlaybackRestore: null,
    params: { itemId: "movie" },
    paused: false,
    isActiveMountToken(token) {
      return token === this.playerMountToken;
    },
    getCurrentStreamCandidate() {
      return this.streamCandidates[0];
    },
    getPlaybackCurrentSeconds: () => 42,
    rememberSelectedStreamPreference() {},
    playStreamByUrl(url, options) {
      this.played = { url, options };
    },
    showStartupError() {
      this.failed = true;
    }
  };
}
function directStream() {
  return {
    ...stream(),
    url: "https://server.test/direct",
    serverPlayback: { profileId: "1", playMethod: "DirectPlay" }
  };
}

test("fallback is requested once, preserves resume and does not affect unrelated or transcoded sources", async () => {
  const candidate = directStream();
  const player = screen(candidate);
  let calls = 0;
  player.playStreamCandidate = async (selected, options) => {
    calls++;
    assert.equal(selected, candidate);
    assert.equal(options.serverFallbackUrl, candidate.url);
    assert.equal(options.preservePlaybackState, true);
    assert.equal(options.mountToken, 1);
  };
  assert.equal(player.tryServerPlaybackFallback(), true);
  assert.equal(player.tryServerPlaybackFallback(), true);
  assert.equal(calls, 1);
  assert.equal(player.pendingPlaybackRestore.timeSeconds, 42);
  assert.equal(player.tryServerPlaybackFallback({ url: candidate.url }), false);
  assert.equal(
    player.tryServerPlaybackFallback({ ...candidate, serverPlayback: { playMethod: "Transcode" } }),
    false
  );
  assert.equal(
    player.tryServerPlaybackFallback({
      ...candidate,
      serverPlayback: { playMethod: "DirectStream" }
    }),
    false
  );
});

for (const outcome of ["success", "failure", "source-change", "unmount"]) {
  test(`server fallback resolution: ${outcome}`, async () => {
    const originalResolve = MediaServerRepository.resolve;
    const originalReport = MediaServerRepository.report;
    const candidate = directStream();
    const player = screen(candidate);
    let stopped = false;
    MediaServerRepository.report = async (_, event) => {
      stopped = event === "stop";
    };
    MediaServerRepository.resolve = async (_, options) => {
      assert.equal(options.allowDirectPlay, false);
      if (outcome === "source-change") player.activePlaybackUrl = "https://other.test/movie";
      if (outcome === "unmount") player.playerMountToken++;
      return outcome === "failure"
        ? { status: "unavailable" }
        : {
            status: "success",
            stream: {
              ...candidate,
              url: "https://server.test/fallback.m3u8",
              serverPlayback: { profileId: "1", playMethod: "Transcode" }
            }
          };
    };
    try {
      await player.playStreamCandidate(candidate, {
        serverFallbackUrl: candidate.url,
        preservePlaybackState: true,
        mountToken: 1
      });
      assert.equal(Boolean(player.played), outcome === "success");
      assert.equal(Boolean(player.failed), outcome === "failure");
      assert.equal(stopped, outcome === "source-change" || outcome === "unmount");
      if (player.played) assert.equal(player.played.options.preservePlaybackState, true);
    } finally {
      MediaServerRepository.resolve = originalResolve;
      MediaServerRepository.report = originalReport;
    }
  });
}

const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods18 } =
  await import("../js/ui/screens/player/playerScreenMethods-18-start-player-controller-playback.js");
const { createPlayerVideoEventHandlers } =
  await import("../js/ui/screens/player/playerVideoEventHandlers.js");

test("a rejected player start reaches server fallback before reporting a terminal failure", async () => {
  const originalPlay = PlayerController.play;
  const originalMute = PlayerController.setStartupPresentationAudioMuted;
  const candidate = directStream();
  const player = {
    ...screen(candidate),
    ...createPlayerScreenMethods18(),
    getCurrentStreamRequestHeaders: () => ({}),
    isExternalFrameMode: () => false,
    isStartupErrorVisible: () => false,
    tryServerPlaybackFallback(selected) {
      this.retried = selected;
      return true;
    },
    markPlaybackSourceFailed() {
      assert.fail("do not declare the source failed before fallback");
    }
  };
  PlayerController.play = async () => {
    throw new Error("Unsupported codec");
  };
  PlayerController.setStartupPresentationAudioMuted = () => {};
  try {
    await player.startPlayerControllerPlayback(
      candidate.url,
      {},
      { mountToken: 1, sourceCandidate: candidate }
    );
    assert.equal(player.retried, candidate);
    assert.equal(player.failed, undefined);
  } finally {
    PlayerController.play = originalPlay;
    PlayerController.setStartupPresentationAudioMuted = originalMute;
  }
});

for (const started of [false, true]) {
  test(`media errors ${started ? "after" : "before"} the first frame reach server fallback`, async () => {
    const originalAlternative = PlayerController.getAlternativePlaybackEngine;
    PlayerController.getAlternativePlaybackEngine = () => null;
    const candidate = directStream();
    const player = {
      ...screen(candidate),
      hasPresentedPlaybackFrame: started,
      isStartupErrorVisible: () => false,
      getPlaybackEventErrorDetail: () => "Unsupported codec",
      getStreamCandidateByUrl: () => candidate,
      getStartupErrorMessage: () => "Unsupported codec",
      clearPlaybackStallGuard() {},
      releaseStartupAudioGate() {},
      markPlaybackSourceFailed() {},
      tryServerPlaybackFallback(selected) {
        this.retried = selected;
        return true;
      }
    };
    try {
      const handlers = createPlayerVideoEventHandlers.call(
        player,
        { error: { code: 3 } },
        () => false
      );
      await handlers.onError({ detail: {} });
      assert.equal(player.retried, candidate);
      assert.equal(player.failed, undefined);
    } finally {
      PlayerController.getAlternativePlaybackEngine = originalAlternative;
    }
  });
}
