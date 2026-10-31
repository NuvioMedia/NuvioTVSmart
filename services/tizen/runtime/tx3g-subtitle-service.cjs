/* global Buffer, module, require */
"use strict";

var http = require("http");
var urlModule = require("url");
var parser = require("./tx3g-subtitle-parser.cjs");
var embeddedTextParser = null;

// Keep this outside the media runtime's 2710-2714 candidate range so a media
// server recovery cannot collide with the subtitle extractor.
var DEFAULT_PORT = 2715;
var service = null;

function getEmbeddedTextParser() {
  if (!embeddedTextParser) {
    // Keep zlib and the Matroska parser out of the EngineFS startup path. The
    // parser is loaded only after a Tizen embedded text fallback is selected.
    embeddedTextParser = require("./embedded-text-subtitle-parser.cjs");
  }
  return embeddedTextParser;
}

function sendJson(response, statusCode, payload) {
  var body = JSON.stringify(payload || {});
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function parseNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function handleRequest(request, response) {
  var parsed = urlModule.parse(request.url || "/", true);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (parsed.pathname === "/settings") {
    sendJson(response, 200, { tx3g: true, embeddedText: true, service: "nuvio-tx3g" });
    return;
  }

  var isEmbeddedTextRequest = parsed.pathname === "/embedded-text";
  var isTx3gRequest = parsed.pathname === "/tx3g";
  var isEmbeddedTextTimelineRequest = parsed.pathname === "/embedded-text-timeline";
  var isTx3gTimelineRequest = parsed.pathname === "/tx3g-timeline";
  if (
    (!isEmbeddedTextRequest &&
      !isTx3gRequest &&
      !isEmbeddedTextTimelineRequest &&
      !isTx3gTimelineRequest) ||
    request.method !== "GET"
  ) {
    sendJson(response, 404, { returnValue: false, errorCode: "NOT_FOUND" });
    return;
  }

  var sourceUrl = String(parsed.query.url || "").trim();
  var trackNumber = parseNumber(parsed.query.trackNumber, 0);
  var trackOrdinal = parseNumber(parsed.query.trackOrdinal, -1);
  var startSeconds = Math.max(0, parseNumber(parsed.query.startSeconds, 0));
  var endSeconds = parseNumber(parsed.query.endSeconds, startSeconds + 120);
  var isTimelineRequest = isEmbeddedTextTimelineRequest || isTx3gTimelineRequest;
  if (
    !/^https?:\/\//i.test(sourceUrl) ||
    (!isTimelineRequest &&
      (isEmbeddedTextRequest
        ? !isFinite(trackOrdinal) || trackOrdinal < 0
        : !isFinite(trackNumber) || trackNumber <= 0))
  ) {
    sendJson(response, 400, {
      returnValue: false,
      errorCode: "INVALID_REQUEST",
      errorText: isTimelineRequest
        ? "Subtitle source URL is required"
        : isEmbeddedTextRequest
          ? "Embedded text source URL and trackOrdinal are required"
          : "TX3G source URL and trackNumber are required"
    });
    return;
  }

  var extraction = Promise.resolve().then(function () {
    if (isEmbeddedTextTimelineRequest) {
      return getEmbeddedTextParser().getEmbeddedTextSubtitleTimeline({
        url: sourceUrl,
        trackOrdinal: isFinite(trackOrdinal) && trackOrdinal >= 0 ? trackOrdinal : undefined
      });
    }
    if (isTx3gTimelineRequest) {
      return parser.extractTx3gTimeline({
        url: sourceUrl,
        trackNumber: isFinite(trackNumber) && trackNumber > 0 ? trackNumber : undefined
      });
    }
    return isEmbeddedTextRequest
      ? getEmbeddedTextParser().getEmbeddedTextSubtitleWindow({
          url: sourceUrl,
          trackOrdinal: trackOrdinal,
          startSeconds: startSeconds,
          endSeconds: endSeconds
        })
      : parser.extractTx3gWindow({
          url: sourceUrl,
          trackNumber: trackNumber,
          startSeconds: startSeconds,
          endSeconds: endSeconds
        });
  });

  extraction
    .then(function (payload) {
      sendJson(response, 200, payload);
    })
    .catch(function (error) {
      var errorCode = String(
        (error && error.code) || (isEmbeddedTextRequest ? "EMBEDDED_TEXT_PARSE_FAILED" : "TX3G_PARSE_FAILED")
      );
      console.warn(
        isEmbeddedTextRequest || isEmbeddedTextTimelineRequest
          ? "[Nuvio embedded text] extraction failed"
          : "[Nuvio TX3G] extraction failed",
        errorCode,
        error && error.message ? error.message : error
      );
      sendJson(response, 422, {
        returnValue: false,
        errorCode: errorCode,
        errorText: String(
          error && error.message
            ? error.message
            : error || (isEmbeddedTextRequest || isEmbeddedTextTimelineRequest
                ? "Embedded text extraction failed"
                : "TX3G extraction failed")
        )
      });
    });
}

function start(port) {
  if (service) {
    return service;
  }
  service = http.createServer(handleRequest);
  service.on("error", function (error) {
    console.warn("[Nuvio TX3G] local subtitle server unavailable", error && error.message ? error.message : error);
  });
  service.listen(Number(port || process.env.TX3G_PORT || DEFAULT_PORT), "127.0.0.1");
  return service;
}

function stop() {
  if (!service) {
    return;
  }
  try {
    service.close();
  } catch (_) {}
  service = null;
}

module.exports = {
  start: start,
  stop: stop,
  handleRequest: handleRequest
};
