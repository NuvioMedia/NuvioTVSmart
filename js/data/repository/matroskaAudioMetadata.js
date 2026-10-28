const MAX_HEADER_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 3000;

function readElement(bytes, offset, limit) {
  const readVint = (start, isId) => {
    const first = bytes[start];
    if (!first) throw new Error("Invalid EBML integer");
    let width = 1;
    let marker = 128;
    while (!(first & marker)) {
      width += 1;
      marker /= 2;
    }
    if (width > (isId ? 4 : 8) || start + width > limit) throw new Error("Truncated EBML integer");
    let value = isId ? first : first & (marker - 1);
    let unknown = !isId && value === marker - 1;
    for (let index = 1; index < width; index += 1) {
      value = value * 256 + bytes[start + index];
      unknown = unknown && bytes[start + index] === 255;
    }
    if (!unknown && !Number.isSafeInteger(value)) throw new Error("Oversized EBML integer");
    return { value, width, unknown };
  };
  const id = readVint(offset, true);
  const size = readVint(offset + id.width, false);
  const start = offset + id.width + size.width;
  return { id: id.value, start, end: size.unknown ? Infinity : start + size.value };
}

function children(bytes, start, end) {
  const elements = [];
  while (start < end) {
    const element = readElement(bytes, start, end);
    if (element.end > end) throw new Error("Truncated EBML element");
    elements.push(element);
    start = element.end;
  }
  return elements;
}

function parseTrackEntries(bytes, element) {
  const entries = children(bytes, element.start, element.end).filter((entry) => entry.id === 0xae);
  const ids = new Set();
  return entries
    .map((entry, containerStreamIndex) => {
      const fields = children(bytes, entry.start, entry.end);
      const find = (id) => fields.find((field) => field.id === id);
      const integer = (id) => {
        const field = find(id);
        if (!field) return null;
        if (field.end - field.start > 6) throw new Error("Oversized track integer");
        return bytes.slice(field.start, field.end).reduce((value, byte) => value * 256 + byte, 0);
      };
      const string = (id) => {
        const field = find(id);
        if (!field) return "";
        if (field.end - field.start > 1024) throw new Error("Oversized track string");
        return new TextDecoder("utf-8", { fatal: true })
          .decode(bytes.subarray(field.start, field.end))
          .replace(/\0+$/, "")
          .trim();
      };
      const id = integer(0xd7);
      const type = integer(0x83);
      if (!id || !type || ids.has(id)) throw new Error("Invalid track identity");
      ids.add(id);
      return {
        id,
        type: type === 2 ? "audio" : "other",
        containerStreamIndex,
        codec: string(0x86),
        name: string(0x536e),
        // Missing language stays unknown; do not turn untagged tracks into English guesses.
        language: string(0x22b59d) || string(0x22b59c)
      };
    })
    .filter((track) => track.type === "audio");
}

// Read one bounded header and, when indexed, one bounded Tracks range.
export function parseMatroskaAudioTracks(bytes) {
  try {
    const header = readElement(bytes, 0, bytes.length);
    if (header.id === 0x1654ae6b)
      return header.end <= bytes.length ? parseTrackEntries(bytes, header) : [];
    if (header.id !== 0x1a45dfa3 || header.end > bytes.length) return [];
    let offset = header.end;
    let segment;
    while (offset < bytes.length) {
      const element = readElement(bytes, offset, bytes.length);
      if (element.id === 0x18538067) {
        segment = element;
        break;
      }
      offset = element.end;
    }
    if (!segment) return [];
    const limit = Math.min(segment.end, bytes.length);
    offset = segment.start;
    while (offset < limit) {
      const element = readElement(bytes, offset, limit);
      if (element.end > limit) return [];
      if (element.id === 0x1654ae6b) {
        return parseTrackEntries(bytes, element);
      }
      if (element.id === 0x1f43b675) return [];
      offset = element.end;
    }
  } catch (_) {
    // Malformed or incomplete metadata must not affect playback.
  }
  return [];
}

// A SeekHead position is relative to the Segment payload, not the file.
export function matroskaTracksOffset(bytes) {
  try {
    const header = readElement(bytes, 0, bytes.length);
    if (header.id !== 0x1a45dfa3 || header.end > bytes.length) return null;
    const segment = readElement(bytes, header.end, bytes.length);
    if (segment.id !== 0x18538067) return null;
    const limit = Math.min(segment.end, bytes.length);
    let offset = segment.start;
    while (offset < limit) {
      const element = readElement(bytes, offset, limit);
      if (element.end > limit || element.id === 0x1f43b675) return null;
      if (element.id === 0x114d9b74) {
        for (const seek of children(bytes, element.start, element.end).filter(
          (entry) => entry.id === 0x4dbb
        )) {
          const fields = children(bytes, seek.start, seek.end);
          const integer = (id) => {
            const field = fields.find((entry) => entry.id === id);
            if (!field || field.end - field.start > 6) return null;
            return bytes
              .subarray(field.start, field.end)
              .reduce((value, byte) => value * 256 + byte, 0);
          };
          if (integer(0x53ab) !== 0x1654ae6b) continue;
          const relative = integer(0x53ac);
          const target = relative == null ? null : segment.start + relative;
          return target != null &&
            Number.isSafeInteger(target + MAX_HEADER_BYTES) &&
            target > element.end &&
            target < segment.end
            ? target
            : null;
        }
      }
      offset = element.end;
    }
  } catch (_) {
    // Incomplete indexes are not a reason to scan or download the movie.
  }
  return null;
}

export async function fetchMatroskaAudioTracks(url) {
  if (!/^https?:\/\//i.test(url) || typeof AbortController !== "function") return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const readRange = async (offset) => {
    let reader;
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + MAX_HEADER_BYTES - 1}` },
        signal: controller.signal,
        credentials: "omit"
      });
      const range = response.headers.get("content-range");
      if (
        response.status !== 206 ||
        (offset > 0 && !range) ||
        (range && !new RegExp(`^bytes ${offset}-\\d+/\\d+$`, "i").test(range)) ||
        !response.body?.getReader
      )
        return null;
      reader = response.body.getReader();
      const bytes = new Uint8Array(MAX_HEADER_BYTES);
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) return bytes.subarray(0, length);
        if (length + value.length > MAX_HEADER_BYTES) return null;
        bytes.set(value, length);
        length += value.length;
        if (length === MAX_HEADER_BYTES) return bytes;
      }
    } finally {
      if (reader) void reader.cancel().catch(() => {});
    }
  };
  try {
    const header = await readRange(0);
    if (!header) return [];
    const tracks = parseMatroskaAudioTracks(header);
    if (tracks.length) return tracks;
    const offset = matroskaTracksOffset(header);
    if (offset == null) return [];
    const indexed = await readRange(offset);
    // The advertised position must contain Tracks, never another Segment or index.
    if (!indexed || readElement(indexed, 0, indexed.length).id !== 0x1654ae6b) return [];
    return parseMatroskaAudioTracks(indexed);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
