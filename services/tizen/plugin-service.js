/* global module, require */
"use strict";

var SERVICE_TAG = "[Nuvio PluginService]";
var DEFAULT_PORT = 2711;
var server = null;
var activePort = 0;
var startRequested = false;
var lifecycleToken = 0;
var STARTUP_LOG_EVENTS = {
  onStart: true,
  "plugin-http load success": true,
  "listen called": true,
  "server listening": true,
  "startup failed": true,
  "server error": true,
  onStop: true,
  "fetch received": true,
  "fetch admission rejected": true,
  "fetch validation failed": true,
  "fetch begin": true,
  "fetch transport selected": true,
  "fetch transport module failed": true,
  "fetch transport request begin": true,
  "fetch transport request created": true,
  "fetch transport request sent": true,
  "fetch transport request threw": true,
  "fetch transport timeout": true,
  "fetch transport error": true,
  "fetch response begin": true,
  "fetch response error": true,
  "fetch response stream error": true,
  "fetch response ended": true,
  "fetch response failed": true,
  "fetch redirect": true,
  "fetch callback success": true,
  "fetch callback failed": true,
  "fetch response sent": true,
  "fetch route threw": true
};

function diagnosticError(error) {
  var details = {
    name: error && error.name ? String(error.name) : "Error",
    message: error && error.message ? String(error.message) : String(error || "Unknown error")
  };
  if (error && error.code) details.code = String(error.code);
  if (error && error.stack) details.stack = String(error.stack).slice(0, 1600);
  return details;
}

function diagnostic(event, details) {
  try {
    if (typeof console === "undefined") return;
    var eventName = String(event || "").toLowerCase();
    var status = Number(
      details &&
        (details.status || details.providerStatus || details.statusCode || details.httpStatus)
    );
    var isFailure =
      /failed|error|threw|unavailable|incompatible|timeout|invalid|exception|fatal|crash/.test(
        eventName
      ) || status >= 500;
    var isWarning =
      status >= 400 || /warn|warning|rejected|unsupported|degraded|stopped/.test(eventName);
    if (!STARTUP_LOG_EVENTS[event] && !isFailure && !isWarning) return;
    var logger = console.log;
    if (isFailure) {
      logger = console.error || console.log;
    } else if (isWarning) {
      logger = console.warn || console.log;
    }
    if (typeof logger !== "function") return;
    var suffix = "";
    if (details !== undefined) {
      try {
        suffix = " " + JSON.stringify(details);
      } catch (_) {
        suffix = " [details unavailable]";
      }
    }
    logger.call(console, SERVICE_TAG + " " + event + suffix);
  } catch (_) {
    // Diagnostics must never prevent the service from starting or stopping.
  }
}

function closeServer(target) {
  if (!target || typeof target.close !== "function") return;
  try {
    target.close();
  } catch (_) {
    // A server that failed during listen may already be closed.
  }
}

function probeNodeRuntime() {
  // The lightweight Tizen Web Service runtime only needs http to expose the
  // health endpoint. plugin-http.cjs loads url/net/dns/https/zlib lazily for
  // individual requests, so an unavailable optional module must not prevent
  // the service from binding and being discoverable by the app.
  diagnostic("runtime probe begin", { requiredModules: ["http"] });
  try {
    var http = require("http");
    if (typeof http.createServer !== "function") {
      throw new Error("http.createServer is unavailable");
    }
    diagnostic("runtime probe success", { httpCreateServer: true });
  } catch (error) {
    diagnostic("runtime probe failed", { error: diagnosticError(error) });
    throw error;
  }
}

function failStart(token, error) {
  if (token !== lifecycleToken) return;
  startRequested = false;
  activePort = 0;
  if (server) {
    closeServer(server);
    server = null;
  }
  diagnostic("startup failed", { error: diagnosticError(error) });
}

function bindServer(token, pluginHttp) {
  if (token !== lifecycleToken) return;
  var localServer;
  diagnostic("bind attempt", { port: DEFAULT_PORT });
  try {
    localServer = pluginHttp.createPluginHttpServer({
      port: DEFAULT_PORT,
      trace: diagnostic
    });
    if (!localServer || typeof localServer.listen !== "function") {
      throw new Error("Plugin HTTP server is unavailable");
    }
    diagnostic("server factory success", { port: DEFAULT_PORT });
  } catch (error) {
    diagnostic("server factory failed", { port: DEFAULT_PORT, error: diagnosticError(error) });
    failStart(token, error);
    return;
  }

  server = localServer;
  var listening = false;
  var handled = false;
  function markListening() {
    if (token !== lifecycleToken || handled) {
      closeServer(localServer);
      return;
    }
    listening = true;
    activePort = DEFAULT_PORT;
    diagnostic("server listening", { port: DEFAULT_PORT, loopback: "127.0.0.1" });
  }
  function handleBindError(error) {
    if (token !== lifecycleToken) {
      closeServer(localServer);
      return;
    }
    if (listening) {
      diagnostic("server error", { port: DEFAULT_PORT, error: diagnosticError(error) });
      return;
    }
    if (handled) return;
    handled = true;
    diagnostic("server bind error", {
      port: DEFAULT_PORT,
      error: diagnosticError(error)
    });
    closeServer(localServer);
    server = null;
    failStart(token, error);
  }
  localServer.on("listening", markListening);
  localServer.on("error", handleBindError);

  try {
    // Keep the exact one-argument overload used by the working EngineFS
    // runtime. Some Tizen lightweight runtimes acknowledge the host/callback
    // overload without creating a reachable loopback listener.
    localServer.listen(DEFAULT_PORT);
    diagnostic("listen called", { port: DEFAULT_PORT, argumentCount: 1 });
  } catch (error) {
    handleBindError(error);
  }
}

function start() {
  if (startRequested) {
    diagnostic("onStart ignored", { reason: "start already requested", activePort: activePort });
    return;
  }

  startRequested = true;
  activePort = 0;
  var token = ++lifecycleToken;
  diagnostic("onStart", { port: DEFAULT_PORT });
  try {
    probeNodeRuntime();
    // Resolve the canonical implementation from the sibling services file.
    // Tizen 6+ uses the same CommonJS layout in development and in the WGT.
    diagnostic("plugin-http load begin", { module: "canonical-plugin-http" });
    var pluginHttp = require("../plugin-http.cjs");
    if (!pluginHttp || typeof pluginHttp.createPluginHttpServer !== "function") {
      throw new Error("Plugin HTTP implementation is unavailable");
    }
    diagnostic("plugin-http load success", {
      module: "canonical-plugin-http",
      createPluginHttpServer: true
    });
    bindServer(token, pluginHttp);
  } catch (error) {
    diagnostic("onStart failed before bind", { error: diagnosticError(error) });
    failStart(token, error);
  }
}

function stop() {
  var previousPort = activePort;
  lifecycleToken += 1;
  startRequested = false;
  activePort = 0;
  var current = server;
  server = null;
  closeServer(current);
  diagnostic("onStop", {
    closed: Boolean(current),
    previousPort: previousPort
  });
}

// Tizen Web Service applications are entered through onStart and stopped
// through onStop. Keeping the server out of module evaluation makes startup,
// failure reporting and shutdown follow the documented service lifecycle.
module.exports.onStart = start;
module.exports.onExit = stop;
module.exports.onStop = stop;
