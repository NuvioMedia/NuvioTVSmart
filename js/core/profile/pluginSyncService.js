import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { PluginManager } from "../player/pluginManager.js";
import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { ProfileManager } from "./profileManager.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import {
  canonicalizePluginUrl,
  isExternalDexRepository,
  normalizePluginRepositoryType,
  PLUGIN_REPOSITORY_TYPES
} from "../player/pluginModels.js";
import { emitPluginDiagnosticEvent } from "../diagnostics/pluginDiagnostics.js";

const TABLE = "plugins";
const PUSH_RPC = "sync_push_plugins";
const SYNC_OVERVIEW_RPC = "get_sync_overview";
let lastPullStatus = "idle";
let lastPullError = null;
const pullInFlightByProfile = new Map();
// A request that arrives while a pull is running asks for one more pull at the end,
// like Android's pending rerun. It never queues more than one.
const pendingPullReruns = new Set();
const syncOperationByProfile = new Map();
let pluginServiceReadyPromise = null;

function areTizenPluginsSupported() {
  return !Platform.isTizen() || TizenCapabilities.canUsePlugins();
}

function createPluginServiceNotReadyError(cause) {
  const detail = String(cause?.message || cause || "PluginService health check failed");
  const error = new Error(`PluginService must be ready before plugin sync: ${detail}`);
  error.code = "PLUGIN_SERVICE_NOT_READY";
  error.cause = cause;
  return error;
}

function ensurePluginServiceReady({ force = true } = {}) {
  // The readiness barrier belongs to the TV service transports. Browser test
  // and development runs use the direct transport and must not be rejected by
  // the absence of a packaged TV service.
  if (
    (!Platform.isTizen() && !Platform.isWebOS()) ||
    !areTizenPluginsSupported() ||
    !AuthManager.isAuthenticated
  ) {
    return Promise.resolve({ status: "skipped" });
  }

  if (!pluginServiceReadyPromise) {
    pluginServiceReadyPromise = PluginServiceClient.ensureReady({ force }).finally(() => {
      pluginServiceReadyPromise = null;
    });
  }

  return pluginServiceReadyPromise.catch((error) => {
    throw createPluginServiceNotReadyError(error);
  });
}

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1200);
  return details;
}

function diagnosticUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 240);
  }
}

function diagnosticRow(row = {}) {
  const url = row?.url || row?.url_template || row?.urlTemplate;
  const type = row?.repo_type ?? row?.repoType ?? row?.type;
  let keys = [];
  try {
    keys = Object.keys(row).sort().slice(0, 40);
  } catch (_) {
    keys = [];
  }
  return {
    id: row?.id == null ? "" : String(row.id).slice(0, 128),
    name: row?.name == null ? "" : String(row.name).slice(0, 120),
    url: diagnosticUrl(url),
    type: type == null ? null : String(type),
    repoTypeDeclared: row?.repoTypeDeclared === true,
    enabled: row?.enabled,
    sortOrder: row?.sort_order ?? row?.sortOrder,
    keys
  };
}

function diagnosticState(state = {}) {
  return {
    syncDirty: state.syncDirty === true,
    repositoryCount: Array.isArray(state.repositories) ? state.repositories.length : 0,
    scraperCount: Array.isArray(state.scrapers) ? state.scrapers.length : 0,
    unknownRemoteRowsCount: Array.isArray(state.unknownRemoteRows)
      ? state.unknownRemoteRows.length
      : 0,
    rawRemoteRowsCount: Array.isArray(state.rawRemoteRows) ? state.rawRemoteRows.length : 0,
    repositories: (Array.isArray(state.repositories) ? state.repositories : [])
      .slice(0, 64)
      .map(diagnosticRow),
    unknownRemoteRows: (Array.isArray(state.unknownRemoteRows) ? state.unknownRemoteRows : [])
      .slice(0, 64)
      .map(diagnosticRow)
  };
}

