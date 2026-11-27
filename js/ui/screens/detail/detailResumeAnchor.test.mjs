import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  isWatchProgressCompleted,
  isWatchProgressInProgress
} from "../../../domain/model/watchProgress.js";
import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [methods04Source, methods05Source] = await Promise.all([
  readFile(
    new URL("./metaDetailsScreenMethods-04-fetch-more-like-this.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./metaDetailsScreenMethods-05-resolve-initial-selected-season.js", import.meta.url),
    "utf8"
  )
]);

const layout = { nextUpFromFurthestEpisode: true };
const internals = {
  LayoutPreferences: {
    get: () => ({ nextUpFromFurthestEpisode: layout.nextUpFromFurthestEpisode })
  },
  watchedItemsShareIdentity,
  buildDetailContentReference: (contentId, meta) => ({ ...meta, contentId, id: contentId }),
  detailProgressFraction: (progress) => {
    const position = Number(progress?.positionMs || 0);
    const duration = Number(progress?.durationMs || 0);
    if (position > 0 && duration > 0) return Math.min(1, position / duration);
    return Number(progress?.progressPercent || 0) / 100;
  },
  isDetailProgressCompleted: (progress) => isWatchProgressCompleted(progress),
  isWatchProgressInProgress,
  isSeriesDetailMeta: () => true,
  detailShuffleSettings: () => ({ enabled: false })
};
const context = vm.createContext({
  internals,
  detailShuffleSettings: () => ({ enabled: false }),
  selectDetailShuffle: () => null,
  detailShuffleResume: () => null,
  EpisodeShuffleStore: { get: () => ({ enabled: false }) },
  selectShuffleEpisode: () => null,
  console
});
vm.runInContext(`${stripModule(methods04Source)}\n${stripModule(methods05Source)}`, context);
const screen = {
  ...context.createMetaDetailsScreenMethods04(),
  ...context.createMetaDetailsScreenMethods05(),
  params: { itemId: "tt0411008", itemType: "series" },
  meta: { id: "tt0411008", type: "series" },
  episodes: [
    { id: "tt0411008:1:6", season: 1, episode: 6 },
    { id: "tt0411008:1:7", season: 1, episode: 7 },
    { id: "tt0411008:1:24", season: 1, episode: 24 },
    { id: "tt0411008:2:1", season: 2, episode: 1 },
    { id: "tt0411008:2:2", season: 2, episode: 2 },
    { id: "tt0411008:2:3", season: 2, episode: 3 }
  ]
};
const progress = (episode, positionMs, durationMs, updatedAt) => ({
  contentId: "tt0411008",
  videoId: `tt0411008:${episode[0]}:${episode[1]}`,
  contentType: "series",
  season: episode[0],
  episode: episode[1],
  positionMs,
  durationMs,
  updatedAt
});
const completed = (episode, updatedAt) => progress(episode, 1000, 1000, updatedAt);
// Issue #1740: S1E6 is a stale 50 s leftover from August, while every later
// episode up to S2E2 was finished in November.
const stalePartial = progress([1, 6], 49839, 2600609, Date.parse("2025-08-18"));
const allProgress = [
  progress([1, 1], 217030, 2540544, Date.parse("2025-07-10")),
  stalePartial,
  completed([1, 7], Date.parse("2025-08-19")),
  completed([1, 24], Date.parse("2025-11-20")),
  completed([2, 1], Date.parse("2025-11-25")),
  completed([2, 2], Date.parse("2025-11-26"))
];

test("detail anchors on the latest finished episode instead of a stale partial one", () => {
  screen.watchedEpisodeKeys = new Set(
    allProgress.filter(isWatchProgressCompleted).map((entry) => `${entry.season}:${entry.episode}`)
  );
  const anchor = screen.getLatestSeriesProgress(stalePartial, allProgress);
  assert.equal(`${anchor.season}:${anchor.episode}`, "2:2");
  assert.equal(isWatchProgressInProgress(anchor), false, "a finished anchor must not offer Resume");
  assert.equal(screen.computeNextEpisodeToWatch(anchor).id, "tt0411008:2:3");
  const seasonScreen = { ...screen, selectedSeason: 0, hasManualSeasonSelection: false };
  assert.equal(seasonScreen.resolveInitialSelectedSeason(anchor, allProgress), 2);
});

test("detail keeps resuming a partial episode that is newer than the finished ones", () => {
  const newerPartial = progress([1, 6], 49839, 2600609, Date.parse("2025-12-01"));
  screen.watchedEpisodeKeys = new Set(
    allProgress.filter(isWatchProgressCompleted).map((entry) => `${entry.season}:${entry.episode}`)
  );
  const anchor = screen.getLatestSeriesProgress(newerPartial, allProgress);
  assert.equal(`${anchor.season}:${anchor.episode}`, "1:6");
  assert.equal(isWatchProgressInProgress(anchor), true);
  assert.equal(screen.computeNextEpisodeToWatch(anchor).id, "tt0411008:1:6");
});

test("detail follows the Up Next From Furthest Episode preference", () => {
  const outOfOrder = [...allProgress, completed([1, 7], Date.parse("2025-11-27"))];
  screen.watchedEpisodeKeys = new Set(
    outOfOrder.filter(isWatchProgressCompleted).map((entry) => `${entry.season}:${entry.episode}`)
  );
  layout.nextUpFromFurthestEpisode = true;
  assert.equal(
    `${screen.getLatestSeriesProgress(null, outOfOrder).season}:${screen.getLatestSeriesProgress(null, outOfOrder).episode}`,
    "2:2"
  );
  layout.nextUpFromFurthestEpisode = false;
  assert.equal(
    `${screen.getLatestSeriesProgress(null, outOfOrder).season}:${screen.getLatestSeriesProgress(null, outOfOrder).episode}`,
    "1:7"
  );
  layout.nextUpFromFurthestEpisode = true;
});
