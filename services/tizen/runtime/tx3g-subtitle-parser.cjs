/* global Buffer, module, require */
"use strict";

// Small, dependency-free MPEG-4 Timed Text reader used only when AVPlay does
// not render an embedded tx3g track.  The media runtime already proves that
// the source is a range-readable ISO-BMFF file; this reader only fetches the
// moov atom and the selected subtitle samples.

var http = require("http");
var https = require("https");
var urlModule = require("url");

var INITIAL_SCAN_BYTES = 1024 * 1024;
var MAX_METADATA_BYTES = 32 * 1024 * 1024;
var MAX_SOURCE_BYTES = 96 * 1024 * 1024;
var MAX_RANGE_BYTES = 32 * 1024 * 1024;
var MAX_SAMPLES_PER_TRACK = 1000000;
var MAX_CUES_PER_WINDOW = 2000;
var MAX_WINDOW_BYTES = 512 * 1024;
var MAX_REDIRECTS = 5;

function parserError(code, message) {
  var error = new Error(String(message || code || "TX3G parser error"));
  error.code = code || "TX3G_PARSE_FAILED";
  return error;
}

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function readUInt64(buffer, offset) {
  var high = buffer.readUInt32BE(offset);
  var low = buffer.readUInt32BE(offset + 4);
  var value = high * 4294967296 + low;
  if (!isFiniteNumber(value) || value > Number.MAX_SAFE_INTEGER) {
    throw parserError("BOX_TOO_LARGE", "ISO-BMFF box offset exceeds JavaScript safe integer range");
  }
  return value;
}

function parseBox(buffer, offset, limit) {
  var endLimit = Math.min(Number(limit || buffer.length), buffer.length);
  var start = Number(offset || 0);
  if (start < 0 || start + 8 > endLimit) {
    return null;
  }

  var size32 = buffer.readUInt32BE(start);
  var type = buffer.toString("ascii", start + 4, start + 8);
  var headerSize = 8;
  var size = size32;
  if (size32 === 1) {
    if (start + 16 > endLimit) {
      return null;
    }
    size = readUInt64(buffer, start + 8);
    headerSize = 16;
  } else if (size32 === 0) {
    size = endLimit - start;
  }

  if (!isFiniteNumber(size) || size < headerSize || start + size > endLimit) {
    return null;
  }

  return {
    type: type,
    start: start,
    size: size,
    headerSize: headerSize,
    payloadStart: start + headerSize,
    end: start + size
  };
}

function listBoxes(buffer, start, end) {
  var boxes = [];
  var cursor = Number(start || 0);
  var limit = Math.min(Number(end || buffer.length), buffer.length);
  while (cursor + 8 <= limit) {
    var box = parseBox(buffer, cursor, limit);
    if (!box) {
      break;
    }
    boxes.push(box);
    if (box.end <= cursor) {
      break;
    }
    cursor = box.end;
  }
  return boxes;
}

function findChildren(buffer, parent, type) {
  return listBoxes(buffer, parent.payloadStart, parent.end).filter(function (box) {
    return !type || box.type === type;
  });
}

function findChild(buffer, parent, type) {
  var children = findChildren(buffer, parent, type);
  return children.length ? children[0] : null;
}

function findBoxPath(buffer, root, path) {
  var current = root;
  for (var index = 0; index < path.length; index += 1) {
    current = findChild(buffer, current, path[index]);
    if (!current) {
      return null;
    }
  }
  return current;
}

function findBoxTypeInBuffer(buffer, absoluteStart, type) {
  var start = Number(absoluteStart || 0);
  if (start === 0) {
    var topLevel = listBoxes(buffer, 0, buffer.length);
    for (var topIndex = 0; topIndex < topLevel.length; topIndex += 1) {
      if (topLevel[topIndex].type === type) {
        return topLevel[topIndex];
      }
    }
    return null;
  }

  // A tail range is not aligned to a top-level box. Validate candidates by
  // checking the preceding size field and the complete box boundary.
  for (var localStart = 0; localStart + 8 <= buffer.length; localStart += 1) {
    if (buffer.toString("ascii", localStart + 4, localStart + 8) !== type) {
      continue;
    }
    var candidate = parseBox(buffer, localStart, buffer.length);
    if (candidate && candidate.type === type) {
      candidate.absoluteStart = start + candidate.start;
      candidate.absoluteEnd = start + candidate.end;
      return candidate;
    }
  }
  return null;
}

