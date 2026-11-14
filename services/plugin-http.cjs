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
var MAX_FAILED_ROUTES = 256;
var MAX_IDLE_CONNECTIONS = 5;
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

function stripIpBracketsAndZone(value) {
  var text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return "";
  if (text.charAt(0) === "[" && text.charAt(text.length - 1) === "]") {
    text = text.slice(1, -1);
  }
  var zoneIndex = text.indexOf("%");
  if (zoneIndex >= 0) {
    text = text.slice(0, zoneIndex);
  }
  return text;
}

function parseIpv4Octets(value) {
  var text = String(value || "");
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return null;
  var parts = text.split(".");
  var octets = [];
  for (var i = 0; i < 4; i += 1) {
    var part = parts[i];
    if (part.length > 1 && part.charAt(0) === "0") return null;
    var num = Number(part);
    if (num < 0 || num > 255) return null;
    octets.push(num);
  }
  return octets;
}

function parseIpv6SegmentList(segments, allowTrailingIpv4) {
  var groups = [];
  for (var i = 0; i < segments.length; i += 1) {
    var segment = segments[i];
    if (!segment) return null;
    if (allowTrailingIpv4 && i === segments.length - 1 && segment.indexOf(".") >= 0) {
      var octets = parseIpv4Octets(segment);
      if (!octets) return null;
      groups.push(((octets[0] << 8) | octets[1]) >>> 0);
      groups.push(((octets[2] << 8) | octets[3]) >>> 0);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(segment)) return null;
      groups.push(parseInt(segment, 16));
    }
  }
  return groups;
}

function parseIpv6Groups(value) {
  var text = String(value || "");
  if (!text || text.indexOf(":") < 0) return null;
  var halves = text.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    var singleGroups = parseIpv6SegmentList(halves[0].split(":"), true);
    if (!singleGroups || singleGroups.length !== 8) return null;
    return singleGroups;
  }
  var leftSegments = halves[0] ? halves[0].split(":") : [];
  var rightSegments = halves[1] ? halves[1].split(":") : [];
  var leftGroups = parseIpv6SegmentList(leftSegments, false);
  var rightGroups = parseIpv6SegmentList(rightSegments, true);
  if (!leftGroups || !rightGroups) return null;
  var missingCount = 8 - (leftGroups.length + rightGroups.length);
  if (missingCount < 1) return null;
  var result = leftGroups.slice();
  for (var i = 0; i < missingCount; i += 1) {
    result.push(0);
  }
  return result.concat(rightGroups);
}

function parseIpAddress(value) {
  var text = stripIpBracketsAndZone(value);
  if (!text) return null;
  var ipv4 = parseIpv4Octets(text);
  if (ipv4) return { family: 4, octets: ipv4 };
  var ipv6 = parseIpv6Groups(text);
  if (ipv6) return { family: 6, groups: ipv6 };
  return null;
}

function isBlockedIpv4Octets(octets) {
  var first = octets[0];
  var second = octets[1];
  // Block loopback (127.0.0.0/8), unspecified (0.0.0.0/8), and link-local / metadata (169.254.0.0/16).
  // RFC1918 private LAN ranges remain allowed so self-hosted LAN plugins/addons keep working.
  return first === 127 || first === 0 || (first === 169 && second === 254);
}

function isBlockedIpv6Groups(groups) {
  // Link-local fe80::/10 (fe80..febf).
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // Embedded IPv4-in-IPv6: IPv4-compatible ::/96 (including :: and ::1) and IPv4-mapped ::ffff:0:0/96.
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] === 0 || groups[5] === 0xffff)
  ) {
    return isBlockedIpv4Octets([
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff
    ]);
  }
  return false;
}

function isBlockedIpAddress(value) {
  var parsed = parseIpAddress(value);
  if (!parsed) return false;
  return parsed.family === 4
    ? isBlockedIpv4Octets(parsed.octets)
    : isBlockedIpv6Groups(parsed.groups);
}

