/**
 * Web Worker entry for subtitle AutoSync.
 *
 * The alignment in subtitleAutoSyncEngine.js scans about eight frame-rate
 * scales by ~720 coarse offsets of bitset intersections per reference track,
 * and the thorough mode repeats that per track. On Tizen 4/5 that froze the
 * player for hundreds of milliseconds while a subtitle was being applied
 * (issue #1208). The worker runs the same pure engine; the player keeps the
 * main-thread path as a fallback (see subtitleAutoSyncWorkerClient.js).
 *
 * Built by scripts/build.mjs to assets/runtime/subtitle-autosync-worker.js.
 */
import { buildAutoSyncReferenceTimeline, findAutoSyncTimeline } from "./subtitleAutoSyncEngine.js";

export function alignSubtitleAutoSync({ referenceCues, targetCues } = {}) {
  return findAutoSyncTimeline(buildAutoSyncReferenceTimeline(referenceCues), targetCues);
}

export function handleSubtitleAutoSyncWorkerMessage(data, post) {
  const id = data?.id;
  try {
    post({ id, ok: true, result: alignSubtitleAutoSync(data || {}) });
  } catch (error) {
    post({ id, ok: false, error: String(error?.message || error || "Subtitle AutoSync failed") });
  }
}

if (
  typeof self !== "undefined" &&
  typeof self.postMessage === "function" &&
  typeof document === "undefined"
) {
  self.onmessage = (event) => {
    handleSubtitleAutoSyncWorkerMessage(event?.data, (message) => self.postMessage(message));
  };
}