function parseContentRange(value) {
  var match = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? 0 : Number(match[3])
  };
}

function requestRange(targetUrl, start, end, redirectCount) {
  var parsed = urlModule.parse(String(targetUrl || ""));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Promise.reject(parserError("INVALID_URL", "TX3G source URL must use HTTP or HTTPS"));
  }

  var client = parsed.protocol === "https:" ? https : http;
  var requestedStart = Math.max(0, Math.floor(Number(start || 0)));
  var requestedEnd = Math.max(requestedStart, Math.floor(Number(end || 0)));
  if (requestedEnd - requestedStart + 1 > MAX_RANGE_BYTES) {
    return Promise.reject(parserError("RANGE_TOO_LARGE", "TX3G byte range exceeds safety limit"));
  }

  return new Promise(function (resolve, reject) {
    var request = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path || "/",
        method: "GET",
        headers: {
          Range: "bytes=" + requestedStart + "-" + requestedEnd,
          "Accept-Encoding": "identity",
          "User-Agent": "NuvioTV/tx3g"
        }
      },
      function (response) {
        var statusCode = Number(response.statusCode || 0);
        var location = response.headers && response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          if (Number(redirectCount || 0) >= MAX_REDIRECTS) {
            reject(parserError("TOO_MANY_REDIRECTS", "TX3G source redirected too many times"));
            return;
          }
          resolve(requestRange(urlModule.resolve(targetUrl, location), requestedStart, requestedEnd, Number(redirectCount || 0) + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(parserError("HTTP_ERROR", "TX3G source returned HTTP " + statusCode));
          return;
        }

        var chunks = [];
        var totalBytes = 0;
        var aborted = false;
        response.on("data", function (chunk) {
          if (aborted) {
            return;
          }
          totalBytes += chunk.length;
          if (totalBytes > MAX_SOURCE_BYTES) {
            aborted = true;
            response.destroy();
            reject(parserError("SOURCE_TOO_LARGE", "TX3G source response exceeds safety limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", function (error) {
          if (!aborted) {
            reject(error);
          }
        });
        response.on("end", function () {
          if (aborted) {
            return;
          }
          var body = Buffer.concat(chunks, totalBytes);
          var contentRange = parseContentRange(response.headers && response.headers["content-range"]);
          var contentLength = Number(response.headers && response.headers["content-length"] || 0);
          var actualStart = contentRange ? contentRange.start : statusCode === 206 ? requestedStart : 0;
          var total = contentRange && contentRange.total ? contentRange.total : statusCode === 200 ? contentLength || body.length : 0;
          resolve({
            body: body,
            statusCode: statusCode,
            start: actualStart,
            end: actualStart + Math.max(0, body.length - 1),
            total: total,
            ranged: statusCode === 206 && Boolean(contentRange)
          });
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function RangeReader(targetUrl) {
  this.targetUrl = String(targetUrl || "");
  this.fullBody = null;
  this.total = 0;
  this.cachedRanges = [];
}

RangeReader.prototype.read = function (start, end) {
  var self = this;
  var requestedStart = Math.max(0, Math.floor(Number(start || 0)));
  var requestedEnd = Math.max(requestedStart, Math.floor(Number(end || 0)));
  if (this.fullBody) {
    if (requestedStart >= this.fullBody.length) {
      return Promise.reject(parserError("RANGE_NOT_AVAILABLE", "TX3G byte range starts past EOF"));
    }
    return Promise.resolve(this.fullBody.slice(requestedStart, Math.min(this.fullBody.length, requestedEnd + 1)));
  }

  for (var index = 0; index < this.cachedRanges.length; index += 1) {
    var cached = this.cachedRanges[index];
    if (requestedStart >= cached.start && requestedEnd <= cached.end) {
      return Promise.resolve(cached.body.slice(requestedStart - cached.start, requestedEnd - cached.start + 1));
    }
  }

  return requestRange(this.targetUrl, requestedStart, requestedEnd, 0).then(function (result) {
    if (result.statusCode === 200 && result.start === 0) {
      self.fullBody = result.body;
      self.total = result.total || result.body.length;
      if (requestedStart >= self.fullBody.length) {
        throw parserError("RANGE_NOT_AVAILABLE", "TX3G byte range starts past EOF");
      }
      return self.fullBody.slice(requestedStart, Math.min(self.fullBody.length, requestedEnd + 1));
    }

    var actualStart = Number(result.start || requestedStart);
    var actualEnd = actualStart + Math.max(0, result.body.length - 1);
    self.total = self.total || Number(result.total || 0);
    self.cachedRanges.push({ start: actualStart, end: actualEnd, body: result.body });
    var reachesKnownEnd = self.total > 0 && actualEnd >= self.total - 1;
    if (requestedStart < actualStart || (requestedEnd > actualEnd && !reachesKnownEnd)) {
      throw parserError("RANGE_NOT_HONORED", "TX3G source did not return the requested byte range");
    }
    return result.body.slice(requestedStart - actualStart, requestedEnd - actualStart + 1);
  });
};

function findMoov(reader) {
  var self = reader;
  function loadBoxFromRange(range, rangeStart) {
    var rangeBox = findBoxTypeInBuffer(range, rangeStart, "moov");
    if (!rangeBox) {
      return null;
    }
    var boxStart = rangeBox.absoluteStart == null ? rangeStart + rangeBox.start : rangeBox.absoluteStart;
    var boxEnd = rangeBox.absoluteEnd == null ? rangeStart + rangeBox.end : rangeBox.absoluteEnd;
    return self.read(boxStart, boxEnd - 1).then(function (body) {
      return { body: body, start: boxStart };
    });
  }

  function scanPrefixes() {
    var total = Number(self.total || 0);
    var prefixSizes = [2, 4, 8, 16, 32].map(function (megabytes) {
      return megabytes * 1024 * 1024;
    });
    var index = 0;
    function next() {
      if (index >= prefixSizes.length) {
        return Promise.reject(parserError("MOOV_NOT_FOUND", "ISO-BMFF moov atom was not found"));
      }
      var prefixSize = prefixSizes[index++];
      if (total > 0) {
        prefixSize = Math.min(prefixSize, total);
      }
      if (prefixSize <= 0 || prefixSize > MAX_METADATA_BYTES) {
        return next();
      }
      return self.read(0, prefixSize - 1).then(function (prefix) {
        var prefixResult = loadBoxFromRange(prefix, 0);
        return prefixResult ? prefixResult.then(function (result) {
          return result || next();
        }) : next();
      });
    }
    return next();
  }

  return self.read(0, INITIAL_SCAN_BYTES - 1).then(function (initial) {
    var initialResult = loadBoxFromRange(initial, 0);
    if (initialResult) {
      return initialResult;
    }

    var total = Number(self.total || 0);
    if (total > 0) {
      var tailStart = Math.max(0, total - Math.min(MAX_METADATA_BYTES, 8 * 1024 * 1024));
      return self.read(tailStart, total - 1).then(function (tail) {
        var tailResult = loadBoxFromRange(tail, tailStart);
        return tailResult ? tailResult.then(function (result) {
          return result || scanPrefixes();
        }) : scanPrefixes();
      });
    }

    return scanPrefixes();
  });
}

function readVersion(buffer, box) {
  return buffer.readUInt8(box.payloadStart);
}

function parseTrackId(buffer, box) {
  var version = readVersion(buffer, box);
  var offset = version === 1 ? box.payloadStart + 20 : box.payloadStart + 12;
  return offset + 4 <= box.end ? buffer.readUInt32BE(offset) : 0;
}

function parseLanguage(buffer, box) {
  var version = readVersion(buffer, box);
  var offset = version === 1 ? box.payloadStart + 32 : box.payloadStart + 20;
  if (offset + 2 > box.end) {
    return "";
  }
  var packed = buffer.readUInt16BE(offset);
  var first = (packed >> 10) & 31;
  var second = (packed >> 5) & 31;
  var third = packed & 31;
  if (first < 1 || second < 1 || third < 1 || first > 26 || second > 26 || third > 26) {
    return "";
  }
  return String.fromCharCode(96 + first, 96 + second, 96 + third);
}

function parseDurationAndTimescale(buffer, box) {
  var version = readVersion(buffer, box);
  var timescaleOffset = version === 1 ? box.payloadStart + 20 : box.payloadStart + 12;
  var durationOffset = version === 1 ? box.payloadStart + 24 : box.payloadStart + 16;
  var duration = version === 1 ? readUInt64(buffer, durationOffset) : buffer.readUInt32BE(durationOffset);
  return {
    timescale: buffer.readUInt32BE(timescaleOffset),
    duration: duration
  };
}

function parseSampleEntryType(buffer, stsd) {
  if (stsd.payloadStart + 8 > stsd.end) {
    return "";
  }
  var entryCount = buffer.readUInt32BE(stsd.payloadStart + 4);
  if (!entryCount) {
    return "";
  }
  var entry = parseBox(buffer, stsd.payloadStart + 8, stsd.end);
  return entry ? entry.type : "";
}

function parseTimeToSample(buffer, stts) {
  var entryCount = buffer.readUInt32BE(stts.payloadStart + 4);
  var starts = [];
  var durations = [];
  var decodeTime = 0;
  var offset = stts.payloadStart + 8;
  for (var entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (offset + 8 > stts.end) {
      break;
    }
    var count = buffer.readUInt32BE(offset);
    var duration = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (starts.length + count > MAX_SAMPLES_PER_TRACK) {
      throw parserError("TRACK_TOO_LARGE", "TX3G track has too many samples");
    }
    for (var sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
      starts.push(decodeTime);
      durations.push(duration);
      decodeTime += duration;
    }
  }
  return {
    starts: starts,
    durations: durations
  };
}

function parseSampleSizes(buffer, stsz, stz2, sampleCount) {
  if (stsz) {
    var defaultSize = buffer.readUInt32BE(stsz.payloadStart + 4);
    var declaredCount = buffer.readUInt32BE(stsz.payloadStart + 8);
    var count = Math.min(sampleCount, declaredCount);
    if (defaultSize) {
      var defaultSizes = new Array(sampleCount);
      for (var defaultIndex = 0; defaultIndex < sampleCount; defaultIndex += 1) {
        defaultSizes[defaultIndex] = defaultSize;
      }
      return defaultSizes;
    }
    var sizes = [];
    var offset = stsz.payloadStart + 12;
    for (var index = 0; index < count && offset + 4 <= stsz.end; index += 1) {
      sizes.push(buffer.readUInt32BE(offset));
      offset += 4;
    }
    while (sizes.length < sampleCount) {
      sizes.push(0);
    }
    return sizes;
  }

  if (!stz2) {
    return [];
  }
  var fieldSize = buffer.readUInt8(stz2.payloadStart + 7);
  var stz2Count = Math.min(sampleCount, buffer.readUInt32BE(stz2.payloadStart + 8));
  var stz2Sizes = [];
  var stz2Offset = stz2.payloadStart + 12;
  for (var stz2Index = 0; stz2Index < stz2Count; stz2Index += 1) {
    if (fieldSize === 4) {
      var packedByte = buffer.readUInt8(stz2Offset + Math.floor(stz2Index / 2));
      stz2Sizes.push(stz2Index % 2 === 0 ? packedByte >> 4 : packedByte & 15);
    } else if (fieldSize === 8) {
      stz2Sizes.push(buffer.readUInt8(stz2Offset + stz2Index));
    } else if (fieldSize === 16) {
      stz2Sizes.push(buffer.readUInt16BE(stz2Offset + stz2Index * 2));
    } else {
      throw parserError("UNSUPPORTED_SAMPLE_SIZE", "Unsupported stz2 field size");
    }
  }
  while (stz2Sizes.length < sampleCount) {
    stz2Sizes.push(0);
  }
  return stz2Sizes;
}

function parseChunkOffsets(buffer, stco, co64) {
  var box = stco || co64;
  if (!box) {
    return [];
  }
  var count = buffer.readUInt32BE(box.payloadStart + 4);
  var offset = box.payloadStart + 8;
  var offsets = [];
  for (var index = 0; index < count; index += 1) {
    if (box.type === "co64") {
      if (offset + 8 > box.end) break;
      offsets.push(readUInt64(buffer, offset));
      offset += 8;
    } else {
      if (offset + 4 > box.end) break;
      offsets.push(buffer.readUInt32BE(offset));
      offset += 4;
    }
  }
  return offsets;
}

function parseSampleToChunk(buffer, stsc) {
  var count = buffer.readUInt32BE(stsc.payloadStart + 4);
  var offset = stsc.payloadStart + 8;
  var entries = [];
  for (var index = 0; index < count; index += 1) {
    if (offset + 12 > stsc.end) break;
    entries.push({
      firstChunk: buffer.readUInt32BE(offset),
      samplesPerChunk: buffer.readUInt32BE(offset + 4),
      descriptionIndex: buffer.readUInt32BE(offset + 8)
    });
    offset += 12;
  }
  return entries;
}

function buildSampleOffsets(chunkOffsets, sampleToChunk, sampleSizes, sampleCount) {
  var offsets = [];
  var sampleIndex = 0;
  var tableIndex = 0;
  for (var chunkNumber = 1; chunkNumber <= chunkOffsets.length && sampleIndex < sampleCount; chunkNumber += 1) {
    while (
      tableIndex + 1 < sampleToChunk.length &&
      sampleToChunk[tableIndex + 1].firstChunk <= chunkNumber
    ) {
      tableIndex += 1;
    }
    var tableEntry = sampleToChunk[tableIndex];
    if (!tableEntry || !tableEntry.samplesPerChunk) {
      break;
    }
    var cursor = chunkOffsets[chunkNumber - 1];
    for (var sampleInChunk = 0; sampleInChunk < tableEntry.samplesPerChunk && sampleIndex < sampleCount; sampleInChunk += 1) {
      var size = Number(sampleSizes[sampleIndex] || 0);
      offsets.push({ offset: cursor, size: size });
      cursor += size;
      sampleIndex += 1;
    }
  }
  while (offsets.length < sampleCount) {
    offsets.push({ offset: 0, size: 0 });
  }
  return offsets;
}

function parseTrack(buffer, trak) {
  var tkhd = findChild(buffer, trak, "tkhd");
  var mdia = findChild(buffer, trak, "mdia");
  if (!tkhd || !mdia) {
    return null;
  }
  var hdlr = findChild(buffer, mdia, "hdlr");
  var mdhd = findChild(buffer, mdia, "mdhd");
  var stbl = findBoxPath(buffer, mdia, ["minf", "stbl"]);
  if (!hdlr || !mdhd || !stbl) {
    return null;
  }
  var stsd = findChild(buffer, stbl, "stsd");
  var stts = findChild(buffer, stbl, "stts");
  var stsc = findChild(buffer, stbl, "stsc");
  var stsz = findChild(buffer, stbl, "stsz");
  var stz2 = findChild(buffer, stbl, "stz2");
  var stco = findChild(buffer, stbl, "stco");
  var co64 = findChild(buffer, stbl, "co64");
  if (!stsd || !stts || !stsc || (!stsz && !stz2) || (!stco && !co64)) {
    return null;
  }

  var sampleEntryType = parseSampleEntryType(buffer, stsd);
  if (sampleEntryType !== "tx3g") {
    return null;
  }

  var timing = parseDurationAndTimescale(buffer, mdhd);
  var timeToSample = parseTimeToSample(buffer, stts);
  var sampleSizes = parseSampleSizes(buffer, stsz, stz2, timeToSample.starts.length);
  var sampleOffsets = buildSampleOffsets(
    parseChunkOffsets(buffer, stco, co64),
    parseSampleToChunk(buffer, stsc),
    sampleSizes,
    timeToSample.starts.length
  );

  return {
    id: parseTrackId(buffer, tkhd),
    type: "text",
    codec: "TX3G",
    language: parseLanguage(buffer, mdhd),
    timescale: timing.timescale || 1,
    duration: timing.duration || 0,
    starts: timeToSample.starts,
    durations: timeToSample.durations,
    samples: sampleOffsets
  };
}

function parseTracks(moovBuffer) {
  var moov = parseBox(moovBuffer, 0, moovBuffer.length);
  if (!moov || moov.type !== "moov") {
    throw parserError("INVALID_MOOV", "Invalid ISO-BMFF moov atom");
  }
  var tracks = [];
  findChildren(moovBuffer, moov, "trak").forEach(function (trak) {
    var track = parseTrack(moovBuffer, trak);
    if (track) {
      tracks.push(track);
    }
  });
  return tracks;
}

function decodeTx3gSample(sample) {
  if (!sample || sample.length < 2) {
    return "";
  }
  var textLength = sample.readUInt16BE(0);
  if (!textLength || sample.length < 2 + textLength) {
    return "";
  }
  var text = sample.slice(2, 2 + textLength);
  if (text.length >= 2 && text[0] === 0xfe && text[1] === 0xff) {
    var swapped = Buffer.alloc(text.length - 2);
    for (var index = 2; index + 1 < text.length; index += 2) {
      swapped[index - 2] = text[index + 1];
      swapped[index - 1] = text[index];
    }
    return swapped.toString("utf16le");
  }
  if (text.length >= 2 && text[0] === 0xff && text[1] === 0xfe) {
    return text.slice(2).toString("utf16le");
  }
  return text.toString("utf8");
}

function formatVttTimestamp(milliseconds) {
  var value = Math.max(0, Math.floor(Number(milliseconds || 0)));
  var hours = Math.floor(value / 3600000);
  value -= hours * 3600000;
  var minutes = Math.floor(value / 60000);
  value -= minutes * 60000;
  var seconds = Math.floor(value / 1000);
  var millis = value - seconds * 1000;
  function pad(number, length) {
    var result = String(number);
    while (result.length < length) result = "0" + result;
    return result;
  }
  return pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(seconds, 2) + "." + pad(millis, 3);
}

function getSampleEnd(track, index) {
  var start = Number(track.starts[index] || 0);
  var duration = Number(track.durations[index] || 0);
  var end = start + duration;
  if (!(end > start) && index + 1 < track.starts.length) {
    end = Number(track.starts[index + 1] || start);
  }
  if (!(end > start)) {
    end = Number(track.duration || 0);
  }
  return end;
}

function selectTrack(tracks, trackNumber) {
  var requested = Math.trunc(Number(trackNumber));
  if (!isFiniteNumber(requested) || requested <= 0) {
    throw parserError("INVALID_TRACK", "TX3G track number is invalid");
  }
  var exact = tracks.filter(function (track) {
    return track.id === requested;
  });
  if (exact.length) {
    return exact[0];
  }
  // A few muxers expose a 1-based stream ordinal instead of the tkhd id.
  var ordinal = tracks[requested - 1];
  if (ordinal) {
    return ordinal;
  }
  throw parserError("TRACK_NOT_FOUND", "Requested TX3G track was not found");
}

function selectTimelineTrack(tracks, trackNumber) {
  var requested = Math.trunc(Number(trackNumber));
  if (isFiniteNumber(requested) && requested > 0) {
    return selectTrack(tracks, requested);
  }
  var best = null;
  tracks.forEach(function (track) {
    if (!track || track.samples.length < 8) return;
    if (!best || track.samples.length > best.samples.length) best = track;
  });
  if (!best) {
    throw parserError("TRACK_NOT_FOUND", "No usable TX3G subtitle track was found");
  }
  return best;
}

function buildTx3gTimelinePayload(track) {
  var timescale = Math.max(1, Number(track.timescale || 1));
  var cues = [];
  for (var index = 0; index < track.samples.length; index += 1) {
    var startUnits = Number(track.starts[index] || 0);
    var endUnits = Math.max(startUnits + 1, getSampleEnd(track, index));
    cues.push({
      startMs: Math.max(0, Math.round((startUnits / timescale) * 1000)),
      durationMs: Math.max(1, Math.round(((endUnits - startUnits) / timescale) * 1000))
    });
  }
  if (cues.length > 12000) {
    throw parserError("TIMELINE_TOO_LARGE", "TX3G subtitle timeline exceeds the supported safety limit");
  }
  return {
    returnValue: true,
    format: "timeline",
    trackNumber: track.id,
    codecId: "TX3G",
    language: track.language || "",
    name: "",
    cueCount: cues.length,
    windowStartSeconds: cues.length ? cues[0].startMs / 1000 : 0,
    windowEndSeconds: cues.length ? cues[cues.length - 1].startMs / 1000 : 0,
    cues: cues
  };
}

function extractTx3gTimeline(options) {
  var sourceUrl = String(options && options.url || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return Promise.reject(parserError("INVALID_URL", "TX3G source URL is invalid"));
  }
  var reader = new RangeReader(sourceUrl);
  return findMoov(reader).then(function (moov) {
    var tracks = parseTracks(moov.body);
    var track = selectTimelineTrack(tracks, options && options.trackNumber);
    return buildTx3gTimelinePayload(track);
  });
}

function extractTx3gWindow(options) {
  var sourceUrl = String(options && options.url || "").trim();
  var trackNumber = Number(options && options.trackNumber);
  var startSeconds = Math.max(0, Number(options && options.startSeconds) || 0);
  var requestedEnd = Number(options && options.endSeconds);
  var endSeconds = isFiniteNumber(requestedEnd)
    ? Math.min(startSeconds + 180, Math.max(startSeconds + 1, requestedEnd))
    : startSeconds + 120;
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return Promise.reject(parserError("INVALID_URL", "TX3G source URL is invalid"));
  }

  var reader = new RangeReader(sourceUrl);
  return findMoov(reader).then(function (moov) {
    var tracks = parseTracks(moov.body);
    var track = selectTrack(tracks, trackNumber);
    var timescale = Math.max(1, Number(track.timescale || 1));
    var startUnits = Math.floor(startSeconds * timescale);
    var endUnits = Math.floor(endSeconds * timescale);
    var selected = [];
    for (var index = 0; index < track.samples.length; index += 1) {
      var sampleStart = Number(track.starts[index] || 0);
      var sampleEnd = getSampleEnd(track, index);
      if (sampleEnd > startUnits && sampleStart < endUnits) {
        selected.push({ index: index, start: sampleStart, end: sampleEnd });
        if (selected.length >= MAX_CUES_PER_WINDOW) {
          throw parserError("WINDOW_TOO_LARGE", "TX3G subtitle window has too many samples");
        }
      }
    }

    var cuePromises = selected.map(function (entry) {
      var sample = track.samples[entry.index];
      if (!sample || !sample.size || !sample.offset) {
        return Promise.resolve({ entry: entry, text: "" });
      }
      return reader.read(sample.offset, sample.offset + sample.size - 1).then(function (body) {
        return { entry: entry, text: decodeTx3gSample(body) };
      });
    });

    return Promise.all(cuePromises).then(function (cues) {
      var blocks = [];
      var outputBytes = Buffer.byteLength("WEBVTT\n\n", "utf8");
      cues.forEach(function (cue) {
        var text = String(cue.text || "")
          .replace(/\r\n?/g, "\n")
          .replace(/\u0000/g, "")
          .trim();
        if (!text) {
          return;
        }
        var cueStartMs = (cue.entry.start / timescale) * 1000;
        var cueEndMs = (Math.max(cue.entry.end, cue.entry.start + 1) / timescale) * 1000;
        var block = [
          String(blocks.length + 1),
          formatVttTimestamp(cueStartMs) + " --> " + formatVttTimestamp(cueEndMs),
          text
        ].join("\n");
        var blockBytes = Buffer.byteLength(block, "utf8") + (blocks.length ? 2 : 0);
        if (outputBytes + blockBytes + 2 > MAX_WINDOW_BYTES) {
          throw parserError("WINDOW_TOO_LARGE", "TX3G subtitle window exceeds safety limit");
        }
        outputBytes += blockBytes;
        blocks.push(block);
      });
      return {
        returnValue: true,
        format: "vtt",
        codecId: "TX3G",
        trackNumber: track.id || trackNumber,
        language: track.language || "",
        windowStartSeconds: startSeconds,
        windowEndSeconds: endSeconds,
        contextStartSeconds: startSeconds,
        cueCount: blocks.length,
        body: "WEBVTT\n\n" + (blocks.length ? blocks.join("\n\n") + "\n\n" : ""),
        bodyBytes: outputBytes,
        bodyTruncated: false
      };
    });
  });
}

module.exports = {
  extractTx3gWindow: extractTx3gWindow,
  extractTx3gTimeline: extractTx3gTimeline,
  buildTx3gTimelinePayload: buildTx3gTimelinePayload,
  parseTracks: parseTracks,
  decodeTx3gSample: decodeTx3gSample,
  parserError: parserError
};
