/**
 * Automatic subtitle synchronization (Android TV AutoSync V2 parity).
 *
 * The engine compares only cue timing: an add-on subtitle's cue activity is
 * correlated with the embedded subtitle index of the video, first as a single
 * constant delay, then as a whole-film affine transform (frame-rate drift).
 * A match is applied only when it is confident and unambiguous, so a wrong
 * subtitle is never retimed.
 *
 * Pure module: no DOM, player or network access.
 */

export const AUTO_SYNC_MIN_CUES = 4;
export const AUTO_SYNC_TOLERANCE_OPTIONS_MS = [0, 100, 200, 300, 400, 500];
const MIN_SCALE = 0.94;
const MAX_SCALE = 1.06;
const SCALE_DEDUP = 0.00035;
const COARSE_BIN_MS = 500;
const FINE_BIN_MS = 100;
const MAX_OFFSET_MS = 180000;
const FINE_RADIUS_MS = 750;
const TIE_MAX_SPREAD_MS = 3000;
const TIE_SCORE_EPSILON = 0.002;
const START_AGREEMENT_TOLERANCE_MS = 200;
const MAX_CUE_DURATION_MS = 20000;
const MAX_TIMELINE_MS = 8 * 60 * 60 * 1000;
const PARTIAL_TARGET_SPAN_RATIO = 0.75;
const MIN_ACTIVITY_SCORE = 0.55;
const MIN_ACTIVITY_MARGIN = 0.02;
const SMALL_SAMPLE_CUES = 8;
const SMALL_SAMPLE_ACTIVITY_SCORE = 0.72;
const SMALL_SAMPLE_ACTIVITY_MARGIN = 0.03;
const DISTINCT_OFFSET_MS = 3000;
const DISTINCT_TRANSFORM_MS = 3000;

const DELAY_ONLY_MIN_SCORE = 0.78;
const DELAY_ONLY_MIN_MARGIN = 0.02;
const DELAY_ONLY_MIN_SEGMENT_SCORE = 0.68;
const DELAY_ONLY_SEGMENT_SEARCH_RADIUS_MS = 1000;
const DELAY_ONLY_MAX_SEGMENT_OFFSET_DELTA_MS = 500;

const MATCH_START_TOLERANCE_MS = 1250;
const MATCH_END_TOLERANCE_MS = 2000;
const MIN_TARGET_COVERAGE = 0.9;
const MIN_REFERENCE_COVERAGE = 0.45;
const MIN_MATCHED_TARGET_CUES = 20;
const MIN_SEGMENT_COVERAGE = 0.72;
const MIN_SEGMENT_MATCHES = 4;
const MAX_AVERAGE_MATCH_COST = 1.1;
const DELAY_ONLY_MAX_AVERAGE_MATCH_COST = 1.35;

