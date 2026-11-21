// Preloaded into the torrent engine so every server it opens binds 127.0.0.1
// instead of all interfaces (copy of scripts/localhost-listen-patch.cjs).

const net = require("net");

const originalListen = net.Server.prototype.listen;

function normalizeHost(host) {
  return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

net.Server.prototype.listen = function patchedListen(...args) {
  if (args.length === 0) {
    return originalListen.call(this, { host: "127.0.0.1" });
  }

  if (args[0] && typeof args[0] === "object") {
    return originalListen.call(
      this,
      {
        ...args[0],
        host: normalizeHost(args[0].host)
      },
      ...args.slice(1)
    );
  }

  if (typeof args[0] === "number" || typeof args[0] === "string") {
    const port = args[0];
    let host = args[1];
    if (typeof host === "function") {
      return originalListen.call(this, port, "127.0.0.1", host);
    }
    if (typeof host === "undefined") {
      return originalListen.call(this, port, "127.0.0.1", ...args.slice(1));
    }
    if (typeof host === "string") {
      args[1] = normalizeHost(host);
    }
  }

  return originalListen.apply(this, args);
};
