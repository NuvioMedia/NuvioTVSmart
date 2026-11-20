import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("playerScreenMethods-35 checks isActiveMountToken after getInstalledAddons and before clearing in-flight flag", async () => {
  const source = stripModule(
    await readFile(
      new URL("./playerScreenMethods-35-play-stream-candidate.js", import.meta.url),
      "utf8"
    )
  );

  let resolveAddons;
  let startupErrors = 0;
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    newerServerResume: () => false,
    WatchProgressStore: {},
    MediaServerRepository: {},
    canResolveMediaServerStream: () => false,
    StreamLinkCacheStore: { remove() {} },
    findSourceRefreshCandidate: () => null,
    hasLikelyExpiringPlaybackCredentials: () => false,
    isSourceFallbackActive: () => true,
    nextSourceFallbackCandidate: () => null,
    sourceFallbackKey: (c) => String(c.id || c.url || ""),
    internals: new Proxy(
      {
        PlayerSettingsStore: { get: () => ({ streamAutoPlayFallbackMaxSources: 3 }) },
        addonRepository: {
          getInstalledAddons: () =>
            new Promise((resolve) => {
              resolveAddons = resolve;
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
  vm.runInContext(`${source}\nglobalThis.api = createPlayerScreenMethods35();`, context);

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
    showStartupError() {
      startupErrors += 1;
    }
  });

  const pendingFallback = screen.tryFallbackToNextSourceAfterError("Err");
  assert.equal(screen.sourceFallbackInFlight, true);

  // Simulate re-mounting new player session before getInstalledAddons resolves.
  screen.playerMountToken = 2;
  screen.sourceFallbackInFlight = "active-new-session";
  resolveAddons([]);
  await Promise.resolve(pendingFallback);
  await Promise.resolve();

  assert.equal(
    screen.sourceFallbackInFlight,
    "active-new-session",
    "stale fallback session must not overwrite sourceFallbackInFlight"
  );
  assert.equal(startupErrors, 0);
});
