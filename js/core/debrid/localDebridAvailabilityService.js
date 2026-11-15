import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { DebridApi } from "../../data/remote/api/debridApi.js";
import { DEBRID_CAPABILITIES, DEBRID_PROVIDER_IDS, DebridProviders } from "./debridProviders.js";
import { resolveAlternativeHashMatches, torboxCachedEntries } from "./torboxCacheAliases.js";

const FINAL_STATES = new Set(["CACHED", "NOT_CACHED"]);

function streamUrl(stream = {}) {
  const url = stream.url || stream.externalUrl || "";
  return String(url || "")
    .toLowerCase()
    .startsWith("magnet:")
    ? ""
    : url;
}

function localAvailabilityHash(stream = {}) {
  const hash = String(stream.infoHash || "")
    .trim()
    .toLowerCase();
  if (!hash || streamUrl(stream)) {
    return null;
  }
  if (stream.clientResolve) {
    return null;
  }
  return hash;
}

function cacheCheckCredential() {
  const settings = DebridSettingsStore.get();
  if (!settings.enabled) {
    return null;
  }
  const credential = DebridProviders.preferredResolverService(settings);
  if (
    !credential ||
    !credential.provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK)
  ) {
    return null;
  }
  return credential;
}

function updateGroups(groups = [], transform) {
  return (groups || []).map((group) => ({
    ...group,
    streams: (group.streams || []).map((stream) => transform(stream))
  }));
}

async function checkCached(account, hashes = []) {
  const normalized = (hashes || [])
    .map((hash) =>
      String(hash || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  if (!normalized.length) {
    return {};
  }
  if (account.provider.id === DEBRID_PROVIDER_IDS.TORBOX) {
    const response = await DebridApi.torboxCheckCached(account.apiKey, normalized);
    if (!response.ok || response.data?.success === false) {
      return null;
    }
    return resolveAlternativeHashMatches(
      torboxCachedEntries(response),
      normalized,
      async (hash) => {
        const single = await DebridApi.torboxCheckCached(account.apiKey, [hash]);
        return single.ok && single.data?.success !== false ? torboxCachedEntries(single) : null;
      }
    );
  }
  if (account.provider.id === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
    const response = await DebridApi.premiumizeCheckCache(account.apiKey, normalized);
    if (!response.ok || String(response.data?.status || "").toLowerCase() === "error") {
      return null;
    }
    return normalized.reduce((accumulator, hash, index) => {
      if (response.data?.response?.[index] === true) {
        accumulator[hash] = {
          name: response.data?.filename?.[index] || null,
          size: response.data?.filesize?.[index] || null
        };
      }
      return accumulator;
    }, {});
  }
  return null;
}

export const LocalDebridAvailabilityService = {
  markChecking(groups = []) {
    const account = cacheCheckCredential();
    if (!account) {
      return groups;
    }
    return updateGroups(groups, (stream) => {
      if (!localAvailabilityHash(stream) || stream.debridCacheStatus?.state === "CACHED") {
        return stream;
      }
      return {
        ...stream,
        debridCacheStatus: {
          providerId: account.provider.id,
          providerName: account.provider.displayName,
          state: "CHECKING"
        }
      };
    });
  },

  async annotateCachedAvailability(groups = []) {
    const account = cacheCheckCredential();
    if (!account) {
      return groups;
    }
    const hashes = Array.from(
      new Set(
        (groups || []).flatMap((group) =>
          (group.streams || [])
            .map((stream) => {
              if (FINAL_STATES.has(stream.debridCacheStatus?.state)) {
                return null;
              }
              return localAvailabilityHash(stream);
            })
            .filter(Boolean)
        )
      )
    );
    if (!hashes.length) {
      return groups;
    }

    const cached = await checkCached(account, hashes).catch(() => null);
    if (!cached) {
      return updateGroups(groups, (stream) => {
        const hash = localAvailabilityHash(stream);
        return hash
          ? {
              ...stream,
              debridCacheStatus: {
                providerId: account.provider.id,
                providerName: account.provider.displayName,
                state: "UNKNOWN"
              }
            }
          : stream;
      });
    }

    return updateGroups(groups, (stream) => {
      const hash = localAvailabilityHash(stream);
      if (!hash || FINAL_STATES.has(stream.debridCacheStatus?.state)) {
        return stream;
      }
      const item = cached[hash] || null;
      return {
        ...stream,
        debridCacheStatus: {
          providerId: account.provider.id,
          providerName: account.provider.displayName,
          state: item ? "CACHED" : "NOT_CACHED",
          cachedName: item?.name || null,
          cachedSize: item?.size || null
        }
      };
    });
  }
};
