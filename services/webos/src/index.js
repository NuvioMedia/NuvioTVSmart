var path = require("path");

var serverHost = require("./serverHost");
var SERVICE_ID = serverHost.SERVICE_ID;
var PORT_CANDIDATES = serverHost.PORT_CANDIDATES;
var bootLocalRuntime = serverHost.bootLocalRuntime;
var probeLocalServer = serverHost.probeLocalServer;
var requestLocalHttp = serverHost.requestLocalHttp;
var requestActiveServerHttp = serverHost.requestActiveServerHttp;
var requestActiveServerPath = serverHost.requestActiveServerPath;
var SUPABASE_PROXY_PATH = require("./supabaseProxy").SUPABASE_PROXY_PATH;
var bitmapSubtitles = require("./bitmapSubtitles");
var getBitmapSubtitleWindow = bitmapSubtitles.getBitmapSubtitleWindow;
var prepareBitmapSubtitleSource = bitmapSubtitles.prepareBitmapSubtitleSource;

var RUNTIME_PATH = path.resolve(__dirname, "..", "runtime", "media-http.cjs");

function createService() {
  try {
    var Service = require("webos-service");
    return new Service(SERVICE_ID);
  } catch (error) {
    console.warn(
      "[" + SERVICE_ID + "] webos-service unavailable, using local mock:",
      error.message
    );
    return {
      register: function () {}
    };
  }
}

var service = createService();

var runtimeState = {
  booted: false,
  bootTimestamp: null,
  bootCount: 0,
  error: null
};
var keepAliveIntervals = {};

function ensureRuntimeStarted(force) {
  if (!force && (runtimeState.booted || runtimeState.error)) {
    return;
  }

  runtimeState.bootTimestamp = new Date().toISOString();

  try {
    if (force) {
      runtimeState.error = null;
      console.warn(
        "[" + SERVICE_ID + "] local media runtime unavailable; attempting reboot from",
        RUNTIME_PATH
      );
    }
    bootLocalRuntime(RUNTIME_PATH);
    runtimeState.booted = true;
    runtimeState.bootCount += 1;
    console.log("[" + SERVICE_ID + "] local media runtime booted from", RUNTIME_PATH);
  } catch (error) {
    runtimeState.error = {
      message: String(error && error.message ? error.message : error),
      stack: String(error && error.stack ? error.stack : "")
    };
    console.error("[" + SERVICE_ID + "] failed to boot local media runtime:", error);
  }
}

function probeLocalServerWithRecovery(callback, includeBody) {
  ensureRuntimeStarted();
  probeLocalServer(function (_, status) {
    if (status || runtimeState.error) {
      callback(status);
      return;
    }
    ensureRuntimeStarted(true);
    setTimeout(function () {
      probeLocalServer(function (__, recoveredStatus) {
        callback(recoveredStatus);
      });
    }, 300);
  });
}

function respond(message, payload) {
  if (message && typeof message.respond === "function") {
    message.respond(payload);
    return;
  }

  console.log("[" + SERVICE_ID + "] response:", JSON.stringify(payload));
}

function buildBasePayload() {
  return {
    returnValue: !runtimeState.error,
    serviceId: SERVICE_ID,
    booted: runtimeState.booted,
    bootTimestamp: runtimeState.bootTimestamp,
    bootCount: runtimeState.bootCount,
    runtimePath: RUNTIME_PATH,
    error: runtimeState.error
  };
}

function buildErrorPayload(error, extras) {
  return Object.assign(
    buildBasePayload(),
    {
      returnValue: false,
      errorCode: -1,
      errorText: String(error && error.message ? error.message : error || "Unknown service error")
    },
    extras || {}
  );
}

function getMessagePayload(message) {
  if (message && message.payload && typeof message.payload === "object") {
    return message.payload;
  }
  return {};
}

function registerCommand(commandName, includeBody) {
  service.register(commandName, function (message) {
    probeLocalServerWithRecovery(function (status) {
      respond(
        message,
        Object.assign(buildBasePayload(), {
          url: status ? "http://127.0.0.1:" + status.port : null,
          settingsReachable: Boolean(status),
          settingsStatusCode: status ? status.statusCode : null,
          settingsBody: includeBody && status ? status.body : null
        })
      );
    });
  });
}

function registerSupabaseProxyCommand() {
  service.register("supabaseProxy", function (message) {
    var payload = getMessagePayload(message);
    var proxyRequest = {
      url: payload.url,
      method: payload.method,
      headers: payload.headers,
      body: typeof payload.body === "string" ? payload.body : null
    };
    requestActiveServerHttp(
      SUPABASE_PROXY_PATH,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(proxyRequest),
        timeoutMs: 20000,
        maxBodyBytes: 10 * 1024 * 1024
      },
      function (error, result) {
        if (error) {
          respond(
            message,
            buildErrorPayload(error, {
              proxiedPath: SUPABASE_PROXY_PATH
            })
          );
          return;
        }

        respond(
          message,
          Object.assign(buildBasePayload(), {
            supabaseProxy: true,
            statusCode: result ? result.statusCode || 0 : 0,
            headers: result ? result.headers || {} : {},
            body: result ? result.body || "" : ""
          })
        );
      }
    );
  });
}

