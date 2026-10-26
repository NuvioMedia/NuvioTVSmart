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

// shortcut: only a complete Tracks element in the first MiB is read; add bounded SeekHead reads if real files require them.
export function parseMatroskaAudioTracks(bytes) {
  try {
    const header = readElement(bytes, 0, bytes.length);
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
        const entries = children(bytes, element.start, element.end).filter(
          (entry) => entry.id === 0xae
        );
        const ids = new Set();
        return entries
          .map((entry, containerStreamIndex) => {
            const fields = children(bytes, entry.start, entry.end);
            const find = (id) => fields.find((field) => field.id === id);
            const integer = (id) => {
              const field = find(id);
              if (!field) return null;
              if (field.end - field.start > 6) throw new Error("Oversized track integer");
              return bytes
                .slice(field.start, field.end)
                .reduce((value, byte) => value * 256 + byte, 0);
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
      if (element.id === 0x1f43b675) return [];
      offset = element.end;
    }
  } catch (_) {
    // Malformed or incomplete metadata must not affect playback.
  }
  return [];
}

export async function fetchMatroskaAudioTracks(url) {
  if (!/^https?:\/\//i.test(url) || typeof AbortController !== "function") return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let reader;
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${MAX_HEADER_BYTES - 1}` },
      signal: controller.signal,
      credentials: "omit"
    });
    // Never buffer a whole movie when the host ignores Range, or trust a body from another byte offset.
    const range = response.headers.get("content-range");
    if (
      response.status !== 206 ||
      (range && !/^bytes 0-\d+\/\d+$/i.test(range)) ||
      !response.body?.getReader
    )
      return [];
    reader = response.body.getReader();
    const bytes = new Uint8Array(MAX_HEADER_BYTES);
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return parseMatroskaAudioTracks(bytes.subarray(0, length));
      if (length + value.length > MAX_HEADER_BYTES) return [];
      bytes.set(value, length);
      length += value.length;
      if (length === MAX_HEADER_BYTES) return parseMatroskaAudioTracks(bytes);
    }
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
