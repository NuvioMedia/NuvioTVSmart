/**
 * Applies an AutoSync timeline to a subtitle file's own text, rewriting only
 * timestamps. Used for ASS/SSA rendered through ass.js and for formats whose
 * cues are not exposed to the player.
 */

const BOUNDARY_TOLERANCE_MS = 500;
const ASS_MIN_DURATION_MS = 10;
const TIMESTAMP_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:([.,])(\d+))?$/;

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle].originalMs < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function buildBoundaries(timeline, start = true) {
  return (timeline?.cues || [])
    .map((cue) => ({
      originalMs: start ? cue.originalStartTimeMs : cue.originalEndTimeMs,
      retimedMs: start ? cue.startTimeMs : cue.endTimeMs
    }))
    .sort((left, right) => left.originalMs - right.originalMs);
}

function mapTime(originalMs, boundaries, timeline) {
  if (boundaries.length) {
    const position = lowerBound(boundaries, originalMs);
    const first = Math.max(0, position - 2);
    const last = Math.min(boundaries.length - 1, position + 2);
    let best = null;
    let bestError = Infinity;
    for (let index = first; index <= last; index += 1) {
      const candidate = boundaries[index];
      const error = Math.abs(candidate.originalMs - originalMs);
      if (error < bestError) {
        best = candidate;
        bestError = error;
      }
    }
    if (best && bestError <= BOUNDARY_TOLERANCE_MS) {
      return Math.max(0, best.retimedMs);
    }
  }
  return Math.max(0, Math.round(originalMs * timeline.scale + timeline.interceptMs));
}

function parseTimestamp(raw) {
  const match = TIMESTAMP_PATTERN.exec(String(raw || "").trim());
  if (!match) {
    return null;
  }
  const fraction = match[5] || "";
  const millis =
    fraction.length === 0
      ? 0
      : fraction.length === 1
        ? Number(fraction) * 100
        : fraction.length === 2
          ? Number(fraction) * 10
          : Number(fraction.slice(0, 3));
  return {
    ms: ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + millis,
    hasHours: Boolean(match[1]),
    separator: match[4] || ","
  };
}

function formatLike(ms, original) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const millis = ms % 1000;
  const pad = (value, length) => String(value).padStart(length, "0");
  if (original.hasHours || hours > 0) {
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${original.separator}${pad(millis, 3)}`;
  }
  return `${pad(minutes, 2)}:${pad(seconds, 2)}${original.separator}${pad(millis, 3)}`;
}

function formatAss(ms) {
  const centis = Math.floor((ms + 5) / 10);
  const pad = (value) => String(value).padStart(2, "0");
  return `${Math.floor(centis / 360000)}:${pad(Math.floor(centis / 6000) % 60)}:${pad(Math.floor(centis / 100) % 60)}.${pad(centis % 100)}`;
}

function retimeTimingLines(text, timeline) {
  const startBoundaries = buildBoundaries(timeline, true);
  const endBoundaries = buildBoundaries(timeline, false);
  const lines = text.split("\n");
  const entries = [];
  const timingPattern =
    /^(\s*)((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?)(\s*-->\s*)((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?)(.*)$/;
  lines.forEach((line, index) => {
    const match = timingPattern.exec(line);
    if (!match) {
      return;
    }
    const start = parseTimestamp(match[2]);
    const end = parseTimestamp(match[4]);
    if (!start || !end) {
      return;
    }
    const originalEndMs = Math.max(end.ms, start.ms + 1);
    const startMs = mapTime(start.ms, startBoundaries, timeline);
    entries.push({
      lineIndex: index,
      groups: match,
      start,
      end,
      originalStartMs: start.ms,
      originalEndMs,
      startMs,
      endMs: Math.max(startMs + 1, mapTime(originalEndMs, endBoundaries, timeline))
    });
  });
  if (!entries.length) {
    return null;
  }

  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (current.originalEndMs > next.originalStartMs) {
      continue;
    }
    if (current.endMs > next.startMs && next.startMs > current.startMs) {
      current.endMs = next.startMs;
    }
  }

  entries.forEach((entry) => {
    lines[entry.lineIndex] =
      entry.groups[1] +
      formatLike(entry.startMs, entry.start) +
      entry.groups[3] +
      formatLike(entry.endMs, entry.end) +
      entry.groups[5];
  });
  return lines.join("\n");
}

function retimeAss(text, timeline) {
  const startBoundaries = buildBoundaries(timeline, true);
  const endBoundaries = buildBoundaries(timeline, false);
  const lines = text.split("\n");
  let inEvents = false;
  let fieldCount = 10;
  let startIndex = 1;
  let endIndex = 2;
  let rewritten = 0;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inEvents = trimmed.toLowerCase() === "[events]";
      return;
    }
    if (!inEvents) {
      return;
    }
    if (/^Format:/i.test(trimmed)) {
      const fields = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim());
      fieldCount = fields.length;
      const startField = fields.findIndex((field) => field.toLowerCase() === "start");
      const endField = fields.findIndex((field) => field.toLowerCase() === "end");
      startIndex = startField >= 0 ? startField : 1;
      endIndex = endField >= 0 ? endField : 2;
      return;
    }
    if (!/^Dialogue:/i.test(trimmed)) {
      return;
    }
    const colon = line.indexOf(":");
    const rawParts = line.slice(colon + 1).split(",");
    const parts =
      rawParts.length > fieldCount
        ? [...rawParts.slice(0, fieldCount - 1), rawParts.slice(fieldCount - 1).join(",")]
        : rawParts;
    if (parts.length <= Math.max(startIndex, endIndex)) {
      return;
    }
    const leadingWhitespace = (value) => value.match(/^\s*/)?.[0] || "";
    const start = parseTimestamp(parts[startIndex]);
    const end = parseTimestamp(parts[endIndex]);
    if (!start || !end) {
      return;
    }
    const startMs = mapTime(start.ms, startBoundaries, timeline);
    const endMs = Math.max(
      startMs + ASS_MIN_DURATION_MS,
      mapTime(Math.max(end.ms, start.ms + 1), endBoundaries, timeline)
    );
    parts[startIndex] = leadingWhitespace(parts[startIndex]) + formatAss(startMs);
    parts[endIndex] = leadingWhitespace(parts[endIndex]) + formatAss(endMs);
    lines[lineIndex] = line.slice(0, colon + 1) + parts.join(",");
    rewritten += 1;
  });

  return rewritten ? lines.join("\n") : null;
}

/**
 * Returns the retimed subtitle text, or null when the format cannot be
 * rewritten or the body has no timing.
 */
export function retimeAutoSyncSubtitleText(body, timeline) {
  if (!body || !timeline || !Array.isArray(timeline.cues)) {
    return null;
  }
  const text = String(body)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (/<tt[\s>]/i.test(text.slice(0, 512))) {
    return null;
  }
  const sample = text.slice(0, 4096).toLowerCase();
  if (sample.includes("[events]") && sample.includes("dialogue:")) {
    return retimeAss(text, timeline);
  }
  return retimeTimingLines(text, timeline);
}