function stopKeepAlive(token) {
  var key = String(token || "").trim();
  if (!key || !keepAliveIntervals[key]) {
    return false;
  }
  clearInterval(keepAliveIntervals[key]);
  delete keepAliveIntervals[key];
  return true;
}

function buildKeepAlivePayload(token, status) {
  return Object.assign(buildBasePayload(), {
    token: token,
    keepAlive: true,
    activeKeepAlives: Object.keys(keepAliveIntervals).length,
    url: status ? "http://127.0.0.1:" + status.port : null,
    settingsReachable: Boolean(status),
    settingsStatusCode: status ? status.statusCode : null
  });
}

function registerEngineFsKeepAliveCommands() {
  service.register("enginefsKeepAlive", function (message) {
    var payload = getMessagePayload(message);
    var token = String(payload.token || Date.now() + "-" + Math.random()).trim();
    var intervalMs = Math.max(
      5000,
      Math.min(30000, Math.trunc(Number(payload.intervalMs || 10000)))
    );

    stopKeepAlive(token);
    probeLocalServerWithRecovery(function (status) {
      respond(message, buildKeepAlivePayload(token, status));
    });

    keepAliveIntervals[token] = setInterval(function () {
      probeLocalServerWithRecovery(function (status) {
        try {
          respond(message, buildKeepAlivePayload(token, status));
        } catch (error) {
          stopKeepAlive(token);
        }
      });
    }, intervalMs);
  });

  service.register("enginefsKeepAliveStop", function (message) {
    var payload = getMessagePayload(message);
    var stopped = stopKeepAlive(payload.token);
    respond(
      message,
      Object.assign(buildBasePayload(), {
        token: String(payload.token || "").trim(),
        stopped: stopped,
        activeKeepAlives: Object.keys(keepAliveIntervals).length
      })
    );
  });
}

function registerTracksCommand() {
  service.register("tracks", function (message) {
    ensureRuntimeStarted();

    if (runtimeState.error) {
      respond(message, buildErrorPayload(runtimeState.error));
      return;
    }

    var mediaUrl = String(getMessagePayload(message).url || "").trim();
    if (!mediaUrl) {
      respond(message, buildErrorPayload("Missing required parameter: url"));
      return;
    }

    var tracksPath = "/tracks/" + encodeURIComponent(mediaUrl);
    requestActiveServerPath(tracksPath, function (error, status) {
      if (error) {
        respond(
          message,
          buildErrorPayload(error, {
            proxiedPath: tracksPath
          })
        );
        return;
      }

      if (!status || status.statusCode < 200 || status.statusCode >= 300) {
        var statusCode = status ? status.statusCode || 0 : 0;
        respond(
          message,
          buildErrorPayload("Track request failed with HTTP " + statusCode, {
            proxiedPath: tracksPath,
            statusCode: statusCode,
            rawBody: status ? status.body || "" : ""
          })
        );
        return;
      }

      try {
        var tracks = JSON.parse(status.body || "[]");
        respond(
          message,
          Object.assign(buildBasePayload(), {
            url: "http://127.0.0.1:" + status.port,
            proxiedPath: tracksPath,
            statusCode: status.statusCode,
            tracks: Array.isArray(tracks) ? tracks : []
          })
        );
      } catch (parseError) {
        respond(
          message,
          buildErrorPayload(parseError, {
            proxiedPath: tracksPath,
            statusCode: status.statusCode,
            rawBody: status.body || ""
          })
        );
      }
    });
  });
}

function registerSubtitleTextCommand() {
  service.register("subtitleText", function (message) {
    ensureRuntimeStarted();

    if (runtimeState.error) {
      respond(message, buildErrorPayload(runtimeState.error));
      return;
    }

    var subtitleUrl = String(getMessagePayload(message).url || "").trim();
    if (!/^https?:\/\//i.test(subtitleUrl)) {
      respond(message, buildErrorPayload("Missing or unsupported subtitle URL"));
      return;
    }

    var subtitlePath = "/subtitles.vtt?from=" + encodeURIComponent(subtitleUrl);
    requestActiveServerHttp(
      subtitlePath,
      {
        timeoutMs: 15000,
        maxBodyBytes: 512 * 1024
      },
      function (error, result) {
        if (error) {
          respond(message, buildErrorPayload(error, { proxiedPath: subtitlePath }));
          return;
        }

        var statusCode = result ? result.statusCode || 0 : 0;
        if (statusCode < 200 || statusCode >= 300) {
          respond(
            message,
            buildErrorPayload("Subtitle request failed with HTTP " + statusCode, {
              proxiedPath: subtitlePath,
              statusCode: statusCode
            })
          );
          return;
        }

        respond(
          message,
          Object.assign(buildBasePayload(), {
            proxiedPath: subtitlePath,
            statusCode: statusCode,
            contentType: String((result.headers && result.headers["content-type"]) || "text/vtt"),
            body: String(result.body || ""),
            bodyBytes: Number(result.bodyBytes || 0),
            bodyTruncated: Boolean(result.bodyTruncated)
          })
        );
      }
    );
  });
}

