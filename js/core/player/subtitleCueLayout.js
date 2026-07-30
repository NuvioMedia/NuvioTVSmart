export function getSubtitleAssAlignment(content) {
  const match = String(content || "").match(/\{[^}]*[\\/]an([1-9])\b[^}]*\}/i);
  return match ? Number(match[1]) : 0;
}

export function getSubtitleAssAlignmentSettings(alignment) {
  const value = Number(alignment || 0);
  if (value < 1 || value > 9) {
    return null;
  }
  const column = ((value - 1) % 3) + 1;
  const row = Math.ceil(value / 3);
  return {
    line: row === 3 ? 10 : row === 2 ? 50 : 90,
    align: column === 1 ? "start" : column === 3 ? "end" : "center"
  };
}

export function parseVttCueLayout(timingLine) {
  const value = String(timingLine || "");
  const lineMatch = value.match(/(?:^|\s)line:([+-]?(?:\d+(?:\.\d+)?|\.\d+))%/i);
  const alignMatch = value.match(/(?:^|\s)align:(start|center|end|left|right)\b/i);
  const rawLine = lineMatch ? Number(lineMatch[1]) : NaN;
  const rawAlign = String(alignMatch?.[1] || "").toLowerCase();
  const align = rawAlign === "left" ? "start" : rawAlign === "right" ? "end" : rawAlign;
  return {
    line: Number.isFinite(rawLine) ? Math.min(100, Math.max(0, rawLine)) : null,
    align: align === "start" || align === "end" || align === "center" ? align : "center"
  };
}

export function buildHtmlSubtitleCue(cue, originalState = null, text = null) {
  if (!cue || typeof cue !== "object") {
    return null;
  }
  const source = originalState && typeof originalState === "object" ? originalState : cue;
  const start = Number(source.startTime);
  const end = Number(source.endTime);
  const normalizedText = String(text == null ? cue.text || "" : text).trim();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !normalizedText) {
    return null;
  }

  const snapToLines = source.snapToLines;
  const rawLine = Number(source.line);
  const line =
    snapToLines === false && Number.isFinite(rawLine) ? Math.min(100, Math.max(0, rawLine)) : null;
  const rawAlign = String(cue.align || source.align || "").toLowerCase();
  const align = rawAlign === "left" ? "start" : rawAlign === "right" ? "end" : rawAlign;

  return {
    start,
    end,
    text: normalizedText,
    line,
    align: align === "start" || align === "end" || align === "center" ? align : "center"
  };
}
