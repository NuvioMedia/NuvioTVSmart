/* Torrent engine for Nuvio on Hisense VIDAA.
 *
 * Runs Nuvio's Tizen EngineFS service (Stremio's streaming server, as bundled
 * by Nuvio) on the TV's Node, on 127.0.0.1:2710. Started on demand by
 * serve.cjs, with localhost-only.cjs preloaded so nothing listens on the LAN.
 *
 * DISABLE_CACHING keeps torrent data in a small memory buffer instead of a
 * disk cache: the TV has well under 1 GB of writable storage.
 */
"use strict";
const fs = require("fs");
const path = require("path");

process.env.HOME = "/var/local/nuvio-engine";
process.env.APP_PATH = path.join(process.env.HOME, "runtime");
process.env.DISABLE_CACHING = "1";
process.env.PORT = "2710";
fs.mkdirSync(process.env.APP_PATH, { recursive: true });

require("./tizen/enginefs-service.js").onStart();

// The service keeps its own servers open; this only stops Node from treating
// an idle moment as the end of the program.
setInterval(() => {}, 1 << 30);
