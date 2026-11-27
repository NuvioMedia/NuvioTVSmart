import {
  buildClearKeyKeyIdsInitData,
  buildClearKeyLicense,
  parseClearKeys
} from "../streams/clearKeys.js";

const CLEAR_KEY_KEY_SYSTEM = "org.w3.clearkey";

// One ClearKey attachment per video element. Older Chromium (webOS 5, Tizen 5,
// Chromium 63/68) refuses to replace or remove MediaKeys once a MediaSource is
// attached, so the same key set is reused instead of set again.
const clearKeyAttachments = new WeakMap();
// dash.js tries to install its own MediaKeys for the DRM entries it finds in the
// manifest (PlayReady on Samsung). Chromium 63/68 refuses to replace a MediaKeys
// object, and on newer engines that replacement would drop the ClearKey one.
// While our keys are attached, key-system installs from the player are ignored.
const clearKeyGuards = new WeakMap();

function mediaSourceAttached(video) {
  return typeof video?.src === "string" && video.src.startsWith("blob:");
}

function originalSetMediaKeys(video) {
  return clearKeyGuards.get(video)?.original || video.setMediaKeys.bind(video);
}

function keyStatuses(session) {
  const statuses = [];
  try {
    session?.keyStatuses?.forEach((status) => statuses.push(status));
  } catch (_) {
    // A released session has no statuses.
  }
  return statuses;
}

function watchKeyStatuses(video, session) {
  const refresh = () => {
    const current = clearKeyGuards.get(video);
    if (current) {
      current.keysUsable = keyStatuses(session).includes("usable");
    }
  };
  try {
    session?.addEventListener?.("keystatuseschange", refresh);
  } catch (_) {
    // Older engines without the event fall back to the initial status.
  }
}

async function waitForUsableKey(session, timeoutMs = 1500) {
  if (keyStatuses(session).includes("usable")) {
    return true;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        session.removeEventListener?.("keystatuseschange", onChange);
      } catch (_) {
        // Nothing to remove.
      }
      resolve(value);
    };
    const onChange = () => {
      if (keyStatuses(session).includes("usable")) {
        finish(true);
      }
    };
    try {
      session.addEventListener?.("keystatuseschange", onChange);
    } catch (_) {
      finish(false);
      return;
    }
    const started = Date.now();
    const poll = () => {
      if (settled) return;
      if (keyStatuses(session).includes("usable")) {
        finish(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        finish(false);
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);
  });
}

function installMediaKeysGuard(video, mediaKeys, keysUsable) {
  const existing = clearKeyGuards.get(video);
  if (existing) {
    existing.mediaKeys = mediaKeys;
    existing.keysUsable = keysUsable;
    return;
  }
  const original = video.setMediaKeys.bind(video);
  const guard = (keys) => {
    const state = clearKeyGuards.get(video);
    // Only hold off key systems installed by the player while our ClearKey
    // keys are actually usable: when they are not, its DRM attempt must run.
    if (state && keys && keys !== state.mediaKeys && state.keysUsable) {
      return Promise.resolve();
    }
    return state ? state.original(keys) : original(keys);
  };
  clearKeyGuards.set(video, { original, mediaKeys, keysUsable, guard });
  video.setMediaKeys = guard;
}

// Chromium only uses these entries to check that the device can play this kind
// of media; the real codecs come from the manifest.
const CLEAR_KEY_CONFIG = [
  {
    initDataTypes: ["keyids"],
    videoCapabilities: [
      { contentType: 'video/mp4; codecs="avc1.42E01E"' },
      { contentType: 'video/mp4; codecs="avc1.640020"' }
    ],
    audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
  }
];

function canUseClearKeyEme() {
  return Boolean(
    typeof navigator !== "undefined" &&
    typeof navigator.requestMediaKeySystemAccess === "function" &&
    typeof MediaKeys !== "undefined"
  );
}

