var http = require("http");
var https = require("https");
var net = require("net");
var zlib = require("zlib");

var HEADER_PROBE_BYTES = 2 * 1024 * 1024;
var CUES_PROBE_BYTES = 64 * 1024;
var MAX_CUES_BYTES = 8 * 1024 * 1024;
var MAX_CLUSTER_BYTES = 20 * 1024 * 1024;
var MAX_WINDOW_BYTES = 3 * 1024 * 1024;
var MAX_BLOCK_BYTES = 1024 * 1024;
var MAX_CUED_FRAME_CACHE_BYTES = 2 * 1024 * 1024;
var CUED_BLOCK_PROBE_BYTES = 64 * 1024;
var MAX_CUED_BLOCK_ELEMENT_BYTES = MAX_BLOCK_BYTES + 64 * 1024;
var MIN_CLUSTER_HEADER_BYTES = 5;
var MAX_CLUSTER_HEADER_BYTES = 12;
var MAX_REDIRECTS = 4;
var REQUEST_TIMEOUT_MS = 15000;
var MIN_ADDRESS_ATTEMPT_TIMEOUT_MS = 2500;
var METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
var WINDOW_CACHE_TTL_MS = 5 * 60 * 1000;
var MAX_METADATA_CACHE_ENTRIES = 6;
var MAX_WINDOW_CACHE_ENTRIES = 12;
var MAX_CUED_FRAME_CACHE_ENTRIES = 512;
var CUED_FRAME_CACHE_TTL_MS = 5 * 60 * 1000;
var WINDOW_BUCKET_SECONDS = 90;
var WINDOW_END_QUANTUM_SECONDS = 30;
var MIN_WINDOW_SECONDS = 120;
var MAX_WINDOW_SECONDS = 270;
var MAX_TEXT_SUBTITLE_WINDOW_BYTES = 512 * 1024;
var MAX_TEXT_ASS_BODY_BYTES = 512 * 1024;
var MAX_TEXT_CODEC_PRIVATE_BYTES = 256 * 1024;
var DEFAULT_TEXT_CUE_DURATION_MS = 5000;
var MAX_TEXT_CUE_DURATION_MS = 30000;
var MAX_CONCURRENT_CLUSTER_REQUESTS = 3;
var MAX_CONCURRENT_CUED_BLOCK_REQUESTS = 6;
var PGS_SYNC_SCAN_BATCH_CUES = 8;
var PGS_MAX_SYNC_SCAN_CUES = 96;
var PGS_MAX_SYNC_LOOKBACK_MS = 15 * 60 * 1000;

var BITMAP_SUBTITLE_FORMAT_BY_CODEC_ID = {
  S_VOBSUB: "vobsub",
  "S_HDMV/PGS": "pgs"
};

var ID_SEGMENT = 0x18538067;
var ID_SEEK_HEAD = 0x114d9b74;
var ID_SEEK = 0x4dbb;
var ID_SEEK_ID = 0x53ab;
var ID_SEEK_POSITION = 0x53ac;
var ID_INFO = 0x1549a966;
var ID_TIMECODE_SCALE = 0x2ad7b1;
var ID_TRACKS = 0x1654ae6b;
var ID_TRACK_ENTRY = 0xae;
var ID_TRACK_NUMBER = 0xd7;
var ID_TRACK_TYPE = 0x83;
var ID_CODEC_ID = 0x86;
var ID_CODEC_PRIVATE = 0x63a2;
var ID_LANGUAGE = 0x22b59c;
var ID_LANGUAGE_IETF = 0x22b59d;
var ID_NAME = 0x536e;
var ID_CONTENT_ENCODINGS = 0x6d80;
var ID_CONTENT_ENCODING = 0x6240;
var ID_CONTENT_COMPRESSION = 0x5034;
var ID_CONTENT_COMP_ALGO = 0x4254;
var ID_CONTENT_COMP_SETTINGS = 0x4255;
var ID_CUES = 0x1c53bb6b;
var ID_CUE_POINT = 0xbb;
var ID_CUE_TIME = 0xb3;
var ID_CUE_TRACK_POSITIONS = 0xb7;
var ID_CUE_TRACK = 0xf7;
var ID_CUE_CLUSTER_POSITION = 0xf1;
var ID_CUE_RELATIVE_POSITION = 0xf0;
var ID_CUE_DURATION = 0xb2;
var ID_CLUSTER = 0x1f43b675;
var ID_CLUSTER_TIMECODE = 0xe7;
var ID_SIMPLE_BLOCK = 0xa3;
var ID_BLOCK_GROUP = 0xa0;
var ID_BLOCK = 0xa1;
var ID_BLOCK_DURATION = 0x9b;

var PGS_SEGMENT_PRESENTATION_COMPOSITION = 0x16;
var PGS_COMPOSITION_STATE_EPOCH_START = 0x80;
var PGS_COMPOSITION_STATE_ACQUISITION_POINT = 0x40;
var PGS_TIMESTAMP_WRAP = 0x100000000;

var MPEG_PACK_HEADER = Buffer.from([
  0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0x04, 0x00, 0x04, 0x01, 0x00, 0x00, 0x03, 0xf8
]);

var metadataCache = new Map();
var metadataRequests = new Map();
var windowCache = new Map();
var windowRequests = new Map();
var textWindowCache = new Map();
var textWindowRequests = new Map();
var cuedFrameCache = new Map();
var cuedFrameCacheBytes = 0;
var clusterRangeRequests = new Map();
var activePgsWindowRequests = new Map();
var activeTextWindowRequests = new Map();

function bitmapSubtitleError(code, message, details) {
  var error = new Error(message);
  error.code = code;
  error.details = details || null;
  return error;
}

function normalizeMediaUrl(value) {
  var text = String(value || "").trim();
  var parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw bitmapSubtitleError("INVALID_URL", "Bitmap subtitle source URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw bitmapSubtitleError("INVALID_URL", "Bitmap subtitle source must use HTTP or HTTPS");
  }
  return parsed.href;
}

function trimCache(cache, maxEntries) {
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

function getCached(cache, key) {
  var entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCached(cache, key, value, ttlMs, maxEntries) {
  cache.delete(key);
  cache.set(key, { value: value, expiresAt: Date.now() + ttlMs });
  trimCache(cache, maxEntries);
}

function getCachedCuedFrame(key) {
  var entry = cuedFrameCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cuedFrameCache.delete(key);
    cuedFrameCacheBytes -= entry.bytes;
    return null;
  }
  cuedFrameCache.delete(key);
  cuedFrameCache.set(key, entry);
  return entry.value;
}

function setCachedCuedFrame(key, frame) {
  var payloadBytes = Number(frame && frame.payload && frame.payload.length) || 0;
  if (payloadBytes > MAX_CUED_FRAME_CACHE_BYTES) return;
  var previous = cuedFrameCache.get(key);
  if (previous) {
    cuedFrameCacheBytes -= previous.bytes;
    cuedFrameCache.delete(key);
  }
  cuedFrameCache.set(key, {
    value: frame,
    expiresAt: Date.now() + CUED_FRAME_CACHE_TTL_MS,
    bytes: payloadBytes
  });
  cuedFrameCacheBytes += payloadBytes;
  while (
    cuedFrameCache.size > MAX_CUED_FRAME_CACHE_ENTRIES ||
    cuedFrameCacheBytes > MAX_CUED_FRAME_CACHE_BYTES
  ) {
    var oldestKey = cuedFrameCache.keys().next().value;
    var oldest = cuedFrameCache.get(oldestKey);
    cuedFrameCache.delete(oldestKey);
    cuedFrameCacheBytes -= oldest ? oldest.bytes : 0;
  }
}

function cuedFrameCacheKey(mediaUrl, track, cue) {
  return (
    mediaUrl +
    "::" +
    String(track && track.number) +
    "::" +
    String(cue && cue.clusterPosition) +
    "::" +
    String(cue && cue.relativePosition) +
    "::" +
    String(cue && cue.timeTicks) +
    "::" +
    String(cue && cue.timeMs) +
    "::" +
    String(cue && cue.durationTicks)
  );
}

function requestRange(url, start, end, maxBytes, redirects, requestContext) {
  var redirectCount = Number(redirects || 0);
  return new Promise(function (resolve, reject) {
    if (requestContext && requestContext.cancelled) {
      reject(bitmapSubtitleError("REQUEST_SUPERSEDED", "Bitmap subtitle request was superseded"));
      return;
    }
    var parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      reject(bitmapSubtitleError("INVALID_URL", "Invalid bitmap subtitle range URL"));
      return;
    }

    var transport = parsed.protocol === "https:" ? https : http;
    var req = transport.request(
      parsed,
      {
        method: "GET",
        // Node 20 can abandon a viable IPv4 connection after 250 ms, then
        // fail on unroutable IPv6. Keep dual-stack selection, but allow the
        // measured slow handshakes without changing process-wide defaults.
        autoSelectFamilyAttemptTimeout:
          typeof net.getDefaultAutoSelectFamilyAttemptTimeout === "function"
            ? Math.max(
                MIN_ADDRESS_ATTEMPT_TIMEOUT_MS,
                net.getDefaultAutoSelectFamilyAttemptTimeout()
              )
            : undefined,
        headers: {
          Range: "bytes=" + start + "-" + end,
          "Accept-Encoding": "identity",
          "User-Agent": "NuvioTV/bitmap-subtitles"
        }
      },
      function (res) {
        var statusCode = Number(res.statusCode || 0);
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          if (requestContext) requestContext.requests.delete(req);
          if (redirectCount >= MAX_REDIRECTS) {
            reject(
              bitmapSubtitleError(
                "TOO_MANY_REDIRECTS",
                "Bitmap subtitle source redirected too many times"
              )
            );
            return;
          }
          var redirected = new URL(res.headers.location, parsed).href;
          requestRange(redirected, start, end, maxBytes, redirectCount + 1, requestContext).then(
            resolve,
            reject
          );
          return;
        }

        if (statusCode !== 206 && !(statusCode === 200 && start === 0)) {
          res.resume();
          if (requestContext) requestContext.requests.delete(req);
          reject(
            bitmapSubtitleError(
              "RANGE_UNAVAILABLE",
              "Bitmap subtitle source did not honor HTTP Range",
              { statusCode: statusCode }
            )
          );
          return;
        }

        var chunks = [];
        var received = 0;
        res.on("data", function (chunk) {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy(
              bitmapSubtitleError(
                "RANGE_TOO_LARGE",
                "Bitmap subtitle range exceeded its safety limit"
              )
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", function () {
          var totalSize = null;
          var contentRange = String(res.headers["content-range"] || "");
          var rangeMatch = contentRange.match(/bytes\s+\d+-\d+\/(\d+|\*)/i);
          if (rangeMatch && rangeMatch[1] !== "*") {
            totalSize = Number(rangeMatch[1]);
          } else if (statusCode === 200) {
            totalSize = Number(res.headers["content-length"] || 0) || null;
          }
          if (requestContext) requestContext.requests.delete(req);
          resolve({
            buffer: Buffer.concat(chunks),
            totalSize: totalSize,
            finalUrl: parsed.href,
            statusCode: statusCode
          });
        });
      }
    );

    if (requestContext) requestContext.requests.add(req);

    req.setTimeout(REQUEST_TIMEOUT_MS, function () {
      req.destroy(bitmapSubtitleError("RANGE_TIMEOUT", "Bitmap subtitle range request timed out"));
    });
    req.on("error", function (error) {
      if (requestContext) requestContext.requests.delete(req);
      reject(error);
    });
    req.end();
  });
}

