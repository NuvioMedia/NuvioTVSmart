import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods25() {
  const {
    metaRepository,
    CW_META_TIMEOUT_MS,
    findAbsoluteEpisodeAnchorIndex,
    withTimeout,
    getContinueWatchingMetaTimeout,
    isSeriesTypeForContinueWatching,
    isCompletedForContinueWatching,
    shouldTreatAsInProgressForContinueWatching,
    episodeKey,
    normalizeEpisodeEntries,
    mapAbsoluteWatchedEpisodeKeys,
    mapAbsoluteEpisodeProgress,
    shouldShowNextUpEpisodeForContinueWatching
  } = internals;

  return {
    buildEpisodeProgressIndex(allProgress = [], contentId = "") {
      const targetContentId = String(contentId || "").trim();
      const byEpisode = new Map();
      if (!targetContentId) {
        return byEpisode;
      }

      (Array.isArray(allProgress) ? allProgress : []).forEach((entry) => {
        if (String(entry?.contentId || "").trim() !== targetContentId) {
          return;
        }
        const season = Number(entry?.season || 0);
        const episode = Number(entry?.episode || 0);
        if (season <= 0 || episode <= 0) {
          return;
        }
        const key = episodeKey(season, episode);
        const existing = byEpisode.get(key);
        if (!existing || Number(entry?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
          byEpisode.set(key, entry);
        }
      });

      return byEpisode;
    },
    async fetchMetaForContinueWatching(contentType, contentId, timeoutMs = CW_META_TIMEOUT_MS, alternateContentIds = []) {
      const effectiveTimeoutMs = getContinueWatchingMetaTimeout(timeoutMs);
      const normalizedType = String(contentType || "")
        .trim()
        .toLowerCase();
      const typeCandidates = [];
      if (normalizedType) {
        typeCandidates.push(normalizedType);
      }
      if (isSeriesTypeForContinueWatching(normalizedType)) {
        typeCandidates.push("series", "tv");
      } else {
        typeCandidates.push("movie");
      }

      const rawContentId = String(contentId || "").trim();
      const idCandidates = [];
      [...(Array.isArray(alternateContentIds) ? alternateContentIds : [alternateContentIds]), rawContentId]
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean)
        .forEach((candidate) => {
          idCandidates.push(candidate);
          if (candidate.includes(":")) {
            idCandidates.push(candidate.split(":").pop());
          }
        });

      const seenTypes = new Set();
      const requests = [];
      for (const type of typeCandidates) {
        const normalizedCandidate = String(type || "")
          .trim()
          .toLowerCase();
        if (!normalizedCandidate || seenTypes.has(normalizedCandidate)) {
          continue;
        }
        seenTypes.add(normalizedCandidate);
        const seenIds = new Set();
        for (const candidateId of idCandidates) {
          const normalizedId = String(candidateId || "").trim();
          if (!normalizedId || seenIds.has(normalizedId)) {
            continue;
          }
          seenIds.add(normalizedId);
          requests.push(
            withTimeout(metaRepository.getMetaFromAllAddons(normalizedCandidate, normalizedId), effectiveTimeoutMs, {
              status: "error",
              message: "timeout"
            }).catch(() => ({ status: "error" }))
          );
        }
      }

      const results = await Promise.all(requests);
      const match = results.find((result) => result?.status === "success" && result?.data);
      if (match) {
        return match.data;
      }

      return null;
    },
    resolveNextUpEpisode(meta = {}, completedProgress = {}, allProgress = [], watchedEpisodeKeys = new Set(), options = {}) {
      const episodes = normalizeEpisodeEntries(meta?.videos || []);
      if (!episodes.length) {
        return null;
      }
      const showUnairedNextUp = options?.showUnairedNextUp !== false;

      let progressByEpisode = this.buildEpisodeProgressIndex(allProgress, completedProgress?.contentId);
      const isSimklAbsoluteEpisode = completedProgress?.isSimklAbsoluteEpisode === true;
      const resolvedWatchedEpisodeKeys = isSimklAbsoluteEpisode
        ? mapAbsoluteWatchedEpisodeKeys(episodes, watchedEpisodeKeys)
        : watchedEpisodeKeys;
      if (isSimklAbsoluteEpisode) {
        progressByEpisode = mapAbsoluteEpisodeProgress(episodes, progressByEpisode);
      }
      const anchorVideoId = String(completedProgress?.videoId || "").trim();
      let anchorIndex = anchorVideoId ? episodes.findIndex((entry) => String(entry?.id || "") === anchorVideoId) : -1;

      const anchorSeason = Number(completedProgress?.season || 0);
      const anchorEpisode = Number(completedProgress?.episode || 0);
      if (anchorIndex < 0 && anchorSeason > 0 && anchorEpisode > 0) {
        anchorIndex = episodes.findIndex(
          (entry) => Number(entry.season || 0) === anchorSeason && Number(entry.episode || 0) === anchorEpisode
        );
      }

      if (anchorIndex < 0 && isSimklAbsoluteEpisode) {
        anchorIndex = findAbsoluteEpisodeAnchorIndex(episodes, {
          season: anchorSeason,
          episode: anchorEpisode
        });
      }

      if (anchorIndex < 0) {
        let latestCompleted = null;
        progressByEpisode.forEach((entry) => {
          if (!isCompletedForContinueWatching(entry)) {
            return;
          }
          if (!latestCompleted || Number(entry.updatedAt || 0) > Number(latestCompleted.updatedAt || 0)) {
            latestCompleted = entry;
          }
        });
        if (latestCompleted) {
          anchorIndex = episodes.findIndex(
            (entry) =>
              Number(entry.season || 0) === Number(latestCompleted.season || 0) &&
              Number(entry.episode || 0) === Number(latestCompleted.episode || 0)
          );
        }
      }

      if (anchorIndex < 0) {
        return null;
      }

      for (let index = anchorIndex + 1; index < episodes.length; index += 1) {
        const candidate = episodes[index];
        if (watchProgressRepository.isHiddenForContinueWatching?.(completedProgress.contentId, candidate.season)) continue;
        const key = episodeKey(candidate.season, candidate.episode);
        const candidateProgress = progressByEpisode.get(key);
        if (resolvedWatchedEpisodeKeys?.has?.(key)) {
          continue;
        }
        if (candidateProgress && isCompletedForContinueWatching(candidateProgress)) {
          continue;
        }
        if (candidateProgress && shouldTreatAsInProgressForContinueWatching(candidateProgress)) {
          return null;
        }
        if (!shouldShowNextUpEpisodeForContinueWatching(candidate, episodes[anchorIndex]?.season, showUnairedNextUp)) {
          continue;
        }
        return candidate;
      }

      return null;
    }
  };
}
