// ClearKey pairs handed out by an add-on in `behaviorHints.clearKeys`.
//
// Accepted shapes, same as NuvioTV and NuvioMobile:
//   "kid:key,kid:key"                     (hex, base64 or base64url, UUID dashes allowed)
//   { "<kid>": "<key>" }
//   [{ "kid": "<kid>", "k": "<key>" }]
//
// Pairs are normalized once to `kid:key,kid:key` in lowercase hex, which is the
// form the player and the stream link cache carry around.

const HEX_KEY = /^[0-9a-fA-F]{32}$/;
const PAIR_SPLIT = /[,;\s]+/;

function hexToBytes(hex) {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    if (binary.length !== 16) {
      return null;
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_) {
    return null;
  }
}

/**
 * A 16-byte key id or key as lowercase hex, or null when the value is not one.
 * Accepts 32 hex characters (optional UUID dashes), base64 and base64url.
 */
export function normalizeClearKeyValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const compact = raw.replace(/-/g, "");
  if (HEX_KEY.test(compact)) {
    return compact.toLowerCase();
  }
  const bytes = base64ToBytes(raw);
  return bytes ? bytesToHex(bytes) : null;
}

/**
 * The pairs of `clearKeys` as `{ kid, key }` objects in lowercase hex, first
 * pair wins on duplicate key ids, malformed entries dropped.
 */
export function parseClearKeys(value) {
  const pairs = [];
  const seen = new Set();
  const push = (kid, key) => {
    const normalizedKid = normalizeClearKeyValue(kid);
    const normalizedKey = normalizeClearKeyValue(key);
    if (!normalizedKid || !normalizedKey || seen.has(normalizedKid)) {
      return;
    }
    seen.add(normalizedKid);
    pairs.push({ kid: normalizedKid, key: normalizedKey });
  };

  if (typeof value === "string") {
    value.split(PAIR_SPLIT).forEach((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) {
        return;
      }
      push(entry.slice(0, separator), entry.slice(separator + 1));
    });
  } else if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (Array.isArray(entry)) {
        push(entry[0], entry[1]);
        return;
      }
      if (entry && typeof entry === "object") {
        push(entry.kid ?? entry.kidHex ?? entry.keyId, entry.k ?? entry.key ?? entry.value);
      }
    });
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([kid, key]) => push(kid, key));
  }

  return pairs;
}

/** `kid:key,kid:key` in lowercase hex, or null when no pair is valid. */
export function normalizeClearKeys(value) {
  const pairs = parseClearKeys(value);
  return pairs.length ? pairs.map(({ kid, key }) => `${kid}:${key}`).join(",") : null;
}

export function hasClearKeys(value) {
  return parseClearKeys(value).length > 0;
}

function hexToBase64Url(hex) {
  return btoa(String.fromCharCode(...hexToBytes(hex)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The `keyids` init data Chromium's ClearKey CDM expects when the manifest
 * carries no PSSH of its own: a JSON list of base64url key ids.
 */
export function buildClearKeyKeyIdsInitData(pairs) {
  return new TextEncoder().encode(
    JSON.stringify({ kids: pairs.map(({ kid }) => hexToBase64Url(kid)) })
  );
}

/** The W3C ClearKey license (a JSON Web Key set) answering the request. */
export function buildClearKeyLicense(pairs) {
  return new TextEncoder().encode(
    JSON.stringify({
      keys: pairs.map(({ kid, key }) => ({
        kty: "oct",
        kid: hexToBase64Url(kid),
        k: hexToBase64Url(key)
      })),
      type: "temporary"
    })
  );
}