function vintWidth(firstByte) {
  if (!firstByte) return 0;
  for (var width = 1; width <= 8; width += 1) {
    if (firstByte & (1 << (8 - width))) return width;
  }
  return 0;
}

function readElementId(data, offset) {
  var first = data[offset];
  var width = vintWidth(first);
  if (!width || width > 4 || offset + width > data.length) return null;
  var value = first;
  for (var index = 1; index < width; index += 1) {
    value = value * 256 + data[offset + index];
  }
  return { value: value >>> 0, width: width };
}

function readVint(data, offset) {
  var first = data[offset];
  var width = vintWidth(first);
  if (!width || offset + width > data.length) return null;
  var marker = 1 << (8 - width);
  var value = first & (marker - 1);
  for (var index = 1; index < width; index += 1) {
    value = value * 256 + data[offset + index];
  }
  return { value: value, width: width };
}

function readElement(data, offset, limit, allowTruncated) {
  var id = readElementId(data, offset);
  if (!id) return null;
  var size = readVint(data, offset + id.width);
  if (!size) return null;
  var unknown = size.value === Math.pow(2, size.width * 7) - 1;
  var dataStart = offset + id.width + size.width;
  var dataEnd = unknown ? limit : dataStart + size.value;
  if (dataStart > limit || (!allowTruncated && dataEnd > limit)) return null;
  return {
    id: id.value,
    start: offset,
    dataStart: dataStart,
    dataEnd: Math.min(dataEnd, limit),
    declaredDataEnd: dataEnd,
    totalSize: unknown ? null : dataEnd - offset,
    truncated: dataEnd > limit,
    unknownSize: unknown
  };
}

function childElements(data, start, end) {
  var items = [];
  var offset = start;
  while (offset < end) {
    var element = readElement(data, offset, end, false);
    if (!element || element.declaredDataEnd <= offset) break;
    items.push(element);
    offset = element.declaredDataEnd;
  }
  return items;
}

function findChild(data, parent, id) {
  var children = childElements(data, parent.dataStart, parent.dataEnd);
  for (var index = 0; index < children.length; index += 1) {
    if (children[index].id === id) return children[index];
  }
  return null;
}

function readUnsigned(data, element) {
  if (!element) return null;
  var size = element.dataEnd - element.dataStart;
  if (size <= 0 || size > 8) return null;
  var value = 0;
  for (var index = element.dataStart; index < element.dataEnd; index += 1) {
    value = value * 256 + data[index];
  }
  return value;
}

function readString(data, element) {
  if (!element) return "";
  return data
    .slice(element.dataStart, element.dataEnd)
    .toString("utf8")
    .replace(/\0+$/g, "")
    .trim();
}

function readBinaryId(data, element) {
  if (!element) return null;
  var value = 0;
  for (var index = element.dataStart; index < element.dataEnd; index += 1) {
    value = value * 256 + data[index];
  }
  return value >>> 0;
}

function parseCompression(data, trackEntry) {
  var encodings = findChild(data, trackEntry, ID_CONTENT_ENCODINGS);
  if (!encodings) return { type: "none", settings: Buffer.alloc(0) };
  var encoding = findChild(data, encodings, ID_CONTENT_ENCODING);
  var compression = encoding ? findChild(data, encoding, ID_CONTENT_COMPRESSION) : null;
  if (!compression) return { type: "none", settings: Buffer.alloc(0) };
  var algo = readUnsigned(data, findChild(data, compression, ID_CONTENT_COMP_ALGO));
  var settingsElement = findChild(data, compression, ID_CONTENT_COMP_SETTINGS);
  var settings = settingsElement
    ? Buffer.from(data.slice(settingsElement.dataStart, settingsElement.dataEnd))
    : Buffer.alloc(0);
  if (algo == null || algo === 0) return { type: "zlib", settings: settings };
  if (algo === 3) return { type: "header", settings: settings };
  return { type: "unsupported", algorithm: algo, settings: settings };
}

function parseTracks(data, tracksElement) {
  return childElements(data, tracksElement.dataStart, tracksElement.dataEnd)
    .filter(function (entry) {
      return entry.id === ID_TRACK_ENTRY;
    })
    .map(function (entry) {
      var codecPrivate = findChild(data, entry, ID_CODEC_PRIVATE);
      return {
        number: readUnsigned(data, findChild(data, entry, ID_TRACK_NUMBER)),
        type: readUnsigned(data, findChild(data, entry, ID_TRACK_TYPE)),
        codecId: readString(data, findChild(data, entry, ID_CODEC_ID)),
        language:
          readString(data, findChild(data, entry, ID_LANGUAGE_IETF)) ||
          readString(data, findChild(data, entry, ID_LANGUAGE)),
        name: readString(data, findChild(data, entry, ID_NAME)),
        codecPrivate: codecPrivate
          ? Buffer.from(data.slice(codecPrivate.dataStart, codecPrivate.dataEnd))
          : Buffer.alloc(0),
        compression: parseCompression(data, entry)
      };
    });
}

function parseHeader(data, totalSize) {
  var offset = 0;
  var segment = null;
  while (offset < data.length) {
    var top = readElement(data, offset, data.length, true);
    if (!top) break;
    if (top.id === ID_SEGMENT) {
      segment = top;
      break;
    }
    if (top.truncated) break;
    offset = top.declaredDataEnd;
  }
  if (!segment) throw bitmapSubtitleError("INVALID_MATROSKA", "Matroska Segment was not found");

  var seekPositions = {};
  var timecodeScaleNs = 1000000;
  var tracks = [];
  var childOffset = segment.dataStart;
  while (childOffset < data.length) {
    var child = readElement(data, childOffset, data.length, true);
    if (!child || child.truncated) break;
    if (child.id === ID_SEEK_HEAD) {
      childElements(data, child.dataStart, child.dataEnd).forEach(function (seek) {
        if (seek.id !== ID_SEEK) return;
        var targetId = readBinaryId(data, findChild(data, seek, ID_SEEK_ID));
        var position = readUnsigned(data, findChild(data, seek, ID_SEEK_POSITION));
        if (targetId != null && position != null) seekPositions[targetId] = position;
      });
    } else if (child.id === ID_INFO) {
      var scale = readUnsigned(data, findChild(data, child, ID_TIMECODE_SCALE));
      if (scale) timecodeScaleNs = scale;
    } else if (child.id === ID_TRACKS) {
      tracks = parseTracks(data, child);
    }
    childOffset = child.declaredDataEnd;
  }

  if (!tracks.length)
    throw bitmapSubtitleError(
      "TRACKS_NOT_FOUND",
      "Matroska tracks were not found in the header probe"
    );
  if (seekPositions[ID_CUES] == null)
    throw bitmapSubtitleError("CUES_NOT_FOUND", "Matroska SeekHead does not reference Cues");
  return {
    totalSize: totalSize,
    segmentDataStart: segment.dataStart,
    segmentDataEnd:
      segment.totalSize == null ? totalSize : Math.min(totalSize, segment.declaredDataEnd),
    cuesOffset: segment.dataStart + seekPositions[ID_CUES],
    timecodeScaleNs: timecodeScaleNs,
    tracks: tracks
  };
}

function parseCues(data, timecodeScaleNs) {
  var cuesElement = readElement(data, 0, data.length, false);
  if (!cuesElement || cuesElement.id !== ID_CUES) {
    throw bitmapSubtitleError("INVALID_CUES", "Matroska Cues element is invalid or truncated");
  }
  var cues = [];
  childElements(data, cuesElement.dataStart, cuesElement.dataEnd).forEach(function (point) {
    if (point.id !== ID_CUE_POINT) return;
    var cueTicks = readUnsigned(data, findChild(data, point, ID_CUE_TIME));
    if (cueTicks == null) return;
    var timeMs = (cueTicks * timecodeScaleNs) / 1000000;
    childElements(data, point.dataStart, point.dataEnd).forEach(function (position) {
      if (position.id !== ID_CUE_TRACK_POSITIONS) return;
      var track = readUnsigned(data, findChild(data, position, ID_CUE_TRACK));
      var clusterPosition = readUnsigned(data, findChild(data, position, ID_CUE_CLUSTER_POSITION));
      var relativePosition = readUnsigned(
        data,
        findChild(data, position, ID_CUE_RELATIVE_POSITION)
      );
      var durationTicks = readUnsigned(data, findChild(data, position, ID_CUE_DURATION));
      if (track == null || clusterPosition == null) return;
      cues.push({
        timeMs: timeMs,
        timeTicks: cueTicks,
        track: track,
        clusterPosition: clusterPosition,
        relativePosition: relativePosition,
        durationTicks: durationTicks
      });
    });
  });
  cues.sort(function (left, right) {
    return (
      left.timeMs - right.timeMs ||
      left.clusterPosition - right.clusterPosition ||
      Number(left.relativePosition || 0) - Number(right.relativePosition || 0) ||
      left.track - right.track
    );
  });
  if (!cues.length)
    throw bitmapSubtitleError("EMPTY_CUES", "Matroska Cues did not contain usable positions");
  return cues;
}

