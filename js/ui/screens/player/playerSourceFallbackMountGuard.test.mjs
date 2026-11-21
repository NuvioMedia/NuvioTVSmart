import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const moduleSource = stripModule(
  await readFile(
    new URL("./playerScreenMethods-35-play-stream-candidate.js", import.meta.url),
    "utf8"
  )
);

// The fallback worker awaits getInstalledAddons().catch(...), so draining microtasks once
// is not enough to prove it has settled.
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function createHarness({ nextCandidate = () => null, playStreamCandidate = async () => {} } = {}) {
  const state = { candidateScans: 0, cacheRemovals: 0, startupErrors: 0, resolveAddons: null };
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    newerServerResume: () => false,
    WatchProgressStore: {},
    MediaServerRepository: {},
    canResolveMediaServerStream: () => false,
    StreamLinkCacheStore: {
      remove() {
        state.cacheRemovals += 1;
      }
    },
    findSourceRefreshCandidate: () => null,
    hasLikelyExpiringPlaybackCredentials: () => false,
    isSourceFallbackActive: () => true,
    nextSourceFallbackCandidate: () => {
      state.candidateScans += 1;
      return nextCandidate();
    },
    sourceFallbackKey: (c) => String(c.id || c.url || ""),
    internals: new Proxy(
      {
        PlayerSettingsStore: { get: () => ({ streamAutoPlayFallbackMaxSources: 3 }) },
        mergeStreamItems: (streams, [stream]) => [...streams, stream],
        addonRepository: {
          getInstalledAddons: () =>
            new Promise((resolve) => {
              state.resolveAddons = resolve;
            })
        },
        streamDirectPlaybackUrl: (c) => c.url || ""
      },
      {
        get(target, prop) {
          return prop in target ? target[prop] : () => {};
        }
      }
    )
  });
  context.globalThis = context;
  vm.runInContext(`${moduleSource}\nglobalThis.api = createPlayerScreenMethods35();`, context);

  const screen = Object.assign(Object.create(context.api), {
    params: {},
    playerMountToken: 1,
    completedSourceRequestKey: "k1",
    getSourceRequestKey: () => "k1",
    sourcesLoading: false,
    sourceFallbackInFlight: false,
    sourceFallbackExhausted: false,
    hasPresentedPlaybackFrame: false,
    sourceFallbackAttempts: 0,
    autoSelectedSourceKey: "https://fail.example/v.mkv",
    streamCandidates: [{ url: "https://fail.example/v.mkv", addonName: "A" }],
    getCurrentStreamCandidate() {
      return this.streamCandidates[0];
    },
    isActiveMountToken(token) {
      return this.playerMountToken === token;
    },
    playStreamCandidate,
    showStartupError() {
      state.startupErrors += 1;
    }
  });
  return { screen, state };
}

test("playerScreenMethods-35 checks isActiveMountToken after getInstalledAddons", async () => {
  const { screen, state } = createHarness();
  assert.equal(screen.tryFallbackToNextSourceAfterError("Err"), true);
  assert.equal(screen.sourceFallbackInFlight, true);

  // Simulate re-mounting new player session before getInstalledAddons resolves.
  screen.playerMountToken = 2;
  screen.sourceFallbackInFlight = "active-new-session";
  state.resolveAddons([]);
  await flush();

  assert.equal(state.candidateScans, 0, "stale fallback session must not scan candidates");
  assert.equal(state.cacheRemovals, 0, "stale fallback session must not drop the link cache entry");
  assert.equal(
    screen.sourceFallbackInFlight,
    "active-new-session",
    "stale fallback session must not overwrite sourceFallbackInFlight"
  );
  assert.equal(screen.sourceFallbackExhausted, false);
  assert.equal(state.startupErrors, 0);
});

test("playerScreenMethods-35 keeps the in-flight flag when the worker fails after a remount", async () => {
  let rejectPlayback;
  const { screen, state } = createHarness({
    nextCandidate: () => ({ url: "https://next.example/v.mkv", addonName: "B" }),
    playStreamCandidate: () =>
      new Promise((_, reject) => {
        rejectPlayback = reject;
      })
  });
  assert.equal(screen.tryFallbackToNextSourceAfterError("Err"), true);
  state.resolveAddons([]);
  await flush();
  assert.equal(
    screen.sourceFallbackInFlight,
    false,
    "the worker hands playback over before awaiting it"
  );

  // Remount while the fallback playback start is still pending, then fail it.
  screen.playerMountToken = 2;
  screen.sourceFallbackInFlight = "active-new-session";
  rejectPlayback(new Error("playback start failed"));
  await flush();

  assert.equal(
    screen.sourceFallbackInFlight,
    "active-new-session",
    "a stale worker failure must not clear the active session in-flight flag"
  );
  assert.equal(screen.sourceFallbackExhausted, false);
  assert.equal(state.startupErrors, 0);
});