function isAllowedResolvedIp(value, netModule) {
  var raw = String(value || "").trim();
  if (!raw) return false;
  var parsed = parseIpAddress(raw);
  if (!parsed) return false;
  if (
    parsed.family === 4 ? isBlockedIpv4Octets(parsed.octets) : isBlockedIpv6Groups(parsed.groups)
  ) {
    return false;
  }
  var netMod = netModule || getNetModule();
  return netMod.isIP(raw) !== 0;
}

function normalizeHostname(hostname) {
  var host = String(hostname || "")
    .trim()
    .toLowerCase();
  if (host.charAt(0) === "[" && host.charAt(host.length - 1) === "]") {
    host = host.slice(1, -1);
  }
  return host.replace(/\.+$/, "");
}

function isBlockedHostname(hostname) {
  var host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === "localhost" || /\.localhost$/.test(host)) return true;
  return isBlockedIpAddress(host);
}

function isLoopbackAddress(value) {
  var parsed = parseIpAddress(value);
  if (!parsed) return false;
  if (parsed.family === 4) return parsed.octets[0] === 127;
  var groups = parsed.groups;
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0) {
    if (groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true;
    if (groups[5] === 0 || groups[5] === 0xffff) {
      return ((groups[6] >> 8) & 0xff) === 127;
    }
  }
  return false;
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
  if (isBlockedHostname(parsed.hostname))
    return {
      ok: false,
      error: "Blocked restricted destination address"
    };
  var requestedMethod = String((payload && payload.method) || "GET").toUpperCase();
  var method =
    ["POST", "PUT", "PATCH", "DELETE"].indexOf(requestedMethod) >= 0 ? requestedMethod : "GET";
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
    bodyKind = hasBinaryBody ? "base64" : method === "DELETE" || !body ? "none" : "text";
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
    if (["PUT", "PATCH"].indexOf(method) >= 0 || (method === "DELETE" && bodyKind !== "none")) {
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
  var host = normalizeHostname(parsed && parsed.hostname);
  if (!host || isBlockedHostname(host)) {
    callback(new Error("Blocked restricted destination address"));
    return;
  }
  if (netModule.isIP(host)) {
    if (!isAllowedResolvedIp(host, netModule)) {
      callback(new Error("Blocked restricted destination address"));
      return;
    }
    callback(null, [host]);
    return;
  }
  var done = false;
  function finish(error, addresses) {
    if (done) return;
    done = true;
    callback(error || null, addresses || null);
  }
  function validateResolvedEntries(entries) {
    var validated = [];
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      var rawAddress =
        entry && typeof entry === "object" && entry.address !== undefined ? entry.address : entry;
      var addressText = rawAddress == null ? "" : String(rawAddress).trim();
      if (!addressText || !isAllowedResolvedIp(addressText, netModule)) {
        return null;
      }
      validated.push(addressText);
    }
    return validated;
  }
  try {
    dnsModule.lookup(host, { all: true, verbatim: true }, function (error, addresses) {
      if (error) {
        finish(error);
        return;
      }
      var values = Array.isArray(addresses)
        ? addresses
        : addresses && typeof addresses === "object"
          ? [addresses]
          : [{ address: addresses }];
      if (!values.length) {
        finish(new Error("DNS lookup returned no address"));
        return;
      }
      // Fail closed if any returned address is invalid or points to a blocked network range.
      var validatedAddresses = validateResolvedEntries(values);
      if (!validatedAddresses || !validatedAddresses.length) {
        finish(new Error("Blocked restricted destination address"));
        return;
      }
      validatedAddresses.sort(function (left, right) {
        return netModule.isIPv4(left) === netModule.isIPv4(right)
          ? 0
          : netModule.isIPv4(left)
            ? -1
            : 1;
      });
      finish(null, validatedAddresses);
    });
  } catch (_) {
    try {
      dnsModule.lookup(host, function (error, address) {
        if (error) {
          finish(error);
          return;
        }
        var addressText = address == null ? "" : String(address).trim();
        if (!addressText || !isAllowedResolvedIp(addressText, netModule)) {
          finish(new Error("Blocked restricted destination address"));
          return;
        }
        finish(null, [addressText]);
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

function routeDatabaseKey(parsed, address) {
  return JSON.stringify([
    String((parsed && parsed.protocol) || "").toLowerCase(),
    String((parsed && parsed.hostname) || "").toLowerCase(),
    Number((parsed && parsed.port) || 0) || (parsed && parsed.protocol === "https:" ? 443 : 80),
    String(address || "")
  ]);
}

function orderResolvedAddresses(networkState, parsed, addresses) {
  var failedRoutes = networkState && networkState.failedRoutes;
  if (!failedRoutes || !failedRoutes.size) return addresses;
  var available = [];
  var postponed = [];
  addresses.forEach(function (address) {
    (failedRoutes.has(routeDatabaseKey(parsed, address)) ? postponed : available).push(address);
  });
  return available.concat(postponed);
}

function rememberFailedRoute(networkState, parsed, address) {
  var failedRoutes = networkState && networkState.failedRoutes;
  if (!failedRoutes || !address) return;
  var key = routeDatabaseKey(parsed, address);
  failedRoutes.delete(key);
  failedRoutes.set(key, true);
  while (failedRoutes.size > MAX_FAILED_ROUTES) {
    failedRoutes.delete(failedRoutes.keys().next().value);
  }
}

function rememberConnectedRoute(networkState, parsed, address) {
  var failedRoutes = networkState && networkState.failedRoutes;
  if (!failedRoutes || !address) return;
  failedRoutes.delete(routeDatabaseKey(parsed, address));
}

function hasActiveAgentSockets(agent) {
  var sockets = agent && agent.sockets;
  return Object.keys(sockets || {}).some(function (name) {
    return Array.isArray(sockets[name]) && sockets[name].length > 0;
  });
}

function requestAgent(networkState, transport, parsed, address) {
  var agents = networkState && networkState.agents;
  if (!agents || !transport || typeof transport.Agent !== "function") return false;
  var key = routeDatabaseKey(parsed, address);
  var agent = agents.get(key);
  if (agent) {
    agents.delete(key);
    agents.set(key, agent);
    return agent;
  }
  if (agents.size >= MAX_IDLE_CONNECTIONS) {
    var oldestIdleKey = null;
    agents.forEach(function (candidate, candidateKey) {
      if (oldestIdleKey === null && !hasActiveAgentSockets(candidate)) {
        oldestIdleKey = candidateKey;
      }
    });
    if (oldestIdleKey !== null) {
      var staleAgent = agents.get(oldestIdleKey);
      agents.delete(oldestIdleKey);
      if (staleAgent && typeof staleAgent.destroy === "function") staleAgent.destroy();
    }
  }
  if (agents.size >= MAX_IDLE_CONNECTIONS) return false;
  agent = new transport.Agent({
    keepAlive: true,
    maxSockets: MAX_ACTIVE_REQUESTS,
    maxFreeSockets: 1
  });
  agents.set(key, agent);
  return agent;
}

function destroyRouteAgents(networkState) {
  var agents = networkState && networkState.agents;
  if (!agents) return;
  agents.forEach(function (agent) {
    if (agent && typeof agent.destroy === "function") agent.destroy();
  });
  agents.clear();
}

function performFetch(payload, callback, redirects, trace, networkState) {
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
    var rawAddresses = (Array.isArray(addresses) ? addresses : [addresses]).map(function (address) {
      return String(address == null ? "" : address).trim();
    });
    if (!rawAddresses.length || (rawAddresses.length === 1 && !rawAddresses[0])) {
      var missingAddressError = new Error("DNS lookup returned no address");
      emitTrace(
        trace,
        "fetch dns failed",
        Object.assign({}, requestTrace, { error: traceError(missingAddressError) })
      );
      finish(missingAddressError);
      return;
    }
    var netModule;
    try {
      netModule = getNetModule();
    } catch (error) {
      finish(error);
      return;
    }
    if (
      isBlockedHostname(parsed.hostname) ||
      rawAddresses.some(function (addr) {
        return !addr || !isAllowedResolvedIp(addr, netModule);
      })
    ) {
      var blockedAddressError = new Error("Blocked restricted destination address");
      emitTrace(
        trace,
        "fetch dns blocked",
        Object.assign({}, requestTrace, { error: traceError(blockedAddressError) })
      );
      finish(blockedAddressError);
      return;
    }
    var resolvedAddresses = rawAddresses.filter(function (address, index, list) {
      return address && list.indexOf(address) === index;
    });
    resolvedAddresses = orderResolvedAddresses(networkState, parsed, resolvedAddresses);
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
      var retryableAddressError = isRetryableAddressError(error);
      if (!responseStarted && retryableAddressError) {
        rememberFailedRoute(networkState, parsed, address);
      }
      var canTryNextAddress =
        !responseStarted &&
        retryableAddressError &&
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
      agent: requestAgent(networkState, transport, parsed, address),
      lookup: function (lookupHostname, lookupOptions, lookupCallback) {
        if (typeof lookupOptions === "function") {
          lookupCallback = lookupOptions;
          lookupOptions = {};
        }
        var targetIp = String(lookupHostname || address || "").trim();
        if (!isAllowedResolvedIp(targetIp, netModule)) {
          lookupCallback(new Error("Blocked restricted destination address"));
          return;
        }
        var family = netModule.isIPv6(targetIp) ? 6 : 4;
        if (lookupOptions && lookupOptions.all) {
          lookupCallback(null, [{ address: targetIp, family: family }]);
          return;
        }
        lookupCallback(null, targetIp, family);
      }
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
        rememberConnectedRoute(networkState, parsed, address);
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
          var previousUrl = parseUrl(validation.url);
          var redirectedUrl = parseUrl(nextUrl);
          if (!redirectedUrl) {
            responseDone(new Error("Only valid HTTP(S) URLs are allowed"));
            return;
          }
          if (isBlockedHostname(redirectedUrl.hostname)) {
            responseDone(new Error("Blocked restricted destination address"));
            return;
          }
          redirected = true;
          settleAttempt();
          var redirectedPayload = Object.assign({}, payload, { url: nextUrl });
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
          performFetch(redirectedPayload, finish, (redirects || 0) + 1, trace, networkState);
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
      request.on("socket", function (socket) {
        if (!socket || socket.connecting === false) {
          clearConnectTimer();
          return;
        }
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
        if (typeof socket.once === "function") socket.once("connect", clearConnectTimer);
      });
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
      if (hasRequestBody && validation.body.length > 0) request.write(validation.body);
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
  var networkState = { failedRoutes: new Map(), agents: new Map() };
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
    var parsedUrl = parseUrl(payload && payload.url);
    if (!parsedUrl) {
      return { ok: false, status: 400, error: "Only valid HTTP(S) URLs are allowed" };
    }
    if (isBlockedHostname(parsedUrl.hostname)) {
      return { ok: false, status: 403, error: "Blocked restricted destination address" };
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
        recordDiagnostic,
        networkState
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
    if (request.url === "/poster-config" && request.method === "POST") {
      readBody(request, function (bodyError, payload) {
        if (bodyError) return send(response, 400, { returnValue: false });
        try {
          var config = require("./custom-poster-config.cjs");
          if (payload.action === "start") {
            config.start(payload).then(
              function (result) {
                send(response, 200, Object.assign({ returnValue: true }, result));
              },
              function () {
                send(response, 503, { returnValue: false });
              }
            );
          } else if (payload.action === "read") {
            var state = config.read(payload.token);
            send(response, state ? 200 : 410, state || { returnValue: false });
          } else if (payload.action === "stop") {
            send(response, 200, { returnValue: config.stop(payload.token) });
          } else send(response, 400, { returnValue: false });
        } catch (_) {
          send(response, 503, { returnValue: false });
        }
      });
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
  server.on("close", function () {
    destroyRouteAgents(networkState);
  });
  return server;
}

module.exports = { createPluginHttpServer: createPluginHttpServer };
