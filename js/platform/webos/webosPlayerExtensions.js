const KEEP_AWAKE_REFRESH_MS = 15000;
const PLAYER_SESSION_REASON = "player-session";

const keepAwakeBindings = new WeakMap();
const keepAwakeReasons = new Map();
const keepAwakeLifecycleBindings = new WeakSet();

let refreshTimer = null;
let screenSaverBlocked = false;
let wakeLock = null;
let wakeLockRequestToken = 0;
let wakeLockPending = false;
let webOsAppInForeground = true;
let documentVisibilityBound = false;
let currentKeepAwakeBinding = null;

function getWebOsSystemObjects() {
  return Array.from(
    new Set([globalThis.webOSSystem || null, globalThis.PalmSystem || null].filter(Boolean))
  ).filter((system) => typeof system.setWindowProperty === "function");
}

function getWebOsLifecycleSystems() {
  return Array.from(
    new Set([globalThis.webOSSystem || null, globalThis.PalmSystem || null].filter(Boolean))
  ).filter((system) => typeof system === "object" || typeof system === "function");
}

function setScreenSaverBlocked(blocked) {
  const systems = getWebOsSystemObjects();
  if (!systems.length) {
    return false;
  }

  let applied = false;
  const values = blocked ? [true, "true"] : [false, "false"];
  systems.forEach((system) => {
    values.forEach((value) => {
      try {
        system.setWindowProperty("blockScreenSaver", value);
        applied = true;
      } catch (_) {
        // Try the next runtime/value variant.
      }
    });
  });
  return applied;
}

function isVideoActivelyPlaying(videoElement) {
  return Boolean(
    videoElement &&
    !videoElement.paused &&
    !videoElement.ended &&
    Number(videoElement.readyState || 0) > 0
  );
}

function hasActiveKeepAwakeReason() {
  // webOS can mark the document hidden while its native video layer is still
  // playing. Visibility must not revoke the system screensaver block.
  keepAwakeReasons.forEach((shouldKeepAwake, reason) => {
    if (typeof shouldKeepAwake !== "function") {
      return;
    }

    let active = false;
    try {
      active = Boolean(shouldKeepAwake());
    } catch (_) {
      active = false;
    }
    if (!active) {
      keepAwakeReasons.delete(reason);
    }
  });

  return webOsAppInForeground && keepAwakeReasons.size > 0;
}

function setWebOsAppForeground(inForeground) {
  webOsAppInForeground = Boolean(inForeground);
  refreshKeepAwake({ force: Boolean(inForeground) });
}

function bindWebOsAppLifecycle() {
  getWebOsLifecycleSystems().forEach((system) => {
    if (keepAwakeLifecycleBindings.has(system)) {
      return;
    }

    const install = (callbackName, inForeground) => {
      const previous =
        typeof system[callbackName] === "function" ? system[callbackName].bind(system) : null;
      try {
        system[callbackName] = (...args) => {
          if (previous) {
            try {
              previous(...args);
            } catch (_) {
              // Keep the screensaver lifecycle independent from app callbacks.
            }
          }
          setWebOsAppForeground(inForeground);
        };
      } catch (_) {
        // Some older webOS runtimes expose readonly lifecycle callbacks.
      }
    };

    install("onshow", true);
    install("onactivate", true);
    install("onhide", false);
    install("ondeactivate", false);
    keepAwakeLifecycleBindings.add(system);
  });
}

function releaseWakeLock() {
  wakeLockRequestToken += 1;
  wakeLockPending = false;
  const lock = wakeLock;
  wakeLock = null;
  if (lock && typeof lock.release === "function") {
    lock.release().catch(() => null);
  }
}

function requestWakeLock() {
  if (wakeLock || wakeLockPending || !globalThis.navigator?.wakeLock?.request) {
    return;
  }
  const token = ++wakeLockRequestToken;
  wakeLockPending = true;
  globalThis.navigator.wakeLock
    .request("screen")
    .then((lock) => {
      if (token === wakeLockRequestToken) {
        wakeLockPending = false;
      }
      if (token !== wakeLockRequestToken || !screenSaverBlocked || !hasActiveKeepAwakeReason()) {
        if (lock && typeof lock.release === "function") {
          lock.release().catch(() => null);
        }
        return;
      }
      wakeLock = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLock === lock) {
          wakeLock = null;
        }
      });
    })
    .catch(() => {
      if (token === wakeLockRequestToken) {
        wakeLockPending = false;
        wakeLock = null;
      }
    });
}

