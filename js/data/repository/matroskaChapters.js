import { children, readElement } from "./matroskaTrackMetadata.js";

const MAX_HEADER_BYTES = 256 * 1024;
const MAX_CHAPTERS_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 8000;

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEK_ID = 0x53ab;
const ID_SEEK_POSITION = 0x53ac;
const ID_CHAPTERS = 0x1043a770;
const ID_EDITION_ENTRY = 0x45b9;
const ID_EDITION_FLAG_HIDDEN = 0x45bd;
const ID_EDITION_FLAG_DEFAULT = 0x45db;
const ID_CHAPTER_ATOM = 0xb6;
const ID_CHAPTER_TIME_START = 0x91;
const ID_CHAPTER_FLAG_HIDDEN = 0x98;
const ID_CHAPTER_FLAG_ENABLED = 0x4598;
const ID_CHAPTER_DISPLAY = 0x80;
const ID_CHAP_STRING = 0x85;
const ID_CLUSTER = 0x1f43b675;

function childrenOf(bytes, parent) {
  return children(bytes, parent.start, Math.min(parent.end, bytes.length));
}

function readUnsigned(bytes, element) {
  if (
    element.end - element.start < 1 ||
    element.end - element.start > 8 ||
    element.end > bytes.length
  ) {
    return null;
  }
  let value = 0;
  for (let index = element.start; index < element.end; index += 1) {
    value = value * 256 + bytes[index];
  }
  return Number.isSafeInteger(value) ? value : null;
}

function readUtf8(bytes, element) {
  if (element.end < element.start || element.end > bytes.length) {
    return "";
  }
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(element.start, element.end))
      .replace(/\0+$/, "")
      .trim();
  } catch (_) {
    return "";
  }
}

function flag(bytes, parent, id, fallback) {
  const element = childrenOf(bytes, parent).find((child) => child.id === id);
  const value = element ? readUnsigned(bytes, element) : null;
  return value == null ? fallback : value !== 0;
}

