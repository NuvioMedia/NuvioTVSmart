var http = require("http");
var https = require("https");
var zlib = require("zlib");

var HEADER_PROBE_BYTES = 2 * 1024 * 1024;
var CUES_PROBE_BYTES = 64 * 1024;
var MAX_CUES_BYTES = 8 * 1024 * 1024;
var MAX_CLUSTER_BYTES = 20 * 1024 * 1024;
var MAX_WINDOW_BYTES = 3 * 1024 * 1024;
var MAX_BLOCK_BYTES = 1024 * 1024;
var MAX_REDIRECTS = 4;
var REQUEST_TIMEOUT_MS = 15000;
var METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
var WINDOW_CACHE_TTL_MS = 5 * 60 * 1000;
var MAX_METADATA_CACHE_ENTRIES = 6;
var MAX_WINDOW_CACHE_ENTRIES = 12;
var WINDOW_BUCKET_SECONDS = 90;
var WINDOW_END_QUANTUM_SECONDS = 30;
var MIN_WINDOW_SECONDS = 120;
var MAX_WINDOW_SECONDS = 270;
var MAX_CONCURRENT_CLUSTER_REQUESTS = 3;

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
var ID_CLUSTER = 0x1f43b675;
var ID_CLUSTER_TIMECODE = 0xe7;
var ID_SIMPLE_BLOCK = 0xa3;
var ID_BLOCK_GROUP = 0xa0;
var ID_BLOCK = 0xa1;

var MPEG_PACK_HEADER = Buffer.from([
  0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0x04, 0x00, 0x04, 0x01, 0x00, 0x00, 0x03, 0xf8
]);

var metadataCache = new Map();
var metadataRequests = new Map();
var windowCache = new Map();
var windowRequests = new Map();
var clusterRangeRequests = new Map();

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

