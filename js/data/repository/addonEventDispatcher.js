import { addonRepository } from "./addonRepository.js";

// Android AddonEventDispatcher: the stremio-core player and library tracking events.
export const ADDON_PLAYER_RESOURCE = "player";
export const ADDON_LIBRARY_RESOURCE = "library";
export const AddonPlayerAction = Object.freeze({ START: "start", PAUSE: "pause", STOP: "stop" });
export const AddonLibraryAction = Object.freeze({
  LIBRARY_ADD: "libraryAdd",
  LIBRARY_REMOVE: "libraryRemove",
  WATCHED: "watched",
  UNWATCHED: "unwatched"
});

const LIBRARY_EVENT_VIDEOS_COUNT = 100;
const EVENT_TIMEOUT_MS = 10000;

function resourceName(resource) {
  return typeof resource === "string" ? resource : String(resource?.name || "");
}

export function isTrackingAddon(addon = {}) {
  return (Array.isArray(addon?.resources) ? addon.resources : []).some((resource) => {
    const name = resourceName(resource);
    return name === ADDON_PLAYER_RESOURCE || name === ADDON_LIBRARY_RESOURCE;
  });
}

/** Android Addon.supportsResource: the resource name, its types and its id prefixes. */
export function addonSupportsResource(addon = {}, name = "", type = "", id = "") {
  return (Array.isArray(addon?.resources) ? addon.resources : []).some((resource) => {
    if (resourceName(resource) !== name) {
      return false;
    }
    const types =
      typeof resource === "object" && Array.isArray(resource?.types) ? resource.types : [];
    if (types.length && !types.includes(type)) {
      return false;
    }
    const resourcePrefixes =
      typeof resource === "object" && Array.isArray(resource?.idPrefixes)
        ? resource.idPrefixes
        : [];
    const prefixes = resourcePrefixes.length
      ? resourcePrefixes
      : Array.isArray(addon?.idPrefixes)
        ? addon.idPrefixes
        : [];
    return !prefixes.length || prefixes.some((prefix) => String(id).startsWith(String(prefix)));
  });
}

export function libraryVideoIdChunks(videoIds = []) {
  const unique = [
    ...new Set(
      (Array.isArray(videoIds) ? videoIds : [...(videoIds || [])]).filter((id) =>
        String(id || "").trim()
      )
    )
  ];
  const chunks = [];
  for (let index = 0; index < unique.length; index += LIBRARY_EVENT_VIDEOS_COUNT) {
    chunks.push(unique.slice(index, index + LIBRARY_EVENT_VIDEOS_COUNT));
  }
  return chunks;
}

// Java URLEncoder with "+" as %20: it also escapes the characters encodeURIComponent keeps.
function encodeSegment(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildAddonEventUrl(baseUrl = "", resource = "", type = "", id = "", extra = []) {
  const rawBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const queryStart = rawBaseUrl.indexOf("?");
  const basePath =
    queryStart >= 0 ? rawBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : rawBaseUrl;
  const baseQuery = queryStart >= 0 ? rawBaseUrl.slice(queryStart) : "";
  const extraSegment = extra
    .map(([name, value]) => `${encodeSegment(name)}=${encodeSegment(value)}`)
    .join("&");
  return `${basePath}/${resource}/${encodeSegment(type)}/${encodeSegment(id)}/${extraSegment}.json${baseQuery}`;
}

const queues = new Map();

async function send(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), EVENT_TIMEOUT_MS);
  try {
    await fetch(url, { method: "GET", signal: controller?.signal });
  } catch (error) {
    console.warn("Addon tracking event failed", error?.message || error);
  } finally {
    clearTimeout(timer);
  }
}

/** Events reach each add-on in order, one at a time, and never block the caller. */
function deliver(baseUrl, url) {
  const previous = queues.get(baseUrl) || Promise.resolve();
  const next = previous.then(() => send(url));
  queues.set(baseUrl, next);
  void next.finally(() => {
    if (queues.get(baseUrl) === next) {
      queues.delete(baseUrl);
    }
  });
}