/** Chapters of the default edition (else the first shown), from a whole Chapters element. */
export function parseMatroskaChapters(bytes) {
  try {
    const root = readElement(bytes, 0, bytes.length);
    if (!root || root.id !== ID_CHAPTERS || root.end > bytes.length) {
      return [];
    }
    const editions = childrenOf(bytes, root).filter((element) => element.id === ID_EDITION_ENTRY);
    const shown = editions.filter(
      (edition) => !flag(bytes, edition, ID_EDITION_FLAG_HIDDEN, false)
    );
    const edition =
      shown.find((entry) => flag(bytes, entry, ID_EDITION_FLAG_DEFAULT, false)) || shown[0];
    if (!edition) {
      return [];
    }
    return childrenOf(bytes, edition)
      .filter((element) => element.id === ID_CHAPTER_ATOM)
      .filter((element) => !flag(bytes, element, ID_CHAPTER_FLAG_HIDDEN, false))
      .filter((element) => flag(bytes, element, ID_CHAPTER_FLAG_ENABLED, true))
      .map((atom) => {
        const atomChildren = childrenOf(bytes, atom);
        const startElement = atomChildren.find((child) => child.id === ID_CHAPTER_TIME_START);
        const startNs = startElement ? readUnsigned(bytes, startElement) : null;
        if (startNs == null) {
          return null;
        }
        const display = atomChildren.find((child) => child.id === ID_CHAPTER_DISPLAY);
        const stringElement = display
          ? childrenOf(bytes, display).find((child) => child.id === ID_CHAP_STRING)
          : null;
        const title = stringElement ? readUtf8(bytes, stringElement) : "";
        return {
          startMs: Math.floor(startNs / 1_000_000),
          title: title || null
        };
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Where SeekHead and Chapters start in a Matroska head; positions are absolute. */
export function matroskaChapterLayout(bytes) {
  try {
    const header = readElement(bytes, 0, bytes.length);
    if (!header || header.id !== ID_EBML || header.end > bytes.length) {
      return null;
    }
    const segment = readElement(bytes, header.end, bytes.length);
    if (!segment || segment.id !== ID_SEGMENT) {
      return null;
    }
    const limit = Math.min(segment.end, bytes.length);
    let offset = segment.start;
    let seekHeadPosition = null;
    let chaptersPosition = null;
    while (offset < limit) {
      const element = readElement(bytes, offset, limit);
      if (!element || element.end > limit || element.end <= offset) {
        break;
      }
      if (element.id === ID_SEEK_HEAD && seekHeadPosition == null) {
        seekHeadPosition = offset;
      }
      if (element.id === ID_CHAPTERS) {
        chaptersPosition = offset;
        break;
      }
      if (element.id === ID_CLUSTER) {
        break;
      }
      offset = element.end;
    }
    return { segmentDataStart: segment.start, seekHeadPosition, chaptersPosition };
  } catch (_) {
    return null;
  }
}

/** Element id to its position relative to the Segment payload, from a whole SeekHead. */
export function matroskaSeekHeadPositions(bytes) {
  try {
    const root = readElement(bytes, 0, bytes.length);
    if (!root || root.id !== ID_SEEK_HEAD) {
      return new Map();
    }
    const positions = new Map();
    childrenOf(bytes, root)
      .filter((element) => element.id === ID_SEEK)
      .forEach((seek) => {
        let targetId = null;
        let position = null;
        childrenOf(bytes, seek).forEach((child) => {
          if (child.id === ID_SEEK_ID) {
            targetId = readUnsigned(bytes, child);
          } else if (child.id === ID_SEEK_POSITION) {
            position = readUnsigned(bytes, child);
          }
        });
        if (targetId != null && position != null && !positions.has(targetId)) {
          positions.set(targetId, position);
        }
      });
    return positions;
  } catch (_) {
    return new Map();
  }
}

export function requestHeaders(headers = {}) {
  const result = {};
  Object.entries(headers || {}).forEach(([name, value]) => {
    if (
      !String(name).toLowerCase().startsWith("range") &&
      !String(name).toLowerCase().startsWith("accept-encoding") &&
      value != null
    ) {
      result[name] = String(value);
    }
  });
  return result;
}

export async function fetchRange(url, headers, start, length, signal) {
  let reader;
  try {
    const response = await fetch(url, {
      headers: {
        ...requestHeaders(headers),
        Range: `bytes=${start}-${start + length - 1}`,
        "Accept-Encoding": "identity"
      },
      signal,
      credentials: "omit"
    });
    const range = response.headers.get("content-range");
    const validStatus = response.status === 206 || (response.status === 200 && start === 0);
    if (
      !validStatus ||
      (start > 0 && !range) ||
      (range && !new RegExp(`^bytes ${start}-\\d+/\\d+$`, "i").test(range)) ||
      !response.body?.getReader
    ) {
      return null;
    }
    reader = response.body.getReader();
    const bytes = new Uint8Array(length);
    let read = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return bytes.subarray(0, read);
      }
      if (read + value.length > length) {
        return null;
      }
      bytes.set(value, read);
      read += value.length;
      if (read === length) {
        return bytes;
      }
    }
  } catch (_) {
    return null;
  } finally {
    if (reader) {
      void reader.cancel().catch(() => {});
    }
  }
}

async function elementAt(url, headers, initial, position, maxBytes, signal) {
  let header = position < initial.length ? readElement(initial, position, initial.length) : null;
  let headerStart = position;
  if (!header) {
    const probe = await fetchRange(url, headers, position, 64, signal);
    if (!probe) {
      return null;
    }
    header = readElement(probe, 0, probe.length);
    headerStart = 0;
    if (!header) {
      return null;
    }
  }
  if (header.end === Infinity) {
    return null;
  }
  const totalSize = header.end - headerStart;
  if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > maxBytes) {
    return null;
  }
  if (position + totalSize <= initial.length) {
    return initial.subarray(position, position + totalSize);
  }
  const element = await fetchRange(url, headers, position, totalSize, signal);
  return element && element.length === totalSize ? element : null;
}

export function isMatroskaSource(url = "", stream = null) {
  const mime = String(
    stream?.mimeType || stream?.raw?.mimeType || stream?.sourceType || stream?.raw?.sourceType || ""
  ).toLowerCase();
  if (mime.includes("matroska") || mime.includes("webm")) {
    return true;
  }
  const filename = String(
    stream?.behaviorHints?.filename ||
      stream?.raw?.behaviorHints?.filename ||
      stream?.raw?.filename ||
      ""
  ).trim();
  return /\.(mkv|webm)([?#]|$)/i.test(filename) || /\.(mkv|webm)([?#]|$)/i.test(String(url || ""));
}

/** Best-effort chapters over HTTP ranges; any failure leaves playback untouched. */
export async function fetchMatroskaChapters(url, headers = {}) {
  if (!/^https?:\/\//i.test(String(url || "")) || typeof AbortController !== "function") {
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const initial = await fetchRange(url, headers, 0, MAX_HEADER_BYTES, controller.signal);
    if (!initial) {
      return [];
    }
    const layout = matroskaChapterLayout(initial);
    if (!layout) {
      return [];
    }
    let chaptersPosition = layout.chaptersPosition;
    if (chaptersPosition == null && layout.seekHeadPosition != null) {
      const seekHead = await elementAt(
        url,
        headers,
        initial,
        layout.seekHeadPosition,
        MAX_HEADER_BYTES,
        controller.signal
      );
      if (seekHead) {
        const relative = matroskaSeekHeadPositions(seekHead).get(ID_CHAPTERS);
        if (relative != null) {
          chaptersPosition = layout.segmentDataStart + relative;
        }
      }
    }
    if (chaptersPosition == null) {
      return [];
    }
    const chapters = await elementAt(
      url,
      headers,
      initial,
      chaptersPosition,
      MAX_CHAPTERS_BYTES,
      controller.signal
    );
    return chapters ? parseMatroskaChapters(chapters) : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