// Keep successful sync state quiet. Warnings and failures are emitted through
// console.warn/error so they are visible in Inspector and in Settings >
// Console debug, which captures those two console levels.
function logPluginSyncDiagnostic(event, details = {}) {
  emitPluginDiagnosticEvent(event, details, { prefix: "[Nuvio PluginSync]" });
}

function normalizeProfileId(profileId = null) {
  const raw = Number(profileId == null ? getEffectivePluginProfileId() : profileId);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function readRemoteBoolean(value, fallback = true) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

async function verifyEmptyRemotePluginSnapshot(profileId) {
  const profileKey = String(normalizeProfileId(profileId));
  try {
    const response = await SupabaseApi.rpc(SYNC_OVERVIEW_RPC, {}, true);
    const overview =
      Array.isArray(response) && response.length === 1
        ? response[0]
        : response && typeof response === "object" && !Array.isArray(response)
          ? response
          : null;
    const plugins =
      overview?.plugins && typeof overview.plugins === "object" && !Array.isArray(overview.plugins)
        ? overview.plugins
        : null;
    const profiles =
      overview?.profiles &&
      typeof overview.profiles === "object" &&
      !Array.isArray(overview.profiles)
        ? overview.profiles
        : null;
    const profileExists =
      profiles &&
      Object.prototype.hasOwnProperty.call(profiles, profileKey) &&
      profiles[profileKey] &&
      typeof profiles[profileKey] === "object" &&
      !Array.isArray(profiles[profileKey]);
    const hasPluginCount = plugins && Object.prototype.hasOwnProperty.call(plugins, profileKey);
    const rawPluginCount = hasPluginCount ? plugins[profileKey] : 0;
    const pluginCount = Number(rawPluginCount);
    const validPluginCount =
      (!hasPluginCount ||
        typeof rawPluginCount === "number" ||
        typeof rawPluginCount === "string") &&
      Number.isInteger(pluginCount) &&
      pluginCount >= 0;
    const verified = Boolean(profileExists && validPluginCount && pluginCount === 0);
    logPluginSyncDiagnostic("empty snapshot verification", {
      targetProfileId: profileKey,
      profileExists: Boolean(profileExists),
      pluginCount: validPluginCount ? pluginCount : null,
      verified
    });
    return verified;
  } catch (error) {
    logPluginSyncDiagnostic("empty snapshot verification failed", {
      targetProfileId: profileKey,
      error: diagnosticError(error)
    });
    return false;
  }
}

/**
 * Convert the typed cloud rows into the local Web model without dropping the
 * repository type or its enabled value. EXTERNAL_DEX rows are intentionally
 * kept in this same round-trip contract even though Web never executes them.
 */
export function mapRemotePluginRows(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const mappedRows = sourceRows
    .map((row, sourceIndex) => {
      const url = canonicalizePluginUrl(row?.url || row?.url_template || row?.urlTemplate);
      if (!url) return null;
      const hasExplicitType = row?.repo_type != null || row?.repoType != null || row?.type != null;
      const inferredType =
        !hasExplicitType && /\.cs3(?:$|[?#])/i.test(url)
          ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
          : null;
      // Missing, empty, and future repo_type values must remain auto-detectable,
      // matching Android's RepositoryType.valueOf() fallback to a null hint.
      // PluginManager still retains the raw row for diagnostics and sync
      // bookkeeping, but it must not block a valid Nuvio JS manifest.
      const normalizedType = hasExplicitType
        ? normalizePluginRepositoryType(
            row?.repo_type ?? row?.repoType ?? row?.type,
            PLUGIN_REPOSITORY_TYPES.UNKNOWN
          )
        : inferredType;
      const repoType = normalizedType === PLUGIN_REPOSITORY_TYPES.UNKNOWN ? null : normalizedType;
      return {
        url:
          repoType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
            ? canonicalizePluginUrl(url, { manifest: true })
            : url,
        name: String(row?.name || "").trim(),
        enabled: readRemoteBoolean(row?.enabled),
        repoType,
        repoTypeDeclared: hasExplicitType && repoType != null,
        sortOrder: Number(row?.sort_order ?? row?.sortOrder ?? row?.position ?? sourceIndex),
        sourceIndex,
        raw: row
      };
    })
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      sortOrder: Number.isFinite(entry.sortOrder) ? entry.sortOrder : entry.sourceIndex
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex, ...entry }) => entry);
  logPluginSyncDiagnostic("remote rows mapped", {
    inputCount: sourceRows.length,
    outputCount: mappedRows.length,
    input: sourceRows.slice(0, 64).map(diagnosticRow),
    output: mappedRows.slice(0, 64).map(diagnosticRow)
  });
  return mappedRows;
}

