const STREAMING_LIBS = [
  {
    id: "hls",
    sources: [
      "assets/libs/hls.min.js",
      "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js"
    ],
    isLoaded: () => Boolean(globalThis.Hls)
  },
  {
    id: "dash",
    sources: [
      "assets/libs/dash.all.min.js",
      "https://cdn.jsdelivr.net/npm/dashjs@5.2.1/dist/legacy/umd/dash.all.min.js"
    ],
    isLoaded: () => Boolean(globalThis.dashjs)
  },
  {
    id: "mp4box",
    sources: [
      "assets/libs/mp4box.all.min.js",
      "https://cdn.jsdelivr.net/npm/mp4box@0.5.4/dist/mp4box.all.min.js"
    ],
    isLoaded: () => Boolean(globalThis.MP4Box?.createFile)
  }
];

let streamingLibsWarmupScheduled = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = (error) => {
      script.remove();
      reject(error);
    };
    document.head.appendChild(script);
  });
}

async function loadStreamingLibrary(entry) {
  let lastError = null;
  for (const src of entry.sources) {
    try {
      await loadScript(src);
      if (entry.isLoaded()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Streaming library failed to initialize");
}

function ensureStreamingLibrary(entry) {
  if (entry.isLoaded()) {
    return Promise.resolve();
  }
  if (entry.loadingPromise) {
    return entry.loadingPromise;
  }
  const loadingPromise = loadStreamingLibrary(entry).finally(() => {
    if (entry.loadingPromise === loadingPromise) {
      entry.loadingPromise = null;
    }
  });
  entry.loadingPromise = loadingPromise;
  return loadingPromise;
}

export async function loadStreamingLibs({ hls = true, dash = true, mp4box = false } = {}) {
  const requiredLibraryIds = new Set([
    ...(hls ? ["hls"] : []),
    ...(dash ? ["dash"] : []),
    ...(mp4box ? ["mp4box"] : [])
  ]);
  for (const entry of STREAMING_LIBS) {
    if (!requiredLibraryIds.has(entry.id) || entry.isLoaded()) {
      continue;
    }
    try {
      await ensureStreamingLibrary(entry);
    } catch (error) {
      console.warn("Streaming library failed to load", entry.sources, error);
    }
  }
}

export function warmStreamingLibs(options = {}) {
  if (
    streamingLibsWarmupScheduled ||
    STREAMING_LIBS.filter((entry) => entry.id !== "mp4box").every((entry) => entry.isLoaded())
  ) {
    return;
  }
  streamingLibsWarmupScheduled = true;
  const delayMs = Math.max(0, Number(options?.delayMs || 1200));
  const startWarmup = () => {
    streamingLibsWarmupScheduled = false;
    void loadStreamingLibs();
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(startWarmup, { timeout: Math.max(2000, delayMs + 1200) });
    return;
  }
  setTimeout(startWarmup, delayMs);
}
