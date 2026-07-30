import { normalizeKeyEvent, isBackEvent } from "../sharedKeys.js";

function getAvplayApi() {
  const webapis = globalThis.webapis;
  const avplay =
    webapis?.avplay ||
    webapis?.avPlay ||
    globalThis.avplay ||
    globalThis.document?.getElementById?.("avPlayerObject") ||
    null;
  if (!avplay || typeof avplay.open !== "function") {
    return null;
  }
  return avplay;
}

function applyTizenViewport() {
  const documentRef = globalThis.document;
  if (!documentRef?.head) {
    return;
  }

  let viewport = documentRef.querySelector("meta[name='viewport']");
  if (!viewport) {
    viewport = documentRef.createElement("meta");
    viewport.name = "viewport";
    documentRef.head.appendChild(viewport);
  }

  viewport.setAttribute(
    "content",
    "width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
  );
  documentRef.documentElement?.classList?.add("tizen-tv");
  documentRef.body?.classList?.add("tizen-tv");

  try {
    globalThis.dispatchEvent?.(new Event("resize"));
  } catch (_) {
    // Ignore resize dispatch failures on older Tizen engines.
  }
}

export const tizenAdapter = {
  name: "tizen",

  init() {
    applyTizenViewport();

    const tvInputDevice = globalThis.tizen?.tvinputdevice || null;
    if (!tvInputDevice) {
      return;
    }

    const mediaKeys = [
      "MediaPlayPause",
      "MediaPlay",
      "MediaPause",
      "MediaStop",
      "MediaFastForward",
      "MediaRewind",
      "MediaTrackPrevious",
      "MediaTrackNext"
    ];

    if (typeof tvInputDevice.registerKeyBatch === "function") {
      try {
        tvInputDevice.registerKeyBatch(mediaKeys);
        return;
      } catch (_) {
        // Fall through to per-key registration.
      }
    }

    mediaKeys.forEach((keyName) => {
      try {
        tvInputDevice.registerKey?.(keyName);
      } catch (_) {
        // Ignore missing media-key support on older firmware.
      }
    });
  },

  exitApp() {
    try {
      globalThis.tizen?.application?.getCurrentApplication?.().exit?.();
    } catch (_) {
      try {
        globalThis.close?.();
      } catch (_) {
        // Ignore unsupported app-exit APIs in non-TV browsers.
      }
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Tizen TV";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: Boolean(getAvplayApi())
    };
  },

  prepareVideoElement() {}
};