async function loadMetadata(mediaUrl) {
  var cached = getCached(metadataCache, mediaUrl);
  if (cached) return cached;
  if (metadataRequests.has(mediaUrl)) return metadataRequests.get(mediaUrl);

  var request = (async function () {
    var head = await requestRange(mediaUrl, 0, HEADER_PROBE_BYTES - 1, HEADER_PROBE_BYTES);
    if (!head.totalSize)
      throw bitmapSubtitleError("SIZE_UNKNOWN", "Bitmap subtitle source size is unknown");
    var metadata = parseHeader(head.buffer, head.totalSize);
    var cuesProbeEnd = Math.min(metadata.totalSize - 1, metadata.cuesOffset + CUES_PROBE_BYTES - 1);
    var cuesProbe = await requestRange(
      mediaUrl,
      metadata.cuesOffset,
      cuesProbeEnd,
      CUES_PROBE_BYTES
    );
    var cuesHeader = readElement(cuesProbe.buffer, 0, cuesProbe.buffer.length, true);
    if (!cuesHeader || cuesHeader.id !== ID_CUES || cuesHeader.totalSize == null) {
      throw bitmapSubtitleError("INVALID_CUES", "Matroska Cues size could not be determined");
    }
    if (cuesHeader.totalSize > MAX_CUES_BYTES) {
      throw bitmapSubtitleError(
        "CUES_TOO_LARGE",
        "Matroska Cues exceed the supported safety limit"
      );
    }
    var cuesBuffer = cuesProbe.buffer;
    if (cuesBuffer.length < cuesHeader.totalSize) {
      cuesBuffer = (
        await requestRange(
          mediaUrl,
          metadata.cuesOffset,
          metadata.cuesOffset + cuesHeader.totalSize - 1,
          MAX_CUES_BYTES
        )
      ).buffer;
    }
    metadata.cues = parseCues(cuesBuffer, metadata.timecodeScaleNs);
    metadata.clusterPositions = Array.from(
      new Set(
        metadata.cues.map(function (cue) {
          return cue.clusterPosition;
        })
      )
    ).sort(function (a, b) {
      return a - b;
    });
    setCached(metadataCache, mediaUrl, metadata, METADATA_CACHE_TTL_MS, MAX_METADATA_CACHE_ENTRIES);
    return metadata;
  })();

  metadataRequests.set(mediaUrl, request);
  try {
    return await request;
  } finally {
    metadataRequests.delete(mediaUrl);
  }
}

function decodeBlockPayload(payload, compression) {
  if (!compression || compression.type === "none") return payload;
  if (compression.type === "header") return Buffer.concat([compression.settings, payload]);
  if (compression.type === "zlib") {
    var inflated = zlib.inflateSync(payload, { maxOutputLength: MAX_BLOCK_BYTES });
    if (inflated.length > MAX_BLOCK_BYTES) {
      throw bitmapSubtitleError(
        "BLOCK_TOO_LARGE",
        "Inflated bitmap subtitle block exceeded its safety limit"
      );
    }
    return inflated;
  }
  throw bitmapSubtitleError(
    "UNSUPPORTED_COMPRESSION",
    "Unsupported Matroska subtitle compression",
    {
      algorithm: compression.algorithm
    }
  );
}

function getBitmapSubtitleFormat(track) {
  return BITMAP_SUBTITLE_FORMAT_BY_CODEC_ID[String((track && track.codecId) || "")] || null;
}

function isBitmapSubtitleTrack(track) {
  return Boolean(track && track.type === 0x11 && getBitmapSubtitleFormat(track));
}

function validateVobSubPayload(payload) {
  if (!payload || payload.length < 4) return false;
  var packetSize = payload.readUInt16BE(0);
  var controlOffset = payload.readUInt16BE(2);
  return packetSize === payload.length && controlOffset >= 4 && controlOffset <= packetSize;
}

function parseBlock(
  data,
  element,
  track,
  clusterTicks,
  timecodeScaleNs,
  blockOrder,
  blockDurationTicks
) {
  var raw = data.slice(element.dataStart, element.dataEnd);
  var trackVint = readVint(raw, 0);
  if (!trackVint || trackVint.value !== track.number || raw.length < trackVint.width + 3)
    return null;
  var relativeTicks = raw.readInt16BE(trackVint.width);
  var flags = raw[trackVint.width + 2];
  if ((flags & 0x06) !== 0) {
    throw bitmapSubtitleError(
      "LACED_BITMAP_SUBTITLE",
      "Laced Matroska bitmap subtitle blocks are not supported"
    );
  }
  var payload = decodeBlockPayload(raw.slice(trackVint.width + 3), track.compression);
  if (payload.length > MAX_BLOCK_BYTES) {
    throw bitmapSubtitleError("BLOCK_TOO_LARGE", "Bitmap subtitle block exceeded its safety limit");
  }
  var absoluteTicks = clusterTicks + relativeTicks;
  if (absoluteTicks < 0) return null;
  var timestampNs = absoluteTicks * timecodeScaleNs;
  var durationTicks = Number(blockDurationTicks || 0);
  return {
    timestampMs: timestampNs / 1000000,
    timestampNs: timestampNs,
    durationMs:
      Number.isFinite(durationTicks) && durationTicks > 0
        ? (durationTicks * timecodeScaleNs) / 1000000
        : 0,
    payload: payload,
    blockOrder: Number(blockOrder || 0)
  };
}

function parseCluster(data, track, timecodeScaleNs) {
  var cluster = readElement(data, 0, data.length, false);
  if (!cluster || cluster.id !== ID_CLUSTER) {
    throw bitmapSubtitleError("INVALID_CLUSTER", "Matroska cluster range is invalid or truncated");
  }
  var children = childElements(data, cluster.dataStart, cluster.dataEnd);
  var clusterTicks = 0;
  for (var index = 0; index < children.length; index += 1) {
    if (children[index].id === ID_CLUSTER_TIMECODE) {
      clusterTicks = readUnsigned(data, children[index]) || 0;
      break;
    }
  }
  var frames = [];
  children.forEach(function (child, childIndex) {
    var block = null;
    var blockDurationTicks = 0;
    if (child.id === ID_SIMPLE_BLOCK) {
      block = child;
    } else if (child.id === ID_BLOCK_GROUP) {
      block = findChild(data, child, ID_BLOCK);
      blockDurationTicks = readUnsigned(data, findChild(data, child, ID_BLOCK_DURATION)) || 0;
    }
    if (!block) return;
    var frame = parseBlock(
      data,
      block,
      track,
      clusterTicks,
      timecodeScaleNs,
      childIndex,
      blockDurationTicks
    );
    if (frame) frames.push(frame);
  });
  return frames;
}

function nextClusterPosition(metadata, clusterPosition) {
  for (var index = 0; index < metadata.clusterPositions.length; index += 1) {
    if (metadata.clusterPositions[index] > clusterPosition) return metadata.clusterPositions[index];
  }
  return metadata.segmentDataEnd - metadata.segmentDataStart;
}

function selectClusterPositions(metadata, trackNumber, startMs, endMs) {
  var trackCues = metadata.cues.filter(function (cue) {
    return cue.track === trackNumber;
  });
  var selected = trackCues.filter(function (cue) {
    return cue.timeMs >= startMs && cue.timeMs <= endMs;
  });
  var previous = null;
  trackCues.forEach(function (cue) {
    if (cue.timeMs < startMs && (!previous || cue.timeMs > previous.timeMs)) previous = cue;
  });
  if (previous && startMs - previous.timeMs <= 30000) selected.unshift(previous);
  if (!selected.length) return [];
  return Array.from(
    new Set(
      selected.map(function (cue) {
        return cue.clusterPosition;
      })
    )
  ).sort(function (a, b) {
    return a - b;
  });
}

function getTrackCues(metadata, trackNumber) {
  var seenPositions = new Set();
  return metadata.cues.filter(function (cue) {
    var key =
      cue.relativePosition == null
        ? String(cue.clusterPosition)
        : cue.clusterPosition + ":" + cue.relativePosition;
    if (cue.track !== trackNumber || seenPositions.has(key)) return false;
    seenPositions.add(key);
    return true;
  });
}

function selectTextSubtitleCues(metadata, trackNumber, startMs, endMs) {
  var trackCues = getTrackCues(metadata, trackNumber);
  var selected = trackCues.filter(function (cue) {
    return cue.timeMs >= startMs && cue.timeMs <= endMs;
  });
  var previous = null;
  trackCues.forEach(function (cue) {
    if (cue.timeMs < startMs && (!previous || cue.timeMs > previous.timeMs)) previous = cue;
  });
  if (previous && startMs - previous.timeMs <= 30000) selected.unshift(previous);
  return selected;
}

function cuePositionKey(cue) {
  return cue.clusterPosition + ":" + cue.relativePosition;
}

function buildClusterRanges(metadata, positions) {
  return positions.map(function (clusterPosition) {
    var nextPosition = nextClusterPosition(metadata, clusterPosition);
    var clusterSize = nextPosition - clusterPosition;
    if (clusterSize <= 0 || clusterSize > MAX_CLUSTER_BYTES) {
      throw bitmapSubtitleError(
        "CLUSTER_TOO_LARGE",
        "Matroska subtitle cluster exceeded its safety limit",
        { clusterSize: clusterSize }
      );
    }
    return {
      clusterPosition: clusterPosition,
      absoluteStart: metadata.segmentDataStart + clusterPosition,
      clusterSize: clusterSize
    };
  });
}

async function loadClusterFrames(mediaUrl, metadata, track, positions, requestContext) {
  var clusterRanges = buildClusterRanges(
    metadata,
    Array.from(new Set(positions)).sort(function (left, right) {
      return left - right;
    })
  );
  var clusterFrames = await mapWithConcurrency(
    clusterRanges,
    MAX_CONCURRENT_CLUSTER_REQUESTS,
    async function (range) {
      var response = await requestClusterRange(
        mediaUrl,
        range.absoluteStart,
        range.clusterSize,
        requestContext
      );
      return parseCluster(response.buffer, track, metadata.timecodeScaleNs).map(function (frame) {
        return Object.assign(frame, { clusterPosition: range.clusterPosition });
      });
    }
  );
  var frames = [];
  clusterFrames.forEach(function (entries) {
    frames.push.apply(frames, entries);
  });
  frames.sort(compareFrames);
  return frames;
}

function invalidCuePosition(message, details) {
  return bitmapSubtitleError("INVALID_CUE_POSITION", message, details);
}

function getCuedBlockTrackNumber(data, element) {
  var block = element;
  if (element.id === ID_BLOCK_GROUP) {
    var childOffset = element.dataStart;
    block = null;
    while (childOffset < element.dataEnd) {
      var child = readElement(data, childOffset, element.dataEnd, true);
      if (!child) break;
      if (child.id === ID_BLOCK) {
        block = child;
        break;
      }
      if (child.truncated || child.declaredDataEnd <= childOffset) break;
      childOffset = child.declaredDataEnd;
    }
    if (!block) return null;
  }
  var trackVint = readVint(data, block.dataStart);
  return trackVint ? trackVint.value : null;
}

