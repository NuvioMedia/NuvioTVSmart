var URL = require("url").URL;
var fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  root = path.resolve(__dirname, "../runtime/dts"),
  t = require("./bitmapSubtitles").matroska,
  mkv = require("./audioTranscodeMatroska"),
  prepare = require("./audioTranscodeSource").prepare,
  createUnits = require("./audioTranscodeUnits").createUnits;
var source = null,
  meta = null,
  header = null,
  cues = [],
  units = null,
  sessionId = "",
  requestContext = null,
  creation = 0;
const waiters = new Set();
let generation = 0,
  session = null,
  playhead = 0;
const wake = () => {
  for (const f of waiters) f();
  waiters.clear();
};
const wait = () =>
  new Promise((r) => {
    waiters.add(r);
    setTimeout(() => {
      waiters.delete(r);
      r();
    }, 250);
  });
const fetchRange = (start, end, ctx) =>
  t.requestRange(source.url, start, end, 8 * 1024 * 1024, 0, ctx || requestContext);
async function unitFor(s, index) {
  if (s.units.has(index)) return s.units.get(index);
  if (index === 0) return null;
  const previous = await unitFor(s, index - 1);
  if (!previous || previous.end >= meta.cuesOffset) return null;
  if (!s.unitLoads.has(index))
    s.unitLoads.set(
      index,
      units.at(previous.end, s.requestContext).then((unit) => {
        if (s.cancelled) throw Error("cancelled");
        s.units.set(index, unit);
        return unit;
      })
    );
  return s.unitLoads.get(index);
}
async function context(s, index) {
  if (s.contexts.has(index)) return s.contexts.get(index);
  const unit = await unitFor(s, index);
  if (!unit) return null;
  if (s.contexts.has(index)) return s.contexts.get(index);
  const end = unit.end - 1;
  const bytes = unit.end - unit.start;
  while (
    Array.from(s.contexts.values()).reduce((n, c) => n + c.bytes, 0) +
      Array.from(s.cache.values()).reduce((n, b) => n + b.length, 0) +
      bytes >
      24 * 1024 * 1024 &&
    s.cache.size
  )
    s.cache.delete(s.cache.keys().next().value);
  if (
    Array.from(s.contexts.values()).reduce((n, c) => n + c.bytes, 0) +
      Array.from(s.cache.values()).reduce((n, b) => n + b.length, 0) +
      bytes >
    24 * 1024 * 1024
  )
    throw Error("buffer-budget");
  const promise = fetchRange(unit.start, end, s.requestContext).then((r) =>
    mkv.parse(r.buffer, unit.start, s.trackNumber, source.format)
  );
  promise.bytes = bytes;
  s.contexts.set(index, promise);
  return promise;
}
function createGeneration(unit) {
  if (session) {
    session.cancelled = true;
    t.cancelRequestContext(session.requestContext);
  }
  session = {
    requestContext: { cancelled: false, requests: new Set() },
    g: ++generation,
    index: 0,
    nextInput: 0,
    units: new Map([[0, unit]]),
    unitLoads: new Map(),
    contexts: new Map(),
    raw: [],
    rawCursor: 0,
    frames: [],
    partial: Buffer.alloc(0),
    frameIndex: 0,
    wanted: 0,
    anchor: null,
    cancelled: false,
    inputBytes: 0,
    outputBytes: 0,
    processed: 0,
    cache: new Map(),
    error: null,
    conversions: new Map(),
    expectedPts: null,
    trackNumber: source.trackNumber
  };
  wake();
  return session;
}
async function input(s) {
  while (!s.cancelled) {
    if (s.raw.length) {
      const out = Buffer.alloc(65536);
      let used = 0;
      while (s.raw.length && used < 65536) {
        const b = s.raw[0],
          n = Math.min(65536 - used, b.length - s.rawCursor);
        b.copy(out, used, s.rawCursor, s.rawCursor + n);
        s.rawCursor += n;
        used += n;
        if (s.rawCursor === b.length) {
          s.raw.shift();
          s.rawCursor = 0;
        }
      }
      s.inputBytes += used;
      return out.subarray(0, used);
    }
    if (s.nextInput > s.index + 2) {
      await wait();
      continue;
    }
    const ctx = await context(s, s.nextInput++);
    if (!ctx) return Buffer.alloc(0);
    if (s.expectedPts !== null && Math.abs(ctx.first - s.expectedPts) > 25)
      throw Error("audio-discontinuity");
    s.expectedPts = ctx.last;
    if (s.anchor === null && source.format === "truehd") {
      const major = ctx.input.findIndex((b) => b.length >= 8 && b.readUInt32BE(4) === 0xf8726fba);
      if (major < 0) throw Error("truehd-sync");
      s.anchor = ctx.inputPts[major];
      s.raw = ctx.input.slice(major);
    } else {
      if (s.anchor === null) s.anchor = ctx.first;
      s.raw = ctx.input.slice();
    }
  }
  throw Error("cancelled");
}
async function buildConverted(s, index) {
  if (s.cache.has(index)) return s.cache.get(index);
  if (index !== s.index) throw Error("noncontiguous");
  const unit = await unitFor(s, index);
  if (!unit) throw Error("cluster-boundary");
  while (!s.cancelled && unit.timeMs / 1000 > playhead + 8) await wait();
  const ctx = await context(s, index);
  while (!s.cancelled) {
    if (s.error) throw Error(s.error);
    if (s.anchor !== null) {
      const wanted = Math.max(0, Math.ceil((ctx.last - s.anchor - 0.5) / 32) - s.frameIndex);
      // /output must keep accepting frames until this unit's demand is met.
      if (wanted * 2560 > 8 * 1024 * 1024) throw Error("frame-budget");
      s.wanted = wanted;
      if (s.frames.length >= wanted) {
        const converted = mkv.project(ctx, s.frames.slice(0, wanted), s.anchor, s.frameIndex);
        if (converted.used !== wanted) throw Error("slot-capacity");
        s.frames.splice(0, converted.used);
        s.frameIndex += converted.used;
        s.wanted = 0;
        s.cache.set(index, converted.out);
        while (s.cache.size > 2) s.cache.delete(s.cache.keys().next().value);
        s.contexts.delete(index);
        s.unitLoads.delete(index);
        if (index >= 4) s.units.delete(index - 4);
        s.processed++;
        s.index++;
        wake();
        return converted.out;
      }
    }
    await wait();
  }
  throw Error("cancelled");
}
function converted(s, index) {
  if (s.cache.has(index)) return Promise.resolve(s.cache.get(index));
  if (s.conversions.has(index)) return s.conversions.get(index);
  const cleanup = () => {
    s.conversions.delete(index);
  };
  const promise = buildConverted(s, index).then(
    (result) => {
      cleanup();
      return result;
    },
    (error) => {
      cleanup();
      throw error;
    }
  );
  s.conversions.set(index, promise);
  return promise;
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
}
async function handleRequest(req, res) {
  let operationSession = session;
  cors(res);
  const u = new URL(req.url, "http://localhost");
  u.pathname = u.pathname.replace("/audio-transcode/" + sessionId, "");
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end();
    }
    if (u.pathname === "/control") {
      const current = Number(u.searchParams.get("time"));
      if (Number.isFinite(current) && current >= 0) playhead = current;
      wake();
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify(
          session
            ? {
                g: session.g,
                error: session.error,
                processed: session.processed,
                inputBytes: session.inputBytes,
                outputBytes: session.outputBytes,
                frames: session.frames.length,
                contexts: session.contexts.size
              }
            : { g: 0 }
        )
      );
    }
    if (u.pathname === "/input") {
      const s = session;
      if (!s || s.g !== Number(u.searchParams.get("g"))) throw Error("cancelled");
      const b = await input(s);
      res.writeHead(b.length ? 200 : 204);
      return res.end(b);
    }
    if (u.pathname === "/output") {
      const s = session;
      if (!s || s.g !== Number(u.searchParams.get("g"))) throw Error("cancelled");
      let bytes = 0,
        parts = [];
      req.on("data", (b) => {
        bytes += b.length;
        if (bytes > 65536) req.destroy();
        else parts.push(b);
      });
      await new Promise((r, j) => {
        req.on("end", r);
        req.on("error", j);
      });
      while (!s.cancelled && s.frames.length > Math.max(96, s.wanted)) await wait();
      if (s.cancelled) throw Error("cancelled");
      const b = Buffer.concat([s.partial, ...parts]);
      let p = 0;
      while (p + 2560 <= b.length) {
        if (b[p] !== 11 || b[p + 1] !== 119) throw Error("ac3-sync");
        s.frames.push(Buffer.from(b.subarray(p, p + 2560)));
        p += 2560;
      }
      s.partial = Buffer.from(b.subarray(p));
      s.outputBytes += bytes;
      wake();
      return res.end("ok");
    }
    if (u.pathname !== "/media.mkv") {
      res.writeHead(404);
      return res.end();
    }
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "bytes=0-");
    if (!r) throw Error("range");
    let pos = r[1] ? Number(r[1]) : meta.totalSize - Number(r[2]),
      end = r[1] && r[2] ? Number(r[2]) : meta.totalSize - 1;
    if (pos < 0 || pos > end || end >= meta.totalSize) throw Error("range");
    const start = pos;
    res.writeHead(206, {
      "Content-Type": "video/x-matroska",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${pos}-${end}/${meta.totalSize}`,
      "Content-Length": end - pos + 1
    });
    if (req.method === "HEAD") return res.end();
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const write = async (b) => {
      if (closed) return;
      if (!res.write(b))
        await new Promise((r) => {
          const done = () => {
            res.removeListener("drain", done);
            res.removeListener("close", done);
            r();
          };
          res.once("drain", done);
          res.once("close", done);
        });
    };
    if (pos < header.length) {
      let stop = Math.min(header.length, end + 1);
      await write(header.subarray(pos, stop));
      pos = stop;
    }
    if (pos >= meta.cuesOffset) {
      while (pos <= end && !closed) {
        const stop = Math.min(end, pos + 1048575),
          b = (await fetchRange(pos, stop)).buffer;
        await write(b);
        pos += b.length;
      }
      return res.end();
    }
    let s = session;
    let index = s
      ? (Array.from(s.units).find(([, unit]) => pos >= unit.start && pos < unit.end)?.[0] ?? -1)
      : -1;
    if (!s || s.cancelled || index < 0 || (!s.cache.has(index) && s.index !== index)) {
      const ctx = requestContext,
        resolver = units;
      const unit = await resolver.at(pos, ctx);
      if (ctx.cancelled || requestContext !== ctx) throw Error("cancelled");
      // Header discovery awaits I/O; another request may have created the same
      // generation meanwhile. Reuse it rather than cancelling its encoder.
      s = session;
      index = s
        ? (Array.from(s.units).find(([, entry]) => pos >= entry.start && pos < entry.end)?.[0] ??
          -1)
        : -1;
      if (!s || s.cancelled || index < 0 || (!s.cache.has(index) && s.index !== index)) {
        s = createGeneration(unit);
        index = 0;
      }
    }
    operationSession = s;
    while (pos <= end && !closed && pos < meta.cuesOffset) {
      const b = await converted(s, index);
      if (closed) break;
      const offset = pos - s.units.get(index).start;
      if (offset < 0 || offset > b.length) throw Error("offset");
      const len = Math.min(b.length - offset, end - pos + 1);
      await write(b.subarray(offset, offset + len));
      pos += len;
      index++;
    }
    if (pos <= end && !closed) {
      while (pos <= end && !closed) {
        const stop = Math.min(end, pos + 1048575),
          b = (await fetchRange(pos, stop)).buffer;
        await write(b);
        pos += b.length;
      }
    }
    res.end();
  } catch (e) {
    if (
      session &&
      session === operationSession &&
      !session.cancelled &&
      e.code !== "REQUEST_SUPERSEDED" &&
      !["cancelled", "noncontiguous"].includes(e.message)
    ) {
      session.error = e.message;
      wake();
    }
    if (!res.headersSent)
      res.writeHead(e.code === "REQUEST_SUPERSEDED" || e.message === "cancelled" ? 409 : 500);
    res.end();
  }
}

function stop(id) {
  if (id && id !== sessionId) return false;
  creation++;
  if (session) {
    session.cancelled = true;
    t.cancelRequestContext(session.requestContext);
  }
  session = null;
  if (requestContext) t.cancelRequestContext(requestContext);
  requestContext = null;
  wake();
  source = null;
  meta = null;
  header = null;
  cues = [];
  units = null;
  sessionId = "";
  return true;
}
async function createSession(options) {
  stop();
  const token = creation,
    ctx = { cancelled: false, requests: new Set() };
  requestContext = ctx;
  const deadline = setTimeout(() => t.cancelRequestContext(ctx), 25000);
  let prepared;
  try {
    prepared = await prepare(
      options.url,
      Number(options.trackNumber),
      Number(options.trackIndex),
      ctx
    );
  } finally {
    clearTimeout(deadline);
  }
  if (token !== creation || ctx.cancelled) throw Error("cancelled");
  source = { url: options.url, trackNumber: prepared.trackNumber, format: prepared.format };
  meta = prepared.meta;
  header = prepared.header;
  cues = prepared.cues;
  units = createUnits(cues, meta.cuesOffset, fetchRange);
  sessionId = crypto.randomBytes(16).toString("hex");
  playhead = 0;
  return {
    id: sessionId,
    path: "/audio-transcode/" + sessionId,
    trackIndex: prepared.trackIndex,
    downmix: prepared.downmix,
    format: prepared.format
  };
}
function handle(req, res) {
  const pathname = String(req.url || "").split("?")[0];
  if (
    /^\/audio-transcode\/assets\/(ffmpeg-core\.js|ffmpeg-core\.wasm|worker\.js)$/.test(pathname)
  ) {
    cors(res);
    const name = pathname.split("/").pop();
    res.setHeader(
      "Content-Type",
      name.endsWith(".wasm") ? "application/wasm" : "application/javascript"
    );
    const stream = fs.createReadStream(path.join(root, name));
    stream.on("error", () => {
      res.statusCode = 404;
      res.end();
    });
    stream.pipe(res);
    return true;
  }
  if (!pathname.startsWith("/audio-transcode/")) return false;
  if (!sessionId || !pathname.startsWith("/audio-transcode/" + sessionId + "/")) {
    res.statusCode = 404;
    res.end();
    return true;
  }
  void handleRequest(req, res);
  return true;
}
module.exports = { createSession: createSession, stop: stop, handle: handle };
