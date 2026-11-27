import {
  buildClearKeyKeyIdsInitData,
  buildClearKeyLicense,
  parseClearKeys
} from "../streams/clearKeys.js";

export const CLEAR_KEY_KEY_SYSTEM = "org.w3.clearkey";

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
  if (!pairs.length) {
    if (video.mediaKeys) {
      await video.setMediaKeys(null);
    }
    return null;
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
  await video.setMediaKeys(mediaKeys);
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