/**
 * The RPC receives the complete typed repository set. In particular, omitting
 * an EXTERNAL_DEX row could be interpreted as a deletion by the cloud sync.
 */
export function buildPluginPushRows(state) {
  return (Array.isArray(state?.repositories) ? state.repositories : [])
    .map((repository) => ({
      repository,
      repoType: isExternalDexRepository(repository)
        ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
        : normalizePluginRepositoryType(repository.type)
    }))
    .filter(({ repoType }) =>
      [PLUGIN_REPOSITORY_TYPES.NUVIO_JS, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX].includes(repoType)
    )
    .map(({ repository, repoType }, index) => ({
      url:
        repoType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
          ? canonicalizePluginUrl(repository.url, { manifest: true })
          : canonicalizePluginUrl(repository.url),
      name: String(repository.name || ""),
      enabled: repository.enabled !== false,
      sort_order: index,
      repo_type: repoType
    }));
}

function hasUnsupportedRepositoryState(state) {
  return state.repositories.some((repository) => {
    const repoType = isExternalDexRepository(repository)
      ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
      : normalizePluginRepositoryType(repository.type);
    return ![PLUGIN_REPOSITORY_TYPES.NUVIO_JS, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX].includes(
      repoType
    );
  });
}

function hasOpaqueRepositoryState(state) {
  return state.unknownRemoteRows.length > 0 || hasUnsupportedRepositoryState(state);
}

function hasSameRemoteRepositoryRows(left, right) {
  return JSON.stringify(buildPluginPushRows(left)) === JSON.stringify(right);
}

function requestedProfileId(profileId = null) {
  return String(profileId == null ? ProfileManager.getActiveProfileId() : profileId || "1");
}

function isCurrentProfile(profileId, effectiveProfileId) {
  return (
    String(ProfileManager.getActiveProfileId()) === String(profileId) &&
    String(getEffectivePluginProfileId(profileId)) === String(effectiveProfileId)
  );
}

function runProfileExclusive(profileId, task) {
  const key = String(profileId || "1");
  const previous = syncOperationByProfile.get(key) || Promise.resolve();
  let current = null;
  current = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (syncOperationByProfile.get(key) === current) {
        syncOperationByProfile.delete(key);
      }
    });
  syncOperationByProfile.set(key, current);
  return current;
}

