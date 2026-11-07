/**
 * Sorted index over the HTML subtitle overlay's cues.
 *
 * The overlay used to filter every cue on every timeupdate and on a 120 ms
 * poll. With a start-sorted index the active cues at a position are found in
 * O(log n + k), and the next cue boundary is known, so the overlay can sleep
 * until something actually changes (issue #1208).
 *
 * Pure module: no DOM or player access. The result of findActiveHtmlSubtitleCues
 * is identical to `cues.filter((cue) => t >= cue.start && t < cue.end)`,
 * including the original array order of the active cues.
 */

export function buildHtmlSubtitleCueIndex(cues) {
  const list = Array.isArray(cues) ? cues : [];
  const order = [];
  for (let index = 0; index < list.length; index += 1) {
    const cue = list[index];
    if (!cue) continue;
    const start = Number(cue.start);
    const end = Number(cue.end);
    // A cue with a non-numeric bound never satisfies both comparisons.
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    order.push(index);
  }
  order.sort((left, right) => Number(list[left].start) - Number(list[right].start) || left - right);
  const starts = new Array(order.length);
  let maxDurationSeconds = 0;
  for (let position = 0; position < order.length; position += 1) {
    const cue = list[order[position]];
    const start = Number(cue.start);
    starts[position] = start;
    const duration = Number(cue.end) - start;
    if (duration > maxDurationSeconds) {
      maxDurationSeconds = duration;
    }
  }
  return { cues: list, order, starts, maxDurationSeconds };
}

/**
 * @returns {{ activeCues: object[], nextBoundarySeconds: number }} The active
 * cues in original order, and the earliest later time at which the active set
 * changes (a cue ending or the next cue starting), or Infinity when none.
 */
export function findActiveHtmlSubtitleCues(index, timeSeconds) {
  const time = Number(timeSeconds);
  if (!index || !Array.isArray(index.order) || !index.order.length || !Number.isFinite(time)) {
    return { activeCues: [], nextBoundarySeconds: Infinity };
  }
  const { cues, order, starts, maxDurationSeconds } = index;
  // First position whose start is after the current time.
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const upper = low;
  let nextBoundarySeconds = upper < starts.length ? starts[upper] : Infinity;
  // Any active cue started within maxDuration of now; walk back only that far.
  const earliestStart = time - maxDurationSeconds;
  const activeIndices = [];
  for (
    let position = upper - 1;
    position >= 0 && starts[position] >= earliestStart;
    position -= 1
  ) {
    const cueIndex = order[position];
    const end = Number(cues[cueIndex].end);
    if (time < end) {
      activeIndices.push(cueIndex);
      if (end < nextBoundarySeconds) {
        nextBoundarySeconds = end;
      }
    }
  }
  activeIndices.sort((left, right) => left - right);
  return {
    activeCues: activeIndices.map((cueIndex) => cues[cueIndex]),
    nextBoundarySeconds
  };
}
