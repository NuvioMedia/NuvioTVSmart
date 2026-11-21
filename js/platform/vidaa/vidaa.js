// Hisense VIDAA support.
//
// The VIDAA browser (Chromium) runs Nuvio as the generic "browser" platform:
// its <video> element hands every source to the TV's own media engine, so the
// browser path (plain video.src, no proxy, no transcode) is the right one.
// What VIDAA adds on top:
//
//   - the formats that engine plays, which canPlayType() under-reports
//     (MKV, HEVC Main10, Dolby Vision, AC-3/E-AC-3, TrueHD, DTS);
//   - a local torrent engine (the Tizen EngineFS runtime, run by the TV's own
//     Node), reached on 127.0.0.1:2710 and started on demand by the local web
//     server that serves the app;
//   - the Hisense exit call.

const ENGINE_BASE_URL = "http://127.0.0.1:2710";
const ENGINE_START_PATH = "/__nuvio/engine/start";
const PROBE_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 20000;

let cachedIsVidaa = null;
let startPromise = null;

export function isVidaaRuntime() {
  if (cachedIsVidaa === null) {
    const userAgent = String(globalThis.navigator?.userAgent || "");
    cachedIsVidaa = globalThis.__NUVIO_VIDAA__ === true || /vidaa|hisense/i.test(userAgent);
  }
  return cachedIsVidaa;
}

// Formats the VIDAA media engine plays as direct files, as measured on a
// 2025 Hisense U6 (MT9618): 4K HEVC Main10 with Dolby Vision profiles 5, 7
// and 8 and HDR10, in MKV and MP4, with AAC, AC-3, E-AC-3, TrueHD, DTS and
// FLAC audio.
export const VIDAA_PLAYBACK_CAPABILITIES = Object.freeze({
  mp4: true,
  mp4H264: true,
  mp4Hevc: true,
  mp4HevcMain10: true,
  mkvH264: true,
  mkvHevc: true,
  audioAac: true,
  audioMp3: true,
  audioFlac: true,
  audioAc3: true,
  audioEac3: true,
  audioTrueHd: true,
  audioDts: true,
  dolbyVision: true,
  hdrLikely: true,
  atmosLikely: true
});

export function applyVidaaPlaybackCapabilities(capabilities = {}) {
  return { ...capabilities, ...VIDAA_PLAYBACK_CAPABILITIES };
}

export function exitVidaaApp() {
  try {
    if (typeof globalThis.Hisense_Exit === "function") {
      globalThis.Hisense_Exit();
      return true;
    }
  } catch (_) {
    // Fall through to window.close().
  }
  try {
    globalThis.close?.();
  } catch (_) {
    // Ignore; the TV's Exit key still closes the app.
  }
  return false;
}

function timeout(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

async function engineResponds() {
  try {
    const response = await Promise.race([
      fetch(`${ENGINE_BASE_URL}/settings`, { cache: "no-cache" }),
      timeout(PROBE_TIMEOUT_MS, "EngineFS probe timed out")
    ]);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function startEngine() {
  if (await engineResponds()) {
    return { status: "success", baseUrl: ENGINE_BASE_URL };
  }
  try {
    await fetch(ENGINE_START_PATH, { method: "POST", cache: "no-cache" });
  } catch (_) {
    // The probe loop below reports the failure.
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await engineResponds()) {
      return { status: "success", baseUrl: ENGINE_BASE_URL };
    }
  }
  return { status: "error", detail: "The TV's torrent engine did not start" };
}

export const VidaaEngineFsService = {
  getLocalBaseUrls() {
    return [ENGINE_BASE_URL];
  },

  async ensureStarted() {
    if (!startPromise) {
      startPromise = startEngine().finally(() => {
        startPromise = null;
      });
    }
    return startPromise;
  }
};