/**
 * Stops holding off key systems installed by the player, without touching the
 * MediaKeys already attached: used when a different, non-ClearKey source is
 * played on the same video element, so its own DRM can take over.
 */
export function releaseClearKeyGuard(video) {
  const state = clearKeyGuards.get(video);
  if (!state) {
    return;
  }
  clearKeyGuards.delete(video);
  try {
    delete video.setMediaKeys;
  } catch (_) {
    video.setMediaKeys = state.original;
  }
}

/**
 * Loads the pairs into the element's ClearKey CDM, so the MSE pipeline decrypts
 * the encrypted samples it is about to receive. Chromium's ClearKey CDM reads
 * `keyids` init data, so the manifest does not need a PSSH of its own.
 *
 * Returns the session (its key statuses say whether the keys were accepted) or
 * null when there is nothing to attach; throws when the platform cannot do it.
 */
export async function attachClearKeyMediaKeys(video, clearKeys) {
  if (!video || typeof video.setMediaKeys !== "function") {
    throw new Error("ClearKey needs a MediaKeys-capable video element");
  }
  const pairs = parseClearKeys(clearKeys);
  const canonical = pairs.map(({ kid, key }) => `${kid}:${key}`).join(",");
  const previous = clearKeyAttachments.get(video);

  if (!pairs.length) {
    // No detach here: the player re-plays the same source without the pairs in
    // some flows (post-play key handling), and removing MediaKeys mid-playback
    // stops the decryption. Clear media ignores MediaKeys, so keeping them is
    // harmless.
    return previous?.session || null;
  }
  if (previous && previous.canonical === canonical && video.mediaKeys === previous.mediaKeys) {
    return previous.session;
  }
  if (!canUseClearKeyEme()) {
    throw new Error("ClearKey EME is not available");
  }

  const access = await navigator.requestMediaKeySystemAccess(
    CLEAR_KEY_KEY_SYSTEM,
    CLEAR_KEY_CONFIG
  );
  const mediaKeys = await access.createMediaKeys();
  const session = mediaKeys.createSession("temporary");
  await session.generateRequest("keyids", buildClearKeyKeyIdsInitData(pairs));
  await session.update(buildClearKeyLicense(pairs));
  if (video.mediaKeys !== mediaKeys) {
    if (video.mediaKeys && mediaSourceAttached(video)) {
      // Chromium 63/68 cannot replace MediaKeys while a MediaSource is attached.
      throw new Error("this TV cannot change ClearKey keys during playback");
    }
    await originalSetMediaKeys(video)(mediaKeys);
  }
  try {
    previous?.session?.close();
  } catch (_) {
    // The replaced session may already be closed.
  }
  const usable = await waitForUsableKey(session);
  installMediaKeysGuard(video, mediaKeys, usable);
  watchKeyStatuses(video, session);
  clearKeyAttachments.set(video, { canonical, mediaKeys, session });
  return session;
}

/**
 * hls.js would fetch the key URI of every `EXT-X-KEY` tag, but for CENC HLS the
 * keys are already in the CDM and the tag only carries a PSSH. Playlists are
 * therefore stripped of the SAMPLE-AES-CTR tags before hls.js parses them;
 * AES-128 and Apple SAMPLE-AES tags are left alone.
 */
export function createClearKeyPlaylistLoader(Hls) {
  if (!Hls?.DefaultConfig?.loader) {
    return null;
  }
  const BaseLoader = Hls.DefaultConfig.loader;
  return class ClearKeyPlaylistLoader extends BaseLoader {
    load(context, config, callbacks) {
      const onSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (response, stats, loaderContext, xhr) => {
        if (typeof response?.data === "string" && response.data.includes("#EXTM3U")) {
          response.data = response.data
            .split(/\r?\n/)
            .filter((line) => !/^#EXT-X-(?:SESSION-)?KEY:.*METHOD=SAMPLE-AES-CTR/i.test(line))
            .join("\n");
        }
        onSuccess(response, stats, loaderContext, xhr);
      };
      super.load(context, config, callbacks);
    }
  };
}
