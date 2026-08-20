const ASS_SECTION_HEADERS = [
  "[Script Info]",
  "[V4+ Styles]",
  "[V4+ Styles+]",
  "[V4 Styles]",
  "[V4 Styles+]",
  "[Events]"
];

const ASS_CONTENT_TYPES = ["text/x-ssa", "application/x-ssa", "text/x-ass", "application/x-ass"];

function normalizeBody(body) {
  return String(body || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

function looksLikeSrtOrVtt(normalized) {
  return (
    /^\s*WEBVTT/i.test(normalized) ||
    /^\s*\d+\s*\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(normalized)
  );
}

function hasAssSectionHeaders(normalized) {
  const head = normalized.slice(0, 4096);
  // Headers must be alone on their line; incidental bracketed prose such
  // as "[Events] tonight" inside subtitle dialogue must not match.
  return ASS_SECTION_HEADERS.some((header) =>
    new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(head)
  );
}

function hasAssDialogueEvents(normalized) {
  return /^\s*Dialogue\s*:/im.test(normalized) && /^\s*Format\s*:/im.test(normalized);
}


/**
 * Detect ASS/SSA subtitle bodies from content and metadata.
 *
 * A body is ASS when it carries standard section headers on their own lines
 * together with Dialogue/Format event lines, or when URL / content-type
 * metadata says so and the body at least looks like SSA. SRT and VTT bodies
 * are always rejected, as is incidental ASS-like text inside a larger
 * non-ASS body.
 */
export function isAssSubtitle(body, { sourceUrl = "", contentType = "" } = {}) {
  const normalized = normalizeBody(body);
  if (!normalized.trim()) {
    return false;
  }
  const fromMetadata =
    /\.(ass|ssa)(\?|#|$)/i.test(String(sourceUrl || "")) ||
    ASS_CONTENT_TYPES.some((type) =>
      String(contentType || "")
        .toLowerCase()
        .includes(type)
    );
  if (looksLikeSrtOrVtt(normalized)) {
    return false;
  }
  if (hasAssSectionHeaders(normalized) && hasAssDialogueEvents(normalized)) {
    return true;
  }
  return fromMetadata && hasAssDialogueEvents(normalized);
}

function parseAssTimestamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) {
    return NaN;
  }
  const milliseconds = Number(String(match[4] || "0").padEnd(3, "0"));
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    milliseconds / 1000
  );
}

function formatVttTimestamp(totalSeconds) {
  const total = Math.max(0, totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const milliseconds = Math.round((total - Math.floor(total)) * 1000) % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

function sanitizeAssDialogueText(text) {
  return String(text || "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/\{[^}]*\}/g, "")
    .trim();
}

export function convertAssDialogueToVttCues(body) {
  const normalized = normalizeBody(body);
  let formatFields = null;
  const cues = [];
  normalized.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (/^Format\s*:/i.test(trimmed)) {
      const section = trimmed.slice(trimmed.indexOf(":") + 1);
      formatFields = section.split(",").map((field) => field.trim().toLowerCase());
      return;
    }
    if (!/^Dialogue\s*:/i.test(trimmed) || !formatFields) {
      return;
    }
    let rest = trimmed.slice(trimmed.indexOf(":") + 1);
    const values = [];
    const textIndex = formatFields.indexOf("text");
    const headCount = textIndex >= 0 ? textIndex : formatFields.length;
    for (let index = 0; index < headCount; index += 1) {
      const commaIndex = rest.indexOf(",");
      if (commaIndex < 0) {
        return;
      }
      values.push(rest.slice(0, commaIndex));
      rest = rest.slice(commaIndex + 1);
    }
    values.push(rest);
    const record = {};
    formatFields.forEach((field, index) => {
      record[field] = values[index];
    });
    const start = parseAssTimestamp(record.start);
    const end = parseAssTimestamp(record.end);
    const text = sanitizeAssDialogueText(record.text);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
      return;
    }
    cues.push({ start, end, text });
  });
  return cues.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Convert ASS/SSA `Dialogue:` events to plain VTT cues: timestamps become
 * `HH:MM:SS.mmm` ranges, dialogue text keeps line breaks and loses all
 * override tags. Malformed events are dropped. Returns "" when no usable
 * cues remain.
 */

export function buildVttFromAssCues(cues) {
  if (!Array.isArray(cues) || !cues.length) {
    return "";
  }
  const blocks = cues.map(
    (cue) => `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function convertAssBodyToVtt(body) {
  return buildVttFromAssCues(convertAssDialogueToVttCues(body));
}