function registerBitmapSubtitleCommand() {
  service.register("bitmapSubtitlePrepare", function (message) {
    var payload = getMessagePayload(message);
    prepareBitmapSubtitleSource({ url: payload.url })
      .then(function (result) {
        respond(message, Object.assign(buildBasePayload(), result, { returnValue: true }));
      })
      .catch(function (error) {
        console.warn("[" + SERVICE_ID + "] bitmap subtitle preparation failed:", error);
        respond(
          message,
          buildErrorPayload(error, {
            bitmapSubtitle: true,
            errorCode: String((error && error.code) || "BITMAP_SUBTITLE_PREPARE_FAILED"),
            errorDetails: (error && error.details) || null
          })
        );
      });
  });

  service.register("bitmapSubtitleWindow", function (message) {
    var payload = getMessagePayload(message);
    getBitmapSubtitleWindow({
      url: payload.url,
      trackNumber: payload.trackNumber,
      startSeconds: payload.startSeconds,
      endSeconds: payload.endSeconds
    })
      .then(function (result) {
        respond(message, Object.assign(buildBasePayload(), result, { returnValue: true }));
      })
      .catch(function (error) {
        console.error("[" + SERVICE_ID + "] bitmap subtitle extraction failed:", error);
        respond(
          message,
          buildErrorPayload(error, {
            bitmapSubtitle: true,
            errorCode: String((error && error.code) || "BITMAP_SUBTITLE_FAILED"),
            errorDetails: (error && error.details) || null
          })
        );
      });
  });
}

function buildTorrentProxyPayload(result, proxiedPath) {
  var json = parseJsonMaybe(result && result.body);
  return Object.assign(buildBasePayload(), {
    returnValue: Boolean(result && result.statusCode >= 200 && result.statusCode < 300),
    url: result ? "http://127.0.0.1:" + result.port : null,
    proxiedPath: proxiedPath,
    statusCode: result ? result.statusCode : null,
    headers: result && result.headers ? result.headers : {},
    body: result ? String(result.body || "") : "",
    bodyBytes: result ? result.bodyBytes : 0,
    bodyTruncated: Boolean(result && result.bodyTruncated),
    json: json
  });
}

function registerTorrentProxyCommand(commandName, buildPath) {
  service.register(commandName, function (message) {
    ensureRuntimeStarted();

    if (runtimeState.error) {
      respond(message, buildErrorPayload(runtimeState.error));
      return;
    }

    var payload = getMessagePayload(message);
    var infoHash = normalizeInfoHash(payload.infoHash);
    if (!infoHash) {
      respond(message, buildErrorPayload("Missing or invalid required parameter: infoHash"));
      return;
    }

    var proxiedPath = buildPath(payload, infoHash);
    requestActiveServerHttp(
      proxiedPath,
      {
        method: "GET",
        timeoutMs: Math.max(250, Math.min(60000, Math.trunc(Number(payload.timeoutMs || 10000)))),
        maxBodyBytes: Math.max(
          1024,
          Math.min(1048576, Math.trunc(Number(payload.maxBodyBytes || 262144)))
        )
      },
      function (error, status) {
        if (error) {
          respond(
            message,
            buildErrorPayload(error, {
              proxiedPath: proxiedPath
            })
          );
          return;
        }

        var responsePayload = buildTorrentProxyPayload(status, proxiedPath);
        if (!responsePayload.returnValue) {
          responsePayload.errorCode = status ? status.statusCode || -1 : -1;
          responsePayload.errorText =
            "Torrent proxy request failed with HTTP " + (status ? status.statusCode || 0 : 0);
        }
        respond(message, responsePayload);
      }
    );
  });
}

function registerTorrentCreateCommand() {
  service.register("torrentCreate", function (message) {
    ensureRuntimeStarted();

    if (runtimeState.error) {
      respond(message, buildErrorPayload(runtimeState.error));
      return;
    }

    var payload = getMessagePayload(message);
    var infoHash =
      normalizeInfoHash(payload.infoHash) ||
      extractInfoHashFromMagnet(payload.magnetUri || payload.magnet);
    if (!infoHash) {
      respond(message, buildErrorPayload("Missing or invalid required parameter: infoHash"));
      return;
    }

    var createRequest = buildCreateRequest(payload, infoHash);
    var createBody = JSON.stringify(createRequest.body || {});
    var timeoutMs = Math.max(250, Math.min(60000, Math.trunc(Number(payload.timeoutMs || 10000))));
    var maxBodyBytes = Math.max(
      1024,
      Math.min(1048576, Math.trunc(Number(payload.maxBodyBytes || 262144)))
    );

    requestActiveServerHttp(
      createRequest.path,
      {
        method: "POST",
        body: createBody,
        headers: {
          "content-type": "application/json"
        },
        timeoutMs: timeoutMs,
        maxBodyBytes: maxBodyBytes
      },
      function (error, status) {
        if (error) {
          respond(
            message,
            buildErrorPayload(error, {
              proxiedPath: createRequest.path
            })
          );
          return;
        }

        var responsePayload = buildTorrentProxyPayload(status, createRequest.path);
        responsePayload.createRequest = {
          method: "POST",
          path: createRequest.path,
          bodyKeys: Object.keys(createRequest.body || {})
        };
        if (!responsePayload.returnValue) {
          responsePayload.errorCode = status ? status.statusCode || -1 : -1;
          responsePayload.errorText =
            "Torrent create request failed with HTTP " + (status ? status.statusCode || 0 : 0);
        }
        respond(message, responsePayload);
      }
    );
  });
}