function findCuedBlockElement(data, track) {
  for (
    var offset = MIN_CLUSTER_HEADER_BYTES;
    offset <= MAX_CLUSTER_HEADER_BYTES && offset < data.length;
    offset += 1
  ) {
    var element = readElement(data, offset, data.length, true);
    if (
      element &&
      (element.id === ID_SIMPLE_BLOCK || element.id === ID_BLOCK_GROUP) &&
      element.totalSize != null &&
      getCuedBlockTrackNumber(data, element) === track.number
    ) {
      return element;
    }
  }
  return null;
}

function parseCuedBlock(data, element, track, cue, timecodeScaleNs) {
  var block = null;
  var blockDurationTicks = 0;
  if (element.id === ID_SIMPLE_BLOCK) {
    block = element;
  } else if (element.id === ID_BLOCK_GROUP) {
    block = findChild(data, element, ID_BLOCK);
    blockDurationTicks = readUnsigned(data, findChild(data, element, ID_BLOCK_DURATION)) || 0;
  }
  if (!block) {
    throw invalidCuePosition("CueRelativePosition did not reference a subtitle block", {
      clusterPosition: cue.clusterPosition,
      relativePosition: cue.relativePosition
    });
  }
  var raw = data.slice(block.dataStart, block.dataEnd);
  var trackVint = readVint(raw, 0);
  if (!trackVint || trackVint.value !== track.number || raw.length < trackVint.width + 3) {
    throw invalidCuePosition("CueRelativePosition referenced a different Matroska track", {
      clusterPosition: cue.clusterPosition,
      relativePosition: cue.relativePosition
    });
  }
  var flags = raw[trackVint.width + 2];
  if ((flags & 0x06) !== 0) {
    throw bitmapSubtitleError(
      "LACED_BITMAP_SUBTITLE",
      "Laced Matroska bitmap subtitle blocks are not supported"
    );
  }
  var payload = decodeBlockPayload(raw.slice(trackVint.width + 3), track.compression);
  if (payload.length > MAX_BLOCK_BYTES) {
    throw bitmapSubtitleError("BLOCK_TOO_LARGE", "Bitmap subtitle block exceeded its safety limit");
  }
  var timestampNs = cue.timeTicks * timecodeScaleNs;
  var durationTicks = blockDurationTicks || Number(cue.durationTicks || 0);
  return {
    timestampMs: cue.timeMs,
    timestampNs: timestampNs,
    durationMs:
      Number.isFinite(durationTicks) && durationTicks > 0
        ? (durationTicks * timecodeScaleNs) / 1000000
        : 0,
    payload: payload,
    blockOrder: cue.relativePosition,
    clusterPosition: cue.clusterPosition
  };
}

async function loadCuedBlockFrame(mediaUrl, metadata, track, cue, requestContext) {
  if (cue.relativePosition == null || cue.relativePosition < 0) {
    throw invalidCuePosition("Cue has no usable CueRelativePosition", {
      clusterPosition: cue.clusterPosition
    });
  }
  var clusterEnd = metadata.segmentDataStart + nextClusterPosition(metadata, cue.clusterPosition);
  var probeStart = metadata.segmentDataStart + cue.clusterPosition + cue.relativePosition;
  var availableBytes = clusterEnd - probeStart;
  if (availableBytes <= 0) {
    throw invalidCuePosition("CueRelativePosition points outside its Cluster", {
      clusterPosition: cue.clusterPosition,
      relativePosition: cue.relativePosition
    });
  }
  var probeBytes = Math.min(CUED_BLOCK_PROBE_BYTES + MAX_CLUSTER_HEADER_BYTES, availableBytes);
  var response = await requestRange(
    mediaUrl,
    probeStart,
    probeStart + probeBytes - 1,
    CUED_BLOCK_PROBE_BYTES + MAX_CLUSTER_HEADER_BYTES,
    0,
    requestContext
  );
  var element = findCuedBlockElement(response.buffer, track);
  var absoluteStart = element ? probeStart + element.start : probeStart;
  var elementAvailableBytes = clusterEnd - absoluteStart;
  if (
    !element ||
    element.totalSize > MAX_CUED_BLOCK_ELEMENT_BYTES ||
    element.totalSize > elementAvailableBytes
  ) {
    throw invalidCuePosition("CueRelativePosition referenced an invalid block element", {
      clusterPosition: cue.clusterPosition,
      relativePosition: cue.relativePosition
    });
  }
  var blockData = response.buffer.slice(element.start);
  if (blockData.length < element.totalSize) {
    blockData = (
      await requestRange(
        mediaUrl,
        absoluteStart,
        absoluteStart + element.totalSize - 1,
        MAX_CUED_BLOCK_ELEMENT_BYTES,
        0,
        requestContext
      )
    ).buffer;
    element = readElement(blockData, 0, blockData.length, false);
  } else {
    blockData = blockData.slice(0, element.totalSize);
    element = readElement(blockData, 0, blockData.length, false);
  }
  if (!element) {
    throw invalidCuePosition("Cued subtitle block is truncated", {
      clusterPosition: cue.clusterPosition,
      relativePosition: cue.relativePosition
    });
  }
  return parseCuedBlock(blockData, element, track, cue, metadata.timecodeScaleNs);
}

async function loadCueFrames(mediaUrl, metadata, track, cues, requestContext) {
  var directCues = [];
  var fallbackPositions = [];
  cues.forEach(function (cue) {
    if (cue.relativePosition == null) fallbackPositions.push(cue.clusterPosition);
    else directCues.push(cue);
  });
  var directResults = await mapWithConcurrency(
    directCues,
    MAX_CONCURRENT_CUED_BLOCK_REQUESTS,
    async function (cue) {
      if (requestContext && requestContext.cancelled) {
        throw bitmapSubtitleError("REQUEST_SUPERSEDED", "Bitmap subtitle request was superseded");
      }
      var cacheKey = cuedFrameCacheKey(mediaUrl, track, cue);
      var cachedFrame = getCachedCuedFrame(cacheKey);
      if (cachedFrame) return { frame: cachedFrame };
      try {
        var frame = await loadCuedBlockFrame(mediaUrl, metadata, track, cue, requestContext);
        setCachedCuedFrame(cacheKey, frame);
        if (requestContext && requestContext.cancelled) {
          throw bitmapSubtitleError("REQUEST_SUPERSEDED", "Bitmap subtitle request was superseded");
        }
        return {
          frame: frame
        };
      } catch (error) {
        if (error && error.code === "INVALID_CUE_POSITION") {
          return { fallbackClusterPosition: cue.clusterPosition };
        }
        throw error;
      }
    }
  );
  var frames = [];
  directResults.forEach(function (result) {
    if (result.frame) frames.push(result.frame);
    if (result.fallbackClusterPosition != null) {
      fallbackPositions.push(result.fallbackClusterPosition);
    }
  });
  if (fallbackPositions.length) {
    var fallbackClusters = new Set(fallbackPositions);
    frames = frames.filter(function (frame) {
      return !fallbackClusters.has(frame.clusterPosition);
    });
    frames.push.apply(
      frames,
      await loadClusterFrames(
        mediaUrl,
        metadata,
        track,
        Array.from(fallbackClusters),
        requestContext
      )
    );
  }
  frames.sort(compareFrames);
  return frames;
}

function compareFrames(left, right) {
  return (
    left.timestampNs - right.timestampNs ||
    left.clusterPosition - right.clusterPosition ||
    left.blockOrder - right.blockOrder
  );
}

function uniqueFramesInRange(frames, startMs, endMs) {
  var uniqueFrames = [];
  var seen = new Set();
  frames.forEach(function (frame) {
    if (frame.timestampMs < startMs || frame.timestampMs > endMs) return;
    var key = frame.clusterPosition + ":" + frame.blockOrder;
    if (seen.has(key)) return;
    seen.add(key);
    uniqueFrames.push(frame);
  });
  return uniqueFrames;
}

function isTextSubtitleTrack(track) {
  var codecId = String((track && track.codecId) || "");
  return Boolean(
    track && track.type === 0x11 && (/^S_TEXT\//i.test(codecId) || isAssSubtitleCodec(codecId))
  );
}

function findTextSubtitleTrack(metadata, trackNumber, trackOrdinal) {
  var normalizedTrackNumber = Math.trunc(Number(trackNumber));
  if (Number.isFinite(normalizedTrackNumber) && normalizedTrackNumber > 0) {
    var exactTrack = metadata.tracks.find(function (entry) {
      return entry.number === normalizedTrackNumber && isTextSubtitleTrack(entry);
    });
    if (exactTrack) return exactTrack;
  }

  var normalizedTrackOrdinal = Math.trunc(Number(trackOrdinal));
  if (!Number.isFinite(normalizedTrackOrdinal) || normalizedTrackOrdinal < 0) {
    return null;
  }
  return metadata.tracks.filter(isTextSubtitleTrack)[normalizedTrackOrdinal] || null;
}

function isAssSubtitleCodec(value) {
  var text = String(value || "").trim();
  if (!text) return false;
  return (
    /^S_TEXT\/(?:ASS|SSA)$/i.test(text) ||
    /^(?:text\/x-ass|application\/x-ass|text\/x-ssa|application\/x-ssa)$/i.test(text) ||
    /^(?:ass|ssa|advanced substation alpha|substation alpha)$/i.test(text)
  );
}

function isAssTextSubtitleTrack(track) {
  return Boolean(
    track &&
    (isAssSubtitleCodec(track.codecId) ||
      isAssSubtitleCodec(track.codecName) ||
      isAssSubtitleCodec(track.codec_name))
  );
}

function isIntegerField(value) {
  return /^-?\d+$/.test(String(value || "").trim());
}

function isOptionalIntegerField(value) {
  var text = String(value || "").trim();
  return text === "" || /^-?\d+$/.test(text);
}

// A Matroska ASS/SSA block is ReadOrder, Layer, Style, Name, MarginL,
// MarginR, MarginV, Effect, Text. The packet has no timestamps: those come
// from the enclosing Block/BlockGroup. SSA commonly leaves Layer empty, and
// some producers leave margins empty, so those fields must remain optional.
function isMatroskaAssPacketShape(fields) {
  return (
    fields.length >= 9 &&
    isIntegerField(fields[0]) &&
    isOptionalIntegerField(fields[1]) &&
    isOptionalIntegerField(fields[4]) &&
    isOptionalIntegerField(fields[5]) &&
    isOptionalIntegerField(fields[6])
  );
}

function isAssTimestamp(value) {
  return /^\s*\d+:\d{1,2}:\d{1,2}[.:]\d{1,3}\s*$/.test(String(value || ""));
}

function isRawAssControlPayload(value, track) {
  var text = String(value || "").trim();
  if (!text) return false;
  var payload = text.replace(/^\s*(?:Dialogue|Comment)\s*:\s*/i, "");
  if (isAssTextSubtitleTrack(track) && isMatroskaAssPacketShape(payload.split(","))) {
    return false;
  }
  // Timed Dialogue/Comment rows are valid ASS subtitle events and must be
  // parsed below; only positional AVPlay control CSV is rejected here.
  return (
    /^\s*\d+\s*,\s*\d+\s*,\s*(?:Onscreen\d*|Screen)\s*,/i.test(payload) &&
    payload.split(",").length >= 6
  );
}

function parseAssTimestampMs(value) {
  var match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);
  if (!match) return NaN;
  var fraction = String(match[4] || "0")
    .slice(0, 3)
    .padEnd(3, "0");
  return (
    Number(match[1]) * 3600000 +
    Number(match[2]) * 60000 +
    Number(match[3]) * 1000 +
    Number(fraction)
  );
}