function requestRange(url, start, end, maxBytes, redirects) {
  var redirectCount = Number(redirects || 0);
  return new Promise(function (resolve, reject) {
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
        headers: {
          Range: "bytes=" + start + "-" + end,
          "Accept-Encoding": "identity",
          "User-Agent": "NuvioTV-Web/bitmap-subtitles"
        }
      },
      function (res) {
        var statusCode = Number(res.statusCode || 0);
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
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
          requestRange(redirected, start, end, maxBytes, redirectCount + 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 206 && !(statusCode === 200 && start === 0)) {
          res.resume();
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
          resolve({
            buffer: Buffer.concat(chunks),
            totalSize: totalSize,
            finalUrl: parsed.href,
            statusCode: statusCode
          });
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, function () {
      req.destroy(bitmapSubtitleError("RANGE_TIMEOUT", "Bitmap subtitle range request timed out"));
    });
    req.on("error", reject);
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
      if (track == null || clusterPosition == null) return;
      cues.push({ timeMs: timeMs, track: track, clusterPosition: clusterPosition });
    });
  });
  cues.sort(function (left, right) {
    return (
      left.timeMs - right.timeMs ||
      left.clusterPosition - right.clusterPosition ||
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
        "Inflated VOBSUB block exceeded its safety limit"
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

function validateVobSubPayload(payload) {
  if (!payload || payload.length < 4) return false;
  var packetSize = payload.readUInt16BE(0);
  var controlOffset = payload.readUInt16BE(2);
  return packetSize === payload.length && controlOffset >= 4 && controlOffset <= packetSize;
}

function parseBlock(data, element, track, clusterTicks, timecodeScaleNs) {
  var raw = data.slice(element.dataStart, element.dataEnd);
  var trackVint = readVint(raw, 0);
  if (!trackVint || trackVint.value !== track.number || raw.length < trackVint.width + 3)
    return null;
  var relativeTicks = raw.readInt16BE(trackVint.width);
  var flags = raw[trackVint.width + 2];
  if ((flags & 0x06) !== 0) {
    throw bitmapSubtitleError("LACED_VOBSUB", "Laced Matroska VOBSUB blocks are not supported");
  }
  var payload = decodeBlockPayload(raw.slice(trackVint.width + 3), track.compression);
  if (payload.length > MAX_BLOCK_BYTES) {
    throw bitmapSubtitleError("BLOCK_TOO_LARGE", "VOBSUB block exceeded its safety limit");
  }
  if (!validateVobSubPayload(payload)) {
    throw bitmapSubtitleError(
      "INVALID_VOBSUB",
      "Matroska block contained an invalid VOBSUB packet"
    );
  }
  var absoluteTicks = clusterTicks + relativeTicks;
  if (absoluteTicks < 0) return null;
  return {
    timestampMs: Math.round((absoluteTicks * timecodeScaleNs) / 1000000),
    payload: payload
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
  children.forEach(function (child) {
    var block = null;
    if (child.id === ID_SIMPLE_BLOCK) {
      block = child;
    } else if (child.id === ID_BLOCK_GROUP) {
      block = findChild(data, child, ID_BLOCK);
    }
    if (!block) return;
    var frame = parseBlock(data, block, track, clusterTicks, timecodeScaleNs);
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

function requestClusterRange(mediaUrl, absoluteStart, clusterSize) {
  var absoluteEnd = absoluteStart + clusterSize - 1;
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

async function buildWindow(mediaUrl, trackNumber, startSeconds, endSeconds) {
  var metadata = await loadMetadata(mediaUrl);
  var track = metadata.tracks.find(function (entry) {
    return entry.number === trackNumber && entry.type === 0x11 && entry.codecId === "S_VOBSUB";
  });
  if (!track) throw bitmapSubtitleError("TRACK_NOT_FOUND", "Requested VOBSUB track was not found");
  if (!track.codecPrivate.length)
    throw bitmapSubtitleError("MISSING_CODEC_PRIVATE", "VOBSUB track has no IDX metadata");

  var startMs = Math.max(0, Math.floor(startSeconds * 1000));
  var endMs = Math.max(startMs + 1000, Math.floor(endSeconds * 1000));
  var positions = selectClusterPositions(metadata, trackNumber, startMs, endMs);
  var clusterRanges = positions.map(function (clusterPosition) {
    var nextPosition = nextClusterPosition(metadata, clusterPosition);
    var clusterSize = nextPosition - clusterPosition;
    if (clusterSize <= 0 || clusterSize > MAX_CLUSTER_BYTES) {
      throw bitmapSubtitleError(
        "CLUSTER_TOO_LARGE",
        "Matroska subtitle cluster exceeded its safety limit",
        {
          clusterSize: clusterSize
        }
      );
    }
    return {
      absoluteStart: metadata.segmentDataStart + clusterPosition,
      clusterSize: clusterSize
    };
  });
  var clusterFrames = await mapWithConcurrency(
    clusterRanges,
    MAX_CONCURRENT_CLUSTER_REQUESTS,
    async function (range) {
      var response = await requestClusterRange(mediaUrl, range.absoluteStart, range.clusterSize);
      return parseCluster(response.buffer, track, metadata.timecodeScaleNs);
    }
  );
  var frames = [];
  clusterFrames.forEach(function (entries) {
    frames.push.apply(frames, entries);
  });

  var uniqueFrames = [];
  var seen = new Set();
  frames.sort(function (left, right) {
    return left.timestampMs - right.timestampMs;
  });
  frames.forEach(function (frame) {
    if (frame.timestampMs < startMs - 30000 || frame.timestampMs > endMs) return;
    var key =
      frame.timestampMs +
      ":" +
      frame.payload.length +
      ":" +
      frame.payload.slice(0, 8).toString("hex");
    if (seen.has(key)) return;
    seen.add(key);
    uniqueFrames.push(frame);
  });

  var chunks = [];
  var idxContent = normalizeIdxHeader(track.codecPrivate);
  var outputLength = 0;
  uniqueFrames.forEach(function (frame) {
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
    trackNumber: trackNumber,
    language: track.language || "",
    name: track.name || "",
    windowStartSeconds: startMs / 1000,
    windowEndSeconds: endMs / 1000,
    cueCount: uniqueFrames.length,
    idxContent: idxContent,
    subBase64: subData.toString("base64"),
    subBytes: subData.length
  };
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
  var cached = getCached(windowCache, cacheKey);
  if (cached) return cached;
  if (windowRequests.has(cacheKey)) return windowRequests.get(cacheKey);
  var request = buildWindow(mediaUrl, trackNumber, bucketStart, bucketEnd);
  windowRequests.set(cacheKey, request);
  try {
    var result = await request;
    setCached(windowCache, cacheKey, result, WINDOW_CACHE_TTL_MS, MAX_WINDOW_CACHE_ENTRIES);
    return result;
  } finally {
    windowRequests.delete(cacheKey);
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

async function prepareBitmapSubtitleSource(options) {
  var mediaUrl = normalizeMediaUrl(options && options.url);
  var metadata = await loadMetadata(mediaUrl);
  var bitmapTracks = metadata.tracks.filter(function (track) {
    return track.type === 0x11 && track.codecId === "S_VOBSUB";
  });
  return {
    prepared: true,
    bitmapTrackCount: bitmapTracks.length,
    cueCount: metadata.cues.length
  };
}

function clearBitmapSubtitleCaches() {
  metadataCache.clear();
  metadataRequests.clear();
  windowCache.clear();
  windowRequests.clear();
  clusterRangeRequests.clear();
}

module.exports = {
  getBitmapSubtitleWindow: getBitmapSubtitleWindow,
  prepareBitmapSubtitleSource: prepareBitmapSubtitleSource,
  clearBitmapSubtitleCaches: clearBitmapSubtitleCaches,
  _test: {
    parseHeader: parseHeader,
    parseCues: parseCues,
    parseCluster: parseCluster,
    normalizeIdxHeader: normalizeIdxHeader,
    appendPesPacket: appendPesPacket,
    normalizeWindowRange: normalizeWindowRange,
    mapWithConcurrency: mapWithConcurrency,
    formatTimestamp: formatTimestamp,
    readElement: readElement
  }
};