async function pushProfile(requestedId, targetProfileId, { requireCurrentProfile = false } = {}) {
  if (!areTizenPluginsSupported()) {
    return false;
  }
  const backoffActive = isSyncBackoffActive();
  const authenticated = AuthManager.isAuthenticated;
  logPluginSyncDiagnostic("push requested", {
    requestedProfileId: requestedId,
    targetProfileId,
    requireCurrentProfile,
    backoffActive,
    authenticated: authenticated === true,
    activeProfileId: String(ProfileManager.getActiveProfileId())
  });
  if (backoffActive || !authenticated) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: backoffActive ? "sync backoff" : "not authenticated"
    });
    return false;
  }
  // Android does not push from a secondary profile that inherits the primary
  // plugin set. Keep that rule here so a Web TV cannot accidentally publish the
  // primary profile's state from a read-only alias.
  const editable = PluginStore.canEdit(requestedId);
  if (!editable) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "profile is read-only"
    });
    return false;
  }
  const currentProfile = isCurrentProfile(requestedId, targetProfileId);
  if (requireCurrentProfile && !currentProfile) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "profile is no longer current"
    });
    return false;
  }

  const state = PluginStore.get(targetProfileId);
  logPluginSyncDiagnostic("push state", {
    requestedProfileId: requestedId,
    targetProfileId,
    revision: PluginStore.getRevision(targetProfileId),
    ...diagnosticState(state)
  });
  if (!state.syncDirty) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "state is clean"
    });
    return false;
  }
  const hasUnsupportedState = hasUnsupportedRepositoryState(state);
  if (state.unknownRemoteRows.length || hasUnsupportedState) {
    // The typed RPC can only represent Android's JS/DEX repository contract.
    // Never silently omit an unknown/future row and turn it into a deletion.
    logPluginSyncDiagnostic("push skipped unsupported repository metadata", {
      requestedProfileId: requestedId,
      targetProfileId,
      unknownRemoteRows: state.unknownRemoteRows.length,
      hasUnsupportedRepositoryState: hasUnsupportedState,
      ...diagnosticState(state)
    });
    return false;
  }
  const rows = buildPluginPushRows(state);
  const stateRevision = PluginStore.getRevision(targetProfileId);
  logPluginSyncDiagnostic("push RPC begin", {
    requestedProfileId: requestedId,
    targetProfileId,
    stateRevision,
    rowCount: rows.length,
    rows: rows.slice(0, 64).map(diagnosticRow)
  });
  try {
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: normalizeProfileId(targetProfileId),
        p_plugins: rows,
        p_origin_client_id: getSyncClientId()
      },
      true
    );
    // A local-only setting/cache write changes the state revision but not the
    // cloud repository rows. Clear the original dirty bit in that case; keep
    // it when a repository row or unsupported metadata changed during the RPC.
    const currentState = PluginStore.get(targetProfileId);
    const currentStateIsPushable =
      !currentState.unknownRemoteRows.length && !hasUnsupportedRepositoryState(currentState);
    if (currentStateIsPushable && hasSameRemoteRepositoryRows(currentState, rows)) {
      PluginStore.clearDirty(targetProfileId);
    } else {
      PluginStore.clearDirty(targetProfileId, stateRevision);
    }
    logPluginSyncDiagnostic("push RPC success", {
      requestedProfileId: requestedId,
      targetProfileId,
      stateRevision,
      currentRevision: PluginStore.getRevision(targetProfileId),
      ...diagnosticState(PluginStore.get(targetProfileId))
    });
    return true;
  } catch (error) {
    // Deliberately no DELETE/UPSERT fallback: those operations are
    // destructive and cannot preserve future columns or repository types.
    logPluginSyncDiagnostic("push RPC failed", {
      requestedProfileId: requestedId,
      targetProfileId,
      stateRevision,
      error: diagnosticError(error)
    });
    return false;
  }
}