function textAfterCommaCount(value, commaCount) {
  var text = String(value || "");
  var offset = 0;
  for (var index = 0; index < commaCount; index += 1) {
    var comma = text.indexOf(",", offset);
    if (comma < 0) return "";
    offset = comma + 1;
  }
  return text.slice(offset);
}

function decodeTextSubtitlePayload(payload) {
  var bytes = Buffer.from(payload || []);
  var text;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = bytes.slice(3).toString("utf8");
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.slice(2).toString("utf16le");
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    var swapped = Buffer.alloc(bytes.length - 2);
    for (var index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    text = swapped.toString("utf16le");
  } else {
    text = bytes.toString("utf8");
  }
  return text
    .replace(/\0/g, "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function normalizeTextSubtitlePayload(track, payload) {
  var text = decodeTextSubtitlePayload(payload);
  if (!text) return "";

  // Inspect the original payload before removing Dialogue:/Comment: so
  // structured ASS control rows are filtered without dropping plain cue text.
  // A complete Matroska ASS/SSA packet is explicitly allowed here because
  // its first numeric field is ReadOrder, not an AVPlay control identifier.
  if (isAssTextSubtitleTrack(track) && isRawAssControlPayload(text, track)) {
    return "";
  }
  var assEvent = text.replace(/^\s*Dialogue\s*:\s*/i, "");
  // ASS-specific parsing follows the original-payload control check above.
  var fields = assEvent.split(",");

  var hasLayeredAssTiming =
    fields.length >= 3 &&
    /^(?:marked\s*=\s*)?-?\d+$/i.test(String(fields[0] || "").trim()) &&
    isAssTimestamp(fields[1]) &&
    isAssTimestamp(fields[2]);
  var hasShortAssTiming =
    fields.length >= 3 && isAssTimestamp(fields[0]) && isAssTimestamp(fields[1]);
  // webOS may strip Start/End and expose the positional form
  // "Layer,?,Style,Name,MarginL,MarginR,MarginV,Effect,Text" with no
  // timestamps (e.g. 0,0,Flashback_Italics - Top,News,0,0,0,,text).
  var hasPositionalAssShape =
    isAssTextSubtitleTrack(track) &&
    !hasLayeredAssTiming &&
    !hasShortAssTiming &&
    isMatroskaAssPacketShape(fields);
  if (hasLayeredAssTiming) {
    text = textAfterCommaCount(assEvent, 9) || "";
  } else if (hasShortAssTiming) {
    text = textAfterCommaCount(assEvent, fields.length >= 9 ? 8 : 2) || "";
  } else if (hasPositionalAssShape) {
    text = textAfterCommaCount(assEvent, 8) || "";
  } else if (isAssTextSubtitleTrack(track)) {
    text = assEvent;
  }

  return text.replace(/\n{2,}/g, "\n").trim();
}

function hasAssOverrideTags(text) {
  return /\{[^}\r\n]*\\(?:[A-Za-z]|[1-4][A-Za-z])/.test(String(text || ""));
}

function hasAdvancedAssOverrideTags(text) {
  return /\{[^}\r\n]*\\(?!(?:an[1-9]\b|[NnHh]\b))[A-Za-z0-9]/i.test(String(text || ""));
}

function getEmbeddedAssCueDurationMs(frame) {
  var raw = decodeTextSubtitlePayload(frame && frame.payload);
  if (!raw) return 0;
  var event = raw.replace(/^\s*Dialogue\s*:\s*/i, "");
  var fields = event.split(",");
  var startIndex = -1;
  var endIndex = -1;
  if (fields.length >= 3 && isAssTimestamp(fields[1]) && isAssTimestamp(fields[2])) {
    startIndex = 1;
    endIndex = 2;
  } else if (fields.length >= 2 && isAssTimestamp(fields[0]) && isAssTimestamp(fields[1])) {
    startIndex = 0;
    endIndex = 1;
  }
  if (startIndex < 0) return 0;
  var startMs = parseAssTimestampMs(fields[startIndex]);
  var endMs = parseAssTimestampMs(fields[endIndex]);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? endMs - startMs
    : 0;
}

function getTextCueEndMs(frame, nextFrame) {
  var startMs = Number(frame && frame.timestampMs);
  if (!Number.isFinite(startMs)) return 0;
  // Matroska packet text has no timing fields. Prefer the enclosing block's
  // duration, then the next packet; keep the embedded-timestamp path only as
  // a compatibility fallback for legacy non-Matroska payloads.
  var durationMs = Number(frame && frame.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return startMs + Math.min(durationMs, MAX_TEXT_CUE_DURATION_MS);
  }
  var nextStartMs = Number(nextFrame && nextFrame.timestampMs);
  if (Number.isFinite(nextStartMs) && nextStartMs > startMs) {
    return Math.min(nextStartMs, startMs + MAX_TEXT_CUE_DURATION_MS);
  }
  var embeddedDurationMs = getEmbeddedAssCueDurationMs(frame);
  if (embeddedDurationMs > 0) {
    return startMs + Math.min(embeddedDurationMs, MAX_TEXT_CUE_DURATION_MS);
  }
  return startMs + DEFAULT_TEXT_CUE_DURATION_MS;
}

function selectTextFramesInRange(frames, startMs, endMs) {
  var contextStartMs = Math.max(0, startMs - 30000);
  var candidates = uniqueFramesInRange(frames, contextStartMs, endMs);
  return candidates.filter(function (frame, index) {
    var cueEndMs = getTextCueEndMs(frame, candidates[index + 1]);
    return frame.timestampMs < endMs && cueEndMs > startMs;
  });
}

function formatAssTimestamp(timestampMs) {
  var total = Math.max(0, Math.round(Number(timestampMs) || 0));
  var hours = Math.floor(total / 3600000);
  var minutes = Math.floor((total % 3600000) / 60000);
  var seconds = Math.floor((total % 60000) / 1000);
  var centiseconds = Math.floor((total % 1000) / 10);
  return (
    String(hours) +
    ":" +
    padLeft(minutes, 2) +
    ":" +
    padLeft(seconds, 2) +
    "." +
    padLeft(centiseconds, 2)
  );
}

function buildDefaultAssHeader() {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Roboto,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,30,30,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ""
  ].join("\n");
}

function normalizeAssHeader(codecPrivate) {
  var header = Buffer.from(codecPrivate || [])
    .slice(0, MAX_TEXT_CODEC_PRIVATE_BYTES)
    .toString("utf8")
    .replace(/\0/g, "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter(function (line) {
      return !/^\s*Dialogue\s*:/i.test(line);
    })
    .join("\n")
    .trim();
  var eventsIndex = header.search(/^\s*\[Events\]\s*$/im);
  var eventsSection = eventsIndex >= 0 ? header.slice(eventsIndex) : "";
  if (
    !/^\s*\[Script Info\]\s*$/im.test(header) ||
    !/^\s*\[V4(?:\+)? Styles(?:\+)?\]\s*$/im.test(header) ||
    eventsIndex < 0 ||
    !/^\s*Format\s*:/im.test(eventsSection)
  ) {
    return buildDefaultAssHeader();
  }
  // Rebuilt Matroska events always use the canonical ASS column order.
  // Preserve the source styles, resolution and other header sections.
  var inEvents = false;
  return (
    header
      .split("\n")
      .map(function (line) {
        if (/^\s*\[.*\]\s*$/.test(line)) {
          inEvents = /^\s*\[Events\]\s*$/i.test(line);
        }
        if (inEvents && /^\s*Format\s*:/i.test(line)) {
          return "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
        }
        return line;
      })
      .join("\n") + "\n"
  );
}

function getAssDialogueText(track, frame) {
  var raw = decodeTextSubtitlePayload(frame && frame.payload);
  if (!raw) return "";
  var event = raw.replace(/^\s*Dialogue\s*:\s*/i, "");
  var fields = event.split(",");
  if (fields.length >= 10 && isAssTimestamp(fields[1]) && isAssTimestamp(fields[2])) {
    return fields.slice(9).join(",").trim();
  }
  if (
    fields.length >= 9 &&
    isAssTimestamp(fields[0]) &&
    isAssTimestamp(fields[1]) &&
    isAssTextSubtitleTrack(track)
  ) {
    return fields.slice(8).join(",").trim();
  }
  return normalizeTextSubtitlePayload(track, frame && frame.payload);
}

