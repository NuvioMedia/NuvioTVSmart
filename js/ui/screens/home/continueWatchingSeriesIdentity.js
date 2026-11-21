// Android stores a series episode under the series id plus its episode id.
// Progress saved by the old resume-row card carries the episode id instead, so
// lookups like Next Up and the in-progress dedupe must use the series identity.
const seriesTypes = new Set(["series", "tv", "anime"]);

const isSeriesItem = (item) =>
  seriesTypes.has(
    String(item?.contentType || item?.type || "")
      .trim()
      .toLowerCase()
  );

export function isServerContentId(value) {
  return /^server:[^:]+:[^:]+$/.test(String(value || "").trim());
}

export function resolveContinueWatchingSeriesContentId(contentId, meta = {}) {
  const stored = String(contentId || "").trim();
  const resolved = String(meta?.id || "").trim();
  if (!stored || !resolved || stored === resolved) {
    return stored;
  }
  if (!isServerContentId(stored) || !isServerContentId(resolved)) {
    return stored;
  }
  return resolved;
}

export function dedupeContinueWatchingInProgress(items = []) {
  const byContentId = new Map();
  const others = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (!isSeriesItem(item) || !contentId) {
      others.push(item);
      return;
    }
    const existing = byContentId.get(contentId);
    const itemTime = Number(item?.updatedAt || item?.watchedAt || item?.sortTimestamp || 0);
    const existingTime = Number(
      existing?.updatedAt || existing?.watchedAt || existing?.sortTimestamp || 0
    );
    if (!existing || itemTime > existingTime) {
      byContentId.set(contentId, item);
    }
  });
  return [...others, ...byContentId.values()];
}
