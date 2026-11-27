import {
  buildClearKeyKeyIdsInitData,
  buildClearKeyLicense,
  parseClearKeys
} from "../streams/clearKeys.js";

export const CLEAR_KEY_KEY_SYSTEM = "org.w3.clearkey";

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

function installMediaKeysGuard(video, mediaKeys) {
  const existing = clearKeyGuards.get(video);
  if (existing) {
    existing.mediaKeys = mediaKeys;
    return;
  }
  const original = video.setMediaKeys.bind(video);
  const guard = (keys) => {
    const state = clearKeyGuards.get(video);
    if (state && keys && keys !== state.mediaKeys) {
      return Promise.resolve();
    }
    return state ? state.original(keys) : original(keys);
  };
  clearKeyGuards.set(video, { original, mediaKeys, guard });
  video.setMediaKeys = guard;
}

function releaseMediaKeysGuard(video) {
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

export function canUseClearKeyEme() {
  return Boolean(
    typeof navigator !== "undefined" &&
    typeof navigator.requestMediaKeySystemAccess === "function" &&
    typeof MediaKeys !== "undefined"
  );
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
    if (previous || video.mediaKeys) {
      releaseMediaKeysGuard(video);
      if (!mediaSourceAttached(video)) {
        try {
          await video.setMediaKeys(null);
        } catch (_) {
          // A browser without detach support keeps the old keys; clear media
          // is not affected by them.
        }
      }
      clearKeyAttachments.delete(video);
    }
    return null;
  }
  if (previous && previous.canonical === canonical) {
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
  installMediaKeysGuard(video, mediaKeys);
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