const MATROSKA_FRAME_RATE_SCALES = [
  1,
  25 / 23.976,
  23.976 / 25,
  25 / 24,
  24 / 25,
  24 / 23.976,
  23.976 / 24
];

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function popcount32(value) {
  let number = value >>> 0;
  number -= (number >>> 1) & 0x55555555;
  number = (number & 0x33333333) + ((number >>> 2) & 0x33333333);
  return (((number + (number >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function activityRangeMask(firstBit, lastBit) {
  const lower = firstBit === 0 ? 0xffffffff : (0xffffffff << firstBit) >>> 0;
  const upper = lastBit === 31 ? 0xffffffff : 0xffffffff >>> (31 - lastBit);
  return (lower & upper) >>> 0;
}

function packedActivityWindow(packed, startBit) {
  const wordIndex = startBit >>> 5;
  const bitOffset = startBit & 31;
  const low = wordIndex >= 0 && wordIndex < packed.length ? packed[wordIndex] >>> 0 : 0;
  if (bitOffset === 0) {
    return low;
  }
  const high = wordIndex + 1 < packed.length ? packed[wordIndex + 1] >>> 0 : 0;
  return ((low >>> bitOffset) | (high << (32 - bitOffset))) >>> 0;
}

/**
 * Normalizes player cues (seconds) or AutoSync cues (milliseconds) to a sorted,
 * deduplicated millisecond timeline.
 */
export function normalizeAutoSyncCues(cues) {
  const normalized = [];
  (Array.isArray(cues) ? cues : []).forEach((cue) => {
    if (!cue) {
      return;
    }
    const rawStart = Number.isFinite(Number(cue.startTimeMs))
      ? Number(cue.startTimeMs)
      : Number(cue.start) * 1000;
    const rawEnd = Number.isFinite(Number(cue.endTimeMs))
      ? Number(cue.endTimeMs)
      : Number(cue.end) * 1000;
    if (!Number.isFinite(rawStart)) {
      return;
    }
    const startTimeMs = Math.max(0, Math.round(rawStart));
    const endTimeMs = Math.max(
      startTimeMs + 1,
      Number.isFinite(rawEnd) ? Math.round(rawEnd) : startTimeMs + 2000
    );
    normalized.push({
      startTimeMs,
      endTimeMs,
      text: String(cue.text || "")
    });
  });
  normalized.sort(
    (left, right) => left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs
  );
  const unique = [];
  let previousKey = "";
  normalized.forEach((cue) => {
    const key = `${cue.startTimeMs}:${cue.endTimeMs}:${cue.text}`;
    if (key === previousKey) {
      return;
    }
    previousKey = key;
    unique.push(cue);
  });
  return unique;
}

/**
 * Builds the embedded reference timeline from the container cue index. Missing
 * durations are estimated from the next cue, exactly like Android's indexed
 * Matroska timeline loader.
 */
export function buildAutoSyncReferenceTimeline(cues) {
  const pending = [];
  (Array.isArray(cues) ? cues : []).forEach((cue) => {
    const startMs = Math.round(toFiniteNumber(cue?.startMs));
    if (!Number.isFinite(startMs)) {
      return;
    }
    const durationMs = Math.round(toFiniteNumber(cue?.durationMs));
    pending.push({ startMs: Math.max(0, startMs), durationMs });
  });
  pending.sort((left, right) => left.startMs - right.startMs || left.durationMs - right.durationMs);
  const unique = [];
  pending.forEach((cue) => {
    const previous = unique[unique.length - 1];
    if (previous && previous.startMs === cue.startMs && previous.durationMs === cue.durationMs) {
      return;
    }
    unique.push(cue);
  });
  return unique.map((cue, index) => {
    const nextStartMs = unique[index + 1]?.startMs;
    const estimatedDurationMs =
      Number.isFinite(nextStartMs) && nextStartMs > cue.startMs
        ? clamp(nextStartMs - cue.startMs, 1, 4000)
        : 2000;
    const durationMs = cue.durationMs > 0 ? cue.durationMs : estimatedDurationMs;
    return {
      startTimeMs: cue.startMs,
      endTimeMs: cue.startMs + Math.max(1, durationMs),
      text: ""
    };
  });
}

function buildActivityTimeline(cues, scale, binMs) {
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE || !binMs) {
    return null;
  }
  const scaled = [];
  let maxEndMs = 0;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const safeStart = Math.max(0, cue.startTimeMs);
    const safeEnd = clamp(cue.endTimeMs, safeStart + 1, safeStart + MAX_CUE_DURATION_MS);
    const start = Math.max(0, Math.round(safeStart * scale));
    const end = Math.max(start + 1, Math.round(safeEnd * scale));
    if (end > MAX_TIMELINE_MS) {
      return null;
    }
    scaled.push({ start, end });
    maxEndMs = Math.max(maxEndMs, end);
  }
  if (!scaled.length) {
    return null;
  }

  const binCount = Math.max(1, Math.ceil((maxEndMs + 1) / binMs));
  const packed = new Uint32Array((binCount + 31) >>> 5);
  for (let index = 0; index < scaled.length; index += 1) {
    const interval = scaled[index];
    const first = Math.floor(interval.start / binMs);
    const lastExclusive = Math.min(binCount, Math.ceil(interval.end / binMs));
    for (let bin = first; bin < lastExclusive; bin += 1) {
      packed[bin >>> 5] |= 1 << (bin & 31);
    }
  }

  const prefix = new Int32Array(binCount + 1);
  let activeCount = 0;
  let firstActive = -1;
  let lastActive = -1;
  for (let index = 0; index < binCount; index += 1) {
    const active = (packed[index >>> 5] & (1 << (index & 31))) !== 0;
    prefix[index + 1] = prefix[index] + (active ? 1 : 0);
    if (active) {
      activeCount += 1;
      if (firstActive < 0) {
        firstActive = index;
      }
      lastActive = index;
    }
  }
  if (!activeCount) {
    return null;
  }
  return {
    binMs,
    binCount,
    packed,
    prefix,
    activeCount,
    firstActive,
    lastActive
  };
}

function countShiftedActivityIntersection(reference, target, offsetBins, sourceStart, sourceEnd) {
  if (sourceEnd < sourceStart) {
    return 0;
  }
  const firstWord = sourceStart >>> 5;
  const lastWord = sourceEnd >>> 5;
  let intersection = 0;
  for (let wordIndex = firstWord; wordIndex <= lastWord; wordIndex += 1) {
    const alignedReference = packedActivityWindow(reference.packed, (wordIndex << 5) + offsetBins);
    const firstBit = wordIndex === firstWord ? sourceStart & 31 : 0;
    const lastBit = wordIndex === lastWord ? sourceEnd & 31 : 31;
    const mask = activityRangeMask(firstBit, lastBit);
    intersection += popcount32((target.packed[wordIndex] & alignedReference & mask) >>> 0);
  }
  return intersection;
}

function scoreActivityOffset(reference, target, offsetBins) {
  const sourceStart = Math.max(0, -offsetBins);
  const sourceEnd = Math.min(target.binCount - 1, reference.binCount - 1 - offsetBins);
  if (sourceEnd < sourceStart) {
    return null;
  }
  const visibleTarget = target.prefix[sourceEnd + 1] - target.prefix[sourceStart];
  if (visibleTarget <= 0) {
    return null;
  }
  const intersection = countShiftedActivityIntersection(
    reference,
    target,
    offsetBins,
    sourceStart,
    sourceEnd
  );
  const referenceWindowStart = Math.max(0, target.firstActive + offsetBins);
  const referenceWindowEnd = Math.min(reference.binCount - 1, target.lastActive + offsetBins);
  if (referenceWindowEnd < referenceWindowStart) {
    return null;
  }
  const referenceInWindow =
    reference.prefix[referenceWindowEnd + 1] - reference.prefix[referenceWindowStart];
  if (referenceInWindow <= 0) {
    return null;
  }
  const precision = intersection / visibleTarget;
  const recall = intersection / referenceInWindow;
  const visibility = clamp(visibleTarget / target.activeCount, 0, 1);
  return (precision * 0.72 + recall * 0.28) * (0.85 + 0.15 * visibility);
}

function scoreActivityOffsetSegment(reference, target, offsetBins, segment) {
  const activeSpan = target.lastActive - target.firstActive + 1;
  if (activeSpan <= 0) {
    return null;
  }
  const segmentStart = target.firstActive + Math.floor((activeSpan * segment) / 3);
  const segmentEnd =
    segment === 2
      ? target.lastActive
      : target.firstActive + Math.floor((activeSpan * (segment + 1)) / 3) - 1;
  if (segmentEnd < segmentStart) {
    return null;
  }
  const visibleTarget = target.prefix[segmentEnd + 1] - target.prefix[segmentStart];
  if (visibleTarget <= 0) {
    return null;
  }
  const intersection = countShiftedActivityIntersection(
    reference,
    target,
    offsetBins,
    segmentStart,
    segmentEnd
  );
  const referenceWindowStart = Math.max(0, segmentStart + offsetBins);
  const referenceWindowEnd = Math.min(reference.binCount - 1, segmentEnd + offsetBins);
  if (referenceWindowEnd < referenceWindowStart) {
    return null;
  }
  const referenceInWindow =
    reference.prefix[referenceWindowEnd + 1] - reference.prefix[referenceWindowStart];
  if (referenceInWindow <= 0) {
    return null;
  }
  const precision = intersection / visibleTarget;
  const recall = intersection / referenceInWindow;
  return precision * 0.72 + recall * 0.28;
}

function targetActivityCoverageAtOffsetSegment(reference, target, offsetBins, segment) {
  const activeSpan = target.lastActive - target.firstActive + 1;
  if (activeSpan <= 0) {
    return null;
  }
  const segmentStart = target.firstActive + Math.floor((activeSpan * segment) / 3);
  const segmentEnd =
    segment === 2
      ? target.lastActive
      : target.firstActive + Math.floor((activeSpan * (segment + 1)) / 3) - 1;
  if (segmentEnd < segmentStart) {
    return null;
  }
  const visibleTarget = target.prefix[segmentEnd + 1] - target.prefix[segmentStart];
  if (visibleTarget <= 0) {
    return null;
  }
  return (
    countShiftedActivityIntersection(reference, target, offsetBins, segmentStart, segmentEnd) /
    visibleTarget
  );
}

function activityScaleCandidates(reference, target) {
  const candidates = MATROSKA_FRAME_RATE_SCALES.slice();
  const referenceSpan = reference[reference.length - 1].startTimeMs - reference[0].startTimeMs;
  const targetSpan = target[target.length - 1].startTimeMs - target[0].startTimeMs;
  if (referenceSpan > 0 && targetSpan > 0) {
    const spanRatio = referenceSpan / targetSpan;
    if (spanRatio >= MIN_SCALE && spanRatio <= MAX_SCALE) {
      candidates.push(spanRatio);
    }
  }
  const unique = [];
  candidates
    .filter((scale) => Number.isFinite(scale) && scale >= MIN_SCALE && scale <= MAX_SCALE)
    .sort((left, right) => left - right)
    .forEach((scale) => {
      if (unique.every((candidate) => Math.abs(candidate - scale) >= SCALE_DEDUP)) {
        unique.push(scale);
      }
    });
  return unique;
}

function coarseOffsetRange(reference, target) {
  const baseBins = Math.floor(MAX_OFFSET_MS / COARSE_BIN_MS);
  const referenceSpan = reference.lastActive - reference.firstActive;
  const targetSpan = target.lastActive - target.firstActive;
  if (targetSpan >= referenceSpan * PARTIAL_TARGET_SPAN_RATIO) {
    return { first: -baseBins, last: baseBins };
  }
  return {
    first: Math.min(-baseBins, reference.firstActive - target.firstActive - baseBins),
    last: Math.max(baseBins, reference.lastActive - target.lastActive + baseBins)
  };
}

function coarseTieRun(candidates, best) {
  const scoresByIntercept = new Map();
  candidates.forEach((candidate) => {
    if (candidate.scale === best.scale) {
      scoresByIntercept.set(candidate.interceptMs, candidate.score);
    }
  });
  const ties = (interceptMs) => {
    if (Math.abs(interceptMs - best.interceptMs) > TIE_MAX_SPREAD_MS) {
      return false;
    }
    const score = scoresByIntercept.get(interceptMs);
    return score != null && score >= best.score - TIE_SCORE_EPSILON;
  };
  let start = best.interceptMs;
  while (ties(start - COARSE_BIN_MS)) {
    start -= COARSE_BIN_MS;
  }
  let end = best.interceptMs;
  while (ties(end + COARSE_BIN_MS)) {
    end += COARSE_BIN_MS;
  }
  return { start, end };
}

function startAgreement(referenceStarts, targetStarts, scale, interceptMs) {
  if (!referenceStarts.length || !targetStarts.length) {
    return 0;
  }
  let agreement = 0;
  for (let index = 0; index < targetStarts.length; index += 1) {
    const mapped = Math.round(targetStarts[index] * scale) + interceptMs;
    const position = lowerBound(referenceStarts, mapped);
    const nextDistance =
      position < referenceStarts.length ? Math.abs(referenceStarts[position] - mapped) : Infinity;
    const previousDistance =
      position > 0 ? Math.abs(referenceStarts[position - 1] - mapped) : Infinity;
    const nearest = Math.min(nextDistance, previousDistance);
    if (nearest <= START_AGREEMENT_TOLERANCE_MS) {
      agreement += 1 - nearest / (START_AGREEMENT_TOLERANCE_MS + 1);
    }
  }
  return agreement / targetStarts.length;
}

function fineActivitySearch({
  referenceFine,
  targetFine,
  scale,
  coarseInterceptMs,
  tieStartMs,
  tieEndMs,
  referenceStarts,
  targetStarts
}) {
  const fromMs = Math.max(tieStartMs - FINE_RADIUS_MS, coarseInterceptMs - TIE_MAX_SPREAD_MS);
  const toMs = Math.min(tieEndMs + FINE_RADIUS_MS, coarseInterceptMs + TIE_MAX_SPREAD_MS);
  const scored = [];
  for (let offsetMs = fromMs; offsetMs <= toMs; offsetMs += FINE_BIN_MS) {
    const offsetBins = Math.round(offsetMs / FINE_BIN_MS);
    const score = scoreActivityOffset(referenceFine, targetFine, offsetBins);
    if (score != null) {
      scored.push({
        scale,
        interceptMs: offsetBins * FINE_BIN_MS,
        score
      });
    }
  }
  if (!scored.length) {
    return null;
  }
  let best = scored[0];
  for (let index = 1; index < scored.length; index += 1) {
    if (scored[index].score > best.score) {
      best = scored[index];
    }
  }
  const tied = scored.filter((candidate) => candidate.score >= best.score - TIE_SCORE_EPSILON);
  if (tied.length < 2) {
    return best;
  }
  let chosen = best;
  let chosenAgreement = startAgreement(referenceStarts, targetStarts, scale, best.interceptMs);
  tied.forEach((candidate) => {
    if (candidate === best) {
      return;
    }
    const agreement = startAgreement(referenceStarts, targetStarts, scale, candidate.interceptMs);
    if (agreement > chosenAgreement) {
      chosen = candidate;
      chosenAgreement = agreement;
    }
  });
  return chosen;
}

function unitCandidates(referenceCoarse, targetCoarse) {
  const range = coarseOffsetRange(referenceCoarse, targetCoarse);
  const candidates = [];
  for (let offsetBins = range.first; offsetBins <= range.last; offsetBins += 1) {
    const score = scoreActivityOffset(referenceCoarse, targetCoarse, offsetBins);
    if (score != null) {
      candidates.push({
        scale: 1,
        interceptMs: offsetBins * COARSE_BIN_MS,
        score
      });
    }
  }
  return candidates;
}

function findDelayOnlyAlignment(reference, target, targetSize, allowAmbiguousMargin) {
  const referenceActivity = buildActivityTimeline(reference, 1, COARSE_BIN_MS);
  const targetActivity = buildActivityTimeline(target, 1, COARSE_BIN_MS);
  const referenceFine = buildActivityTimeline(reference, 1, FINE_BIN_MS);
  const targetFine = buildActivityTimeline(target, 1, FINE_BIN_MS);
  if (!referenceActivity || !targetActivity || !referenceFine || !targetFine) {
    return null;
  }
  const candidates = unitCandidates(referenceActivity, targetActivity);
  if (!candidates.length) {
    return null;
  }
  let coarse = candidates[0];
  candidates.forEach((candidate) => {
    if (candidate.score > coarse.score) {
      coarse = candidate;
    }
  });
  const secondDistinct = candidates
    .filter(
      (candidate) => Math.abs(candidate.interceptMs - coarse.interceptMs) >= DISTINCT_OFFSET_MS
    )
    .reduce((best, candidate) => (!best || candidate.score > best.score ? candidate : best), null);
  const margin = coarse.score - (secondDistinct?.score || 0);
  if (!allowAmbiguousMargin && margin < DELAY_ONLY_MIN_MARGIN) {
    return null;
  }

  const tie = coarseTieRun(candidates, coarse);
  const referenceStarts = reference.map((cue) => cue.startTimeMs);
  const targetStarts = target.map((cue) => cue.startTimeMs);
  const best =
    fineActivitySearch({
      referenceFine,
      targetFine,
      scale: 1,
      coarseInterceptMs: coarse.interceptMs,
      tieStartMs: tie.start,
      tieEndMs: tie.end,
      referenceStarts,
      targetStarts
    }) || coarse;
  if (best.score < DELAY_ONLY_MIN_SCORE) {
    return null;
  }

  const globalOffsetBins = Math.round(best.interceptMs / FINE_BIN_MS);
  const localRadiusBins = Math.round(DELAY_ONLY_SEGMENT_SEARCH_RADIUS_MS / FINE_BIN_MS);
  const maxDeltaBins = Math.round(DELAY_ONLY_MAX_SEGMENT_OFFSET_DELTA_MS / FINE_BIN_MS);
  let availableSegments = 0;
  let passedSegments = 0;
  for (let segment = 0; segment <= 2; segment += 1) {
    if (allowAmbiguousMargin) {
      const coverage = targetActivityCoverageAtOffsetSegment(
        referenceFine,
        targetFine,
        globalOffsetBins,
        segment
      );
      if (coverage == null) {
        continue;
      }
      availableSegments += 1;
      if (coverage >= DELAY_ONLY_MIN_SEGMENT_SCORE) {
        passedSegments += 1;
      }
      continue;
    }

    let segmentBestScore = -Infinity;
    let segmentBestOffsetBins = globalOffsetBins;
    let closestDistance = Infinity;
    for (let delta = -localRadiusBins; delta <= localRadiusBins; delta += 1) {
      const score = scoreActivityOffsetSegment(
        referenceFine,
        targetFine,
        globalOffsetBins + delta,
        segment
      );
      if (score == null) {
        continue;
      }
      if (score > segmentBestScore) {
        segmentBestScore = score;
      }
    }
    if (segmentBestScore === -Infinity) {
      continue;
    }
    for (let delta = -localRadiusBins; delta <= localRadiusBins; delta += 1) {
      const score = scoreActivityOffsetSegment(
        referenceFine,
        targetFine,
        globalOffsetBins + delta,
        segment
      );
      if (score == null || score < segmentBestScore - TIE_SCORE_EPSILON) {
        continue;
      }
      if (Math.abs(delta) < closestDistance) {
        closestDistance = Math.abs(delta);
        segmentBestOffsetBins = globalOffsetBins + delta;
      }
    }
    availableSegments += 1;
    if (
      segmentBestScore >= DELAY_ONLY_MIN_SEGMENT_SCORE &&
      Math.abs(segmentBestOffsetBins - globalOffsetBins) <= maxDeltaBins
    ) {
      passedSegments += 1;
    }
  }

  const requiredSegments = targetSize < SMALL_SAMPLE_CUES ? 2 : 3;
  if (availableSegments < requiredSegments || passedSegments < requiredSegments) {
    return null;
  }

  return {
    offsetMs: best.interceptMs,
    score: best.score,
    margin,
    segmentsPassed: passedSegments
  };
}

function discoverAffineAlignment(
  reference,
  target,
  preparedReferenceActivity,
  preparedTargetActivity
) {
  const referenceCoarse = preparedReferenceActivity.coarse;
  const coarseCandidates = [];
  activityScaleCandidates(reference, target).forEach((scale) => {
    const targetCoarse =
      scale === 1
        ? preparedTargetActivity.coarse
        : buildActivityTimeline(target, scale, COARSE_BIN_MS);
    if (!targetCoarse) {
      return;
    }
    const range = coarseOffsetRange(referenceCoarse, targetCoarse);
    for (let offsetBins = range.first; offsetBins <= range.last; offsetBins += 1) {
      const score = scoreActivityOffset(referenceCoarse, targetCoarse, offsetBins);
      if (score != null) {
        coarseCandidates.push({
          scale,
          interceptMs: offsetBins * COARSE_BIN_MS,
          score
        });
      }
    }
  });
  if (!coarseCandidates.length) {
    return null;
  }

  let coarseBest = coarseCandidates[0];
  coarseCandidates.forEach((candidate) => {
    if (candidate.score > coarseBest.score) {
      coarseBest = candidate;
    }
  });
  const targetEndMs = target[target.length - 1].endTimeMs;
  const isDistinct = (candidate) =>
    Math.max(
      Math.abs(coarseBest.interceptMs - candidate.interceptMs),
      Math.abs(
        targetEndMs * coarseBest.scale +
          coarseBest.interceptMs -
          (targetEndMs * candidate.scale + candidate.interceptMs)
      )
    ) >= DISTINCT_TRANSFORM_MS;
  const secondDistinct = coarseCandidates
    .filter((candidate) => candidate !== coarseBest && isDistinct(candidate))
    .reduce((best, candidate) => (!best || candidate.score > best.score ? candidate : best), null);
  const margin = coarseBest.score - (secondDistinct?.score || 0);

  const targetFine =
    coarseBest.scale === 1
      ? preparedTargetActivity.fine
      : buildActivityTimeline(target, coarseBest.scale, FINE_BIN_MS);
  if (!targetFine) {
    return null;
  }
  const tie = coarseTieRun(coarseCandidates, coarseBest);
  const referenceStarts = reference.map((cue) => cue.startTimeMs);
  const targetStarts = target.map((cue) => cue.startTimeMs);
  const best =
    fineActivitySearch({
      referenceFine: preparedReferenceActivity.fine,
      targetFine,
      scale: coarseBest.scale,
      coarseInterceptMs: coarseBest.interceptMs,
      tieStartMs: tie.start,
      tieEndMs: tie.end,
      referenceStarts,
      targetStarts
    }) || coarseBest;

  return {
    scale: best.scale,
    interceptMs: best.interceptMs,
    score: best.score,
    margin
  };
}

function transformedCues(target, scale, interceptMs) {
  return target.map((cue) => {
    const startTimeMs = Math.max(0, Math.round(cue.startTimeMs * scale + interceptMs));
    const endTimeMs = Math.max(startTimeMs + 1, Math.round(cue.endTimeMs * scale + interceptMs));
    return {
      originalStartTimeMs: cue.startTimeMs,
      originalEndTimeMs: cue.endTimeMs,
      startTimeMs,
      endTimeMs
    };
  });
}

function validateCueCoverage(reference, target, retimed) {
  const referenceStarts = reference.map((cue) => cue.startTimeMs);
  const matchedTarget = new Uint8Array(target.length);
  const matchedReference = new Uint8Array(reference.length);
  const costs = [];
  let minimumTargetIndex = 0;

  for (let index = 0; index < target.length; index += 1) {
    const predictedStart = retimed[index].startTimeMs;
    const predictedEnd = retimed[index].endTimeMs;
    let referenceIndex = Math.max(
      minimumTargetIndex,
      lowerBound(referenceStarts, predictedStart - MATCH_START_TOLERANCE_MS)
    );
    let bestIndex = -1;
    let bestResidual = Infinity;
    while (
      referenceIndex < referenceStarts.length &&
      referenceStarts[referenceIndex] <= predictedStart + MATCH_START_TOLERANCE_MS
    ) {
      const residual = Math.abs(referenceStarts[referenceIndex] - predictedStart);
      const durationResidual = Math.abs(
        reference[referenceIndex].endTimeMs -
          reference[referenceIndex].startTimeMs -
          (predictedEnd - predictedStart)
      );
      const totalResidual = residual + Math.min(durationResidual, MATCH_END_TOLERANCE_MS) * 0.25;
      if (totalResidual < bestResidual) {
        bestResidual = totalResidual;
        bestIndex = referenceIndex;
      }
      referenceIndex += 1;
    }
    if (bestIndex >= 0) {
      matchedTarget[index] = 1;
      matchedReference[bestIndex] = 1;
      // Keep the reference available: one dialogue line can be split across two
      // or three add-on cues that must all anchor to the same embedded start.
      minimumTargetIndex = bestIndex;
      costs.push(Math.abs(referenceStarts[bestIndex] - predictedStart) / MATCH_START_TOLERANCE_MS);
    }
  }

  let matchedTargetCount = 0;
  let matchedReferenceCount = 0;
  for (let index = 0; index < matchedTarget.length; index += 1) {
    matchedTargetCount += matchedTarget[index];
  }
  for (let index = 0; index < matchedReference.length; index += 1) {
    matchedReferenceCount += matchedReference[index];
  }
  const targetCoverage = matchedTargetCount / target.length;
  const referenceCoverage = matchedReferenceCount / reference.length;
  const averageCost = costs.length
    ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length
    : Infinity;

  let coverageSegmentsPassed = 0;
  for (let segment = 0; segment < 3; segment += 1) {
    const start = Math.floor((segment * target.length) / 3);
    const end = segment === 2 ? target.length : Math.floor(((segment + 1) * target.length) / 3);
    const length = Math.max(1, end - start);
    let matched = 0;
    for (let index = start; index < end; index += 1) {
      matched += matchedTarget[index];
    }
    if (
      matched / length >= MIN_SEGMENT_COVERAGE &&
      matched >= Math.min(MIN_SEGMENT_MATCHES, length)
    ) {
      coverageSegmentsPassed += 1;
    }
  }

  return {
    targetCoverage,
    referenceCoverage,
    averageCost,
    coverageSegmentsPassed,
    matchedTargetCount
  };
}

function buildResult({ reference, target, scale, interceptMs, source, score, margin, delayOnly }) {
  const retimed = transformedCues(target, scale, interceptMs);
  const coverage = validateCueCoverage(reference, target, retimed);
  const requiredSegments = target.length < SMALL_SAMPLE_CUES ? 2 : 3;
  const requiredMatched = Math.min(MIN_MATCHED_TARGET_CUES, target.length);
  const requiredScore =
    target.length < SMALL_SAMPLE_CUES ? SMALL_SAMPLE_ACTIVITY_SCORE : MIN_ACTIVITY_SCORE;
  const requiredMargin =
    target.length < SMALL_SAMPLE_CUES ? SMALL_SAMPLE_ACTIVITY_MARGIN : MIN_ACTIVITY_MARGIN;
  const requiredReferenceCoverage =
    reference.length * 2 >= target.length * 3 ? 0.25 : MIN_REFERENCE_COVERAGE;
  const effectiveMargin =
    delayOnly && reference.length * 2 >= target.length * 3
      ? Math.max(margin, requiredMargin)
      : margin;
  const accepted =
    coverage.matchedTargetCount >= requiredMatched &&
    coverage.targetCoverage >= MIN_TARGET_COVERAGE &&
    coverage.referenceCoverage >= requiredReferenceCoverage &&
    coverage.averageCost <=
      (delayOnly ? DELAY_ONLY_MAX_AVERAGE_MATCH_COST : MAX_AVERAGE_MATCH_COST) &&
    coverage.coverageSegmentsPassed >= requiredSegments &&
    score >= requiredScore &&
    effectiveMargin >= requiredMargin;

  const firstStartMs = target[0].startTimeMs;
  const lastStartMs = target[target.length - 1].startTimeMs;
  const shiftAt = (timeMs) => Math.abs((scale - 1) * timeMs + interceptMs);
  return {
    confident: accepted,
    source,
    scale,
    interceptMs,
    activityScore: score,
    activityMargin: margin,
    targetCoverage: coverage.targetCoverage,
    referenceCoverage: coverage.referenceCoverage,
    averageMatchCost: coverage.averageCost,
    coverageSegmentsPassed: coverage.coverageSegmentsPassed,
    matchedTargetCues: coverage.matchedTargetCount,
    maxShiftMs: Math.max(shiftAt(firstStartMs), shiftAt(lastStartMs)),
    cues: retimed,
    referenceCueCount: reference.length,
    targetCueCount: target.length
  };
}

/**
 * Finds the AutoSync timeline for one add-on subtitle against one embedded
 * reference. Returns null when either timeline is unusable; the result may be
 * non-confident, in which case the caller must keep the original timing.
 */
export function findAutoSyncTimeline(referenceInput, targetInput) {
  const reference = Array.isArray(referenceInput)
    ? referenceInput[0] && Number.isFinite(Number(referenceInput[0].startTimeMs))
      ? normalizeAutoSyncCues(referenceInput)
      : buildAutoSyncReferenceTimeline(referenceInput)
    : [];
  const target = normalizeAutoSyncCues(targetInput);
  if (reference.length < AUTO_SYNC_MIN_CUES || target.length < AUTO_SYNC_MIN_CUES) {
    return null;
  }
  if (reference[reference.length - 1].startTimeMs - reference[0].startTimeMs < 45000) {
    return null;
  }

  const allowAmbiguousMargin = reference.length * 2 >= target.length * 3;
  const delayOnly = findDelayOnlyAlignment(reference, target, target.length, allowAmbiguousMargin);
  if (delayOnly) {
    const result = buildResult({
      reference,
      target,
      scale: 1,
      interceptMs: Math.round(delayOnly.offsetMs),
      source: "delay-only",
      score: delayOnly.score,
      margin: delayOnly.margin,
      delayOnly: true
    });
    if (result.confident) {
      return result;
    }
  }

  const preparedReferenceActivity = {
    coarse: buildActivityTimeline(reference, 1, COARSE_BIN_MS),
    fine: buildActivityTimeline(reference, 1, FINE_BIN_MS)
  };
  const preparedTargetActivity = {
    coarse: buildActivityTimeline(target, 1, COARSE_BIN_MS),
    fine: buildActivityTimeline(target, 1, FINE_BIN_MS)
  };
  if (
    !preparedReferenceActivity.coarse ||
    !preparedReferenceActivity.fine ||
    !preparedTargetActivity.coarse ||
    !preparedTargetActivity.fine
  ) {
    return null;
  }

  const alignment = discoverAffineAlignment(
    reference,
    target,
    preparedReferenceActivity,
    preparedTargetActivity
  );
  if (!alignment) {
    return null;
  }
  if (Math.abs(alignment.scale - 1) <= 0.0015 && Math.abs(alignment.interceptMs) < 1) {
    return null;
  }
  return buildResult({
    reference,
    target,
    scale: alignment.scale,
    interceptMs: Math.round(alignment.interceptMs),
    source: "activity",
    score: alignment.score,
    margin: alignment.margin,
    delayOnly: false
  });
}