function registerTorrentProxyCommands() {
  registerTorrentCreateCommand();
  registerTorrentProxyCommand("torrentStats", function (payload, infoHash) {
    var fileIdx = Number(payload.fileIdx);
    if (Number.isFinite(fileIdx)) {
      return "/" + infoHash + "/" + fileIdx + "/stats.json";
    }
    return "/" + infoHash + "/stats.json";
  });
  registerTorrentProxyCommand("torrentRemove", function (_, infoHash) {
    return "/" + infoHash + "/remove";
  });
}

function parseJsonMaybe(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch (_) {
    return null;
  }
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function requestRuntime(pathname, options) {
  return new Promise(function (resolve, reject) {
    requestActiveServerHttp(pathname, options || {}, function (error, result) {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function requestRuntimeJson(pathname, options) {
  return requestRuntime(pathname, options).then(function (result) {
    var json = parseJsonMaybe(result.body);
    return Object.assign({}, result, {
      json: json
    });
  });
}

function normalizeInfoHash(value) {
  var hash = String(value || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : "";
}

function extractInfoHashFromMagnet(value) {
  var magnet = String(value || "").trim();
  var match = magnet.match(/xt=urn:btih:([0-9a-fA-F]{40})/);
  return match ? normalizeInfoHash(match[1]) : "";
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (entry) {
      return String(entry || "").trim();
    })
    .filter(Boolean);
}

function buildMagnetUri(infoHash, payload) {
  var magnet = String(payload.magnetUri || payload.magnet || "").trim();
  if (magnet) {
    return magnet;
  }

  var trackers = normalizeStringArray(payload.trackers || payload.sources);
  if (!infoHash || !trackers.length) {
    return "";
  }

  return (
    "magnet:?xt=urn:btih:" +
    encodeURIComponent(infoHash) +
    trackers
      .map(function (tracker) {
        return "&tr=" + encodeURIComponent(tracker);
      })
      .join("")
  );
}

function normalizePeerSearchSource(value, infoHash) {
  var source = String(value || "").trim();
  if (!source) {
    return "";
  }
  if (/^tracker:/i.test(source) || /^dht:/i.test(source)) {
    return source;
  }
  if (normalizeInfoHash(source) && normalizeInfoHash(source) === infoHash) {
    return "dht:" + infoHash;
  }
  return "tracker:" + source;
}

function buildPeerSearchSources(infoHash, payload) {
  var trackers = normalizeStringArray(payload.trackers || payload.sources);
  var seen = {};
  var result = [];
  function add(source) {
    var normalized = normalizePeerSearchSource(source, infoHash);
    var key = normalized.toLowerCase();
    if (normalized && !seen[key]) {
      seen[key] = true;
      result.push(normalized);
    }
  }
  if (infoHash) {
    add("dht:" + infoHash);
  }
  trackers.forEach(add);
  return result;
}

function sanitizeDiagnosticPayload(payload) {
  return {
    infoHash:
      normalizeInfoHash(payload.infoHash) ||
      extractInfoHashFromMagnet(payload.magnetUri || payload.magnet),
    hasMagnet: Boolean(String(payload.magnetUri || payload.magnet || "").trim()),
    hasBlob: typeof payload.blob === "string",
    blobHexLength: typeof payload.blob === "string" ? payload.blob.length : 0,
    from: typeof payload.from === "string" ? payload.from : "",
    fileIdx: payload.fileIdx,
    fileMustInclude: normalizeStringArray(payload.fileMustInclude),
    trackers: normalizeStringArray(payload.trackers || payload.sources),
    pollCount: payload.pollCount,
    pollIntervalMs: payload.pollIntervalMs,
    skipCreate: payload.skipCreate,
    createMethod: payload.createMethod,
    settingsTimeoutMs: payload.settingsTimeoutMs,
    createTimeoutMs: payload.createTimeoutMs,
    streamProbeTimeoutMs: payload.streamProbeTimeoutMs,
    statsTimeoutMs: payload.statsTimeoutMs,
    streamProbe: payload.streamProbe,
    streamProbeBytes: payload.streamProbeBytes,
    removeAfter: payload.removeAfter
  };
}

function truncateDiagnosticBody(body, limit) {
  var maxLength = Math.max(0, Number(limit || 4096) || 4096);
  if (body == null) {
    return {
      body: "",
      encoding: "utf8",
      truncated: false
    };
  }
  if (Buffer.isBuffer(body)) {
    var binarySlice = body.slice(0, maxLength);
    return {
      body: binarySlice.toString("base64"),
      encoding: "base64",
      truncated: body.length > binarySlice.length
    };
  }
  var text = String(body);
  return {
    body: text.slice(0, maxLength),
    encoding: "utf8",
    truncated: text.length > maxLength
  };
}

function summarizeHttpResult(result) {
  var truncated = truncateDiagnosticBody(result && result.body, 4096);
  return {
    port: result && result.port,
    statusCode: result && result.statusCode,
    headers: result && result.headers ? result.headers : {},
    bodyBytes: result && result.bodyBytes,
    bodyTruncated: Boolean(result && result.bodyTruncated) || truncated.truncated,
    bodyEncoding: truncated.encoding,
    body: truncated.body,
    json: result && result.json ? result.json : null
  };
}

function diagnosticTimeout(payload, key, fallback) {
  return Math.max(250, Math.min(60000, Math.trunc(Number(payload[key] || fallback))));
}

function diagnosticErrorMessage(error) {
  return String(error && error.message ? error.message : error || "Unknown diagnostic error");
}

function requestRuntimeOnPort(port, pathname, options) {
  return new Promise(function (resolve, reject) {
    requestLocalHttp(port, pathname, options || {}, function (error, result) {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function markReportError(report, step) {
  report.returnValue = false;
  if (!Array.isArray(report.errors)) {
    report.errors = [];
  }
  report.errors.push({
    name: step.name,
    url: step.url,
    method: step.method,
    errorMessage: step.errorMessage,
    timeoutMs: step.timeoutMs,
    statusCode: step.statusCode
  });
}

function pushDiagnosticStep(report, step) {
  report.steps.push(step);
  console.log("[" + SERVICE_ID + "] enginefs diagnostic " + step.name + ":", JSON.stringify(step));
  return step;
}

function finalizeDiagnosticReport(report) {
  if (!report.completedAt) {
    report.completedAt = new Date().toISOString();
    pushDiagnosticStep(report, {
      name: "complete",
      startedAt: report.completedAt,
      durationMs: 0,
      url: null,
      method: null,
      statusCode: null,
      responseBody: "",
      responseBodyEncoding: "utf8",
      responseBodyTruncated: false,
      errorMessage: null,
      timeoutMs: null,
      completedAt: report.completedAt
    });
  }
  return report;
}

async function runSyncDiagnosticStep(report, name, timeoutMs, task) {
  var startedMs = Date.now();
  var step = {
    name: name,
    startedAt: new Date(startedMs).toISOString(),
    durationMs: null,
    url: null,
    method: null,
    statusCode: null,
    responseBody: "",
    responseBodyEncoding: "utf8",
    responseBodyTruncated: false,
    errorMessage: null,
    timeoutMs: timeoutMs
  };
  try {
    var value = task();
    step.durationMs = Date.now() - startedMs;
    if (value && typeof value === "object") {
      Object.assign(step, value);
    }
    pushDiagnosticStep(report, step);
    return { ok: true, step: step, value: value };
  } catch (error) {
    step.durationMs = Date.now() - startedMs;
    step.errorMessage = diagnosticErrorMessage(error);
    pushDiagnosticStep(report, step);
    markReportError(report, step);
    return { ok: false, step: step, error: error };
  }
}

async function runHttpDiagnosticStep(report, options) {
  var startedMs = Date.now();
  var pathName = options.path;
  var method = options.method || "GET";
  var timeoutMs = options.timeoutMs;
  var bodyLimit = Number(options.responseBodyLimit || 4096) || 4096;
  var step = {
    name: options.name,
    startedAt: new Date(startedMs).toISOString(),
    durationMs: null,
    url: report.baseUrl ? report.baseUrl + pathName : pathName,
    method: method,
    statusCode: null,
    headers: {},
    responseBody: "",
    responseBodyEncoding: "utf8",
    responseBodyBytes: 0,
    responseBodyTruncated: false,
    json: null,
    errorMessage: null,
    timeoutMs: timeoutMs
  };
  try {
    if (!report.runtimePort) {
      throw new Error("Local media runtime port is not available");
    }
    var result = await requestRuntimeOnPort(report.runtimePort, pathName, {
      method: method,
      body: options.body || null,
      headers: options.headers || {},
      timeoutMs: timeoutMs,
      maxBodyBytes: options.maxBodyBytes || 1048576,
      encoding: options.encoding
    });
    var truncated = truncateDiagnosticBody(result.body, bodyLimit);
    var json = options.parseJson === false ? null : parseJsonMaybe(result.body);
    step.durationMs = Date.now() - startedMs;
    step.url = "http://127.0.0.1:" + result.port + pathName;
    step.statusCode = result.statusCode;
    step.headers = result.headers || {};
    step.responseBody = truncated.body;
    step.responseBodyEncoding = truncated.encoding;
    step.responseBodyBytes = result.bodyBytes;
    step.responseBodyTruncated = Boolean(result.bodyTruncated) || truncated.truncated;
    step.json = json;
    pushDiagnosticStep(report, step);
    if (result.statusCode < 200 || result.statusCode >= 400) {
      step.errorMessage = "HTTP " + result.statusCode;
      markReportError(report, step);
      return { ok: false, step: step, result: result, json: json };
    }
    return { ok: true, step: step, result: Object.assign({}, result, { json: json }), json: json };
  } catch (error) {
    step.durationMs = Date.now() - startedMs;
    step.errorMessage = diagnosticErrorMessage(error);
    pushDiagnosticStep(report, step);
    markReportError(report, step);
    return { ok: false, step: step, error: error };
  }
}

async function runSettingsProbeStep(report, timeoutMs) {
  var startedMs = Date.now();
  var step = {
    name: "settings-probe",
    startedAt: new Date(startedMs).toISOString(),
    durationMs: null,
    url: "/settings",
    method: "GET",
    statusCode: null,
    headers: {},
    responseBody: "",
    responseBodyEncoding: "utf8",
    responseBodyBytes: 0,
    responseBodyTruncated: false,
    json: null,
    errorMessage: null,
    timeoutMs: timeoutMs,
    attempts: []
  };

  for (var index = 0; index < PORT_CANDIDATES.length; index += 1) {
    var port = PORT_CANDIDATES[index];
    var attemptStartedMs = Date.now();
    var attempt = {
      port: port,
      url: "http://127.0.0.1:" + port + "/settings",
      startedAt: new Date(attemptStartedMs).toISOString(),
      durationMs: null,
      statusCode: null,
      errorMessage: null
    };
    step.attempts.push(attempt);
    try {
      var result = await requestRuntimeOnPort(port, "/settings", {
        method: "GET",
        timeoutMs: timeoutMs,
        maxBodyBytes: 262144
      });
      var truncated = truncateDiagnosticBody(result.body, 4096);
      var json = parseJsonMaybe(result.body);
      attempt.durationMs = Date.now() - attemptStartedMs;
      attempt.statusCode = result.statusCode;
      step.durationMs = Date.now() - startedMs;
      step.url = attempt.url;
      step.statusCode = result.statusCode;
      step.headers = result.headers || {};
      step.responseBody = truncated.body;
      step.responseBodyEncoding = truncated.encoding;
      step.responseBodyBytes = result.bodyBytes;
      step.responseBodyTruncated = Boolean(result.bodyTruncated) || truncated.truncated;
      step.json = json;
      if (result.statusCode >= 200 && result.statusCode < 500) {
        report.runtimePort = port;
        report.baseUrl = "http://127.0.0.1:" + port;
        pushDiagnosticStep(report, step);
        return {
          ok: true,
          step: step,
          result: Object.assign({}, result, { json: json }),
          json: json
        };
      }
    } catch (error) {
      attempt.durationMs = Date.now() - attemptStartedMs;
      attempt.errorMessage = diagnosticErrorMessage(error);
    }
  }

  step.durationMs = Date.now() - startedMs;
  step.errorMessage = "Local media server unavailable on ports " + PORT_CANDIDATES.join(", ");
  pushDiagnosticStep(report, step);
  markReportError(report, step);
  return { ok: false, step: step };
}

function buildCreateRequest(payload, infoHash) {
  var hasTorrentFile = typeof payload.blob === "string" || typeof payload.from === "string";
  var body = {};
  var magnet = buildMagnetUri(infoHash, payload);
  var fileMustInclude = normalizeStringArray(payload.fileMustInclude);
  var peerSearchSources = buildPeerSearchSources(infoHash, payload);
  var explicitFileIdx = Number(payload.fileIdx);
  var hasExplicitFileIdx = Number.isFinite(explicitFileIdx) && explicitFileIdx >= 0;

  if (hasTorrentFile) {
    if (typeof payload.blob === "string") {
      body.blob = payload.blob;
    }
    if (typeof payload.from === "string") {
      body.from = payload.from;
    }
    return {
      path: "/create",
      body: body
    };
  }

  if (infoHash) {
    body.torrent = {
      infoHash: infoHash
    };
  }
  if (magnet) {
    body.stream = magnet;
  }
  if (peerSearchSources.length > 0) {
    body.peerSearch = {
      sources: peerSearchSources,
      min: Math.max(1, Math.min(1000, Math.trunc(Number(payload.peerSearchMin || 40)))),
      max: Math.max(1, Math.min(2000, Math.trunc(Number(payload.peerSearchMax || 200))))
    };
  }
  if (fileMustInclude.length) {
    body.fileMustInclude = fileMustInclude;
  }
  if (hasExplicitFileIdx || payload.guessFileIdx === false) {
    body.guessFileIdx = false;
  } else if (payload.guessFileIdx !== false) {
    body.guessFileIdx = payload.guessFileIdx || {};
  }

  return {
    path: "/" + infoHash + "/create",
    body: body
  };
}

function normalizeCreateMethod(value) {
  var method = String(value || "BOTH")
    .trim()
    .toUpperCase();
  if (method === "GET" || method === "POST" || method === "BOTH") {
    return method;
  }
  return "BOTH";
}

function createMethodsFor(value) {
  var method = normalizeCreateMethod(value);
  if (method === "BOTH") {
    return ["GET", "POST"];
  }
  return [method];
}

async function runCreateDiagnostics(report, payload, createRequest, createTimeoutMs) {
  var methods = createMethodsFor(payload.createMethod);
  var createBody = JSON.stringify(createRequest.body || {});
  var attempts = [];

  for (var index = 0; index < methods.length; index += 1) {
    var method = methods[index];
    var createStep = await runHttpDiagnosticStep(report, {
      name: "create-" + method.toLowerCase(),
      path: createRequest.path,
      method: method,
      body: createBody,
      headers: {
        "Content-Type": "application/json"
      },
      timeoutMs: createTimeoutMs,
      maxBodyBytes: 1048576
    });
    attempts.push(createStep.step);
    if (createStep.ok && createStep.json) {
      return {
        ok: true,
        attempts: attempts,
        step: createStep.step,
        json: createStep.json
      };
    }
  }

  return {
    ok: false,
    attempts: attempts,
    step: attempts[attempts.length - 1] || null,
    json: null
  };
}

function guessDiagnosticFileIndexFromStats(files) {
  var bestIndex = -1;
  var bestLength = -1;
  (Array.isArray(files) ? files : []).forEach(function (file, index) {
    var length = Number((file && file.length) || 0);
    if (length > bestLength) {
      bestIndex = index;
      bestLength = length;
    }
  });
  return bestIndex;
}

function selectDiagnosticFileIndex(payload, createJson) {
  if (payload.fileIdx !== undefined && payload.fileIdx !== null && payload.fileIdx !== "") {
    return Number(payload.fileIdx);
  }
  if (createJson && createJson.guessedFileIdx !== undefined && createJson.guessedFileIdx !== null) {
    return Number(createJson.guessedFileIdx);
  }
  var guessedFromFiles = guessDiagnosticFileIndexFromStats(createJson && createJson.files);
  if (guessedFromFiles >= 0) {
    return guessedFromFiles;
  }
  return -1;
}

async function runEngineFsDiagnostic(payload) {
  var sanitized = sanitizeDiagnosticPayload(payload);
  var infoHash = sanitized.infoHash;
  var pollCount = Math.max(0, Math.min(60, Math.trunc(Number(payload.pollCount || 6))));
  var pollIntervalMs = Math.max(
    250,
    Math.min(30000, Math.trunc(Number(payload.pollIntervalMs || 1000)))
  );
  var streamProbe = payload.streamProbe !== false;
  var streamProbeBytes = Math.max(
    1,
    Math.min(1048576, Math.trunc(Number(payload.streamProbeBytes || 262144)))
  );
  var settingsTimeoutMs = diagnosticTimeout(payload, "settingsTimeoutMs", 5000);
  var createTimeoutMs = diagnosticTimeout(payload, "createTimeoutMs", 10000);
  var streamProbeTimeoutMs = diagnosticTimeout(payload, "streamProbeTimeoutMs", 10000);
  var statsTimeoutMs = diagnosticTimeout(payload, "statsTimeoutMs", 5000);
  var removeTimeoutMs = diagnosticTimeout(payload, "removeTimeoutMs", 5000);
  var skipCreate = payload.skipCreate === true;
  var createMethod = normalizeCreateMethod(payload.createMethod);
  var report = {
    startedAt: new Date().toISOString(),
    returnValue: true,
    serviceId: SERVICE_ID,
    runtimePath: RUNTIME_PATH,
    request: sanitized,
    timeouts: {
      settingsTimeoutMs: settingsTimeoutMs,
      createTimeoutMs: createTimeoutMs,
      streamProbeTimeoutMs: streamProbeTimeoutMs,
      statsTimeoutMs: statsTimeoutMs,
      removeTimeoutMs: removeTimeoutMs
    },
    steps: [],
    errors: [],
    runtimePort: null,
    baseUrl: null,
    initialStats: null,
    create: null,
    createAttempts: [],
    selectedInfoHash: null,
    selectedFileIdx: null,
    playbackUrl: null,
    streamProbe: null,
    polls: [],
    removed: null,
    completedAt: null
  };

  var bootStep = await runSyncDiagnosticStep(report, "ensureRuntimeStarted", null, function () {
    ensureRuntimeStarted();
    if (runtimeState.error) {
      throw new Error(runtimeState.error.message || "Runtime failed to boot");
    }
    return {
      booted: runtimeState.booted,
      bootTimestamp: runtimeState.bootTimestamp,
      runtimePath: RUNTIME_PATH
    };
  });
  if (!bootStep.ok) {
    return finalizeDiagnosticReport(report);
  }

  var settingsStep = await runSettingsProbeStep(report, settingsTimeoutMs);
  if (!settingsStep.ok) {
    return finalizeDiagnosticReport(report);
  }

  var initialStatsStep = await runHttpDiagnosticStep(report, {
    name: "initial-stats",
    path: "/stats.json",
    method: "GET",
    timeoutMs: statsTimeoutMs,
    maxBodyBytes: 262144
  });
  report.initialStats = initialStatsStep.step;

  if (skipCreate) {
    return finalizeDiagnosticReport(report);
  }

  if (!infoHash && typeof payload.blob !== "string" && typeof payload.from !== "string") {
    var validationStep = {
      name: "validate-create-input",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      url: null,
      method: null,
      statusCode: null,
      responseBody: "",
      responseBodyEncoding: "utf8",
      responseBodyTruncated: false,
      errorMessage: "Missing infoHash, magnetUri, blob or from for EngineFS diagnostic",
      timeoutMs: null
    };
    pushDiagnosticStep(report, validationStep);
    markReportError(report, validationStep);
    return finalizeDiagnosticReport(report);
  }

  var createRequest = buildCreateRequest(payload, infoHash);
  pushDiagnosticStep(report, {
    name: "create-plan",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    url: report.baseUrl + createRequest.path,
    method: createMethod,
    statusCode: null,
    responseBody: "",
    responseBodyEncoding: "utf8",
    responseBodyTruncated: false,
    errorMessage: null,
    timeoutMs: createTimeoutMs,
    path: createRequest.path,
    bodyKeys: Object.keys(createRequest.body || {}),
    methods: createMethodsFor(createMethod)
  });

  var createResult = await runCreateDiagnostics(report, payload, createRequest, createTimeoutMs);
  report.createAttempts = createResult.attempts;
  report.create = createResult.step;

  if (createResult.ok && createResult.json) {
    infoHash = normalizeInfoHash(createResult.json.infoHash) || infoHash;
    if (!infoHash) {
      createResult.step.errorMessage = "EngineFS create did not return a usable infoHash";
      markReportError(report, createResult.step);
    }
  }

  if (!infoHash) {
    return finalizeDiagnosticReport(report);
  }

  var fileIdx = selectDiagnosticFileIndex(payload, createResult.json || {});
  report.selectedInfoHash = infoHash;
  report.selectedFileIdx = fileIdx;
  report.playbackUrl = report.baseUrl + "/" + infoHash + "/" + fileIdx;

  pushDiagnosticStep(report, {
    name: "select-stream",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    url: report.playbackUrl,
    method: "GET",
    statusCode: null,
    responseBody: "",
    responseBodyEncoding: "utf8",
    responseBodyTruncated: false,
    errorMessage: null,
    timeoutMs: null,
    infoHash: infoHash,
    fileIdx: fileIdx,
    playbackUrl: report.playbackUrl
  });

  var postCreateGlobalStatsStep = await runHttpDiagnosticStep(report, {
    name: "post-create-global-stats",
    path: "/stats.json",
    method: "GET",
    timeoutMs: statsTimeoutMs,
    maxBodyBytes: 1048576
  });

  var postCreateTorrentStatsStep = await runHttpDiagnosticStep(report, {
    name: "post-create-torrent-stats",
    path: "/" + infoHash + "/stats.json",
    method: "GET",
    timeoutMs: statsTimeoutMs,
    maxBodyBytes: 1048576
  });

  var postCreateAutoFileStatsStep = await runHttpDiagnosticStep(report, {
    name: "post-create-auto-file-stats",
    path: "/" + infoHash + "/-1/stats.json",
    method: "GET",
    timeoutMs: statsTimeoutMs,
    maxBodyBytes: 1048576
  });

  report.postCreate = {
    globalStats: postCreateGlobalStatsStep.step,
    torrentStats: postCreateTorrentStatsStep.step,
    autoFileStats: postCreateAutoFileStatsStep.step
  };

  var autoFileProbeStep = await runHttpDiagnosticStep(report, {
    name: "post-create-auto-file-probe",
    path: "/" + infoHash + "/-1",
    method: "GET",
    headers: {
      Range: "bytes=0-1023"
    },
    timeoutMs: streamProbeTimeoutMs,
    maxBodyBytes: 1024,
    responseBodyLimit: 512,
    encoding: null,
    parseJson: false
  });
  report.postCreate.autoFileProbe = autoFileProbeStep.step;

  if (streamProbe) {
    var streamStep = await runHttpDiagnosticStep(report, {
      name: "stream-probe",
      path: "/" + infoHash + "/" + fileIdx,
      method: "GET",
      headers: {
        Range: "bytes=0-" + (streamProbeBytes - 1)
      },
      timeoutMs: streamProbeTimeoutMs,
      maxBodyBytes: streamProbeBytes,
      responseBodyLimit: 512,
      encoding: null,
      parseJson: false
    });
    report.streamProbe = streamStep.step;
  }

  for (var index = 0; index < pollCount; index += 1) {
    if (index > 0) {
      await delay(pollIntervalMs);
    }
    var torrentStatsStep = await runHttpDiagnosticStep(report, {
      name: "torrent-stats-poll",
      path: "/" + infoHash + "/stats.json",
      method: "GET",
      timeoutMs: statsTimeoutMs,
      maxBodyBytes: 1048576
    });
    torrentStatsStep.step.pollIndex = index;

    var fileStatsStep = await runHttpDiagnosticStep(report, {
      name: "file-stats-poll",
      path: "/" + infoHash + "/" + fileIdx + "/stats.json",
      method: "GET",
      timeoutMs: statsTimeoutMs,
      maxBodyBytes: 1048576
    });
    fileStatsStep.step.pollIndex = index;

    var poll = {
      index: index,
      at: new Date().toISOString(),
      torrent: torrentStatsStep.step,
      file: fileStatsStep.step
    };
    report.polls.push(poll);
  }

  if (payload.removeAfter === true) {
    var removeStep = await runHttpDiagnosticStep(report, {
      name: "remove",
      path: "/" + infoHash + "/remove",
      method: "GET",
      timeoutMs: removeTimeoutMs,
      maxBodyBytes: 262144
    });
    report.removed = removeStep.step;
  }

  return finalizeDiagnosticReport(report);
}

function registerEngineFsDiagnosticCommand() {
  service.register("enginefsDiagnostic", function (message) {
    var payload = getMessagePayload(message);
    runEngineFsDiagnostic(payload)
      .then(function (report) {
        respond(message, report);
      })
      .catch(function (error) {
        console.error("[" + SERVICE_ID + "] enginefs diagnostic failed:", error);
        respond(
          message,
          buildErrorPayload(error, {
            diagnostic: {
              request: sanitizeDiagnosticPayload(payload),
              failedAt: new Date().toISOString()
            }
          })
        );
      });
  });
}

ensureRuntimeStarted();
registerCommand("ping", false);
registerCommand("status", true);
registerSupabaseProxyCommand();
registerEngineFsKeepAliveCommands();
registerTracksCommand();
registerSubtitleTextCommand();
registerBitmapSubtitleCommand();
registerTorrentProxyCommands();
registerEngineFsDiagnosticCommand();
