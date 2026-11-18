import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const NEXT_EPISODE = { videoId: "tt1:1:2", season: 1, episode: 2, hasAired: true };
const PLUGIN_GROUP = "local-plugin-easystreams|1080p";

async function loadMethods(streamRepository, overrides = {}) {
  const [cardSource, autoplaySource] = await Promise.all([
    readFile(
      new URL(
        "../js/ui/screens/player/playerScreenMethods-22-should-show-next-episode-card.js",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../js/ui/screens/player/playerScreenMethods-23-maybe-autoplay-next-episode.js",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  const internals = {
    PlayerController: {},
    shouldTreatAsNaturalPlaybackCompletion: () => true,
    PlayerSettingsStore: { get: () => ({}) },
    Router: {},
    shouldShowNextEpisodeCardRule: () => true,
    normalizeItemType: (value) => String(value || "series").toLowerCase(),
    isSeriesItemType: () => true,
    streamRepository,
    addonRepository: { getInstalledAddons: async () => [] },
    selectAutoPlayStream: () => null,
    orderStreamsByAddonOrder: (streams) => streams,
    DebridStreamPresentation: { isDirectDebrid: () => false },
    shouldEnterStillWatchingPrompt: () => false,
    NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS: 1000,
    flattenStreamGroups: (result) =>
      result?.status === "success"
        ? (result.data || []).flatMap((group) => group.streams || [])
        : [],
    mergeStreamItems: (left, right) => [...left, ...right],
    ...overrides
  };
  const context = vm.createContext({
    internals,
    buildNextFilename: () => null,
    scraperIdFromPluginBingeGroup: (group) =>
      String(group || "").startsWith("local-plugin-")
        ? String(group).slice("local-plugin-".length).split("|")[0]
        : null
  });
  const strip = (source) => source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  vm.runInContext(
    `${strip(cardSource)}\n${strip(autoplaySource)}\nthis.methods = { ...createPlayerScreenMethods22(), ...createPlayerScreenMethods23() };`,
    context
  );
  return context.methods;
}

function buildScreen(methods, { bingeGroup = "" }) {
  const screen = Object.create(methods);
  Object.assign(screen, {
    params: { itemType: "series" },
    streamCandidatesByVideoId: new Map(),
    streamCandidatesLoadPromises: new Map(),
    nextEpisodePrefetchAttemptedKey: "",
    renderCount: 0,
    resolveNextEpisodeInfo: () => NEXT_EPISODE,
    shouldPrefetchNextEpisodeStreams: () => true,
    getCurrentStreamBingeGroup: () => bingeGroup
  });
  // The card render calls the prefetch guard again, which is where the
  // finished plugin-only search used to be restarted forever.
  screen.renderNextEpisodeCard = () => {
    screen.renderCount += 1;
    assert.ok(screen.renderCount < 50, "the card render must not restart the prefetch forever");
    screen.ensureNextEpisodeStreamsPrefetch();
  };
  return screen;
}

function repository(onFetch) {
  const repository = {
    calls: 0,
    async getStreamsFromAllAddons() {
      repository.calls += 1;
      return onFetch(repository.calls);
    }
  };
  return repository;
}

const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a finished plugin-only prefetch is reused, not restarted by the card render", async () => {
  const repo = repository(() => ({
    status: "success",
    data: [{ addonName: "EasyStreams", streams: [{ url: "https://example.test/s1e2.mkv" }] }]
  }));
  const methods = await loadMethods(repo);
  const screen = buildScreen(methods, { bingeGroup: PLUGIN_GROUP });

  screen.ensureNextEpisodeStreamsPrefetch();
  await flushed();

  assert.equal(repo.calls, 1);
  assert.equal(screen.renderCount, 1);
  assert.deepEqual(
    [...screen.streamCandidatesByVideoId.keys()],
    [screen.getStreamCacheKey(NEXT_EPISODE.videoId, "series", 1, 2, true)],
    "the plugin-only result is stored under the plugin-aware key"
  );
  assert.equal(screen.hasCachedPlayableStreamsForNextEpisode(), true);

  screen.ensureNextEpisodeStreamsPrefetch();
  await flushed();
  assert.equal(repo.calls, 1, "the next UI tick must not search again");
  assert.equal(screen.renderCount, 1);
});

test("an empty next-episode search is attempted once, like Android's preload flag", async () => {
  const repo = repository(() => ({ status: "success", data: [] }));
  const methods = await loadMethods(repo);
  const screen = buildScreen(methods, { bingeGroup: PLUGIN_GROUP });

  for (let tick = 0; tick < 5; tick += 1) {
    screen.ensureNextEpisodeStreamsPrefetch();
    await flushed();
  }

  assert.equal(repo.calls, 1);
  assert.equal(screen.renderCount, 1);
});

test("an addon prefetch keeps the plain cache key and is reused", async () => {
  const repo = repository(() => ({
    status: "success",
    data: [{ addonName: "Addon", streams: [{ url: "https://example.test/s1e2.mkv" }] }]
  }));
  const methods = await loadMethods(repo);
  const screen = buildScreen(methods, { bingeGroup: "" });

  screen.ensureNextEpisodeStreamsPrefetch();
  await flushed();
  screen.ensureNextEpisodeStreamsPrefetch();
  await flushed();

  assert.equal(repo.calls, 1);
  assert.equal(screen.renderCount, 1);
  assert.deepEqual(
    [...screen.streamCandidatesByVideoId.keys()],
    [screen.getStreamCacheKey(NEXT_EPISODE.videoId, "series", 1, 2, false)]
  );
});

test("a dismissed next-episode card survives a backward seek, like Android", async () => {
  let position = 1300;
  const methods = await loadMethods(repository(() => ({ status: "success", data: [] })), {
    PlayerController: { video: { paused: false } },
    PlayerSettingsStore: { get: () => ({ autoplayNextEpisode: true }) },
    // Outro starts at 1290s of a 1400s episode.
    shouldShowNextEpisodeCardRule: ({ positionSeconds }) => positionSeconds >= 1290,
    Router: { getCurrent: () => "player" }
  });
  const screen = Object.create(methods);
  let launches = 0;
  Object.assign(screen, {
    params: { itemType: "series" },
    hasPresentedPlaybackFrame: true,
    nextEpisodeAutoplayAttemptedKey: "",
    resolveNextEpisodeInfo: () => NEXT_EPISODE,
    getPlaybackDurationSeconds: () => 1400,
    getPlaybackCurrentSeconds: () => position,
    isStartupErrorVisible: () => false,
    renderNextEpisodeCard: () => {},
    setControlsVisible: () => {},
    playNextEpisode: async () => {
      launches += 1;
      screen.nextEpisodeLaunching = true;
    }
  });

  assert.equal(screen.maybeAutoplayNextEpisode(), true);
  assert.equal(launches, 1);
  screen.dismissNextEpisodeCard({ revealControls: true, armExitOnNextBack: true });
  assert.equal(screen.nextEpisodeLaunching, false);

  screen.nextEpisodeCardTriggered = true;
  screen.resetNextEpisodeCardAfterBackwardSeek(1200);
  position = 1200;
  assert.equal(screen.maybeAutoplayNextEpisode(), false);
  position = 1295;
  assert.equal(screen.maybeAutoplayNextEpisode(), false, "rewinding must not re-arm auto-play");
  assert.equal(launches, 1);
  assert.equal(screen.isNextEpisodeCardVisible(), false);

  // A new stream's first frame clears the dismissal, as Android does.
  screen.resetNextEpisodeCardDismissal();
  position = 10;
  assert.equal(screen.maybeAutoplayNextEpisode(), false);
  position = 1295;
  assert.equal(screen.maybeAutoplayNextEpisode(), true);
  assert.equal(launches, 2);
});
