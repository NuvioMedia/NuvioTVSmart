import { fetchRange, requestHeaders } from "./matroskaChapters.js";

// MP4/MOV chapters over HTTP ranges. Two layouts are supported, in the order
// players usually expose them: Nero's `moov/udta/chpl` list, and the QuickTime
// chapter track (a text/sbtl/subt track referenced by another track's `tref/chap`).
// Any failure is best-effort: playback keeps working, chapters are simply absent.

const PROBE_TIMEOUT_MS = 8000;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;
const MAX_CHAPTERS = 500;
const MAX_SAMPLE_BYTES = 64 * 1024;

function u16(bytes, offset) {
  return offset + 2 <= bytes.length ? (bytes[offset] << 8) | bytes[offset + 1] : null;
}

function u32(bytes, offset) {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function u64(bytes, offset) {
  if (offset + 8 > bytes.length) {
    return null;
  }
  const high = u32(bytes, offset);
  const low = u32(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function typeAt(bytes, offset) {
  if (offset + 4 > bytes.length) {
    return "";
  }
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

/** ISO BMFF box header at `offset`; `size` is the full box size including the header. */
export function readBox(bytes, offset = 0) {
  if (offset + 8 > bytes.length) {
    return null;
  }
  const size32 = u32(bytes, offset);
  if (size32 == null) {
    return null;
  }
  const type = typeAt(bytes, offset + 4);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    const large = u64(bytes, offset + 8);
    if (large == null) {
      return null;
    }
    size = large;
    headerSize = 16;
  } else if (size32 === 0) {
    size = bytes.length - offset;
  }
  if (!type || size < headerSize) {
    return null;
  }
  return {
    type,
    start: offset,
    headerSize,
    dataStart: offset + headerSize,
    size,
    end: offset + size
  };
}

export function childBoxes(bytes, start, end = bytes.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = readBox(bytes, offset);
    if (!box || box.end > end || box.end <= offset) {
      break;
    }
    boxes.push(box);
    offset = box.end;
  }
  return boxes;
}

function payload(bytes, box) {
  return box ? bytes.subarray(box.dataStart, Math.min(box.end, bytes.length)) : new Uint8Array();
}

function utf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\0+$/, "").trim();
  } catch (_) {
    return "";
  }
}

function childrenOf(bytes, box) {
  return box ? childBoxes(bytes, box.dataStart, Math.min(box.end, bytes.length)) : [];
}

function parseChplPayload(data) {
  if (!data || data.length < 9) {
    return [];
  }
  const candidates = [
    { offset: 8, width: 1 },
    { offset: 4, width: 4 },
    { offset: 4, width: 1 }
  ];
  for (const candidate of candidates) {
    const count = candidate.width === 1 ? data[candidate.offset] : u32(data, candidate.offset);
    if (!Number.isInteger(count) || count <= 0 || count > MAX_CHAPTERS) {
      continue;
    }
    let offset = candidate.offset + candidate.width;
    const chapters = [];
    let valid = true;
    for (let index = 0; index < count; index += 1) {
      if (offset + 9 > data.length) {
        valid = false;
        break;
      }
      const start = u64(data, offset);
      const titleLength = data[offset + 8];
      offset += 9;
      if (start == null || offset + titleLength > data.length) {
        valid = false;
        break;
      }
      const title = utf8(data.subarray(offset, offset + titleLength));
      offset += titleLength;
      chapters.push({ startMs: Math.round(start / 10000), title: title || null });
    }
    if (valid && chapters.length === count) {
      return chapters;
    }
  }
  return [];
}

