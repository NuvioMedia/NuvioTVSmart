function normalizeIdentityValue(value) {
  return String(value ?? "").trim();
}

export function shouldApplyLateContinueWatchingFocus({
  background = false,
  initialContinueWatchingPending = false,
  hasUserInteracted = false,
  suppressInitialFocus = false,
  hasAppliedInitialFocus = false
} = {}) {
  return Boolean(
    (!background || initialContinueWatchingPending) &&
    !hasUserInteracted &&
    !suppressInitialFocus &&
    !hasAppliedInitialFocus
  );
}

export function getHomeFocusIdentity(node) {
  const dataset = node?.dataset || {};
  const itemId = normalizeIdentityValue(dataset.itemId);
  if (!itemId) {
    return null;
  }
  // Android keys a Continue Watching card by its show (cw_<contentId>), so when it
  // moves on to another episode it stays the same row item and keeps the focus.
  if (dataset.action === "resumeProgress") {
    return { itemId, itemType: normalizeIdentityValue(dataset.itemType) };
  }
  return {
    itemId,
    itemType: normalizeIdentityValue(dataset.itemType),
    videoId: normalizeIdentityValue(dataset.videoId),
    season: normalizeIdentityValue(dataset.season),
    episode: normalizeIdentityValue(dataset.episode)
  };
}

export function findHomeFocusIdentityMatch(nodes = [], identity = null) {
  if (!identity?.itemId || !Array.isArray(nodes)) {
    return null;
  }
  return (
    nodes.find((node) => {
      const candidate = getHomeFocusIdentity(node);
      if (!candidate || candidate.itemId !== identity.itemId) {
        return false;
      }
      return ["itemType", "videoId", "season", "episode"].every(
        (field) => !identity[field] || candidate[field] === identity[field]
      );
    }) || null
  );
}
