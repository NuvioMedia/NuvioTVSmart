import { fetchRange, requestHeaders, runRangeProbe } from "../../data/repository/rangeProbe.js";

// Same probe budget as the chapter readers: subtitles must not wait longer than this.
const PROBE_TIMEOUT_MS = 8000;
const CHUNK_BYTES = 64 * 1024;
const MIN_FILE_BYTES = CHUNK_BYTES * 2;
const UINT32_BYTES = 2 ** 32;

function parseContentRangeTotal(value) {
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(String(value || "").trim());
  const total = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

function decodeFilename(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

export function parseContentDispositionFilename(value) {
  const text = String(value || "");
  if (!text) {
    return null;
  }
  const encoded = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(text);
  const plain = /filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]+))/i.exec(text);
  const raw = encoded ? encoded[2] : plain ? plain[1] || plain[2] : "";
  const name = decodeFilename(String(raw || "").trim())
    .split(/[\\/]/)
    .pop()
    .trim();
  return name && ![...name].some((char) => char.charCodeAt(0) < 32) ? name : null;
}

async function readHead(url, headers, probe) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { ...requestHeaders(headers), "Accept-Encoding": "identity" },
      ...(probe?.signal ? { signal: probe.signal } : {}),
      credentials: "omit"
    });
    if (probe?.expired || !response.ok) {
      return null;
    }
    const length = Number(response.headers.get("content-length"));
    return {
      fileSize: Number.isSafeInteger(length) && length > 0 ? length : null,
      filename: parseContentDispositionFilename(response.headers.get("content-disposition"))
    };
  } catch (_) {
    return null;
  }
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function addChunk(sum, bytes) {
  for (let offset = 0; offset + 8 <= bytes.length; offset += 8) {
    sum.low += readUint32LE(bytes, offset);
    sum.high += readUint32LE(bytes, offset + 4);
  }
}

function formatHash(fileSize, first, last) {
  const sum = { low: 0, high: 0 };
  addChunk(sum, first);
  addChunk(sum, last);
  const low = (sum.low + (fileSize % UINT32_BYTES)) >>> 0;
  const high =
    (sum.high + Math.floor(sum.low / UINT32_BYTES) + Math.floor(fileSize / UINT32_BYTES)) >>> 0;
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

/**
 * OpenSubtitles hash for a remote file: file size plus the first and last 64 KB,
 * read with two Range requests. Anything other than a direct http(s) file that
 * accepts ranges is skipped, so subtitle lookup falls back to its previous hints.
 */
export async function computeOpenSubtitlesHash(url, headers = {}) {
  const target = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(target);
  } catch (_) {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
  ) {
    return null;
  }

  return runRangeProbe(PROBE_TIMEOUT_MS, async (probe) => {
    const head = await readHead(target, headers, probe);
    if (head?.fileSize && head.fileSize < MIN_FILE_BYTES) {
      return null;
    }

    let firstHeaders = null;
    const first = await fetchRange(target, headers, 0, CHUNK_BYTES, probe, {
      partialOnly: true,
      onResponse: (response) => {
        firstHeaders = response.headers;
      }
    });
    if (first?.length !== CHUNK_BYTES) {
      return null;
    }

    const fileSize = head?.fileSize || parseContentRangeTotal(firstHeaders?.get("content-range"));
    if (!fileSize || fileSize < MIN_FILE_BYTES) {
      return null;
    }

    const last = await fetchRange(target, headers, fileSize - CHUNK_BYTES, CHUNK_BYTES, probe, {
      partialOnly: true
    });
    if (last?.length !== CHUNK_BYTES) {
      return null;
    }

    return {
      hash: formatHash(fileSize, first, last),
      fileSize,
      filename:
        head?.filename || parseContentDispositionFilename(firstHeaders?.get("content-disposition"))
    };
  });
}