/** Nero chapter list (`chpl`) payload. Exported for tests. */
export function parseMp4Chpl(bytes) {
  return parseChplPayload(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
}

function handlerType(bytes, trak) {
  const mdia = childrenOf(bytes, trak).find((box) => box.type === "mdia");
  const hdlr = childrenOf(bytes, mdia).find((box) => box.type === "hdlr");
  const data = payload(bytes, hdlr);
  return data.length >= 12 ? typeAt(data, 8) : "";
}

function trackId(bytes, trak) {
  const tkhd = childrenOf(bytes, trak).find((box) => box.type === "tkhd");
  const data = payload(bytes, tkhd);
  if (!data.length) {
    return null;
  }
  const version = data[0];
  const offset = version === 1 ? 20 : 12;
  return u32(data, offset);
}

function mediaTimescale(bytes, trak) {
  const mdia = childrenOf(bytes, trak).find((box) => box.type === "mdia");
  const mdhd = childrenOf(bytes, mdia).find((box) => box.type === "mdhd");
  const data = payload(bytes, mdhd);
  if (!data.length) {
    return null;
  }
  const version = data[0];
  return u32(data, version === 1 ? 20 : 12);
}

function chapterTrackIds(bytes, trak) {
  const tref = childrenOf(bytes, trak).find((box) => box.type === "tref");
  const chap = childrenOf(bytes, tref).find((box) => box.type === "chap");
  if (!chap) {
    return [];
  }
  const data = payload(bytes, chap);
  const ids = [];
  for (let offset = 0; offset + 4 <= data.length; offset += 4) {
    const id = u32(data, offset);
    if (id != null) {
      ids.push(id);
    }
  }
  return ids;
}

function parseStts(bytes, box) {
  const data = payload(bytes, box);
  const count = u32(data, 4);
  if (count == null || count > 100000) {
    return [];
  }
  const entries = [];
  let offset = 8;
  for (let index = 0; index < count && offset + 8 <= data.length; index += 1) {
    const sampleCount = u32(data, offset);
    const delta = u32(data, offset + 4);
    if (sampleCount == null || delta == null) {
      break;
    }
    entries.push({ sampleCount, delta });
    offset += 8;
  }
  return entries;
}

function parseStsc(bytes, box) {
  const data = payload(bytes, box);
  const count = u32(data, 4);
  if (count == null || count > 100000) {
    return [];
  }
  const entries = [];
  let offset = 8;
  for (let index = 0; index < count && offset + 12 <= data.length; index += 1) {
    const firstChunk = u32(data, offset);
    const samplesPerChunk = u32(data, offset + 4);
    if (firstChunk == null || samplesPerChunk == null) {
      break;
    }
    entries.push({ firstChunk, samplesPerChunk });
    offset += 12;
  }
  return entries;
}

function parseStsz(bytes, box) {
  const data = payload(bytes, box);
  const sampleSize = u32(data, 4);
  const sampleCount = u32(data, 8);
  if (sampleSize == null || sampleCount == null || sampleCount > 100000) {
    return [];
  }
  if (sampleSize > 0) {
    return new Array(sampleCount).fill(sampleSize);
  }
  const sizes = [];
  let offset = 12;
  for (let index = 0; index < sampleCount && offset + 4 <= data.length; index += 1) {
    const size = u32(data, offset);
    if (size == null) {
      break;
    }
    sizes.push(size);
    offset += 4;
  }
  return sizes;
}

function parseChunkOffsets(bytes, box) {
  const data = payload(bytes, box);
  const count = u32(data, 4);
  if (count == null || count > 100000) {
    return [];
  }
  const offsets = [];
  let offset = 8;
  const width = box.type === "co64" ? 8 : 4;
  for (let index = 0; index < count && offset + width <= data.length; index += 1) {
    const value = width === 8 ? u64(data, offset) : u32(data, offset);
    if (value == null) {
      break;
    }
    offsets.push(value);
    offset += width;
  }
  return offsets;
}

function chapterTimeTable(stts) {
  const times = [];
  let ticks = 0;
  stts.forEach((entry) => {
    for (let index = 0; index < entry.sampleCount && times.length < MAX_CHAPTERS; index += 1) {
      times.push(ticks);
      ticks += entry.delta;
    }
  });
  return times;
}

function sampleOffsets(stsc, stsz, chunkOffsets) {
  const offsets = [];
  let sampleIndex = 0;
  for (let chunkIndex = 0; chunkIndex < chunkOffsets.length; chunkIndex += 1) {
    const chunkNumber = chunkIndex + 1;
    let mapping = stsc[0];
    for (const entry of stsc) {
      if (entry.firstChunk <= chunkNumber) {
        mapping = entry;
      } else {
        break;
      }
    }
    const samplesPerChunk = mapping?.samplesPerChunk || 0;
    let offset = chunkOffsets[chunkIndex];
    for (let index = 0; index < samplesPerChunk && sampleIndex < stsz.length; index += 1) {
      offsets.push({ offset, size: stsz[sampleIndex] });
      offset += stsz[sampleIndex];
      sampleIndex += 1;
    }
  }
  return offsets;
}

function decodeSampleText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length < 2) {
    return "";
  }
  const length = u16(data, 0);
  const end = length == null ? data.length : Math.min(data.length, 2 + length);
  return utf8(data.subarray(2, end));
}

function parseStblChapters(bytes, stbl, timescale) {
  if (!stbl || !timescale) {
    return [];
  }
  const children = childrenOf(bytes, stbl);
  const stts = parseStts(
    bytes,
    children.find((box) => box.type === "stts")
  );
  const stsc = parseStsc(
    bytes,
    children.find((box) => box.type === "stsc")
  );
  const stsz = parseStsz(
    bytes,
    children.find((box) => box.type === "stsz")
  );
  const chunkBox = children.find((box) => box.type === "stco" || box.type === "co64");
  const chunkOffsets = parseChunkOffsets(bytes, chunkBox);
  const times = chapterTimeTable(stts);
  const samples = sampleOffsets(stsc, stsz, chunkOffsets);
  return samples.slice(0, Math.min(times.length, MAX_CHAPTERS)).map((sample, index) => ({
    offset: sample.offset,
    size: Math.min(sample.size, MAX_SAMPLE_BYTES),
    startMs: Math.round((times[index] / timescale) * 1000)
  }));
}

