// Android PlaybackUrlCredentials: query keys that usually carry a signed or
// expiring credential, so a failed link is fetched again from its add-on.
const CREDENTIAL_QUERY_KEYS = new Set([
  "accesskey",
  "accesssignature",
  "accesssig",
  "access_token",
  "accesstoken",
  "auth",
  "authkey",
  "authsig",
  "authsignature",
  "auth_token",
  "authtoken",
  "e",
  "exp",
  "expiration",
  "expire",
  "expires",
  "expiresat",
  "expiresin",
  "expires_in",
  "expiry",
  "hmac",
  "jwt",
  "keypairid",
  "policy",
  "sig",
  "signature",
  "signed",
  "st",
  "t",
  "token"
]);

const CREDENTIAL_KEY_FRAGMENTS = ["token", "signature", "expires", "expiry"];

/** True when the URL query carries a key that usually holds a signed or expiring credential. */
export function hasLikelyExpiringPlaybackCredentials(url = "") {
  const value = String(url || "");
  const queryStart = value.indexOf("?");
  if (queryStart < 0) {
    return false;
  }
  const query = value.slice(queryStart + 1).split("#")[0];
  if (!query.trim()) {
    return false;
  }
  return query.split(/[&;]/).some((rawParameter) => {
    const separator = rawParameter.indexOf("=");
    if (separator < 0) {
      return false;
    }
    const rawKey = rawParameter.slice(0, separator).trim().toLowerCase();
    if (!rawKey) {
      return false;
    }
    const compactKey = rawKey.replace(/[-_.]/g, "");
    return (
      CREDENTIAL_QUERY_KEYS.has(rawKey) ||
      CREDENTIAL_QUERY_KEYS.has(compactKey) ||
      CREDENTIAL_KEY_FRAGMENTS.some(
        (fragment) => rawKey.includes(fragment) || compactKey.includes(fragment)
      )
    );
  });
}

function streamUrl(stream = {}) {
  return String(stream?.url || stream?.externalUrl || "").trim();
}

function streamInfoHash(stream = {}) {
  return String(
    stream?.infoHash || stream?.raw?.infoHash || stream?.clientResolve?.infoHash || ""
  ).trim();
}

function streamHints(stream = {}) {
  return stream?.behaviorHints || stream?.raw?.behaviorHints || {};
}

/**
 * Android findCachedSourceRefreshCandidate: among freshly fetched streams, the one
 * from the same add-on that best matches the failed source. A stream must offer a
 * new URL, or be resolvable again (a debrid result Nuvio resolved, or a torrent the
 * debrid resolver can play). Same torrent > same name > same file > same group.
 */
export function findSourceRefreshCandidate(
  streams = [],
  failedUrl = "",
  expected = {},
  canResolve = () => false
) {
  const addonName = String(expected?.addonName || "").trim();
  if (!addonName) {
    return null;
  }
  let best = null;
  let bestScore = -1;
  (Array.isArray(streams) ? streams : []).forEach((stream) => {
    if (String(stream?.addonName || "").trim() !== addonName) {
      return;
    }
    const url = streamUrl(stream);
    const hasFreshUrl = Boolean(url) && url !== failedUrl;
    const resolvable = stream?.debridResolved === true || (!url && canResolve(stream));
    if (!hasFreshUrl && !resolvable) {
      return;
    }
    let score = 100;
    const infoHash = streamInfoHash(stream);
    if (
      expected.infoHash &&
      infoHash &&
      infoHash.toLowerCase() === String(expected.infoHash).toLowerCase()
    ) {
      score += 60;
    }
    const name = String(stream?.name || "").trim() || String(stream?.addonName || "").trim();
    if (expected.streamName && name === expected.streamName) {
      score += 40;
    }
    if (expected.filename && streamHints(stream).filename === expected.filename) {
      score += 30;
    }
    if (expected.bingeGroup && streamHints(stream).bingeGroup === expected.bingeGroup) {
      score += 20;
    }
    if (url && hasLikelyExpiringPlaybackCredentials(url)) {
      score += 5;
    }
    if (score > bestScore) {
      best = stream;
      bestScore = score;
    }
  });
  return best;
}
