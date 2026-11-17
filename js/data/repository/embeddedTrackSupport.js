// The embedded-track readers (webOS/Tizen) understand Matroska and MP4 only.
// These containers can never answer, so the provider is not even asked.
// Unknown extensions stay discoverable: never skip when we are not sure (for
// example 3GP and F4V share the MP4 box structure and must still be probed).
const UNSUPPORTED_TRACK_CONTAINER_EXTENSIONS = new Set([
  "avi",
  "divx",
  "wmv",
  "asf",
  "mpg",
  "mpeg",
  "mpe",
  "m1v",
  "m2v",
  "vob",
  "flv",
  "ogv",
  "rm",
  "rmvb",
  "ts",
  "m2ts",
  "mts",
  "mxf",
  "wtv"
]);

export function getEmbeddedTrackContainerExtension(mediaUrl = "", filename = "") {
  for (const source of [filename, mediaUrl]) {
    const pathname = String(source || "")
      .trim()
      .split(/[?#]/, 1)[0];
    const match = /\.([a-z0-9]{2,5})$/i.exec(pathname);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return "";
}

export function isEmbeddedTrackContainerSupported(mediaUrl = "", filename = "") {
  const extension = getEmbeddedTrackContainerExtension(mediaUrl, filename);
  return !extension || !UNSUPPORTED_TRACK_CONTAINER_EXTENSIONS.has(extension);
}

// The companion service answers 415 for containers it knows it cannot parse.
export function isTerminalTrackDiscoveryResponse(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return payload.terminal === true || Number(payload.statusCode || 0) === 415;
}
