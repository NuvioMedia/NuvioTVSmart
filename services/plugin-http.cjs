var http = require("http");
var https = null;
var dns = null;
var net = null;
var urlModule = null;
var zlib = null;

function loadRuntimeModule(name) {
  return require(name);
}

function getUrlModule() {
  if (!urlModule) urlModule = loadRuntimeModule("url");
  return urlModule;
}

function getNetModule() {
  if (!net) net = loadRuntimeModule("net");
  return net;
}

function getDnsModule() {
  if (!dns) dns = loadRuntimeModule("dns");
  return dns;
}

function getHttpsModule() {
  if (!https) https = loadRuntimeModule("https");
  return https;
}

function getZlibModule() {
  if (!zlib) zlib = loadRuntimeModule("zlib");
  return zlib;
}

var MAX_REQUEST_BYTES = 1024 * 1024;
var MAX_SERVICE_REQUEST_BYTES = Math.ceil(MAX_REQUEST_BYTES / 3) * 4 + 64 * 1024;
var DEFAULT_RESPONSE_BYTES = 1024 * 1024;
// Keep the service envelope consistent with the modern app policy. Plugin
// fetches still request the Android 1 MiB cap; this upper bound is for
// manifest/code management responses.
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
var MAX_WIRE_RESPONSE_BYTES = MAX_RESPONSE_BYTES;
var MAX_REDIRECTS = 20;
// Android gives each provider request a 60-second budget; the caller still
// enforces the separate 120-second global plugin-search deadline.
var DEFAULT_TIMEOUT_MS = 60000;
// Match Android's OkHttp connect timeout while leaving the existing 60-second
// request/read timeout unchanged. This is the per-address budget used when a
// DNS route fails before a response is received.
var CONNECT_ATTEMPT_TIMEOUT_MS = 30000;
var PLUGIN_PROTOCOL_VERSION = 1;
var MAX_ACTIVE_REQUESTS = 10;
// Keep the active network cap unchanged, but queue the burst generated when
// one scraper issues several fetches. Android queues eligible scraper work;
// rejecting overflow here turns otherwise independent providers into failures.
var MAX_QUEUED_REQUESTS = 128;
var MAX_REQUESTS_PER_SCRAPER_PER_MINUTE = 60;
var CIRCUIT_FAILURE_LIMIT = 3;
var CIRCUIT_OPEN_MS = 30000;

function emitTrace(trace, event, details) {
  if (typeof trace !== "function") return;
  try {
    trace(event, details || {});
  } catch (_) {
    // Diagnostics must never affect the network service.
  }
}

function traceError(error) {
  var result = {
    name: error && error.name ? String(error.name) : "Error",
    message: error && error.message ? String(error.message) : String(error || "Unknown error")
  };
  if (error && error.code) result.code = String(error.code);
  if (error && error.stack) result.stack = String(error.stack).slice(0, 1200);
  return result;
}

function traceRequestDetails(payload, parsed, redirects) {
  var method = String((payload && payload.method) || "GET").toUpperCase();
  var details = {
    requestId: String((payload && payload.requestId) || "").slice(0, 128),
    method: method.slice(0, 12),
    redirect: Number(redirects) || 0
  };
  if (parsed) {
    details.protocol = String(parsed.protocol || "");
    details.host = String(parsed.hostname || "").slice(0, 255);
    details.port = Number(parsed.port || 0) || (parsed.protocol === "https:" ? 443 : 80);
    // Never include query strings: plugin URLs may contain configuration data.
    details.path = String(parsed.pathname || "/").slice(0, 512);
  }
  return details;
}

function isLoopbackAddress(value) {
  var address = String(value || "")
    .trim()
    .toLowerCase();
  if (!address) return false;
  address = address.split("%", 1)[0];
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  address = address.replace(/^::ffff:/, "");
  return /^127(?:\.\d{1,3}){3}$/.test(address);
}

function isLoopbackRequest(request) {
  var socket = request && (request.socket || request.connection);
  return isLoopbackAddress(socket && socket.remoteAddress);
}