function buildAssDialogueLine(track, frame, nextFrame) {
  var text = getAssDialogueText(track, frame);
  if (!text) return "";
  var startMs = Number(frame && frame.timestampMs);
  var endMs = getTextCueEndMs(frame, nextFrame);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "";
  var raw = decodeTextSubtitlePayload(frame && frame.payload);
  var event = raw.replace(/^\s*Dialogue\s*:\s*/i, "");
  var fields = event.split(",");
  if (fields.length >= 10 && isAssTimestamp(fields[1]) && isAssTimestamp(fields[2])) {
    fields[1] = formatAssTimestamp(startMs);
    fields[2] = formatAssTimestamp(endMs);
    return "Dialogue: " + fields.slice(0, 9).concat(fields.slice(9).join(",")).join(",");
  }
  // Preserve leading ASS fields only for the two shapes that carry them.
  // Metadata alone is not enough: webOS can expose ordinary cue text as a
  // comma-separated row, and treating its first fields as Style/Name/Margins
  // duplicates that prefix in the generated Dialogue line.
  var hasShortTiming = fields.length >= 9 && isAssTimestamp(fields[0]) && isAssTimestamp(fields[1]);
  var hasPositionalShape = isAssTextSubtitleTrack(track) && isMatroskaAssPacketShape(fields);
  var hasStructuredFields = hasShortTiming || hasPositionalShape;
  var assText = text.replace(/\r?\n/g, "\\N");
  // Matroska stores ReadOrder first, then Layer; ReadOrder is not a layer.
  // SSA may leave Layer empty, which maps to the default layer 0.
  var layer = hasPositionalShape ? String(fields[1] || "").trim() || "0" : "0";
  var style = hasStructuredFields ? String(fields[2] || "").trim() || "Default" : "Default";
  var name = hasStructuredFields ? String(fields[3] || "").trim() : "";
  var marginL = hasStructuredFields ? String(fields[4] || "").trim() || "0" : "0";
  var marginR = hasStructuredFields ? String(fields[5] || "").trim() || "0" : "0";
  var marginV = hasStructuredFields ? String(fields[6] || "").trim() || "0" : "0";
  var effect = hasStructuredFields ? String(fields[7] || "").trim() : "";
  return (
    "Dialogue: " +
    layer +
    "," +
    formatAssTimestamp(startMs) +
    "," +
    formatAssTimestamp(endMs) +
    "," +
    style +
    "," +
    name +
    "," +
    marginL +
    "," +
    marginR +
    "," +
    marginV +
    "," +
    effect +
    "," +
    assText
  );
}

function buildAssSubtitleBody(track, frames) {
  var events = [];
  frames.forEach(function (frame, index) {
    var line = buildAssDialogueLine(track, frame, frames[index + 1]);
    if (line) events.push(line);
  });
  return normalizeAssHeader(track && track.codecPrivate) + events.join("\n") + "\n";
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  var results = new Array(items.length);
  var nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      var index = nextIndex;
      nextIndex += 1;
      results[index] = await iteratee(items[index], index);
    }
  }
  var workers = [];
  var workerCount = Math.min(Math.max(1, concurrency), items.length);
  for (var index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function requestClusterRange(mediaUrl, absoluteStart, clusterSize, requestContext) {
  var absoluteEnd = absoluteStart + clusterSize - 1;
  if (requestContext) {
    return requestRange(mediaUrl, absoluteStart, absoluteEnd, MAX_CLUSTER_BYTES, 0, requestContext);
  }
  var key = mediaUrl + "::" + absoluteStart + "::" + absoluteEnd;
  if (clusterRangeRequests.has(key)) return clusterRangeRequests.get(key);
  var request = requestRange(mediaUrl, absoluteStart, absoluteEnd, MAX_CLUSTER_BYTES);
  var trackedRequest = request.then(
    function (result) {
      if (clusterRangeRequests.get(key) === trackedRequest) clusterRangeRequests.delete(key);
      return result;
    },
    function (error) {
      if (clusterRangeRequests.get(key) === trackedRequest) clusterRangeRequests.delete(key);
      throw error;
    }
  );
  clusterRangeRequests.set(key, trackedRequest);
  return trackedRequest;
}

function parsePgsSegments(payload) {
  var segments = [];
  var offset = 0;
  while (offset < payload.length) {
    if (offset + 3 > payload.length) {
      throw bitmapSubtitleError("INVALID_PGS", "PGS block ended inside a segment header");
    }
    var segmentType = payload[offset];
    var segmentSize = payload.readUInt16BE(offset + 1);
    var segmentEnd = offset + 3 + segmentSize;
    if (segmentEnd > payload.length) {
      throw bitmapSubtitleError("INVALID_PGS", "PGS segment exceeds its Matroska block");
    }
    var compositionState = null;
    if (segmentType === PGS_SEGMENT_PRESENTATION_COMPOSITION && segmentSize >= 8) {
      compositionState = payload[offset + 3 + 7];
    }
    segments.push({
      type: segmentType,
      size: segmentSize,
      compositionState: compositionState,
      data: payload.slice(offset, segmentEnd)
    });
    offset = segmentEnd;
  }
  if (!segments.length) {
    throw bitmapSubtitleError("INVALID_PGS", "Matroska block contained no PGS segments");
  }
  return segments;
}

function getPgsFrameSyncState(frame) {
  var segments = parsePgsSegments(frame.payload);
  for (var index = 0; index < segments.length; index += 1) {
    var state = segments[index].compositionState;
    if (
      state === PGS_COMPOSITION_STATE_EPOCH_START ||
      state === PGS_COMPOSITION_STATE_ACQUISITION_POINT
    ) {
      return state;
    }
  }
  return null;
}

function findLatestPgsSyncFrame(frames, startMs) {
  for (var index = frames.length - 1; index >= 0; index -= 1) {
    var frame = frames[index];
    if (frame.timestampMs <= startMs && getPgsFrameSyncState(frame) != null) {
      return frame;
    }
  }
  return null;
}

function findFirstPgsSyncFrame(frames, startMs, endMs) {
  for (var index = 0; index < frames.length; index += 1) {
    var frame = frames[index];
    if (
      frame.timestampMs >= startMs &&
      frame.timestampMs <= endMs &&
      getPgsFrameSyncState(frame) != null
    ) {
      return frame;
    }
  }
  return null;
}

function getPgsSyncType(frame) {
  var state = frame ? getPgsFrameSyncState(frame) : null;
  if (state === PGS_COMPOSITION_STATE_EPOCH_START) return "epoch";
  if (state === PGS_COMPOSITION_STATE_ACQUISITION_POINT) return "acquisition";
  return null;
}

function appendPgsSupSegment(chunks, timestampNs, segmentData) {
  var pts = Math.floor((timestampNs * 9) / 100000) % PGS_TIMESTAMP_WRAP;
  if (!Number.isFinite(pts) || pts < 0) {
    throw bitmapSubtitleError("INVALID_TIMESTAMP", "PGS timestamp is outside its valid range");
  }
  var header = Buffer.alloc(10);
  header.writeUInt16BE(0x5047, 0);
  header.writeUInt32BE(pts >>> 0, 2);
  header.writeUInt32BE(0, 6);
  chunks.push(header, segmentData);
  return header.length + segmentData.length;
}

function serializePgsFrames(frames) {
  var chunks = [];
  var segmentCount = 0;
  var outputLength = 0;
  frames.forEach(function (frame) {
    parsePgsSegments(frame.payload).forEach(function (segment) {
      outputLength += appendPgsSupSegment(chunks, frame.timestampNs, segment.data);
      segmentCount += 1;
      if (outputLength > MAX_WINDOW_BYTES) {
        throw bitmapSubtitleError("WINDOW_TOO_LARGE", "PGS window exceeded its safety limit");
      }
    });
  });
  return {
    data: Buffer.concat(chunks),
    segmentCount: segmentCount
  };
}

async function findPgsContext(mediaUrl, metadata, track, startMs, endMs, requestContext) {
  var trackCues = getTrackCues(metadata, track.number);
  if (!trackCues.length) {
    throw bitmapSubtitleError("TRACK_CUES_NOT_FOUND", "PGS track has no seekable cue entries");
  }
  var cueIndex = -1;
  for (var index = 0; index < trackCues.length; index += 1) {
    if (trackCues[index].timeMs <= startMs) cueIndex = index;
    else break;
  }

  var scannedCues = 0;
  var earliestAllowedMs = Math.max(0, startMs - PGS_MAX_SYNC_LOOKBACK_MS);
  while (
    cueIndex >= 0 &&
    trackCues[cueIndex].timeMs >= earliestAllowedMs &&
    scannedCues < PGS_MAX_SYNC_SCAN_CUES
  ) {
    var batchStart = Math.max(0, cueIndex - PGS_SYNC_SCAN_BATCH_CUES + 1);
    var batch = trackCues.slice(batchStart, cueIndex + 1).filter(function (cue) {
      return cue.timeMs >= earliestAllowedMs || cue.timeMs === 0;
    });
    if (!batch.length) break;
    var frames = await loadCueFrames(mediaUrl, metadata, track, batch, requestContext);
    var syncFrame = findLatestPgsSyncFrame(frames, startMs);
    if (syncFrame) {
      return {
        timestampMs: syncFrame.timestampMs,
        clusterPosition: syncFrame.clusterPosition,
        trackCues: trackCues,
        syncType: getPgsSyncType(syncFrame),
        prefetchedFrames: frames
      };
    }
    scannedCues += batch.length;
    if (batchStart === 0) break;
    cueIndex = batchStart - 1;
  }

  var requestedCues = trackCues.filter(function (cue) {
    return cue.timeMs >= startMs && cue.timeMs <= endMs;
  });
  if (!requestedCues.length) {
    return { empty: true, trackCues: trackCues, syncType: "empty" };
  }
  var requestedFrames = await loadCueFrames(
    mediaUrl,
    metadata,
    track,
    requestedCues,
    requestContext
  );
  var futureSyncFrame = findFirstPgsSyncFrame(requestedFrames, startMs, endMs);
  if (futureSyncFrame) {
    return {
      timestampMs: futureSyncFrame.timestampMs,
      clusterPosition: futureSyncFrame.clusterPosition,
      trackCues: trackCues,
      syncType: getPgsSyncType(futureSyncFrame),
      prefetchedFrames: requestedFrames
    };
  }
  throw bitmapSubtitleError(
    "PGS_SYNC_NOT_FOUND",
    "PGS epoch or acquisition point was not found within the bounded seek context",
    { startMs: startMs, lookbackMs: PGS_MAX_SYNC_LOOKBACK_MS, scannedCues: scannedCues }
  );
}

function encodePts(timestampMs) {
  var pts = (timestampMs * 90) % 8589934592;
  return Buffer.from([
    ((Math.floor(pts / 1073741824) & 0x07) << 1) | 0x21,
    Math.floor(pts / 4194304) & 0xff,
    ((Math.floor(pts / 32768) & 0x7f) << 1) | 0x01,
    Math.floor(pts / 128) & 0xff,
    ((pts & 0x7f) << 1) | 0x01
  ]);
}

function appendPesPacket(chunks, timestampMs, payload) {
  var maxPayloadBytes = 0xffff - 9;
  var payloadOffset = 0;
  var bytesWritten = 0;
  do {
    var payloadChunk = payload.slice(payloadOffset, payloadOffset + maxPayloadBytes);
    var pesLength = payloadChunk.length + 9;
    var header = Buffer.alloc(6);
    header.writeUInt32BE(0x000001bd, 0);
    header.writeUInt16BE(pesLength, 4);
    var packetChunks = [
      MPEG_PACK_HEADER,
      header,
      Buffer.from([0x80, 0x80, 0x05]),
      encodePts(timestampMs),
      Buffer.from([0x20]),
      payloadChunk
    ];
    chunks.push.apply(chunks, packetChunks);
    bytesWritten += packetChunks.reduce(function (sum, chunk) {
      return sum + chunk.length;
    }, 0);
    payloadOffset += payloadChunk.length;
  } while (payloadOffset < payload.length);
  return bytesWritten;
}

function padLeft(value, width) {
  var text = String(value);
  while (text.length < width) text = "0" + text;
  return text;
}

function formatTimestamp(timestampMs) {
  var total = Math.max(0, Math.round(timestampMs));
  var hours = Math.floor(total / 3600000);
  var minutes = Math.floor((total % 3600000) / 60000);
  var seconds = Math.floor((total % 60000) / 1000);
  var millis = total % 1000;
  return (
    padLeft(hours, 2) +
    ":" +
    padLeft(minutes, 2) +
    ":" +
    padLeft(seconds, 2) +
    ":" +
    padLeft(millis, 3)
  );
}

function formatVttTimestamp(timestampMs) {
  return formatTimestamp(timestampMs).replace(/:(\d{3})$/, ".$1");
}

// Plain-text VTT cannot render ASS drawing paths. Keep this sanitation local
// to the VTT fallback: the reconstructed ASS body must retain every balanced
// override so libass/ass.js can render the original styling.
function sanitizePlainTextAssCue(text) {
  var source = String(text || "");
  var drawing = false;
  var output = "";
  var offset = 0;
  var blocks = /\{([^}]*)\}/g;
  var match;
  while ((match = blocks.exec(source))) {
    if (!drawing) output += source.slice(offset, match.index);
    var block = match[1];
    var depth = 0;
    for (var index = 0; index < block.length; index += 1) {
      var character = block[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === "\\" && depth === 0) {
        var tag = block.slice(index + 1);
        var mode = /^p(-?\d+)(?=\\|\s|$)/.exec(tag);
        if (mode) drawing = Number(mode[1]) > 0;
        else if (tag[0] === "r") drawing = false;
      }
    }
    offset = blocks.lastIndex;
  }
  if (!drawing) output += source.slice(offset);
  return output
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

function buildTextSubtitleWindowPayload(track, frames, startMs, endMs, options) {
  var cueBlocks = [];
  var outputBytes = Buffer.byteLength("WEBVTT\n\n", "utf8");
  var hasOverrides = false;
  var hasAdvancedOverrides = false;
  frames.forEach(function (frame, index) {
    var rawText = normalizeTextSubtitlePayload(track, frame.payload);
    if (!rawText) return;
    var assContext = isAssTextSubtitleTrack(track) || hasAssOverrideTags(rawText);
    hasOverrides = hasOverrides || hasAssOverrideTags(rawText);
    hasAdvancedOverrides = hasAdvancedOverrides || hasAdvancedAssOverrideTags(rawText);
    var text = assContext ? sanitizePlainTextAssCue(rawText) : rawText;
    if (!text) return;
    var cueStartMs = Number(frame.timestampMs);
    var cueEndMs = getTextCueEndMs(frame, frames[index + 1]);
    if (!Number.isFinite(cueStartMs) || cueEndMs <= startMs || cueStartMs >= endMs) return;
    var block = [
      String(cueBlocks.length + 1),
      formatVttTimestamp(Math.max(0, cueStartMs)) +
        " --> " +
        formatVttTimestamp(Math.max(cueStartMs + 1, Math.min(endMs, cueEndMs))),
      text
    ].join("\n");
    var blockBytes = Buffer.byteLength(block, "utf8") + (cueBlocks.length ? 2 : 0);
    if (outputBytes + blockBytes + 2 > MAX_TEXT_SUBTITLE_WINDOW_BYTES) {
      throw bitmapSubtitleError(
        "TEXT_WINDOW_TOO_LARGE",
        "Embedded text subtitle window exceeded its safety limit"
      );
    }
    outputBytes += blockBytes;
    cueBlocks.push(block);
  });
  var body = "WEBVTT\n\n" + (cueBlocks.length ? cueBlocks.join("\n\n") + "\n\n" : "");
  var includeAssBody =
    Boolean(options && options.includeAssBody) ||
    isAssTextSubtitleTrack(track) ||
    hasAdvancedOverrides;
  var assBody = includeAssBody ? buildAssSubtitleBody(track, frames) : "";
  if (Buffer.byteLength(assBody, "utf8") > MAX_TEXT_ASS_BODY_BYTES) {
    throw bitmapSubtitleError(
      "TEXT_ASS_WINDOW_TOO_LARGE",
      "Embedded ASS subtitle window exceeded its safety limit"
    );
  }
  return {
    format: "vtt",
    cueCount: cueBlocks.length,
    body: body,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    bodyTruncated: false,
    hasAssOverrideTags: hasOverrides,
    hasAdvancedAssOverrideTags: hasAdvancedOverrides,
    assBody: assBody
  };
}

function normalizeIdxHeader(codecPrivate) {
  return (
    codecPrivate
      .toString("utf8")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function (line) {
        return line.replace(/\0/g, "").trim();
      })
      .filter(function (line) {
        return line && !/^timestamp:/i.test(line);
      })
      .join("\n") + "\n"
  );
}

