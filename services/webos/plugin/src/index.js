var Service;
try {
  Service = require("webos-service");
} catch (error) {
  console.warn("[space.nuvio.webos.plugin.service] webos-service unavailable:", error.message);
  Service = function () {
    this.register = function () {};
  };
}
var pluginHttp = require("../../../plugin-http.cjs");
var SERVICE_ID = "space.nuvio.webos.plugin.service";
var PLUGIN_SERVICE_PORT = 2721;
var MAX_ACTIVE_REQUESTS = 10;
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
var service = new Service(SERVICE_ID);
var server = pluginHttp.createPluginHttpServer({ port: PLUGIN_SERVICE_PORT });
var serverStartInFlight = false;
var serverStartWaiters = [];

function respond(message, payload) {
  if (message && typeof message.respond === "function") {
    message.respond(payload);
  } else {
    console.log("[" + SERVICE_ID + "] response", JSON.stringify(payload));
  }
}

function startServer(callback) {
  if (server.listening) {
    callback(null);
    return;
  }
  if (serverStartInFlight) {
    serverStartWaiters.push(callback);
    return;
  }

  serverStartInFlight = true;
  var settled = false;
  var finish = function (error) {
    if (settled) {
      return;
    }
    settled = true;
    serverStartInFlight = false;
    var waiters = serverStartWaiters.splice(0);
    [callback].concat(waiters).forEach(function (waiter) {
      try {
        waiter(error || null);
      } catch (_) {
        // One failed Luna caller must not prevent other callers from being
        // notified about the same bind attempt.
      }
    });
  };

  server.once("listening", function () {
    finish(null);
  });
  server.once("error", function (error) {
    finish(error);
  });
  try {
    server.listen(PLUGIN_SERVICE_PORT, "127.0.0.1");
  } catch (error) {
    finish(error);
  }
}

service.register("ping", function (message) {
  startServer(function (error) {
    respond(
      message,
      error
        ? { returnValue: false, errorText: error.message }
        : {
            returnValue: true,
            serviceId: SERVICE_ID,
            protocolVersion: 1,
            serviceVersion: 1,
            runtimeVersion: "nuvio-plugin-network/1",
            quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
            workerSupport: true,
            maxConcurrency: MAX_ACTIVE_REQUESTS,
            memoryTier: "bounded",
            defaultResponseBytes: 1024 * 1024,
            maxResponseBytes: MAX_RESPONSE_BYTES,
            jsPluginCapability: true,
            networkBoundary: true,
            port: PLUGIN_SERVICE_PORT
          }
    );
  });
});

service.register("capabilities", function (message) {
  respond(message, {
    returnValue: true,
    protocolVersion: 1,
    serviceVersion: 1,
    runtimeVersion: "nuvio-plugin-network/1",
    quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
    workerSupport: true,
    maxConcurrency: MAX_ACTIVE_REQUESTS,
    memoryTier: "bounded",
    defaultResponseBytes: 1024 * 1024,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    jsPluginCapability: true,
    networkBoundary: true
  });
});

service.register("diagnostics", function (message) {
  forward("diagnostics", message);
});

function forward(method, message) {
  startServer(function (error) {
    if (error) {
      respond(message, { returnValue: false, errorText: error.message });
      return;
    }
    var payload =
      message && message.payload && typeof message.payload === "object" ? message.payload : {};
    // webOS 5/6 use Node 8: request accepts (options, callback), not
    // (url, options, callback). Keep the loopback POST in that contract.
    var request = require("http").request(
      {
        hostname: "127.0.0.1",
        port: PLUGIN_SERVICE_PORT,
        path:
          method === "diagnostics" ? "/diagnostics" : method === "cancel" ? "/cancel" : "/fetch",
        method: method === "diagnostics" ? "GET" : "POST",
        headers: { "Content-Type": "application/json" }
      },
      function (response) {
        var chunks = [];
        response.on("data", function (chunk) {
          chunks.push(chunk);
        });
        response.on("end", function () {
          try {
            respond(message, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (_) {
            respond(message, { returnValue: false, errorText: "Invalid local plugin response" });
          }
        });
      }
    );
    request.on("error", function (requestError) {
      respond(message, { returnValue: false, errorText: requestError.message });
    });
    if (method !== "diagnostics") request.write(JSON.stringify(payload));
    request.end();
  });
}

service.register("fetch", function (message) {
  forward("fetch", message);
});
service.register("cancel", function (message) {
  forward("cancel", message);
});
service.register("cacheClear", function (message) {
  respond(message, { returnValue: true, cleared: true });
});
