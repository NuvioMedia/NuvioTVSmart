import {
  inferHeaderlessAssFormat,
  isAssEventFormat
} from "./assSubtitleHelpers-01-ass-content-types.js";

const squareBrackets = /\[[^\]]*\][ \t]*/g;
const chevrons = /[<>]{2,}[ \t]*/g;
const parentheses =
  /(?:\((?=[A-Za-z0-9 '#.,"\\\-\r\n]*\))(?![0-9]*\))[^)]*\)|（(?=[A-Za-z0-9 '#.,"\\\-\r\n]*）)(?![0-9]*）)[^）]*）)[ \t]*/g;
const speakerLabel = /^([ \t]*-[ \t]*)?([A-Za-z0-9 ()'#.,]+|\[[^\]\r\n]*\]):(?=\s|$)[ \t]*/gm;

export function isSdhSpeakerLabel(label, textFollows) {
  if (label.startsWith("[")) return true;
  if (!/[A-Za-z]/.test(label)) return false;
  if (!/[a-z]/.test(label)) return true;
  if (!textFollows) return false;
  const words = label.trim().split(/[ \t]+/);
  return words.length <= 3 && words.every((word) => !/^[a-z]/.test(word));
}

export function stripSubtitleSdh(input, { ass = false } = {}) {
  const source = String(input).replace(/\r\n?/g, "\n");
  let plain = "",
    drawing = false,
    hasDrawing = false;
  const spans = [];
  for (let index = 0; index < source.length;) {
    const tag = ass
      ? source[index] === "{" && /^\{[^}]*\}/.exec(source.slice(index))
      : source[index] === "<" &&
        /^<\/?(?:b|i|u|c|v|lang|ruby|rt)(?:[ .][^>]*)?>/i.exec(source.slice(index));
    if (tag) {
      if (ass) {
        const modes = [...tag[0].matchAll(/\\p(\d+)/g)];
        if (modes.length) drawing = Number(modes[modes.length - 1][1]) > 0;
      }
      index += tag[0].length;
      continue;
    }
    if (drawing) {
      hasDrawing = true;
      index++;
      continue;
    }
    const escape = ass && source[index] === "\\" && /[Nnh]/.test(source[index + 1] || "");
    plain += escape ? (source[index + 1] === "h" ? " " : "\n") : source[index];
    spans.push([index, escape ? 2 : 1]);
    index += escape ? 2 : 1;
  }
  let indices = Array.from({ length: plain.length }, (_, index) => index);
  const removeMatches = (regex, preserve = () => 0) => {
    const text = indices.map((index) => plain[index]).join("");
    const removed = new Uint8Array(indices.length);
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const prefix = preserve(match, text);
      if (prefix != null) removed.fill(1, match.index + prefix, match.index + match[0].length);
    }
    indices = indices.filter((_, index) => !removed[index]);
  };
  removeMatches(chevrons);
  removeMatches(speakerLabel, (match, text) => {
    const follows =
      text
        .slice(match.index + match[0].length)
        .split("\n")[0]
        .trim().length > 0;
    return isSdhSpeakerLabel(match[2], follows) ? (match[1] || "").length : null;
  });
  removeMatches(squareBrackets);
  removeMatches(parentheses);
  const text = indices.map((index) => plain[index]).join("");
  const lines = text.split("\n");
  const retained = [];
  let offset = 0,
    previousNewline = null;
  for (const line of lines) {
    if (/[^\s-]/.test(line)) {
      if (previousNewline != null) retained.push(previousNewline);
      for (let index = offset; index < offset + line.length; index++) retained.push(indices[index]);
      previousNewline = indices[offset + line.length];
    }
    offset += line.length + 1;
  }
  if (!retained.length && !hasDrawing) return "";
  const kept = new Set(retained),
    removed = new Uint8Array(source.length);
  spans.forEach(([start, length], index) => {
    if (!kept.has(index)) removed.fill(1, start, start + length);
  });
  return source
    .split("")
    .filter((_, index) => !removed[index])
    .join("");
}

export function stripAssSubtitleSdh(body) {
  let fields = null,
    inEvents = false;
  return String(body)
    .split("\n")
    .map((line) => {
      const section = /^\s*\[([^\]]+)\]/.exec(line);
      if (section) {
        inEvents = section[1].toLowerCase() === "events";
        fields = null;
        return line;
      }
      if (!inEvents) return line;
      const format = /^\s*Format\s*:\s*(.*)/i.exec(line);
      if (format) {
        const candidate = format[1]
          .trim()
          .toLowerCase()
          .split(",")
          .map((field) => field.trim());
        fields = isAssEventFormat(candidate) ? candidate : null;
        return line;
      }
      const dialogue = /^(\s*Dialogue\s*:\s*)(.*?)(\r?)$/i.exec(line);
      if (!dialogue) return line;
      const eventFields = fields || inferHeaderlessAssFormat(dialogue[2]);
      if (!eventFields || eventFields.indexOf("text") !== eventFields.length - 1) return line;
      let start = 0;
      for (let field = 0; field < eventFields.length - 1; field++) {
        const comma = dialogue[2].indexOf(",", start);
        if (comma < 0) return line;
        start = comma + 1;
      }
      return (
        dialogue[1] +
        dialogue[2].slice(0, start) +
        stripSubtitleSdh(dialogue[2].slice(start), { ass: true }) +
        dialogue[3]
      );
    })
    .join("\n");
}