function buildVobSubWindowPayload(track, frames) {
  if (!track.codecPrivate.length) {
    throw bitmapSubtitleError("MISSING_CODEC_PRIVATE", "VOBSUB track has no IDX metadata");
  }
  var chunks = [];
  var idxContent = normalizeIdxHeader(track.codecPrivate);
  var outputLength = 0;
  frames.forEach(function (frame) {
    if (!validateVobSubPayload(frame.payload)) {
      throw bitmapSubtitleError(
        "INVALID_VOBSUB",
        "Matroska block contained an invalid VOBSUB packet"
      );
    }
    idxContent +=
      "timestamp: " +
      formatTimestamp(frame.timestampMs) +
      ", filepos: " +
      padLeft(outputLength.toString(16).toUpperCase(), 8) +
      "\n";
    outputLength += appendPesPacket(chunks, frame.timestampMs, frame.payload);
    if (outputLength > MAX_WINDOW_BYTES) {
      throw bitmapSubtitleError("WINDOW_TOO_LARGE", "VOBSUB window exceeded its safety limit");
    }
  });
  var subData = Buffer.concat(chunks);
  return {
    format: "vobsub",
    cueCount: frames.length,
    idxContent: idxContent,
    subBase64: subData.toString("base64"),
    subBytes: subData.length
  };
}

function buildPgsWindowPayload(frames) {
  var serialized = serializePgsFrames(frames);
  return {
    format: "pgs",
    cueCount: frames.length,
    segmentCount: serialized.segmentCount,
    supBase64: serialized.data.toString("base64"),
    supBytes: serialized.data.length
  };
}

async function buildWindow(mediaUrl, trackNumber, startSeconds, endSeconds, requestContext) {
  var metadata = await loadMetadata(mediaUrl);
  var track = metadata.tracks.find(function (entry) {
    return entry.number === trackNumber && isBitmapSubtitleTrack(entry);
  });
  if (!track) {
    throw bitmapSubtitleError("TRACK_NOT_FOUND", "Requested bitmap subtitle track was not found");
  }
  var format = getBitmapSubtitleFormat(track);
  var startMs = Math.max(0, Math.floor(startSeconds * 1000));
  var endMs = Math.max(startMs + 1000, Math.floor(endSeconds * 1000));
  var contextStartMs = Math.max(0, startMs - 30000);
  var contextType = format === "pgs" ? null : "vobsub";
  var positions;
  var pgsCues = null;
  var prefetchedFrames = null;
  if (format === "pgs") {
    var context = await findPgsContext(mediaUrl, metadata, track, startMs, endMs, requestContext);
    contextType = context.syncType;
    if (context.empty) {
      contextStartMs = startMs;
      positions = [];
    } else {
      contextStartMs = context.timestampMs;
      prefetchedFrames = context.prefetchedFrames || null;
      pgsCues = context.trackCues.filter(function (cue) {
        return cue.timeMs >= contextStartMs && cue.timeMs <= endMs;
      });
      if (
        !pgsCues.some(function (cue) {
          return cue.clusterPosition === context.clusterPosition;
        })
      ) {
        var contextCue = context.trackCues.find(function (cue) {
          return cue.clusterPosition === context.clusterPosition;
        });
        if (contextCue) pgsCues.unshift(contextCue);
      }
    }
  } else {
    positions = selectClusterPositions(metadata, trackNumber, startMs, endMs);
  }
  var loadedFrames;
  if (format === "pgs") {
    var prefetchedKeys = new Set(
      (prefetchedFrames || []).map(function (frame) {
        return cuePositionKey(frame);
      })
    );
    var remainingCues = (pgsCues || []).filter(function (cue) {
      return !prefetchedKeys.has(cuePositionKey(cue));
    });
    loadedFrames = (prefetchedFrames || []).concat(
      await loadCueFrames(mediaUrl, metadata, track, remainingCues, requestContext)
    );
    loadedFrames.sort(compareFrames);
  } else {
    loadedFrames = await loadClusterFrames(mediaUrl, metadata, track, positions, requestContext);
  }
  var frames = uniqueFramesInRange(loadedFrames, contextStartMs, endMs);
  var payload =
    format === "pgs" ? buildPgsWindowPayload(frames) : buildVobSubWindowPayload(track, frames);
  return Object.assign(payload, {
    trackNumber: trackNumber,
    language: track.language || "",
    name: track.name || "",
    windowStartSeconds: startMs / 1000,
    windowEndSeconds: endMs / 1000,
    contextStartSeconds: contextStartMs / 1000,
    contextType: contextType
  });
}