function dispatch(resource, type, id, extra, getAddons) {
  if (!String(type || "").trim() || !String(id || "").trim() || String(id).startsWith("server:")) {
    return 0;
  }
  const seen = new Set();
  let count = 0;
  (getAddons() || []).forEach((addon) => {
    const baseUrl = String(addon?.baseUrl || "");
    if (!baseUrl || seen.has(baseUrl) || !addonSupportsResource(addon, resource, type, id)) {
      return;
    }
    seen.add(baseUrl);
    deliver(baseUrl, buildAddonEventUrl(baseUrl, resource, type, id, extra));
    count += 1;
  });
  return count;
}

const enabledAddons = () => addonRepository.getCachedInstalledAddons() || [];

export const AddonEventDispatcher = {
  hasEnabledAddonFor(resource, getAddons = enabledAddons) {
    return (getAddons() || []).some((addon) =>
      (Array.isArray(addon?.resources) ? addon.resources : []).some(
        (entry) => resourceName(entry) === resource
      )
    );
  },
  player({ type, videoId }, action, currentTimeMs = 0, durationMs = 0, getAddons = enabledAddons) {
    return dispatch(
      ADDON_PLAYER_RESOURCE,
      type,
      videoId,
      [
        ["action", action],
        ["currentTime", String(Math.max(0, Math.round(Number(currentTimeMs) || 0)))],
        ["duration", String(Math.max(0, Math.round(Number(durationMs) || 0)))]
      ],
      getAddons
    );
  },
  library(type, id, action, getAddons = enabledAddons) {
    return dispatch(ADDON_LIBRARY_RESOURCE, type, id, [["action", action]], getAddons);
  },
  libraryVideos(type, id, action, videoIds = [], getAddons = enabledAddons) {
    return libraryVideoIdChunks(videoIds).reduce(
      (count, chunk) =>
        count +
        dispatch(
          ADDON_LIBRARY_RESOURCE,
          type,
          id,
          [
            ["action", action],
            ["videoId", chunk.join(",")]
          ],
          getAddons
        ),
      0
    );
  }
};

const SEEK_RESEND_DELAY_MS = 1000;

/**
 * Android emitAddonPlayerEvent as a scrobble provider: start on play/resume, pause on
 * pause, one stop on exit, video change or end, and the current state again after a seek.
 */
export const AddonPlayerScrobbleService = {
  active: null,
  lastAction: null,
  seekTimer: null,

  isEnabled() {
    return AddonEventDispatcher.hasEnabledAddonFor(ADDON_PLAYER_RESOURCE);
  },

  target(context = {}) {
    const type = String(context.contentType || "").trim();
    const videoId = String(context.videoId || "").trim() || String(context.contentId || "").trim();
    return type && videoId ? { type, videoId } : null;
  },

  emit(action, context = {}, { resend = false } = {}) {
    const positionMs = Number(context.positionMs || 0);
    const durationMs = Number(context.durationMs || 0);
    const active = this.active;
    if (action === AddonPlayerAction.STOP) {
      if (!active) return;
      this.active = null;
      this.lastAction = null;
      AddonEventDispatcher.player(active, AddonPlayerAction.STOP, positionMs, durationMs);
      return;
    }
    const target = this.target(context);
    if (!target) return;
    const sameTarget = active && active.type === target.type && active.videoId === target.videoId;
    if (active && !sameTarget) {
      AddonEventDispatcher.player(active, AddonPlayerAction.STOP, positionMs, durationMs);
      this.active = null;
      this.lastAction = null;
    }
    if (action === AddonPlayerAction.PAUSE && !this.active) return;
    if (!resend && action === this.lastAction && this.active) return;
    this.active = target;
    this.lastAction = action;
    AddonEventDispatcher.player(target, action, positionMs, durationMs);
  },

  start(context) {
    this.emit(AddonPlayerAction.START, context);
  },

  pause(context) {
    this.emit(AddonPlayerAction.PAUSE, context);
  },

  stop(context) {
    clearTimeout(this.seekTimer);
    this.emit(AddonPlayerAction.STOP, context);
  },

  /** After a seek the add-on gets the current state again, once the seeking settles. */
  seeked(getContext) {
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => {
      if (this.lastAction) {
        this.emit(this.lastAction, getContext(), { resend: true });
      }
    }, SEEK_RESEND_DELAY_MS);
  },

  cancel() {
    clearTimeout(this.seekTimer);
    this.active = null;
    this.lastAction = null;
  }
};