function parseUrl(value) {
  var parsed;
  try {
    parsed = new (getUrlModule().URL)(String(value || ""));
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

function resolveUrl(value, base) {
  return new (getUrlModule().URL)(String(value || ""), String(base || "")).toString();
}

function normalizeHeaders(headers) {
  var result = {};
  Object.keys(headers || {}).forEach(function (key) {
    var name = String(key || "");
    var lower = name.toLowerCase();
    var value = headers[key];
    if (!name || value == null || lower === "accept-encoding") return;
    result[name] = String(value);
  });
  if (
    !Object.keys(result).some(function (key) {
      return key === "User-Agent";
    })
  ) {
    result["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }
  return result;
}

function headerValue(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  var key = Object.keys(headers || {}).find(function (name) {
    return String(name).toLowerCase() === wanted;
  });
  return key ? headers[key] : null;
}

function hasHeader(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  return Object.keys(headers || {}).some(function (name) {
    return String(name).toLowerCase() === wanted;
  });
}

function removeHeader(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  Object.keys(headers || {}).forEach(function (name) {
    if (String(name).toLowerCase() === wanted) delete headers[name];
  });
}

function validatePayload(payload) {
  var parsed = parseUrl(payload && payload.url);
  if (!parsed)
    return {
      ok: false,
      error: "Only valid HTTP(S) URLs are allowed"
    };
  var requestedMethod = String((payload && payload.method) || "GET").toUpperCase();
  var method = ["POST", "PUT", "PATCH", "DELETE"].indexOf(requestedMethod) >= 0 ? requestedMethod : "GET";
  var body = typeof (payload && payload.body) === "string" ? payload.body : "";
  var hasBinaryBody = payload && Object.prototype.hasOwnProperty.call(payload, "bodyBase64");
  var encodedBody = hasBinaryBody ? payload.bodyBase64 : "";
  if (
    hasBinaryBody &&
    (typeof encodedBody !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedBody))
  )
    return { ok: false, error: "Invalid binary request body" };
  var bodyKind = payload && payload.bodyKind;
  if (bodyKind === undefined || bodyKind === null) {
    bodyKind = hasBinaryBody
      ? "base64"
      : method === "DELETE" || !body
        ? "none"
        : "text";
  }
  if (["none", "text", "base64"].indexOf(bodyKind) < 0)
    return { ok: false, error: "Unsupported request body type" };
  if ((bodyKind === "base64") !== Boolean(hasBinaryBody))
    return { ok: false, error: "Invalid binary request body" };
  var requestBody =
    bodyKind === "base64"
      ? Buffer.from(encodedBody, "base64")
      : bodyKind === "text"
        ? Buffer.from(body, "utf8")
        : Buffer.alloc(0);
  if (requestBody.length > MAX_REQUEST_BYTES)
    return { ok: false, error: "Request body exceeds the plugin quota" };
  var headers = normalizeHeaders(payload && payload.headers);
  // Android's OkHttp RequestBody supplies these defaults when a plugin does
  // not provide Content-Type. Keep the exact media types and do not append a
  // charset, because some providers include the value in a signature.
  if (!headerValue(headers, "Content-Type")) {
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (
      ["PUT", "PATCH"].indexOf(method) >= 0 ||
      (method === "DELETE" && bodyKind !== "none")
    ) {
      headers["Content-Type"] = "application/json";
    }
  }
  return {
    ok: true,
    url: parsed.toString(),
    method: method,
    headers: headers,
    bodyKind: bodyKind,
    body: requestBody,
    responseEncoding: payload && payload.responseEncoding === "base64" ? "base64" : "text",
    requestId: String((payload && payload.requestId) || "").slice(0, 128),
    executionId: String((payload && payload.executionId) || "").slice(0, 128),
    profileId: String((payload && payload.profileId) || "").slice(0, 64),
    repositoryId: String((payload && payload.repositoryId) || "").slice(0, 128),
    scraperId: String((payload && payload.scraperId) || "").slice(0, 128),
    maxResponseBytes: Math.max(
      1,
      Math.min(
        MAX_RESPONSE_BYTES,
        Number(payload && (payload.maxResponseBytes || payload.maxBodyBytes)) ||
          DEFAULT_RESPONSE_BYTES
      )
    ),
    timeoutMs: Math.max(
      1000,
      Math.min(DEFAULT_TIMEOUT_MS, Number(payload && payload.timeoutMs) || DEFAULT_TIMEOUT_MS)
    )
  };
}

function lookupHost(parsed, callback) {
  var netModule;
  var dnsModule;
  try {
    netModule = getNetModule();
    dnsModule = getDnsModule();
  } catch (error) {
    callback(error);
    return;
  }
  var host = String(parsed.hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (netModule.isIP(host)) {
    callback(null, [host]);
    return;
  }
  var done = false;
  function finish(error, addresses) {
    if (done) return;
    done = true;
    callback(error || null, addresses || null);
  }
  try {
    dnsModule.lookup(host, { all: true, verbatim: true }, function (error, addresses) {
      if (error) {
        finish(error);
        return;
      }
      var values = Array.isArray(addresses) ? addresses : [{ address: addresses }];
      values = values
        .filter(function (entry) {
          return entry && entry.address;
        })
        .sort(function (left, right) {
          return netModule.isIPv4(left.address) === netModule.isIPv4(right.address)
            ? 0
            : netModule.isIPv4(left.address)
              ? -1
              : 1;
        });
      if (!values.length) {
        finish(new Error("DNS lookup returned no address"));
        return;
      }
      finish(
        null,
        values.map(function (entry) {
          return String(entry.address || "");
        })
      );
    });
  } catch (_) {
    try {
      dnsModule.lookup(host, function (error, address) {
        finish(error || null, address ? [String(address)] : null);
      });
    } catch (error) {
      finish(error);
    }
  }
}

function responseHeaders(response) {
  var result = {};
  var truncationSuffix = "\n...[truncated]";
  Object.keys((response && response.headers) || {}).forEach(function (key) {
    var value = response.headers[key];
    var text = Array.isArray(value) ? value.join(",") : String(value == null ? "" : value);
    if (text.length > 8192) {
      text = text.slice(0, 8192 - truncationSuffix.length) + truncationSuffix;
    }
    result[String(key).toLowerCase()] = text;
  });
  return result;
}

function responseCharset(contentType) {
  var match = String(contentType || "").match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i);
  if (!match) return "utf8";
  var charset = String(match[1] || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (["utf8", "utf-8"].indexOf(charset) >= 0) return "utf8";
  if (
    [
      "iso88591",
      "iso-8859-1",
      "latin1",
      "latin-1",
      "windows1252",
      "windows-1252",
      "cp1252",
      "cp-1252"
    ].indexOf(charset) >= 0
  )
    return "latin1";
  if (["utf16le", "utf-16le", "ucs2", "ucs-2"].indexOf(charset) >= 0) return "utf16le";
  return "utf8";
}

function performFetch(payload, callback, redirects, trace) {
  var requestTrace = null;
  var finish = once(function (error, result) {
    emitTrace(
      trace,
      error ? "fetch callback failed" : "fetch callback success",
      Object.assign({}, requestTrace || {}, {
        status: result && result.status ? Number(result.status) : 0,
        error: error ? traceError(error) : undefined
      })
    );
    return callback(error, result);
  });
  if (callback && typeof callback.registerRequest === "function") {
    finish.registerRequest = callback.registerRequest;
  }
  var redirected = false;
  var validation = validatePayload(payload);
  if (!validation.ok) {
    emitTrace(trace, "fetch validation failed", {
      requestId: String((payload && payload.requestId) || "").slice(0, 128),
      error: validation.error
    });
    finish(new Error(validation.error));
    return;
  }
  var parsed = parseUrl(validation.url);
  requestTrace = traceRequestDetails(payload, parsed, redirects);
  emitTrace(trace, "fetch begin", requestTrace);
  // Keep one budget across Smart's address attempts. The per-address connect
  // budget below matches Android's 30-second connect timeout; resetting this
  // outer budget would exceed the existing 60-second PluginService contract.
  var requestDeadline = Date.now() + validation.timeoutMs;
  function continueWithResolvedHost(lookupError, addresses) {
    if (lookupError) {
      emitTrace(
        trace,
        "fetch dns failed",
        Object.assign({}, requestTrace, { error: traceError(lookupError) })
      );
      finish(lookupError);
      return;
    }
    var resolvedAddresses = (Array.isArray(addresses) ? addresses : [addresses])
      .map(function (address) {
        return String(address || "");
      })
      .filter(function (address, index, list) {
        return address && list.indexOf(address) === index;
      });
    if (!resolvedAddresses.length) {
      var missingAddressError = new Error("DNS lookup returned no address");
      emitTrace(
        trace,
        "fetch dns failed",
        Object.assign({}, requestTrace, { error: traceError(missingAddressError) })
      );
      finish(missingAddressError);
      return;
    }
    var address = resolvedAddresses[0];
    emitTrace(
      trace,
      "fetch dns success",
      Object.assign({}, requestTrace, {
        address: address || null,
        addressCount: resolvedAddresses.length
      })
    );
    var transport;
    try {
      transport = parsed.protocol === "https:" ? getHttpsModule() : http;
      emitTrace(trace, "fetch transport selected", {
        requestId: requestTrace.requestId,
        transport: parsed.protocol === "https:" ? "https" : "http"
      });
    } catch (error) {
      emitTrace(
        trace,
        "fetch transport module failed",
        Object.assign({}, requestTrace, { error: traceError(error) })
      );
      finish(error);
      return;
    }
    var requestHeaders = Object.assign({}, validation.headers);
    var hasRequestBody =
      ["POST", "PUT", "PATCH"].indexOf(validation.method) >= 0 ||
      (validation.method === "DELETE" && validation.bodyKind !== "none");
    if (hasRequestBody) {
      // Android builds its RequestBody from the exact request bytes. Keep the
      // caller's Content-Type (or the platform default), set the byte length,
      // and remove Transfer-Encoding to match that transport.
      var contentType =
        headerValue(validation.headers, "Content-Type") ||
        (validation.method === "POST" ? "application/x-www-form-urlencoded" : "application/json");
      removeHeader(requestHeaders, "Content-Type");
      requestHeaders["Content-Type"] = contentType;
      removeHeader(requestHeaders, "Content-Length");
      removeHeader(requestHeaders, "Transfer-Encoding");
    } else {
      // Android calls Request.Builder.get()/delete() without a RequestBody.
      // OkHttp's bridge consequently removes body-only headers even when a
      // plugin supplied them explicitly.
      removeHeader(requestHeaders, "Content-Type");
      removeHeader(requestHeaders, "Content-Length");
      removeHeader(requestHeaders, "Transfer-Encoding");
    }
    // OkHttp adds transparent gzip negotiation after removing any caller
    // supplied Accept-Encoding. Node's client does not, so add the same
    // transport header at the final socket boundary.
    if (!hasHeader(requestHeaders, "Range")) requestHeaders["Accept-Encoding"] = "gzip";
    if (!hasHeader(requestHeaders, "Host")) {
      requestHeaders.Host = parsed.host;
    }
    if (!hasHeader(requestHeaders, "Connection")) requestHeaders.Connection = "Keep-Alive";
    if (hasRequestBody && !hasHeader(requestHeaders, "Content-Length")) {
      requestHeaders["Content-Length"] = String(validation.body.length);
    }
    function isRetryableAddressError(error) {
      return (
        [
          "ECONNABORTED",
          "ECONNREFUSED",
          "ECONNRESET",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "ETIMEDOUT",
          "EPIPE"
        ].indexOf(String((error && error.code) || "")) >= 0
      );
    }
    var responseStarted = false;
    var attemptComplete = false;
    var request = null;
    var connectTimer = null;
    function clearConnectTimer() {
      if (connectTimer !== null) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    }
    function settleAttempt() {
      if (attemptComplete) return false;
      attemptComplete = true;
      clearConnectTimer();
      return true;
    }
    function failTransport(error) {
      if (attemptComplete) return;
      var canTryNextAddress =
        !responseStarted &&
        isRetryableAddressError(error) &&
        resolvedAddresses.length > 1 &&
        requestDeadline > Date.now();
      if (canTryNextAddress) {
        settleAttempt();
        emitTrace(
          trace,
          "fetch address fallback",
          Object.assign({}, requestTrace, {
            address: address,
            nextAddress: resolvedAddresses[1],
            remainingMs: Math.max(0, requestDeadline - Date.now()),
            error: traceError(error)
          })
        );
        continueWithResolvedHost(null, resolvedAddresses.slice(1));
        return;
      }
      settleAttempt();
      if (!redirected) finish(error);
    }
    var requestOptions = {
      protocol: parsed.protocol,
      // Keep the original Host/SNI while using the Android-compatible
      // IPv4-first DNS result for the actual socket connection.
      hostname: address || parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: String(parsed.pathname || "/") + String(parsed.search || ""),
      method: validation.method,
      headers: requestHeaders,
      servername: String(parsed.hostname || "").replace(/^\[|\]$/g, ""),
      agent: false
    };
    var requestSent = false;
    try {
      emitTrace(
        trace,
        "fetch transport request begin",
        Object.assign({}, requestTrace, { address: address })
      );
      request = transport.request(requestOptions, function (response) {
        responseStarted = true;
        clearConnectTimer();
        emitTrace(
          trace,
          "fetch response begin",
          Object.assign({}, requestTrace, {
            status: Number(response && response.statusCode) || 0,
            encoding: String(
              (response && response.headers && response.headers["content-encoding"]) || ""
            )
          })
        );
        var responseDone = once(function (error, result) {
          settleAttempt();
          emitTrace(
            trace,
            error ? "fetch response failed" : "fetch response ended",
            Object.assign({}, requestTrace, {
              status: Number((result && result.status) || (response && response.statusCode)) || 0,
              error: error ? traceError(error) : undefined
            })
          );
          finish(error, result);
        });
        var wireLength = 0;
        response.on("data", function (chunk) {
          wireLength += chunk.length;
          if (wireLength > MAX_WIRE_RESPONSE_BYTES) {
            responseDone(new Error("Plugin provider response exceeds the wire quota"));
            response.destroy();
          }
        });
        response.on("error", function (error) {
          emitTrace(
            trace,
            "fetch response error",
            Object.assign({}, requestTrace, { error: traceError(error) })
          );
          responseDone(error);
        });
        var headers = responseHeaders(response);
        var bodyEncoding = responseCharset(response.headers["content-type"]);
        var location = headers.location;
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          if (!location) {
            responseDone(new Error("Plugin provider redirect has no location"));
            return;
          }
          if ((redirects || 0) >= MAX_REDIRECTS) {
            responseDone(new Error("Plugin provider redirect limit exceeded"));
            return;
          }
          var nextUrl;
          try {
            nextUrl = resolveUrl(location, validation.url);
          } catch (_) {
            responseDone(new Error("Invalid redirect URL"));
            return;
          }
          redirected = true;
          settleAttempt();
          var redirectedPayload = Object.assign({}, payload, { url: nextUrl });
          var previousUrl = parseUrl(validation.url);
          var redirectedUrl = parseUrl(nextUrl);
          var crossOrigin =
            previousUrl &&
            redirectedUrl &&
            (previousUrl.protocol !== redirectedUrl.protocol ||
              previousUrl.hostname !== redirectedUrl.hostname ||
              (previousUrl.port || "") !== (redirectedUrl.port || ""));
          var redirectedHeaders = Object.assign({}, payload && payload.headers);
          if (crossOrigin) {
            // OkHttp does not forward credentials to a different origin during
            // a follow-up request. Keep all other plugin headers intact.
            removeHeader(redirectedHeaders, "Authorization");
          }
          // OkHttp changes non-GET methods to GET for 301/302/303 redirects and
          // drops the request body/content headers.  307/308 keep the original
          // method and body, matching the native follow-up behavior.
          if (
            [301, 302, 303].indexOf(Number(response.statusCode)) >= 0 &&
            validation.method !== "GET"
          ) {
            redirectedPayload.method = "GET";
            redirectedPayload.bodyKind = "none";
            redirectedPayload.body = "";
            delete redirectedPayload.bodyBase64;
            Object.keys(redirectedHeaders).forEach(function (headerName) {
              if (
                ["content-length", "content-type", "transfer-encoding"].indexOf(
                  String(headerName).toLowerCase()
                ) >= 0
              ) {
                delete redirectedHeaders[headerName];
              }
            });
            redirectedPayload.headers = redirectedHeaders;
          } else if (crossOrigin) {
            redirectedPayload.headers = redirectedHeaders;
          }
          emitTrace(
            trace,
            "fetch redirect",
            Object.assign({}, requestTrace, {
              status: Number(response.statusCode) || 0,
              targetHost: String((redirectedUrl && redirectedUrl.hostname) || "").slice(0, 255),
              targetPath: String((redirectedUrl && redirectedUrl.pathname) || "/").slice(0, 512),
              redirect: (redirects || 0) + 1
            })
          );
          performFetch(redirectedPayload, finish, (redirects || 0) + 1, trace);
          return;
        }

        var stream = response;
        var encoding = String(response.headers["content-encoding"] || "").toLowerCase();
        var transparentGzip = !hasHeader(requestHeaders, "Range");
        if (transparentGzip && encoding === "gzip") {
          delete headers["content-encoding"];
          delete headers["content-length"];
        }
        try {
          if (encoding === "gzip") {
            stream = response.pipe(getZlibModule().createGunzip());
          } else if (encoding === "deflate") {
            stream = response.pipe(getZlibModule().createInflate());
          }
        } catch (error) {
          responseDone(error);
          response.resume();
          return;
        }
        var chunks = [];
        var length = 0;
        var truncated = false;
        var finishTruncated = function () {
          if (truncated) return;
          truncated = true;
          var responseBytes = Buffer.concat(chunks);
          responseDone(null, {
            returnValue: true,
            // Android keeps the original HTTP response metadata when its body
            // cap is reached; truncation is an orthogonal flag.
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            statusText: response.statusMessage || "",
            url: validation.url,
            body: responseBytes.toString(bodyEncoding),
            bodyBase64:
              validation.responseEncoding === "base64"
                ? responseBytes.toString("base64")
                : undefined,
            headers: headers,
            truncated: true
          });
          stream.destroy();
          if (stream !== response) response.destroy();
        };
        stream.on("data", function (chunk) {
          if (length >= validation.maxResponseBytes) {
            finishTruncated();
            return;
          }
          var remaining = validation.maxResponseBytes - length;
          var part = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
          chunks.push(part);
          length += part.length;
          if (part.length < chunk.length) {
            finishTruncated();
          }
        });
        stream.on("error", function (error) {
          emitTrace(
            trace,
            "fetch response stream error",
            Object.assign({}, requestTrace, { error: traceError(error) })
          );
          responseDone(error);
        });
        stream.on("end", function () {
          var responseBytes = Buffer.concat(chunks);
          responseDone(null, {
            returnValue: true,
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            statusText: response.statusMessage || "",
            url: validation.url,
            body: responseBytes.toString(bodyEncoding),
            bodyBase64:
              validation.responseEncoding === "base64"
                ? responseBytes.toString("base64")
                : undefined,
            headers: headers,
            truncated: truncated
          });
        });
      });
      emitTrace(
        trace,
        "fetch transport request created",
        Object.assign({}, requestTrace, { address: address })
      );
      var connectTimeoutMs = Math.min(
        CONNECT_ATTEMPT_TIMEOUT_MS,
        Math.max(1, requestDeadline - Date.now())
      );
      connectTimer = setTimeout(function () {
        if (attemptComplete || responseStarted) return;
        var timeoutError = new Error("Plugin provider connection timed out");
        timeoutError.code = "ETIMEDOUT";
        emitTrace(
          trace,
          "fetch transport connect timeout",
          Object.assign({}, requestTrace, {
            address: address,
            timeoutMs: connectTimeoutMs
          })
        );
        failTransport(timeoutError);
        if (request && typeof request.destroy === "function") request.destroy(timeoutError);
      }, connectTimeoutMs);
      request.setTimeout(validation.timeoutMs, function () {
        if (attemptComplete) return;
        var timeoutError = new Error("Plugin provider request timed out");
        timeoutError.code = "ETIMEDOUT";
        emitTrace(
          trace,
          "fetch transport timeout",
          Object.assign({}, requestTrace, {
            address: address,
            timeoutMs: validation.timeoutMs
          })
        );
        failTransport(timeoutError);
        request.destroy(timeoutError);
      });
      request.on("error", function (error) {
        emitTrace(
          trace,
          "fetch transport error",
          Object.assign({}, requestTrace, { address: address, error: traceError(error) })
        );
        failTransport(error);
      });
      if (validation.requestId && typeof finish.registerRequest === "function") {
        finish.registerRequest(validation.requestId, request);
      }
      if (hasRequestBody && validation.body.length > 0)
        request.write(validation.body);
      request.end();
      requestSent = true;
      emitTrace(
        trace,
        "fetch transport request sent",
        Object.assign({}, requestTrace, { address: address })
      );
    } catch (error) {
      emitTrace(
        trace,
        "fetch transport request threw",
        Object.assign({}, requestTrace, { address: address, error: traceError(error) })
      );
      if (requestSent) {
        settleAttempt();
        finish(error);
      } else {
        failTransport(error);
      }
    }
  }
  emitTrace(trace, "fetch dns begin", requestTrace);
  lookupHost(parsed, continueWithResolvedHost);
}

function once(callback) {
  var called = false;
  var wrapped = function () {
    if (called) return;
    called = true;
    return callback.apply(null, arguments);
  };
  if (callback && typeof callback.registerRequest === "function") {
    wrapped.registerRequest = callback.registerRequest;
  }
  return wrapped;
}

function memoryUsage() {
  try {
    if (typeof process !== "undefined" && process && typeof process.memoryUsage === "function") {
      return process.memoryUsage();
    }
  } catch (_) {
    // Some lightweight Web Service runtimes do not expose process memory APIs.
  }
  return {};
}

function createPluginHttpServer({ port = 2711, logger = console, trace } = {}) {
  var activeRequests = {};
  var inFlightRequests = {};
  var queuedRequests = [];
  var activeRequestCount = 0;
  var scraperRequestWindows = {};
  var hostCircuits = {};
  var recentDiagnostics = [];

  function recordDiagnostic(event, details) {
    var entry = {
      event: String(event || "unknown").slice(0, 96),
      at: Date.now(),
      details: details || {}
    };
    recentDiagnostics.push(entry);
    if (recentDiagnostics.length > 32) recentDiagnostics.shift();
    emitTrace(trace, entry.event, entry.details);
  }

  function hostForPayload(payload) {
    try {
      var parsed = parseUrl(payload && payload.url);
      return parsed ? String(parsed.hostname || "").toLowerCase() : "";
    } catch (_) {
      return "";
    }
  }

  function pruneCircuit(host, now) {
    var circuit = hostCircuits[host];
    if (circuit && circuit.openUntil && circuit.openUntil <= now) {
      delete hostCircuits[host];
      circuit = null;
    }
    return circuit;
  }

  function admitRequest(payload, requestId) {
    var now = Date.now();
    if (requestId && inFlightRequests[requestId]) {
      return { ok: false, status: 409, error: "Duplicate plugin request id" };
    }
    var shouldQueue = activeRequestCount >= MAX_ACTIVE_REQUESTS || queuedRequests.length > 0;
    if (shouldQueue && queuedRequests.length >= MAX_QUEUED_REQUESTS) {
      return { ok: false, status: 429, error: "Plugin service concurrency quota exceeded" };
    }
    var scraperId = String((payload && payload.scraperId) || "").slice(0, 128);
    if (scraperId) {
      var window = scraperRequestWindows[scraperId] || [];
      window = window.filter(function (timestamp) {
        return now - timestamp < 60000;
      });
      if (window.length >= MAX_REQUESTS_PER_SCRAPER_PER_MINUTE) {
        scraperRequestWindows[scraperId] = window;
        return { ok: false, status: 429, error: "Plugin scraper request-rate quota exceeded" };
      }
      window.push(now);
      scraperRequestWindows[scraperId] = window;
    }
    var host = hostForPayload(payload);
    var circuit = pruneCircuit(host, now);
    if (host && circuit && circuit.openUntil > now) {
      return { ok: false, status: 503, error: "Plugin provider circuit is temporarily open" };
    }
    inFlightRequests[requestId] = {
      request: null,
      host: host,
      cancelled: false,
      started: false,
      queued: shouldQueue,
      finished: false,
      response: null,
      requestDetails: null,
      payload: null
    };
    return { ok: true, host: host, queued: shouldQueue };
  }

  function recordHostResult(host, error, result) {
    if (!host) return;
    var failed = Boolean(error) || Number((result && result.status) || 0) >= 500;
    if (!failed) {
      delete hostCircuits[host];
      return;
    }
    var circuit = hostCircuits[host] || { failures: 0, openUntil: 0 };
    circuit.failures += 1;
    if (circuit.failures >= CIRCUIT_FAILURE_LIMIT) circuit.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    hostCircuits[host] = circuit;
  }

  function send(response, status, body) {
    var data = JSON.stringify(body || {});
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data, "utf8"),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    response.end(data);
  }

  function removeQueuedRequest(state) {
    var index = queuedRequests.indexOf(state);
    if (index >= 0) queuedRequests.splice(index, 1);
  }

  function finishQueuedRequest(state, errorText) {
    if (!state || state.finished) return;
    state.cancelled = true;
    state.finished = true;
    removeQueuedRequest(state);
    delete inFlightRequests[state.requestId];
    if (state.response && !state.response.writableEnded && !state.response.destroyed) {
      send(state.response, 502, {
        returnValue: false,
        errorText: errorText || "Plugin request cancelled",
        requestId: state.requestId
      });
    }
  }

  function pumpQueue() {
    while (activeRequestCount < MAX_ACTIVE_REQUESTS && queuedRequests.length) {
      var state = queuedRequests.shift();
      if (
        !state ||
        state.finished ||
        state.cancelled ||
        inFlightRequests[state.requestId] !== state
      ) {
        continue;
      }
      startRequest(state);
    }
  }

  function cancelRequest(state) {
    if (!state || state.finished) return false;
    state.cancelled = true;
    if (!state.started) {
      finishQueuedRequest(state, "Plugin request cancelled");
      pumpQueue();
      return true;
    }
    if (state.request && typeof state.request.destroy === "function") {
      state.request.destroy(new Error("Plugin request cancelled"));
    }
    return true;
  }

  function startRequest(state) {
    if (!state || state.finished || state.cancelled) return;
    state.started = true;
    state.queued = false;
    activeRequestCount += 1;
    var requestId = state.requestId;
    var response = state.response;
    var requestDetails = state.requestDetails;
    var callback = function (error, result) {
      if (state.finished) return;
      state.finished = true;
      if (requestId) delete activeRequests[requestId];
      delete inFlightRequests[requestId];
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      recordHostResult(state.host, state.cancelled ? null : error, result);
      recordDiagnostic(
        "fetch response sent",
        Object.assign({}, requestDetails, {
          httpStatus: error ? 502 : 200,
          providerStatus: Number(result && result.status) || 0,
          error: error ? traceError(error) : undefined
        })
      );
      if (!response || response.writableEnded || response.destroyed) {
        pumpQueue();
        return;
      }
      if (error) {
        send(response, 502, {
          returnValue: false,
          errorText: error.message || String(error),
          requestId: requestId
        });
      } else {
        send(response, 200, Object.assign({ requestId: requestId }, result));
      }
      pumpQueue();
    };
    callback.registerRequest = function (id, activeRequest) {
      activeRequests[id] = activeRequest;
      state.request = activeRequest;
      if (state.cancelled) activeRequest.destroy(new Error("Plugin request cancelled"));
    };
    try {
      performFetch(
        Object.assign({}, state.payload, { requestId: requestId }),
        callback,
        0,
        recordDiagnostic
      );
    } catch (error) {
      recordDiagnostic(
        "fetch route threw",
        Object.assign({}, requestDetails, { error: traceError(error) })
      );
      callback(error);
    }
  }

  function readBody(request, callback) {
    var chunks = [];
    var length = 0;
    request.on("data", function (chunk) {
      length += chunk.length;
      if (length <= MAX_SERVICE_REQUEST_BYTES) chunks.push(chunk);
    });
    request.on("end", function () {
      if (length > MAX_SERVICE_REQUEST_BYTES) {
        callback(new Error("Plugin service request is too large"));
        return;
      }
      try {
        callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        callback(error);
      }
    });
  }
  var server = http.createServer(function (request, response) {
    if (!isLoopbackRequest(request)) {
      send(response, 403, {
        returnValue: false,
        errorText: "Plugin service accepts loopback clients only"
      });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      response.end();
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      var memory = memoryUsage();
      send(response, 200, {
        returnValue: true,
        service: "nuvio-plugin-network",
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        serviceVersion: 1,
        runtimeVersion: "nuvio-plugin-network/1",
        quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
        workerSupport: true,
        maxConcurrency: MAX_ACTIVE_REQUESTS,
        memoryTier: "bounded",
        defaultResponseBytes: DEFAULT_RESPONSE_BYTES,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        memory: { rssBytes: Number(memory.rss || 0), heapUsedBytes: Number(memory.heapUsed || 0) },
        jsPluginCapability: true,
        networkBoundary: true,
        port: port
      });
      return;
    }
    if (request.url === "/capabilities" && request.method === "GET") {
      send(response, 200, {
        returnValue: true,
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        serviceVersion: 1,
        runtimeVersion: "nuvio-plugin-network/1",
        quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
        workerSupport: true,
        maxConcurrency: MAX_ACTIVE_REQUESTS,
        memoryTier: "bounded",
        defaultResponseBytes: DEFAULT_RESPONSE_BYTES,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        jsPluginCapability: true,
        networkBoundary: true
      });
      return;
    }
    if (request.url === "/diagnostics" && request.method === "GET") {
      send(response, 200, {
        returnValue: true,
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        activeRequests: Object.keys(activeRequests).length,
        queuedRequests: queuedRequests.length,
        memory: memoryUsage(),
        recentEvents: recentDiagnostics.slice(-16)
      });
      return;
    }
    if (request.url === "/cache/clear" && request.method === "POST") {
      send(response, 200, { returnValue: true, cleared: true });
      return;
    }
    if ((request.url === "/cancel" || request.url === "/fetch") && request.method === "POST") {
      readBody(request, function (bodyError, payload) {
        if (bodyError) {
          send(response, 400, { returnValue: false, errorText: bodyError.message });
          return;
        }
        if (request.url === "/cancel") {
          var cancelId = String(payload.requestId || "");
          var state = inFlightRequests[cancelId];
          var active = activeRequests[cancelId];
          var cancelled = cancelRequest(state);
          if (!cancelled && active) active.destroy(new Error("Plugin request cancelled"));
          send(response, 200, {
            returnValue: true,
            requestId: cancelId,
            cancelled: Boolean(cancelled || active)
          });
          return;
        }
        var requestId =
          String(payload.requestId || "").slice(0, 128) ||
          `service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        var requestDetails = traceRequestDetails(payload, parseUrl(payload && payload.url), 0);
        requestDetails.requestId = requestId;
        recordDiagnostic("fetch received", requestDetails);
        var admission = admitRequest(payload, requestId);
        if (!admission.ok) {
          recordDiagnostic(
            "fetch admission rejected",
            Object.assign({}, requestDetails, {
              status: admission.status,
              error: admission.error
            })
          );
          send(response, admission.status, {
            returnValue: false,
            errorText: admission.error,
            requestId: requestId
          });
          return;
        }
        var state = inFlightRequests[requestId];
        state.requestId = requestId;
        state.response = response;
        state.requestDetails = requestDetails;
        state.payload = payload;
        response.on("close", function () {
          if (!state.finished && !state.started) finishQueuedRequest(state);
          else if (!state.finished && state.started) cancelRequest(state);
        });
        if (admission.queued) {
          recordDiagnostic(
            "fetch queued",
            Object.assign({}, requestDetails, { queueSize: queuedRequests.length + 1 })
          );
          queuedRequests.push(state);
        } else {
          startRequest(state);
        }
      });
      return;
    }
    send(response, 404, { returnValue: false, errorText: "Plugin service route not found" });
  });
  server.on("error", function (error) {
    if (logger && typeof logger.warn === "function")
      logger.warn("Plugin service error", error.message || error);
  });
  return server;
}

module.exports = { createPluginHttpServer: createPluginHttpServer };