/** Chapters from a moov payload (without the moov box header). Exported for tests. */
export async function parseMp4MoovChapters(moovBytes, { readSample = null } = {}) {
  const bytes = moovBytes instanceof Uint8Array ? moovBytes : new Uint8Array(moovBytes || []);
  const moov = readBox(bytes, 0);
  const moovPayload =
    moov && moov.type === "moov"
      ? bytes.subarray(moov.dataStart, Math.min(moov.end, bytes.length))
      : bytes;
  const root = { dataStart: 0, end: moovPayload.length };
  const boxes = childBoxes(moovPayload, 0, moovPayload.length);

  const udta = boxes.find((box) => box.type === "udta");
  const chpl = childrenOf(moovPayload, udta).find((box) => box.type === "chpl");
  if (chpl) {
    const chapters = parseChplPayload(payload(moovPayload, chpl));
    if (chapters.length) {
      return chapters.sort((left, right) => left.startMs - right.startMs);
    }
  }

  const traks = boxes.filter((box) => box.type === "trak");
  const trackIds = new Map();
  traks.forEach((trak) => trackIds.set(trackId(moovPayload, trak), trak));
  const referencedChapterIds = new Set();
  traks.forEach((trak) =>
    chapterTrackIds(moovPayload, trak).forEach((id) => referencedChapterIds.add(id))
  );

  let chapterTrak = null;
  for (const id of referencedChapterIds) {
    if (trackIds.has(id)) {
      chapterTrak = trackIds.get(id);
      break;
    }
  }
  if (!chapterTrak) {
    chapterTrak = traks.find((trak) =>
      ["text", "sbtl", "subt"].includes(handlerType(moovPayload, trak))
    );
  }
  if (!chapterTrak) {
    return [];
  }
  const mdia = childrenOf(moovPayload, chapterTrak).find((box) => box.type === "mdia");
  const minf = childrenOf(moovPayload, mdia).find((box) => box.type === "minf");
  const stbl = childrenOf(moovPayload, minf).find((box) => box.type === "stbl");
  const timescale = mediaTimescale(moovPayload, chapterTrak);
  const sampleRefs = parseStblChapters(moovPayload, stbl, timescale);
  if (!sampleRefs.length || typeof readSample !== "function") {
    return [];
  }
  const chapters = [];
  for (const sample of sampleRefs) {
    const data = await readSample(sample.offset, sample.size);
    if (!data || !data.length) {
      continue;
    }
    const title = decodeSampleText(data);
    if (!title) {
      continue;
    }
    chapters.push({ startMs: sample.startMs, title });
  }
  return chapters.sort((left, right) => left.startMs - right.startMs);
}

export function isMp4Source(url = "", stream = null) {
  const mime = String(
    stream?.mimeType || stream?.raw?.mimeType || stream?.sourceType || stream?.raw?.sourceType || ""
  ).toLowerCase();
  if (
    mime.includes("video/mp4") ||
    mime.includes("video/quicktime") ||
    mime.includes("video/x-m4v") ||
    mime === "mp4"
  ) {
    return true;
  }
  const filename = String(
    stream?.behaviorHints?.filename ||
      stream?.raw?.behaviorHints?.filename ||
      stream?.raw?.filename ||
      ""
  ).trim();
  return (
    /\.(mp4|m4v|mov|qt)([?#]|$)/i.test(filename) ||
    /\.(mp4|m4v|mov|qt)([?#]|$)/i.test(String(url || ""))
  );
}

async function findMoov(url, headers, signal) {
  let offset = 0;
  for (let index = 0; index < MAX_TOP_LEVEL_BOXES; index += 1) {
    const head = await fetchRange(url, headers, offset, 16, signal);
    if (!head || head.length < 8) {
      return null;
    }
    const box = readBox(head, 0);
    if (!box || !box.type) {
      return null;
    }
    if (box.type === "moov") {
      if (box.size > MAX_MOOV_BYTES) {
        return null;
      }
      const moov = await fetchRange(url, headers, offset, box.size, signal);
      return moov && moov.length === box.size ? moov : null;
    }
    if (box.size <= 0) {
      return null;
    }
    offset += box.size;
  }
  return null;
}

/** Best-effort MP4/MOV chapters over HTTP ranges. */
export async function fetchMp4Chapters(url, headers = {}) {
  if (!/^https?:\/\//i.test(String(url || "")) || typeof AbortController !== "function") {
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const moov = await findMoov(url, headers, controller.signal);
    if (!moov) {
      return [];
    }
    const readSample = async (offset, size) => {
      if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0) {
        return null;
      }
      return fetchRange(url, headers, offset, size, controller.signal);
    };
    return await parseMp4MoovChapters(moov, { readSample });
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
