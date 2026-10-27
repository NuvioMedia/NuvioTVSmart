import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index],
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = { MDBLIST_CLIENT_ID: "fixture" };
const { LocalStore } = await import("../js/core/storage/localStore.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { MdbListAccount: account } = await import("../js/data/repository/mdbListAccount.js");
const { MdbListTracking: tracking, mdbMutationTarget } =
  await import("../js/data/repository/mdbListTracking.js");
const { decodeMdbListItems, projectMdbListEntries } =
  await import("../js/data/repository/mdbListLibraryCodec.js");
const mdbOnly = decodeMdbListItems({ movies: [{ title: "MDB-only", ids: { mdblist: "abc" } }] });
assert.equal(mdbOnly[0].id, "mdblist:abc");
assert.equal(
  projectMdbListEntries({ items: { "mdblist:watchlist": mdbOnly } })[0].id,
  "mdblist:abc"
);
const codec = await import("../js/data/repository/mdbListTrackingCodec.js");
const { normalizeMdbSnapshot, projectMdbTracking } =
  await import("../js/data/repository/mdbListTrackingProjection.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../js/data/local/traktSettingsStore.js");
const syncSettings =
  await import("../js/core/profile/profileSettingsSyncServiceHelpers-02-normalize-half-step-for-sync.js");
const { notifySessionTeardownHandlers } = await import("../js/core/auth/sessionLifecycle.js");
const { clearAccountLocalData } = await import("../js/core/auth/accountLocalDataReset.js");
const { clearProfileLocalData } = await import("../js/core/profile/profileLocalDataReset.js");
const { isWatchProgressCompleted, resolveWatchProgressResumePositionMs } =
  await import("../js/domain/model/watchProgress.js");
const now = "2026-10-26T12:00:00Z",
  later = "2026-10-26T12:01:00Z";
const movie = { ids: { imdb: "tt123", tmdb: 123 }, title: "Fixture", runtime: 100 };
const show = { ids: { imdb: "tt456", tmdb: 456 }, title: "Fixture show", runtime: 45 };
const watched = {
  movies: [{ movie, watched_at: now }],
  shows: [{ show, seasons: [{ number: 1, episodes: [{ number: 1, watched_at: now }] }] }]
};
const playback = [
  {
    id: 9,
    type: "episode",
    show,
    episode: { season: 1, number: 2 },
    progress: 42,
    paused_at: later
  }
];
function connect(profile = "1", generation = "g") {
  LocalStore.set("mdbListAccounts", {
    ...LocalStore.get("mdbListAccounts", {}),
    [profile]: {
      generation,
      user: { id: 7 },
      tokens: {
        accessToken: "synthetic",
        refreshToken: "synthetic",
        expiresAt: Date.now() + 3600000
      }
    }
  });
}
connect();
assert.equal(syncSettings.normalizeTraktWatchProgressSourceForAndroid("mdblist"), "MDBLIST");
assert.equal(syncSettings.normalizeTraktWatchProgressSourceForWeb("MDBLIST"), "mdblist");
TraktSettingsStore.setWatchProgressSource("MDBLIST");
assert.equal(TraktSettingsStore.get().watchProgressSource, WatchProgressSource.MDBLIST);
assert.equal(mdbMutationTarget({ contentId: "tt123", isLive: true }), null);
const knownWithoutTitle = {
  watched: [{ type: "movie", media: { ids: { tmdb: 123 }, title: null } }],
  playback: []
};
const enrichedTarget = mdbMutationTarget(
  { contentId: "tt123", tmdbId: 123, title: "Incoming title" },
  knownWithoutTitle
);
assert.equal(enrichedTarget.media.title, "Incoming title");
assert.deepEqual(enrichedTarget.media.ids, { imdb: "tt123", tmdb: 123 });
assert.equal(mdbMutationTarget({ contentId: "tt456", contentType: "series" }), null);
assert.equal(
  mdbMutationTarget({ contentId: "tt456", contentType: "series", season: 0, episode: 1 }).season,
  0
);
assert.equal(
  mdbMutationTarget({
    contentId: "tt456",
    contentType: "series",
    season: 1,
    episode: 1,
    usesTvdbSeasonMapping: true
  }),
  null
);
let activity = { server_time: now, watched_at: now, paused_at: later, dropped_at: null };
let journal = { journal: [] },
  watchedCalls = 0,
  journalCalls = 0,
  failPath = null;
let receipt = {
  action: "pause",
  progress: 42,
  show,
  episode: { season: 1, number: 2 },
  paused_at: later,
  id: 9
};
let historyReceipt = { updated: { movies: 1 }, plays: [] };
const writes = [],
  paths = [];
const realApi = account.api;
account.api = async (scope, path, options = {}) => {
  account.check(scope);
  paths.push(path);
  if (path === failPath) throw Object.assign(new Error("fixture unavailable"), { status: 503 });
  if (options.method === "POST") {
    writes.push({ path, body: options.body });
    const payload =
      path === "/scrobble/clear"
        ? { action: "clear", deleted: true }
        : path.startsWith("/scrobble/")
          ? receipt
          : historyReceipt;
    return { payload, headers: new Headers() };
  }
  let payload;
  if (path === "/sync/last_activities") payload = activity;
  else if (path === "/sync/watched") {
    watchedCalls++;
    payload = watched;
  } else if (path === "/sync/journal") {
    journalCalls++;
    payload = journal;
  } else if (path === "/sync/playback") payload = playback;
  else if (path === "/sync/dropped") payload = { shows: [] };
  else if (path === "/sync/seasons/dropped") payload = { seasons: [] };
  else throw new Error(path);
  return { payload, headers: new Headers() };
};
assert.equal(await tracking.refresh({ strict: true }), true);
assert.equal(watchedCalls, 1);
const projection = await tracking.getProgressSnapshot();
assert.equal(projection.playbackItems[0].progressPercent, 42);
assert.equal(projection.watchedShowSeedItems[0].episode, 1);
assert.equal((await tracking.getWatchedItems()).length, 2);
assert.equal(resolveWatchProgressResumePositionMs(projection.playbackItems[0]), 1134000);
assert(isWatchProgressCompleted({ source: "mdblist_playback", progressPercent: 80 }));
await tracking.refresh({ force: true, strict: true });
assert.equal(watchedCalls, 1);
assert.equal(journalCalls, 0);
activity = { ...activity, watched_at: later, server_time: later };
journal = {
  journal: [
    {
      category: "watched",
      item_type: "movie",
      ids: { tmdb: 123 },
      status: "removed",
      action_at: later
    }
  ]
};
await tracking.refresh({ force: true, strict: true });
assert.equal(journalCalls, 1);
assert.equal(
  (await tracking.getWatchedItems()).filter((item) => item.contentType === "movie").length,
  0
);
activity = { ...activity, server_time: "2026-10-26T12:02:00Z", watched_at: "2026-10-26T12:02:00Z" };
journal = { requires_full_sync: true };
await tracking.refresh({ force: true, strict: true });
assert.equal(watchedCalls, 2);
const beforeFailure = tracking.getSnapshot();
failPath = "/sync/last_activities";
await assert.rejects(tracking.refresh({ force: true, strict: true }));
assert.deepEqual(tracking.getSnapshot(), beforeFailure);
failPath = null;
// Confirmed server receipts control completion; mismatched identities must fail closed.
const context = {
  contentId: "tt456",
  contentType: "series",
  seasonNumber: 1,
  episodeNumber: 2,
  progressPercent: 99
};
const watchedStorageBeforePause = localStorage.getItem("mdbListTracking");
await tracking.scrobble(account.scope(), "pause", context);
assert.equal(localStorage.getItem("mdbListTracking"), watchedStorageBeforePause);
assert(LocalStore.get("mdbListTrackingPlayback")["1"].playback.length > 0);
assert.equal(tracking.getSnapshot().playback[0].progress, 42);
assert.deepEqual(writes.at(-1).body.show, { ids: show.ids, season: 1, episode: 2 });
receipt = { ...receipt, show: { ids: { imdb: "tt999" } } };
await assert.rejects(tracking.scrobble(account.scope(), "stop", context));
assert.equal(tracking.getSnapshot().invalidated, true);
receipt = {
  action: "scrobble",
  progress: 80,
  show,
  episode: { season: 1, number: 2 },
  watched_at: later
};
await tracking.scrobble(account.scope(), "stop", context);
assert.equal(tracking.getSnapshot().playback.length, 0);
assert(tracking.getSnapshot().watched.some((row) => row.episode === 2));
// Clear is separate from history.
receipt = {
  action: "pause",
  progress: 20,
  show,
  episode: { season: 1, number: 2 },
  paused_at: later
};
await tracking.scrobble(account.scope(), "pause", context);
const watchedCount = tracking.getSnapshot().watched.length;
await tracking.clearProgress("tt456", "tt456:1:2");
assert.equal(tracking.getSnapshot().playback.length, 0);
LocalStore.set("mdbListTrackingPlayback", LocalStore.get("mdbListTrackingPlayback"));
assert.equal(tracking.getSnapshot().playback.length, 0); // Restored from the persisted playback sidecar.
assert.equal(tracking.getSnapshot().watched.length, watchedCount);
// Whole-series history is intentionally skipped, specials remain addressable.
const writeCount = writes.length;
await tracking.writeHistory([{ contentId: "tt456", contentType: "series" }]);
assert.equal(writes.length, writeCount);
historyReceipt = { updated: { episodes: 1 } };
await tracking.writeHistory([
  { contentId: "tt456", contentType: "series", season: 0, episode: 1 },
  { contentId: "tt456", contentType: "series", season: 0, episode: 1 }
]);
assert.equal(writes.at(-1).body.shows.length, 1);
assert.equal(writes.at(-1).body.shows[0].seasons[0].number, 0);
historyReceipt = { deleted: { shows: 1 } };
await tracking.writeHistory([{ contentId: "tt456", contentType: "series" }], true);
assert(!tracking.getSnapshot().watched.some((row) => row.media.ids.imdb === "tt456"));
assert.deepEqual(writes.at(-1).body.shows, [{ ids: show.ids }]);
historyReceipt = { updated: { movies: 0 }, not_found: { movies: [{ ids: movie.ids }] } };
await assert.rejects(tracking.writeHistory([{ contentId: "tt123", contentType: "movie" }]));
assert.equal(tracking.getSnapshot().invalidated, true);
// Strict decoding and bounded pagination.
assert.throws(() => codec.mdbTime("2026-02-30T00:00:00Z"));
assert.throws(() => codec.mdbTime("123"));
assert.throws(() => codec.mdbIds({ tmdb: true }));
assert.throws(() => codec.mdbPercentage(false));
assert.equal(codec.mdbIds({ mdblist: 123 }).mdblist, "123");
assert.throws(() => codec.decodeMdbPlayback([{ ...playback[0], progress: null }]));
assert.throws(() => codec.decodeMdbWatched({ unexpected: [] }));
assert.throws(() => codec.decodeMdbDropped({ seasons: [{ season: { number: -1 }, show }] }, true));
await assert.rejects(
  codec.mdbTrackingPages(
    async () => ({ payload: { movies: [], next_cursor: "same" }, headers: new Headers() }),
    "/sync/watched",
    codec.decodeMdbWatched
  )
);
assert.equal(
  await codec.mdbTrackingPages(
    async () => {
      throw { status: 409 };
    },
    "/sync/journal",
    codec.decodeMdbJournal
  ),
  null
);
const blank = { watched: [], playback: [], dropped: [] };
assert.throws(() =>
  normalizeMdbSnapshot({
    ...blank,
    watched: [
      { type: "movie", media: { ids: { imdb: "tt1", tmdb: 1 } } },
      { type: "movie", media: { ids: { imdb: "tt1", tmdb: 2 } } }
    ]
  })
);
const hidden = normalizeMdbSnapshot({
  ...blank,
  watched: codec.decodeMdbWatched(watched),
  playback: codec.decodeMdbPlayback(playback),
  dropped: [{ ids: { tmdb: 456 }, season: null }]
});
assert.equal(projectMdbTracking(hidden).playbackItems.length, 0);
assert.equal(projectMdbTracking(hidden).watchedShowSeedItems.length, 0);
const unknownRuntime = {
  ...hidden,
  dropped: [],
  playback: hidden.playback.map((row) => ({
    ...row,
    media: { ...row.media, runtime: 0 },
    runtime: 0
  }))
};
assert.equal(projectMdbTracking(unknownRuntime).playbackItems[0].progressPercent, 42);
assert.equal(projectMdbTracking(unknownRuntime).playbackItems[0].durationMs, 0);
// Real repository wiring: supported local data never overrides MDBList removals.
await tracking.refresh({ force: true, strict: true });
const { watchProgressRepository } =
  await import("../js/data/repository/watchProgressRepository.js");
const { watchedItemsRepository } = await import("../js/data/repository/watchedItemsRepository.js");
LocalStore.set("watchProgressItems", [
  {
    profileId: "1",
    contentId: "tt999",
    contentType: "movie",
    source: "mdblist_local",
    progressPercent: 40,
    updatedAt: Date.now()
  },
  {
    profileId: "1",
    contentId: "custom:no-ids",
    contentType: "movie",
    source: "mdblist_local",
    progressPercent: 30,
    updatedAt: Date.now()
  }
]);
LocalStore.set("watchedItems", [
  { profileId: "1", contentId: "tt999", contentType: "movie" },
  { profileId: "1", contentId: "custom:no-ids", contentType: "movie" }
]);
const recent = await watchProgressRepository.getRecent(30, { enrichMetadata: false });
assert(recent.some((row) => row.contentId === "tt456" && row.progressPercent === 42));
assert(recent.some((row) => row.contentId === "custom:no-ids"));
assert(!recent.some((row) => row.contentId === "tt999"));
const allWatched = await watchedItemsRepository.getAll();
assert(allWatched.some((row) => row.contentId === "tt123"));
assert(allWatched.some((row) => row.contentId === "custom:no-ids"));
assert(!allWatched.some((row) => row.contentId === "tt999"));
assert.equal(
  (await watchProgressRepository.getResumeByContentId("tmdb:456", { season: 1, episode: 2 }))
    .progressPercent,
  42
);
assert.equal(
  mdbMutationTarget({ contentId: "tmdb:series:456", contentType: "series", season: 0, episode: 1 })
    .media.ids.tmdb,
  456
);
assert.equal(tracking.isHidden("tt456"), false);
assert.equal(
  watchProgressRepository.getContinueWatchingRemoteProgressState().sourceKey,
  watchProgressRepository.getContinueWatchingSourceKey()
);
const oldSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
const previousAccounts = LocalStore.get("mdbListAccounts");
connect("1", "other-account-generation");
assert.notEqual(watchProgressRepository.getContinueWatchingSourceKey(), oldSourceKey);
LocalStore.set("mdbListAccounts", previousAccounts);
const { getDetailAllProgressPromise } =
  await import("../js/ui/screens/detail/metaDetailsScreenHelpers-01-tmdb-base-url.js");
assert((await getDetailAllProgressPromise()).some((row) => row.source === "mdblist_playback"));
assert(await watchedItemsRepository.isWatched("tt456", { season: 1, episode: 1 }));
const { detailWatchedEnrichmentService } =
  await import("../js/data/repository/detailWatchedEnrichmentService.js");
const { TraktAuthService } = await import("../js/data/repository/traktAuthService.js");
const previousTraktAuth = TraktAuthService.isAuthenticated,
  previousTraktMovies = TraktAuthService.fetchWatchedMovies;
TraktAuthService.isAuthenticated = () => true;
TraktAuthService.fetchWatchedMovies = async () => {
  throw new Error("MDBList selection must not read Trakt watched history");
};
try {
  assert.equal(
    (await detailWatchedEnrichmentService.enrichMovieWatchedState("tt999", 999)).isWatched,
    false
  );
} finally {
  TraktAuthService.isAuthenticated = previousTraktAuth;
  TraktAuthService.fetchWatchedMovies = previousTraktMovies;
}
// Tracking settings expose MDBList and reuse the existing account dialog.
const { createTrackingSettingsMethods } =
  await import("../js/ui/screens/settings/trackingSettingsMethods.js");
const { Router } = await import("../js/ui/navigation/routerState.js");
const { I18n } = await import("../js/i18n/index.js");
const previousTranslate = I18n.t;
I18n.t = (key, params, options) => options?.fallback || key;
const previousRoute = Router.getCurrent;
Router.getCurrent = () => "settings";
let settingsDialog;
const settingsRows = [];
const settingsScreen = {
  ...createTrackingSettingsMethods(),
  isMounted: true,
  activeSection: "trakt",
  actionMap: new Map(),
  trackingRenderProfile: ProfileManager.getActiveProfileId(),
  startTraktClock() {},
  stopTrackingWork() {},
  renderActionRow(row) {
    settingsRows.push(row);
    return row.title;
  },
  renderToggleRow() {
    return "";
  },
  openOptionDialog(dialog) {
    settingsDialog = dialog;
  }
};
settingsScreen.renderTrackingSection();
assert(
  settingsRows.some(
    (row) => row.focusKey === "integration:mdblist:account" && row.title === "MDBList"
  )
);
settingsScreen.actionMap.get("tracking:progressSource")();
assert(settingsDialog.options.some((option) => option.id === "mdblist"));
settingsScreen.actionMap.get("integration:mdblist:account")();
assert(settingsDialog.options.some((option) => option.id === "sync"));
const restoredKeys = [
  "mdbListAccounts",
  "mdbListLibraries",
  "mdbListTracking",
  "mdbListTrackingPlayback"
].map((key) => [key, LocalStore.get(key)]);
TraktSettingsStore.setLibrarySourceMode("mdblist");
await settingsDialog.onSelect({ id: "disconnect" });
assert.equal(TraktSettingsStore.get().watchProgressSource, "mdblist");
assert.equal(TraktSettingsStore.get().librarySourceMode, "mdblist");
assert.equal(watchProgressRepository.getContinueWatchingSource(), "nuvio_sync");
for (const [key, value] of restoredKeys) {
  if (value == null) LocalStore.remove(key);
  else LocalStore.set(key, value);
}
Router.getCurrent = previousRoute;
I18n.t = previousTranslate;
// Cleanup captures progress before releasing playback; completed post-play does not send twice.
const { readFile } = await import("node:fs/promises");
const cleanupSource = await readFile(
  new URL("../js/ui/screens/player/playerScreenMethods-73-cleanup.js", import.meta.url),
  "utf8"
);
const cleanupEvents = [];
const cleanup = new Function(
  "internals",
  cleanupSource.replace(/^import .*;\n/gm, "").replace("export function", "function") +
    "; return createPlayerScreenMethods73().cleanup;"
)({
  TrackingScrobbleService: {
    isEnabled: () => true,
    stop: () => cleanupEvents.push("stop"),
    cancel: () => {}
  },
  PlayerController: {},
  streamRepository: {}
});
const cleanupScreen = {
  hasPresentedPlaybackFrame: true,
  closeStreamInfo() {},
  buildScrobbleContext: () => context,
  leavePartyPlayback() {},
  unbindParty() {},
  cancelSourceLoad() {
    cleanupEvents.push("release");
    throw new Error("fixture ends after first release");
  }
};
const warnBefore = console.warn;
console.warn = () => {};
try {
  cleanup.call(cleanupScreen);
  assert.deepEqual(cleanupEvents, ["stop", "release"]);
  cleanupEvents.length = 0;
  cleanupScreen.postPlayNaturalCompletionPrepared = true;
  cleanup.call(cleanupScreen);
  assert.deepEqual(cleanupEvents, ["release"]);
} finally {
  console.warn = warnBefore;
}

// engineFs must start tracking at its first real frame, never while startup is stalled.
const frameSource = await readFile(
  new URL(
    "../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js",
    import.meta.url
  ),
  "utf8"
);
let frameStarts = 0;
const frameMethods = new Function(
  "internals",
  frameSource.replace(/^import .*;\n/gm, "").replace("export function", "function") +
    "; return createPlayerScreenMethods30();"
)({ TrackingScrobbleService: { isEnabled: () => true, start: () => frameStarts++ } });
const frameScreen = {
  hasPresentedPlaybackFrame: false,
  currentEngineFsStream: {},
  startupTrackPreferenceReady: true,
  buildScrobbleContext: () => context,
  hasStartupPlaybackAdvanced: () => false,
  beginPlaybackEngineValidation() {},
  warmBitmapSubtitleSharedResources() {},
  setLoadingLogoFillTarget() {},
  isStartupGateReleaseReady: () => false,
  clearPlaybackStallGuard() {}
};
assert.equal(frameMethods.markPlaybackPresentedAfterAdvance.call(frameScreen, 0), false);
assert.equal(frameStarts, 0);
frameScreen.hasStartupPlaybackAdvanced = () => true;
assert.equal(frameMethods.markPlaybackPresentedAfterAdvance.call(frameScreen, 1), true);
assert.equal(frameMethods.markPlaybackPresentedAfterAdvance.call(frameScreen, 2), true);
assert.equal(frameStarts, 1);

// Single pending start, immediate pause/stop, no duplicate stop, and captured-profile timers.
const { MdbListScrobbleService: scrobbler } =
  await import("../js/data/repository/mdbListScrobbleService.js");
const originalScrobble = tracking.scrobble,
  originalSetTimeout = globalThis.setTimeout,
  originalClearTimeout = globalThis.clearTimeout;
const timers = new Map(),
  sent = [];
let nextTimer = 1;
globalThis.setTimeout = (callback) => {
  const id = nextTimer++;
  timers.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
tracking.scrobble = async (scope, action, item) => {
  account.check(scope);
  sent.push({ action, item });
};
const drain = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};
try {
  scrobbler.start(context);
  assert.equal(timers.size, 1);
  scrobbler.pause(context);
  await drain();
  assert.equal(timers.size, 0);
  assert.equal(sent.at(-1).action, "pause");
  scrobbler.start(context);
  const callback = [...timers.values()][0];
  timers.clear();
  callback();
  await drain();
  assert.equal(sent.at(-1).action, "start");
  scrobbler.stop(context);
  scrobbler.stop(context);
  await drain();
  assert.equal(sent.filter((row) => row.action === "stop").length, 1);
  const count = sent.length;
  scrobbler.start({ ...context, isLive: true });
  assert.equal(timers.size, 0);
  scrobbler.start(context);
  const obsolete = [...timers.values()][0];
  timers.clear();
  await ProfileManager.setActiveProfile("2");
  connect("2", "g2");
  obsolete();
  await drain();
  assert.equal(sent.length, count);
  await ProfileManager.setActiveProfile("1");
  scrobbler.cancel();
  scrobbler.start(context);
  await notifySessionTeardownHandlers();
  assert.equal(timers.size, 0);
} finally {
  scrobbler.cancel();
  tracking.scrobble = originalScrobble;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
// The shared exit fan-out must stop every provider once across pagehide and cleanup.
const { TrackingScrobbleService: registry } =
  await import("../js/data/repository/trackingScrobbleService.js");
const { TraktScrobbleService } = await import("../js/data/repository/traktScrobbleService.js");
const providerBackups = [scrobbler, TraktScrobbleService].map((provider) => ({
  provider,
  isEnabled: provider.isEnabled,
  start: provider.start,
  stop: provider.stop
}));
const stoppedProviders = [];
try {
  for (const { provider } of providerBackups) {
    provider.isEnabled = () => true;
    provider.start = () => {};
    provider.stop = () => stoppedProviders.push(provider);
  }
  registry.start(context);
  registry.stop(context);
  registry.stop(context);
  assert.equal(stoppedProviders.length, 2);
  registry.start(context);
  registry.stop(context);
  assert.equal(stoppedProviders.length, 4);
} finally {
  registry.cancel();
  for (const backup of providerBackups)
    Object.assign(backup.provider, {
      isEnabled: backup.isEnabled,
      start: backup.start,
      stop: backup.stop
    });
}

// A late sync response must never publish into a switched or reused profile.
const requestBeforeRace = account.api;
let releaseResponse, started;
const reached = new Promise((resolve) => {
  started = resolve;
});
account.api = async (scope, path, options) => {
  if (path === "/sync/last_activities") {
    started();
    await new Promise((resolve) => {
      releaseResponse = resolve;
    });
  }
  return requestBeforeRace(scope, path, options);
};
const staleRefresh = tracking.refresh({ force: true, strict: true });
await reached;
await ProfileManager.setActiveProfile("2");
releaseResponse();
await assert.rejects(staleRefresh);
account.api = requestBeforeRace;
await ProfileManager.setActiveProfile("1");

// Large accounts: a pause persists a small sidecar and never rewrites the watched library.
const savedBase = LocalStore.get("mdbListTracking"),
  savedSidecars = LocalStore.get("mdbListTrackingPlayback", {});
const large = {
  ...tracking.getSnapshot(),
  storageRevision: "large-fixture",
  playback: [],
  watched: Array.from({ length: 10000 }, (_, index) => ({
    type: "movie",
    media: { ids: { imdb: `tt${100000 + index}` }, title: `Movie ${index}`, runtime: 90 },
    season: null,
    episode: null,
    updatedAt: Date.parse(now)
  }))
};
LocalStore.set("mdbListTracking", { 1: large });
const libraryBeforePause = localStorage.getItem("mdbListTracking"),
  previousApi = account.api;
account.api = async () => ({
  payload: {
    action: "pause",
    progress: 40,
    movie: { ids: { imdb: "tt100000" } },
    paused_at: later
  },
  headers: new Headers()
});
try {
  await tracking.scrobble(account.scope(), "pause", {
    contentId: "tt100000",
    contentType: "movie",
    progressPercent: 40
  });
  assert.equal(localStorage.getItem("mdbListTracking"), libraryBeforePause);
  assert(localStorage.getItem("mdbListTrackingPlayback").length < 2000);
} finally {
  account.api = previousApi;
  LocalStore.set("mdbListTracking", savedBase);
  LocalStore.set("mdbListTrackingPlayback", savedSidecars);
}

// Active-profile visits, profile slot reuse and root account teardown invalidate captured writes.
const old = account.scope();
await ProfileManager.setActiveProfile("2");
connect("2", "g2");
await ProfileManager.setActiveProfile("1");
assert.throws(() => account.check(old));
const reused = account.scope();
await notifySessionTeardownHandlers();
clearAccountLocalData();
assert.equal(account.connected("1"), false);
assert.equal(LocalStore.get("mdbListTracking"), null);
assert.equal(LocalStore.get("mdbListTrackingPlayback"), null);
connect();
assert.throws(() => account.check(reused)); // Session teardown also protects identical synthetic generations.
connect("2");
LocalStore.set("mdbListTracking", { 2: { generation: "g" } });
clearProfileLocalData("2");
assert.equal(account.connected("2"), false);
assert.equal(LocalStore.get("mdbListTracking")["2"], undefined);
account.api = realApi;
console.log(
  "MDBList tracking parity passed: sync, journal/full fallback, last-good snapshot, receipts, clear/history, IDs, specials, dropped, pagination, settings and account/profile isolation."
);