export const PluginSyncService = {
  ensureReadyForPull({ force = true } = {}) {
    return ensurePluginServiceReady({ force });
  },

  getLastPullStatus() {
    return lastPullStatus;
  },

  getLastPullError() {
    return lastPullError;
  },

  async pull(profileId = null) {
    if (!areTizenPluginsSupported()) {
      lastPullStatus = "unsupported";
      lastPullError = null;
      return PluginManager.listRepositories();
    }
    const requestedId = requestedProfileId(profileId);
    const targetProfileId = String(getEffectivePluginProfileId(requestedId) || "1");
    const pullKey = `${requestedId}:${targetProfileId}`;
    const activePull = pullInFlightByProfile.get(pullKey);
    logPluginSyncDiagnostic("pull requested", {
      requestedProfileId: requestedId,
      targetProfileId,
      pullKey,
      activeProfileId: String(ProfileManager.getActiveProfileId()),
      authenticated: AuthManager.isAuthenticated === true,
      backoffActive: isSyncBackoffActive(),
      ...diagnosticState(PluginStore.get(targetProfileId))
    });
    if (activePull) {
      pendingPullReruns.add(pullKey);
      logPluginSyncDiagnostic("pull joined existing request", { pullKey, rerunQueued: true });
      return activePull;
    }

    let requestPromise = null;
    requestPromise = runProfileExclusive(targetProfileId, async () => {
      lastPullStatus = "loading";
      lastPullError = null;
      logPluginSyncDiagnostic("pull started", { requestedProfileId: requestedId, targetProfileId });
      if (isSyncBackoffActive()) {
        lastPullStatus = "deferred";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "sync backoff"
        });
        return PluginManager.listRepositories();
      }
      if (!AuthManager.isAuthenticated) {
        lastPullStatus = "signed-out";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "not authenticated"
        });
        return PluginManager.listRepositories();
      }

      // Android reads the remote snapshot before flushing a pending local push.
      // Keep that order here too: beginRemoteSync below prevents a new local
      // write from racing reconciliation, and endRemoteSync defers the push
      // until the complete remote snapshot has been applied. In particular, a
      // failed/unsupported push must never prevent the first useful pull.
      const pendingState = PluginStore.get(targetProfileId);
      if (pendingState.syncDirty) {
        logPluginSyncDiagnostic("pull has pending local state", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(pendingState)
        });
        if (hasOpaqueRepositoryState(pendingState)) {
          logPluginSyncDiagnostic("pull proceeds before pending push for opaque state", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "remote pull must classify unsupported local metadata",
            ...diagnosticState(pendingState)
          });
        }
      }
      if (!isCurrentProfile(requestedId, targetProfileId)) {
        lastPullStatus = "stale";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "profile is no longer current"
        });
        return PluginManager.listRepositories();
      }

      // Cloud row synchronization is independent from the optional plugin
      // network/runtime service. Android can reconcile repository rows even
      // when a plugin runtime is unavailable; manifest hydration below will
      // keep a typed row as a local stub until the service becomes usable.
      // This is also what lets a confirmed cloud deletion remove a stale TV
      // repository instead of being blocked by a service-health failure.

      // Keep local writes from starting a competing push until the complete
      // remote snapshot has been reconciled, matching Android's
      // isSyncingFromRemote/pendingPushAfterSync flow.
      PluginStore.beginRemoteSync(targetProfileId);
      let pullRevision = PluginStore.getRevision(targetProfileId);
      logPluginSyncDiagnostic("remote pull transaction begun", {
        requestedProfileId: requestedId,
        targetProfileId,
        revision: pullRevision
      });
      try {
        const ownerId = String((await AuthManager.getEffectiveUserId()) || "").trim();
        if (!ownerId) {
          throw new Error("Unable to resolve sync owner for plugin sync");
        }
        logPluginSyncDiagnostic("sync owner resolved", {
          requestedProfileId: requestedId,
          targetProfileId,
          ownerResolved: true
        });
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "profile changed after owner resolution"
          });
          return PluginManager.listRepositories();
        }
        const rows = await SupabaseApi.select(
          TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${normalizeProfileId(targetProfileId)}&select=*&order=sort_order.asc`,
          true
        );
        logPluginSyncDiagnostic("remote rows selected", {
          requestedProfileId: requestedId,
          targetProfileId,
          rowCount: Array.isArray(rows) ? rows.length : 0,
          rows: (Array.isArray(rows) ? rows : []).slice(0, 64).map(diagnosticRow)
        });
        if (!AuthManager.isAuthenticated || !isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: !AuthManager.isAuthenticated
              ? "signed out during select"
              : "profile changed during select"
          });
          return PluginManager.listRepositories();
        }
        const currentRevision = PluginStore.getRevision(targetProfileId);
        if (currentRevision !== pullRevision && PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "local state changed during select",
            initialRevision: pullRevision,
            currentRevision,
            ...diagnosticState(PluginStore.get(targetProfileId))
          });
          return PluginManager.listRepositories();
        }
        // Local-only provider/settings changes are not part of the remote
        // repository snapshot. Continue from the latest revision so they do
        // not cause an otherwise valid pull to be skipped.
        pullRevision = currentRevision;
        const remotePlugins = mapRemotePluginRows(rows);
        const currentState = PluginStore.get(targetProfileId);
        const allowVerifiedEmptySnapshot =
          Array.isArray(rows) &&
          rows.length === 0 &&
          currentState.repositories.length > 0 &&
          !currentState.syncDirty &&
          !hasOpaqueRepositoryState(currentState) &&
          (await verifyEmptyRemotePluginSnapshot(targetProfileId));
        logPluginSyncDiagnostic("remote plugins normalized", {
          requestedProfileId: requestedId,
          targetProfileId,
          pullRevision,
          rowCount: remotePlugins.length,
          allowVerifiedEmptySnapshot,
          rows: remotePlugins.slice(0, 64).map(diagnosticRow)
        });
        const reconciled = await PluginManager.reconcileWithRemoteRepoUrls(remotePlugins, {
          removeMissingLocal: true,
          authoritativeSnapshot: true,
          allowVerifiedEmptySnapshot,
          expectedRevision: pullRevision,
          profileId: targetProfileId
        });
        logPluginSyncDiagnostic("remote repositories reconciled", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(reconciled)
        });
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "profile changed after reconcile"
          });
          return reconciled;
        }
        if (PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          logPluginSyncDiagnostic("pull completed with pending local state", {
            requestedProfileId: requestedId,
            targetProfileId,
            ...diagnosticState(PluginStore.get(targetProfileId))
          });
          return reconciled;
        }
        lastPullStatus = "ok";
        logPluginSyncDiagnostic("pull success", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(PluginStore.get(targetProfileId))
        });
        return reconciled;
      } finally {
        PluginStore.endRemoteSync(targetProfileId);
        logPluginSyncDiagnostic("remote pull transaction ended", {
          requestedProfileId: requestedId,
          targetProfileId,
          lastPullStatus,
          ...diagnosticState(PluginStore.get(targetProfileId))
        });
      }
    });
    pullInFlightByProfile.set(pullKey, requestPromise);
    try {
      return await requestPromise;
    } catch (error) {
      if (error?.code === "PLUGIN_SERVICE_NOT_READY") {
        lastPullStatus = "service-not-ready";
        lastPullError = error;
        logPluginSyncDiagnostic("pull blocked by PluginService readiness", {
          requestedProfileId: requestedId,
          targetProfileId,
          error: diagnosticError(error)
        });
        throw error;
      }
      lastPullStatus = "error";
      lastPullError = error;
      logPluginSyncDiagnostic("pull failed", {
        requestedProfileId: requestedId,
        targetProfileId,
        error: diagnosticError(error)
      });
      return PluginManager.listRepositories();
    } finally {
      if (pullInFlightByProfile.get(pullKey) === requestPromise) {
        pullInFlightByProfile.delete(pullKey);
      }
      if (pendingPullReruns.delete(pullKey)) {
        logPluginSyncDiagnostic("pull rerun queued", { pullKey });
        void PluginSyncService.pull(requestedId);
      }
    }
  },

  async push(profileId = null) {
    const requestedId = requestedProfileId(profileId);
    const targetProfileId = String(getEffectivePluginProfileId(requestedId) || "1");
    return runProfileExclusive(targetProfileId, () =>
      pushProfile(requestedId, targetProfileId, { requireCurrentProfile: profileId == null })
    );
  }
};
