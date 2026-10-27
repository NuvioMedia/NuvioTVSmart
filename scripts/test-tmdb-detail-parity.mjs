import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

// Keep the production TMDB modules together; stub only browser/platform boundaries.
async function setup() {
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const settings = {
    enabled: true,
    language: "en",
    useEpisodes: true,
    useCredits: true,
    useBasicInfo: true,
    useNetworks: true,
    useProductions: true
  };
  const calls = [],
    warnings = [];
  const fixtures = {
    settings,
    webos: false,
    TmdbSettingsStore: { get: () => settings },
    normalizeTmdbLanguageCode: (value) => value || "en",
    Platform: { isWebOS: () => fixtures.webos },
    PluginServiceClient: {
      fetch: async (request) => {
        calls.push({ service: true, ...request });
        const data = await fixtures.respond(new URL(request.url));
        return { ok: true, body: JSON.stringify(data) };
      }
    },
    respond: async () => null,
    TMDB_API_KEY: "fixture-key",
    isSeriesDetailMeta: (meta) => ["series", "tv"].includes(meta.type),
    mergeGenreLists: (a = [], b = []) => [...new Set([...a, ...b])]
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export { TmdbService, fetchTmdbJson } from './js/core/tmdb/tmdbService.js';
      export { TmdbMetadataService, resolveTmdbCredits } from './js/core/tmdb/tmdbMetadataService.js';
      export { createMetaDetailsScreenMethods06 } from './js/ui/screens/detail/metaDetailsScreenMethods-06-enrich-meta.js';
      export { createMetaDetailsScreenMethods07 } from './js/ui/screens/detail/metaDetailsScreenMethods-07-merge-stream-items.js';
      export { createMetaDetailsScreenMethods01 } from './js/ui/screens/detail/metaDetailsScreenMethods-01-get-route-state-key.js';
      export { createMetaDetailsScreenMethods02 } from './js/ui/screens/detail/metaDetailsScreenMethods-02-mount.js';
      export { createMetaDetailsScreenMethods05 } from './js/ui/screens/detail/metaDetailsScreenMethods-05-resolve-initial-selected-season.js';
      export { createMetaDetailsScreenMethods03 } from './js/ui/screens/detail/metaDetailsScreenMethods-03-load-detail.js';
    `
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "subject",
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onLoad({ filter: /detailEpisodeShuffle\.js$/ }, () => ({
            contents:
              "export const detailShuffleSettings = () => ({}); export const selectDetailShuffle = () => null; export const detailShuffleResume = () => null;",
            loader: "js"
          }));
          b.onLoad(
            {
              filter: /(?:config|tmdbSettingsStore|pluginServiceClient)\.js$|platform\/index\.js$/
            },
            ({ path }) => {
              const contents = path.endsWith("config.js")
                ? 'export const TMDB_API_KEY = "fixture-key";'
                : path.endsWith("tmdbSettingsStore.js")
                  ? "export const { TmdbSettingsStore, normalizeTmdbLanguageCode } = fixtures;"
                  : path.endsWith("pluginServiceClient.js")
                    ? "export const { PluginServiceClient } = fixtures;"
                    : "export const { Platform } = fixtures;";
              return { contents, loader: "js" };
            }
          );
          b.onLoad(
            { filter: /metaDetailsScreenMethods-(?:01|02|03|05|06|07)-[^/]+\.js$/ },
            async ({ path }) => ({
              contents: (await readFile(path, "utf8")).replace(
                /^import \* as internals from [^;]+;/m,
                "const internals = fixtures;"
              ),
              loader: "js"
            })
          );
        }
      }
    ]
  });
  const context = vm.createContext({
    fixtures,
    document: { getElementById: () => ({ querySelector: () => null }) },
    URL,
    AbortController,
    console: { warn: (...args) => warnings.push(args) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const data = await fixtures.respond(new URL(url));
      return { ok: data !== null, json: async () => data };
    },
    setTimeout: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const timeoutSource = await readFile(
    "js/ui/screens/detail/metaDetailsScreenHelpers-03-meta-with-route-external-ids.js",
    "utf8"
  );
  vm.runInContext(
    timeoutSource
      .slice(timeoutSource.indexOf("export async function withTimeout("))
      .replace("export ", ""),
    context
  );
  fixtures.withTimeout = context.withTimeout;
  Object.assign(fixtures, context.subject);
  return {
    ...context.subject,
    fixtures,
    calls,
    warnings,
    timers,
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id);
          timer.fn();
        }
    }
  };
}
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const tvData = () => ({
  name: "Localized",
  overview: "Translated description",
  networks: [{ id: 4, name: "BBC" }],
  production_companies: [],
  videos: { results: [] },
  aggregate_credits: {
    cast: [
      {
        id: 1,
        name: "Actor",
        profile_path: "/actor.jpg",
        roles: [{ character: "First" }, { character: "Second" }]
      }
    ],
    crew: [
      { id: 2, name: "Crew", department: "Writing", jobs: [{ job: "Writer" }, { job: "Producer" }] }
    ]
  }
});

test("ID fallback matches Android without changing primary-ID, cache or disabled-feature gates", async () => {
  const { TmdbService, fixtures, calls } = await setup();
  fixtures.respond = async (url) => ({
    tv_results: url.pathname.endsWith("tt123") ? [{ id: 7 }] : []
  });
  assert.equal(
    await TmdbService.ensureTmdbId("addon:unknown", "series", { fallbackImdbId: " TT123:1:2 " }),
    "7"
  );
  assert.equal(await TmdbService.ensureTmdbId("addon:unknown", "series"), null);
  assert.equal(
    await TmdbService.ensureTmdbId("tmdb:9", "series", { fallbackImdbId: "tt123" }),
    "9"
  );
  assert.equal(
    await TmdbService.ensureTmdbId("tt999", "series", { fallbackImdbId: "tt123" }),
    null
  );
  const count = calls.length;
  fixtures.settings.enabled = false;
  assert.equal(
    await TmdbService.ensureTmdbId("addon:x", "series", { fallbackImdbId: "tt123" }),
    "7"
  );
  assert.equal(
    await TmdbService.ensureTmdbId("addon:x", "series", { fallbackImdbId: "tt555" }),
    null
  );
  assert.equal(calls.length, count);
});

test("series use aggregate cast/crew, movies retain standard credits, including English name fallback", async () => {
  const { TmdbMetadataService, fixtures, calls } = await setup();
  fixtures.respond = async (url) => (url.pathname.endsWith("/videos") ? { results: [] } : tvData());
  const series = await TmdbMetadataService.fetchEnrichment({ tmdbId: "7", contentType: "series" });
  assert.equal(series.credits.cast[0].character, "First");
  assert.deepEqual(plain(series.credits.crew.map((member) => member.job)), ["Writer", "Producer"]);
  assert.ok(calls[0].url.includes("aggregate_credits"));
  fixtures.settings.language = "fr";
  fixtures.respond = async (url) => {
    if (url.pathname.endsWith("/videos")) return { results: [] };
    const data = tvData();
    data.aggregate_credits.cast[0].name =
      url.searchParams.get("language") === "en-US" ? "English Actor" : "俳優";
    return data;
  };
  assert.equal(
    (await TmdbMetadataService.fetchEnrichment({ tmdbId: "7", contentType: "series" })).credits
      .cast[0].name,
    "English Actor"
  );
  assert.ok(
    calls.some((call) => call.url.includes("en-US") && call.url.includes("aggregate_credits"))
  );
  fixtures.settings.language = "en";
  fixtures.respond = async () => ({ title: "Film", credits: { cast: [{ name: "Film Actor" }] } });
  const movie = await TmdbMetadataService.fetchEnrichment({ tmdbId: "8", contentType: "movie" });
  assert.equal(movie.credits.cast[0].name, "Film Actor");
  assert.ok(!calls.at(-1).url.includes("aggregate_credits"));
});

test("metadata uses packaged webOS transport with direct fallback; Tizen/browser use bounded fetch", async () => {
  const api = await setup();
  api.fixtures.webos = true;
  api.fixtures.respond = async () => tvData();
  await api.TmdbMetadataService.fetchEnrichment({ tmdbId: "7", contentType: "series" });
  assert.equal(api.calls[0].service, true);
  assert.equal(api.calls[0].maxResponseBytes, 5 * 1024 * 1024);
  api.fixtures.PluginServiceClient.fetch = async () => {
    throw Error("Service unavailable");
  };
  await api.TmdbMetadataService.fetchEnrichment({ tmdbId: "7", contentType: "series" });
  assert.ok(api.calls.some((call) => !call.service));
  api.fixtures.webos = false;
  api.fixtures.respond = () => new Promise(() => {});
  const pending = api.fetchTmdbJson("https://api.themoviedb.org/3/tv/7");
  const rejected = assert.rejects(pending, /timed out/);
  api.advance(60_001);
  await rejected;
  assert.equal(api.calls.at(-1).options.signal.aborted, true);
  assert.equal(api.timers.size, 0);
});

test("season failures are isolated and concurrency is limited to four like Android", async () => {
  const { TmdbMetadataService, fixtures, warnings } = await setup();
  let active = 0,
    peak = 0;
  fixtures.respond = async (url) => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    if (url.pathname.endsWith("/2")) throw Error("offline");
    return { episodes: [{ episode_number: 1, name: url.pathname.split("/").at(-1) }] };
  };
  const episodes = await TmdbMetadataService.fetchEpisodeEnrichment({
    tmdbId: "7",
    seasonNumbers: [1, 2, 3, 4, 5, 1]
  });
  assert.equal(peak, 4);
  assert.equal(episodes.size, 4);
  assert.equal(episodes.has("2:1"), false);
  assert.equal(episodes.get("5:1").title, "5");
  assert.equal(warnings.length, 1);
});

test("detail starts main and episode enrichment together, preserves dates and addon company data", async () => {
  const api = await setup();
  const main = deferred(),
    episodes = deferred(),
    started = [];
  api.fixtures.TmdbMetadataService = {
    fetchEnrichment: () => {
      started.push("main");
      return main.promise;
    },
    fetchEpisodeEnrichment: () => {
      started.push("episodes");
      return episodes.promise;
    }
  };
  const screen = { params: { itemId: "7", itemType: "series" } };
  const meta = {
    id: "7",
    type: "series",
    name: "Original",
    released: "2020-01-01",
    networks: [{ name: "Addon Network" }],
    productionCompanies: [{ name: "Addon Studio" }],
    videos: [{ season: 1, episode: 1, released: "2020-02-01" }]
  };
  const task = api.createMetaDetailsScreenMethods06().enrichMeta.call(screen, meta);
  await flush();
  assert.deepEqual(started, ["main", "episodes"]);
  main.resolve({ localizedTitle: "Translated", networks: [], productionCompanies: [] });
  episodes.resolve(new Map([["1:1", { title: "Translated Episode", airDate: "2099-01-01" }]]));
  const result = await task;
  assert.equal(result.name, "Translated");
  assert.equal(result.released, meta.released);
  assert.equal(result.videos[0].released, meta.videos[0].released);
  assert.equal(result.videos[0].title, "Translated Episode");
  assert.equal(result.networks, meta.networks);
  assert.equal(result.productionCompanies, meta.productionCompanies);
});

test("detail resolves route ID and keeps successful episode data when the main request fails", async () => {
  const api = await setup();
  const meta = {
    id: "custom:x",
    type: "series",
    name: "Original",
    videos: [{ season: 1, episode: 1 }]
  };
  api.fixtures.TmdbMetadataService = {
    fetchEnrichment: async () => {
      throw Error("main offline");
    },
    fetchEpisodeEnrichment: async () => new Map([["1:1", { title: "Episode" }]])
  };
  const result = await api
    .createMetaDetailsScreenMethods06()
    .enrichMeta.call({ params: { itemId: "7", itemType: "series" } }, meta);
  assert.equal(result.name, "Original");
  assert.equal(result.videos[0].title, "Episode");
  api.fixtures.settings.enabled = false;
  assert.equal(await api.createMetaDetailsScreenMethods06().enrichMeta.call({}, meta), meta);
});

test("special episodes and per-field opt-outs preserve addon data", async () => {
  const api = await setup();
  let requestedSeasons;
  const meta = {
    id: "7",
    type: "series",
    name: "Addon",
    networks: [{ name: "Addon Network" }],
    productionCompanies: [{ name: "Addon Studio" }],
    videos: [{ season: 0, episode: 1, title: "Original special" }, { episode: 1 }]
  };
  Object.assign(api.fixtures.settings, {
    useBasicInfo: false,
    useNetworks: false,
    useProductions: false
  });
  api.fixtures.TmdbMetadataService = {
    fetchEnrichment: async () => ({
      localizedTitle: "Translated",
      networks: [{ name: "TMDB Network" }],
      productionCompanies: [{ name: "TMDB Studio" }]
    }),
    fetchEpisodeEnrichment: async ({ seasonNumbers }) => {
      requestedSeasons = seasonNumbers;
      return new Map([["0:1", { title: "Translated special" }]]);
    }
  };
  const result = await api.createMetaDetailsScreenMethods06().enrichMeta.call({}, meta);
  assert.deepEqual(plain(requestedSeasons), [0]);
  assert.equal(result.videos[0].title, "Translated special");
  assert.equal(result.videos[1], meta.videos[1]);
  assert.equal(result.name, meta.name);
  assert.equal(result.networks, meta.networks);
  assert.equal(result.productionCompanies, meta.productionCompanies);
  api.fixtures.settings.useEpisodes = false;
  const disabled = await api.createMetaDetailsScreenMethods06().enrichMeta.call({}, meta);
  assert.equal(disabled.videos, meta.videos);
});

async function loadScreen(
  api,
  enrichment,
  extractCast = () => ["cast"],
  progressPromise = null,
  onScreen = () => {}
) {
  const meta = {
    id: "7",
    type: api.fixtures.contentType || "series",
    name: "Original",
    videos: api.fixtures.videos || []
  };
  Object.assign(api.fixtures, {
    metaRepository: { getMetaFromAllAddons: async () => ({ status: "success", data: meta }) },
    savedLibraryRepository: { isSaved: async () => false },
    watchProgressRepository: { getResumeByContentId: async () => null },
    watchedItemsRepository: { isWatched: async () => false, getAll: async () => [] },
    getDetailAllProgressPromise: async () => progressPromise || api.fixtures.progressItems || [],
    mdbListRepository: api.fixtures.mdbListRepository || { getRatingsForMeta: async () => null },
    metaWithRouteExternalIds: (meta) => meta,
    isDetailTitleWatched: async () => false,
    buildResumeContentIds: () => [],
    buildDetailContentReference: () => ({}),
    hasCompletedSimklMovieProgress: () => false,
    hasInProgressSimklMovieProgress: () => false,
    normalizeEpisodes: (videos) => videos,
    extractCast,
    isSimklProgressSourceSelected: () => false,
    resolveTrailerSource: () => null,
    addonRatingsBySeason: () => ({}),
    mergeSeasonRatings: () => ({})
  });
  const screen = {
    ...api.createMetaDetailsScreenMethods03(),
    detailLoadToken: 1,
    params: { itemId: "7", itemType: meta.type },
    updates: [],
    resolveCanonicalDetailItemId: async (id) => id,
    enrichMeta: () => enrichment.promise,
    render(value) {
      this.initial = value;
    },
    updateRenderedDetailSections(value) {
      this.updates.push(value);
    },
    buildEpisodeState(...args) {
      this.episodeState = args;
    },
    computeNextEpisodeToWatch() {},
    resolveInitialSelectedSeason() {},
    refreshLibraryMembership() {},
    maybeAutoOpenContinueWatchingStream() {},
    maybePlayOnLoad() {},
    refreshTrailerSource() {},
    loadTraktComments() {},
    fetchMoreLikeThis: async () => [],
    loadMdbListRatings() {},
    fetchMovieCollection: async () => ({ items: [], name: "" }),
    fetchSeriesRatingsBySeason: api.fixtures.fetchSeriesRatingsBySeason || (async () => ({}))
  };
  onScreen(screen);
  await api.createMetaDetailsScreenMethods03().loadDetail.call(screen);
  await flush();
  return screen;
}

test("late enrichment updates the already-rendered page, but cannot update a different route", async () => {
  for (const navigateAway of [false, true]) {
    const api = await setup(),
      enrichment = deferred();
    const screen = await loadScreen(api, enrichment);
    assert.equal(screen.initial.name, "Original");
    api.advance(15_000);
    await flush();
    assert.equal(screen.meta.name, "Original");
    if (navigateAway) screen.detailLoadToken++;
    enrichment.resolve({ id: "7", type: "series", name: "Translated", videos: [] });
    await flush();
    assert.equal(screen.meta.name, navigateAway ? "Original" : "Translated");
  }
});

test("navigation during cast fallback cannot overwrite the next page's cast", async () => {
  const api = await setup(),
    enrichment = deferred(),
    fallback = deferred();
  const screen = await loadScreen(api, enrichment, () => []);
  screen.fetchTmdbCastFallback = () => fallback.promise;
  enrichment.resolve({ id: "7", type: "series", name: "Translated", videos: [] });
  await flush();
  screen.detailLoadToken++;
  screen.castItems = ["Next page cast"];
  const updateCount = screen.updates.length;
  fallback.resolve(["Old page cast"]);
  await flush();
  assert.deepEqual(screen.castItems, ["Next page cast"]);
  assert.equal(screen.updates.length, updateCount);
});

test("late metadata rebuilds episode state from current progress and watched items", async () => {
  const api = await setup(),
    enrichment = deferred();
  const screen = await loadScreen(api, enrichment);
  const progress = [{ contentId: "7", season: 1, episode: 1, positionMs: 50 }];
  const watched = [{ contentId: "7", season: 1, episode: 2 }];
  api.fixtures.progressItems = progress;
  api.fixtures.watchedItemsRepository.getAll = async () => watched;
  enrichment.resolve({ id: "7", type: "series", name: "Translated", videos: [] });
  await flush();
  assert.equal(screen.episodeState[1], watched);
  assert.deepEqual(screen.episodeState[0], progress);
});

test("ratings start and finish while remote progress remains pending; stale metadata cannot start them", async () => {
  for (const stale of [false, true]) {
    const api = await setup(),
      progress = deferred(),
      enrichment = deferred();
    let ratingsLoaded = false,
      episodeRatingsLoaded = false,
      screen;
    api.fixtures.videos = [{ season: 1, episode: 1 }];
    api.fixtures.fetchSeriesRatingsBySeason = async (_meta, episodes) => {
      assert.equal(episodes.length, 1);
      episodeRatingsLoaded = true;
      return {};
    };
    api.fixtures.mdbListRepository = {
      getRatingsForMeta: async (meta) => {
        assert.equal(meta.id, "7");
        ratingsLoaded = true;
        return { ratings: { imdb: 8 } };
      }
    };
    const loading = loadScreen(
      api,
      enrichment,
      () => ["cast"],
      progress.promise,
      (value) => {
        screen = value;
        if (stale) queueMicrotask(() => screen.detailLoadToken++);
      }
    );
    await flush();
    assert.equal(ratingsLoaded, !stale);
    assert.equal(episodeRatingsLoaded, !stale);
    assert.equal(screen.initial, undefined, "remote progress is still pending");
    progress.resolve([]);
    await loading;
  }
});

test("prefetched ratings are reused, stale completions are ignored, and enriched IDs remain a fallback", async () => {
  const api = await setup();
  let requests = 0;
  api.fixtures.metaWithRouteExternalIds = (meta) => meta;
  api.fixtures.mdbListRepository = {
    getRatingsForMeta: async () => {
      requests++;
      return { ratings: { imdb: 9 }, hasImdbRating: true };
    }
  };
  const screen = {
    detailLoadToken: 1,
    params: { itemId: "7", itemType: "series" },
    meta: { name: "Fresh" },
    updateRenderedDetailSections() {}
  };
  const load = api.createMetaDetailsScreenMethods07().loadMdbListRatings;
  await load.call(screen, {}, 1, Promise.resolve({ ratings: { imdb: 8 }, hasImdbRating: true }));
  assert.equal(requests, 0);
  assert.equal(screen.meta.mdbListRatings.imdb, 8);
  assert.equal(screen.meta.name, "Fresh");
  await load.call(screen, {}, 1, Promise.resolve(null));
  assert.equal(requests, 1);
  const pending = deferred();
  const stale = load.call(screen, {}, 1, pending.promise);
  screen.detailLoadToken++;
  pending.resolve({ ratings: { imdb: 1 } });
  await stale;
  assert.equal(screen.meta.mdbListRatings.imdb, 9);
  assert.equal(requests, 1);
});

test("Continue Watching Back resumes interrupted enrichment and preserves the detail snapshot", async () => {
  for (const [contentType, leaveAgain] of [
    ["series", false],
    ["series", true],
    ["movie", false],
    ["movie", true]
  ]) {
    const api = await setup(),
      enrichment = deferred();
    Object.assign(api.fixtures, {
      contentType,
      videos: contentType === "series" ? [{ id: "7:1:1", season: 1, episode: 1 }] : [],
      Router: { getCurrent: () => "detail" },
      ScreenUtils: { show() {} },
      hasMdbListRatings: () => true,
      captureHorizontalScrollMap: () => ({ cast: 240 })
    });
    let snapshot,
      enrichmentCalls = 0;
    const screen = await loadScreen(
      api,
      enrichment,
      (meta) => [{ name: "Actor", photo: meta.credits ? "https://example.com/actor.jpg" : "" }],
      null,
      (screen) => {
        Object.assign(
          screen,
          api.createMetaDetailsScreenMethods01(),
          api.createMetaDetailsScreenMethods02(),
          {
            maybeAutoOpenContinueWatchingStream:
              api.createMetaDetailsScreenMethods05().maybeAutoOpenContinueWatchingStream,
            findContinueWatchingEpisodeTarget:
              api.createMetaDetailsScreenMethods05().findContinueWatchingEpisodeTarget,
            container: { querySelector: () => ({ scrollTop: 120 }) },
            captureDetailFocus: () => ({ rail: "cast", index: 2 }),
            stopTrailerPlayback() {},
            cancelTraktCommentsRequest() {},
            bindTrailerProxyMessaging() {},
            refreshEpisodePlaybackState: async () => {},
            navigateToStreamScreenForMovie() {
              snapshot = this.captureRouteState();
              this.detailLoadToken++;
            },
            navigateToStreamScreenForEpisode() {
              this.navigateToStreamScreenForMovie();
            },
            enrichMeta() {
              enrichmentCalls++;
              return enrichment.promise;
            }
          }
        );
        screen.params.autoOpenContinueWatching = true;
      }
    );
    assert.equal(snapshot.detailEnrichmentComplete, false);
    assert.equal(snapshot.castItems[0].photo, "");
    snapshot.selectedSeason = 3;
    await screen.mount(screen.params, { isBackNavigation: true, restoredState: snapshot });
    assert.equal(enrichmentCalls, 1);
    assert.equal(screen.initial.name, "Original");
    assert.deepEqual(plain(screen.pendingFocusRestore), { rail: "cast", index: 2 });
    assert.equal(screen.restoredContentScrollTop, 120);
    assert.equal(screen.restoredTrackScrollLeftByKey.cast, 240);
    if (leaveAgain) screen.detailLoadToken++;
    enrichment.resolve({
      id: "7",
      type: contentType,
      name: "Enriched",
      videos: [],
      credits: { cast: [] }
    });
    await flush();
    assert.equal(screen.castItems[0].photo, leaveAgain ? "" : "https://example.com/actor.jpg");
    assert.equal(screen.detailEnrichmentComplete, !leaveAgain);
    assert.equal(screen.selectedSeason, 3, "enrichment preserves the restored season");
    if (!leaveAgain) {
      const completed = screen.captureRouteState();
      await screen.mount(screen.params, { isBackNavigation: true, restoredState: completed });
      await flush();
      assert.equal(enrichmentCalls, 1, "completed enrichment is not restarted on Back");
      assert.equal(screen.castItems[0].photo, "https://example.com/actor.jpg");
    }
  }
});