async function buildTextWindow(
  mediaUrl,
  trackNumber,
  trackOrdinal,
  startSeconds,
  endSeconds,
  includeAssBody,
  requestContext
) {
  var metadata = await loadMetadata(mediaUrl);
  var track = findTextSubtitleTrack(metadata, trackNumber, trackOrdinal);
  if (!track) {
    throw bitmapSubtitleError(
      "TRACK_NOT_FOUND",
      "Requested embedded text subtitle track was not found"
    );
  }
  var startMs = Math.max(0, Math.floor(startSeconds * 1000));
  var endMs = Math.max(startMs + 1000, Math.floor(endSeconds * 1000));
  var resolvedTrackNumber = track.number;
  var cues = selectTextSubtitleCues(metadata, resolvedTrackNumber, startMs, endMs);
  var loadedFrames = await loadCueFrames(mediaUrl, metadata, track, cues, requestContext);
  var frames = selectTextFramesInRange(loadedFrames, startMs, endMs);
  var payload = buildTextSubtitleWindowPayload(track, frames, startMs, endMs, {
    includeAssBody: includeAssBody
  });
  return Object.assign(payload, {
    trackNumber: resolvedTrackNumber,
    codecId: track.codecId || "",
    language: track.language || "",
    name: track.name || "",
    windowStartSeconds: startMs / 1000,
    windowEndSeconds: endMs / 1000,
    contextStartSeconds: Math.max(0, startMs - 30000) / 1000
  });
}

async function getEmbeddedTextSubtitleWindow(options) {
  var mediaUrl = normalizeMediaUrl(options && options.url);
  var trackNumber = Math.trunc(Number(options && options.trackNumber));
  var trackOrdinal = Math.trunc(Number(options && options.trackOrdinal));
  var startSeconds = Math.max(0, Number(options && options.startSeconds) || 0);
  var includeAssBody = Boolean(options && options.includeAssBody);
  var requestedEnd = Number(options && options.endSeconds);
  var endSeconds = Number.isFinite(requestedEnd)
    ? Math.min(startSeconds + 180, Math.max(startSeconds + 1, requestedEnd))
    : startSeconds + 120;
  if (
    (!Number.isFinite(trackNumber) || trackNumber <= 0) &&
    (!Number.isFinite(trackOrdinal) || trackOrdinal < 0)
  ) {
    throw bitmapSubtitleError(
      "INVALID_TRACK",
      "Embedded text subtitle track number or ordinal is invalid"
    );
  }
  var normalizedWindow = normalizeWindowRange(startSeconds, endSeconds);
  var bucketStart = normalizedWindow.startSeconds;
  var bucketEnd = normalizedWindow.endSeconds;
  var trackKey =
    Number.isFinite(trackNumber) && trackNumber > 0
      ? "number:" + trackNumber
      : "ordinal:" + trackOrdinal;
  var activeKey = mediaUrl + "::" + trackKey;
  var cacheKey =
    mediaUrl +
    "::" +
    trackKey +
    "::" +
    bucketStart +
    "::" +
    bucketEnd +
    "::ass=" +
    (includeAssBody ? "1" : "0");
  var cached = getCached(textWindowCache, cacheKey);
  if (cached) {
    cancelActiveTextWindowRequest(activeKey);
    return cached;
  }
  if (textWindowRequests.has(cacheKey)) return textWindowRequests.get(cacheKey);
  cancelActiveTextWindowRequest(activeKey);
  var requestContext = { cancelled: false, requests: new Set(), cacheKey: cacheKey };
  activeTextWindowRequests.set(activeKey, requestContext);
  var request = buildTextWindow(
    mediaUrl,
    trackNumber,
    trackOrdinal,
    bucketStart,
    bucketEnd,
    includeAssBody,
    requestContext
  );
  textWindowRequests.set(cacheKey, request);
  try {
    var result = await request;
    setCached(textWindowCache, cacheKey, result, WINDOW_CACHE_TTL_MS, MAX_WINDOW_CACHE_ENTRIES);
    return result;
  } finally {
    if (textWindowRequests.get(cacheKey) === request) textWindowRequests.delete(cacheKey);
    if (activeTextWindowRequests.get(activeKey) === requestContext) {
      activeTextWindowRequests.delete(activeKey);
    }
  }
}

async function getBitmapSubtitleWindow(options) {
  var mediaUrl = normalizeMediaUrl(options && options.url);
  var trackNumber = Math.trunc(Number(options && options.trackNumber));
  var startSeconds = Math.max(0, Number(options && options.startSeconds) || 0);
  var requestedEnd = Number(options && options.endSeconds);
  var endSeconds = Number.isFinite(requestedEnd)
    ? Math.min(startSeconds + 180, Math.max(startSeconds + 1, requestedEnd))
    : startSeconds + 120;
  if (!Number.isFinite(trackNumber) || trackNumber <= 0) {
    throw bitmapSubtitleError("INVALID_TRACK", "Bitmap subtitle track number is invalid");
  }
  var normalizedWindow = normalizeWindowRange(startSeconds, endSeconds);
  var bucketStart = normalizedWindow.startSeconds;
  var bucketEnd = normalizedWindow.endSeconds;
  var cacheKey = mediaUrl + "::" + trackNumber + "::" + bucketStart + "::" + bucketEnd;
  var activeKey = mediaUrl + "::" + trackNumber;
  var cached = getCached(windowCache, cacheKey);
  if (cached) {
    cancelActivePgsWindowRequest(activeKey);
    return cached;
  }
  if (windowRequests.has(cacheKey)) return windowRequests.get(cacheKey);
  cancelActivePgsWindowRequest(activeKey);
  var requestContext = { cancelled: false, requests: new Set() };
  activePgsWindowRequests.set(activeKey, requestContext);
  var request = buildWindow(mediaUrl, trackNumber, bucketStart, bucketEnd, requestContext);
  windowRequests.set(cacheKey, request);
  try {
    var result = await request;
    setCached(windowCache, cacheKey, result, WINDOW_CACHE_TTL_MS, MAX_WINDOW_CACHE_ENTRIES);
    return result;
  } finally {
    windowRequests.delete(cacheKey);
    if (activePgsWindowRequests.get(activeKey) === requestContext) {
      activePgsWindowRequests.delete(activeKey);
    }
  }
}

function normalizeWindowRange(startSeconds, endSeconds) {
  var bucketStart =
    Math.floor(Math.max(0, startSeconds) / WINDOW_BUCKET_SECONDS) * WINDOW_BUCKET_SECONDS;
  var quantizedEnd =
    Math.ceil(Math.max(bucketStart + 1, endSeconds) / WINDOW_END_QUANTUM_SECONDS) *
    WINDOW_END_QUANTUM_SECONDS;
  var bucketEnd = Math.max(bucketStart + MIN_WINDOW_SECONDS, quantizedEnd);
  bucketEnd = Math.min(bucketStart + MAX_WINDOW_SECONDS, bucketEnd);
  return { startSeconds: bucketStart, endSeconds: bucketEnd };
}

function cancelActivePgsWindowRequest(activeKey) {
  var requestContext = activePgsWindowRequests.get(activeKey);
  if (!requestContext) return;
  cancelRequestContext(requestContext);
  activePgsWindowRequests.delete(activeKey);
}

function cancelActiveTextWindowRequest(activeKey) {
  var requestContext = activeTextWindowRequests.get(activeKey);
  if (!requestContext) return;
  cancelRequestContext(requestContext);
  if (requestContext.cacheKey) {
    textWindowRequests.delete(requestContext.cacheKey);
  }
  activeTextWindowRequests.delete(activeKey);
}

function cancelRequestContext(requestContext) {
  requestContext.cancelled = true;
  requestContext.requests.forEach(function (activeRequest) {
    activeRequest.destroy(
      bitmapSubtitleError("REQUEST_SUPERSEDED", "Bitmap subtitle request was superseded")
    );
  });
  requestContext.requests.clear();
}

async function prepareBitmapSubtitleSource(options) {
  var mediaUrl = normalizeMediaUrl(options && options.url);
  var metadata = await loadMetadata(mediaUrl);
  var bitmapTracks = metadata.tracks.filter(function (track) {
    return isBitmapSubtitleTrack(track);
  });
  return {
    prepared: true,
    bitmapTrackCount: bitmapTracks.length,
    bitmapFormats: Array.from(
      new Set(
        bitmapTracks.map(function (track) {
          return getBitmapSubtitleFormat(track);
        })
      )
    ),
    cueCount: metadata.cues.length
  };
}

function clearBitmapSubtitleCaches() {
  metadataCache.clear();
  metadataRequests.clear();
  windowCache.clear();
  windowRequests.clear();
  textWindowCache.clear();
  textWindowRequests.clear();
  cuedFrameCache.clear();
  cuedFrameCacheBytes = 0;
  clusterRangeRequests.clear();
  Array.from(activeTextWindowRequests.keys()).forEach(function (activeKey) {
    cancelActiveTextWindowRequest(activeKey);
  });
  Array.from(activePgsWindowRequests.keys()).forEach(function (activeKey) {
    cancelActivePgsWindowRequest(activeKey);
  });
}

module.exports = {
  getBitmapSubtitleWindow: getBitmapSubtitleWindow,
  getEmbeddedTextSubtitleWindow: getEmbeddedTextSubtitleWindow,
  prepareBitmapSubtitleSource: prepareBitmapSubtitleSource,
  clearBitmapSubtitleCaches: clearBitmapSubtitleCaches,
  _test: {
    parseHeader: parseHeader,
    parseCues: parseCues,
    parseCluster: parseCluster,
    getTrackCues: getTrackCues,
    loadCueFrames: loadCueFrames,
    requestRange: requestRange,
    cancelRequestContext: cancelRequestContext,
    getBitmapSubtitleFormat: getBitmapSubtitleFormat,
    isTextSubtitleTrack: isTextSubtitleTrack,
    isAssTextSubtitleTrack: isAssTextSubtitleTrack,
    normalizeTextSubtitlePayload: normalizeTextSubtitlePayload,
    hasAssOverrideTags: hasAssOverrideTags,
    hasAdvancedAssOverrideTags: hasAdvancedAssOverrideTags,
    buildTextSubtitleWindowPayload: buildTextSubtitleWindowPayload,
    buildAssSubtitleBody: buildAssSubtitleBody,
    getTextCueEndMs: getTextCueEndMs,
    parsePgsSegments: parsePgsSegments,
    getPgsFrameSyncState: getPgsFrameSyncState,
    findLatestPgsSyncFrame: findLatestPgsSyncFrame,
    findFirstPgsSyncFrame: findFirstPgsSyncFrame,
    appendPgsSupSegment: appendPgsSupSegment,
    serializePgsFrames: serializePgsFrames,
    buildVobSubWindowPayload: buildVobSubWindowPayload,
    buildPgsWindowPayload: buildPgsWindowPayload,
    normalizeIdxHeader: normalizeIdxHeader,
    appendPesPacket: appendPesPacket,
    normalizeWindowRange: normalizeWindowRange,
    mapWithConcurrency: mapWithConcurrency,
    formatTimestamp: formatTimestamp,
    readElement: readElement
  }
};
