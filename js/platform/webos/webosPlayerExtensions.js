const KEEP_AWAKE_REFRESH_MS = 15000;
const PLAYER_SESSION_REASON = "player-session";

const keepAwakeBindings = new WeakMap();
const keepAwakeReasons = new Map();
const keepAwakeLifecycleBindings = new WeakSet();

let refreshTimer = null;
let screenSaverBlocked = false;
let wakeLock = null;
let webOsAppInForeground = true;

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
  refreshKeepAwake();
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
  const lock = wakeLock;
  wakeLock = null;
  if (lock && typeof lock.release === "function") {
    lock.release().catch(() => null);
  }
}

function requestWakeLock() {
  if (wakeLock || !globalThis.navigator?.wakeLock?.request) {
    return;
  }
  globalThis.navigator.wakeLock
    .request("screen")
    .then((lock) => {
      wakeLock = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLock === lock) {
          wakeLock = null;
        }
      });
    })
    .catch(() => {
      wakeLock = null;
    });
}

function refreshKeepAwake() {
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

  screenSaverBlocked = true;
  setScreenSaverBlocked(true);
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
    refreshTimer = setInterval(refreshKeepAwake, KEEP_AWAKE_REFRESH_MS);
  }
}

function releaseKeepAwake(reason) {
  const key = String(reason || "").trim();
  if (key) {
    keepAwakeReasons.delete(key);
  }
  refreshKeepAwake();
}

function bindWebOsPlaybackKeepAwake(videoElement) {
  if (!videoElement || keepAwakeBindings.has(videoElement)) {
    return;
  }

  const reason = `video:${Date.now()}:${Math.random()}`;

  const start = () => {
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

  const onVisibilityChange = () => {
    sync();
  };

  ["playing", "play", "timeupdate", "seeked", "ratechange", "loadeddata", "canplay"].forEach(
    (eventName) => {
      videoElement.addEventListener(eventName, sync);
    }
  );
  ["pause", "ended", "emptied", "abort", "error"].forEach((eventName) => {
    videoElement.addEventListener(eventName, stop);
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("webkitvisibilitychange", onVisibilityChange);

  keepAwakeBindings.set(videoElement, { stop });
}

export const WebOSPlayerExtensions = {
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
      refreshKeepAwake();
    }
  }
};