function refreshKeepAwake({ force = false } = {}) {
  const shouldBlock = hasActiveKeepAwakeReason();
  if (!shouldBlock) {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (screenSaverBlocked) {
      screenSaverBlocked = false;
      setScreenSaverBlocked(false);
    }
    releaseWakeLock();
    return;
  }

  if (force || !screenSaverBlocked) {
    screenSaverBlocked = true;
    setScreenSaverBlocked(true);
  }
  requestWakeLock();
}

function requestKeepAwake(reason, shouldKeepAwake = null) {
  const key = String(reason || "").trim();
  if (!key) {
    return;
  }

  keepAwakeReasons.set(key, typeof shouldKeepAwake === "function" ? shouldKeepAwake : null);
  refreshKeepAwake();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => refreshKeepAwake({ force: true }), KEEP_AWAKE_REFRESH_MS);
  }
}

function releaseKeepAwake(reason) {
  const key = String(reason || "").trim();
  if (key) {
    keepAwakeReasons.delete(key);
  }
  refreshKeepAwake();
}

function bindDocumentVisibilityKeepAwake() {
  if (
    documentVisibilityBound ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  documentVisibilityBound = true;
  const onVisibilityChange = () => {
    currentKeepAwakeBinding?.sync();
    refreshKeepAwake();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("webkitvisibilitychange", onVisibilityChange);
}

function bindWebOsPlaybackKeepAwake(videoElement) {
  if (!videoElement || keepAwakeBindings.has(videoElement)) {
    return;
  }

  const reason = `video:${Date.now()}:${Math.random()}`;
  const binding = {
    videoElement,
    sync: null,
    stop: null
  };

  const start = () => {
    currentKeepAwakeBinding = binding;
    requestKeepAwake(reason, () => isVideoActivelyPlaying(videoElement));
  };

  function stop() {
    releaseKeepAwake(reason);
  }

  const sync = () => {
    if (isVideoActivelyPlaying(videoElement)) {
      start();
    } else {
      stop();
    }
  };

  const stopAndClearCurrent = () => {
    if (currentKeepAwakeBinding === binding) {
      currentKeepAwakeBinding = null;
    }
    stop();
  };

  binding.sync = sync;
  binding.stop = stop;
  currentKeepAwakeBinding = binding;

  ["playing", "play", "seeked", "ratechange", "loadeddata", "canplay"].forEach((eventName) => {
    videoElement.addEventListener(eventName, sync);
  });
  videoElement.addEventListener("pause", stop);
  ["ended", "emptied", "abort", "error"].forEach((eventName) => {
    videoElement.addEventListener(eventName, stopAndClearCurrent);
  });
  bindDocumentVisibilityKeepAwake();

  keepAwakeBindings.set(videoElement, binding);
}

export const WebOSPlayerExtensions = {
  startAmbientKeepAwake(shouldKeepAwake) {
    bindWebOsAppLifecycle();
    requestKeepAwake("ambient-mode", shouldKeepAwake);
  },

  stopAmbientKeepAwake() {
    releaseKeepAwake("ambient-mode");
  },

  apply(videoElement) {
    if (!videoElement) {
      return;
    }

    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "");
    videoElement.setAttribute("preload", "auto");
    bindWebOsAppLifecycle();
    bindWebOsPlaybackKeepAwake(videoElement);
  },

  startPlaybackKeepAwake(shouldKeepAwake = null) {
    requestKeepAwake(PLAYER_SESSION_REASON, shouldKeepAwake);
  },

  stopPlaybackKeepAwake() {
    releaseKeepAwake(PLAYER_SESSION_REASON);
  },

  refreshPlaybackKeepAwake() {
    if (keepAwakeReasons.has(PLAYER_SESSION_REASON)) {
      refreshKeepAwake({ force: true });
    }
  }
};
