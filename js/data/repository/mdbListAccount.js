import { MDBLIST_API_BASE_URL, MDBLIST_CLIENT_ID } from "../../config.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";

import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

let sessionGeneration = 0;
registerSessionTeardownHandler(() => {
  sessionGeneration++;
  refreshes.clear();
});

const KEY = "mdbListAccounts";
const refreshes = new Map();
const limits = new Map();
let requestQueue = Promise.resolve();
function failure(code, status = 0) {
  return Object.assign(new Error(code), { code, status });
}
async function responseText(response) {
  const maximum = 16 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > maximum)
    throw failure("mdblist_invalid_response");
  if (response.body?.getReader && typeof TextDecoder === "function") {
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let size = 0,
      text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        size += chunk.value.byteLength;
        if (size > maximum) {
          void reader.cancel().catch(() => {});
          throw failure("mdblist_invalid_response");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = await response.text();
  if (text.length > maximum) throw failure("mdblist_invalid_response");
  return text;
}
function read(profileId) {
  return LocalStore.get(KEY, {})?.[profileId] || null;
}
function write(profileId, value) {
  const all = LocalStore.get(KEY, {});
  all[profileId] = value;
  LocalStore.set(KEY, all);
}
function verificationUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "mdblist.com" &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch (_) {
    /* Invalid provider response. */
  }
  throw failure("mdblist_invalid_response");
}
function tokens(payload, previousRefresh = null) {
  const seconds = Number(payload.expires_in);
  if (
    !payload.access_token ||
    !(payload.refresh_token || previousRefresh) ||
    String(payload.token_type).toLowerCase() !== "bearer" ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !Number.isSafeInteger(Date.now() + seconds * 1000)
  )
    throw failure("mdblist_invalid_response");
  if (payload.scope != null && !String(payload.scope).split(/\s+/).includes("write"))
    throw failure("mdblist_insufficient_scope");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previousRefresh,
    expiresAt: Date.now() + seconds * 1000
  };
}

export const MdbListAccount = {
  configured() {
    return Boolean(MDBLIST_CLIENT_ID);
  },
  connected(profileId = ProfileManager.getActiveProfileId()) {
    return Boolean(read(String(profileId))?.tokens?.refreshToken);
  },
  user(profileId = ProfileManager.getActiveProfileId()) {
    return read(String(profileId))?.user || null;
  },
  scope() {
    const profileId = String(ProfileManager.getActiveProfileId());
    if (!read(profileId)?.generation)
      write(profileId, { generation: `${Date.now()}:${Math.random()}` });
    return {
      profileId,
      generation: read(profileId).generation,
      sessionGeneration,
      profileRevision: LocalStore.revision("activeProfileId"),
      profileVersion: ProfileManager.getProfileDataVersion(profileId)
    };
  },
  check(scope) {
    if (
      scope.sessionGeneration !== sessionGeneration ||
      scope.profileRevision !== LocalStore.revision("activeProfileId") ||
      scope.profileVersion !== ProfileManager.getProfileDataVersion(scope.profileId) ||
      String(ProfileManager.getActiveProfileId()) !== scope.profileId ||
      (read(scope.profileId)?.generation || null) !== scope.generation
    ) {
      throw failure("mdblist_scope_changed");
    }
  },
  async request(
    scope,
    path,
    { method = "GET", query = {}, body = null, form = null, accessToken = null } = {}
  ) {
    // One queue shares account rate limits across auth, lists and mutations.
    const run = async () => {
      this.check(scope);
      const limitKey = read(scope.profileId)?.user?.id
        ? `user:${read(scope.profileId).user.id}`
        : `${scope.profileId}:${scope.generation}`;
      if ((limits.get(limitKey) || 0) > Date.now())
        throw Object.assign(failure("mdblist_rate_limited", 429), {
          retryAfterMs: limits.get(limitKey) - Date.now()
        });
      if (!/^\/(?!\/)[^?#]*$/.test(path)) throw failure("mdblist_invalid_response");
      const base = new URL(MDBLIST_API_BASE_URL);
      if (
        base.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      )
        throw failure("mdblist_invalid_response");
      const url = new URL(path, base);
      Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      const headers = { Accept: "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
      else if (body != null) headers["Content-Type"] = "application/json";
      const { response, text } = await withRequestTimeout(async (signal) => {
        const response = await fetch(url.href, {
          method,
          headers,
          signal,
          redirect: "error",
          ...(form
            ? { body: new URLSearchParams(form).toString() }
            : body != null
              ? { body: JSON.stringify(body) }
              : {})
        });
        this.check(scope);
        return { response, text: response.status === 429 ? "" : await responseText(response) };
      }, 15000);
      this.check(scope);
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        const delay = /^\d+$/.test(retry || "")
          ? Number(retry) * 1000
          : Date.parse(retry || "") - Date.now();
        limits.set(limitKey, Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000));
        throw Object.assign(failure("mdblist_rate_limited", 429), {
          retryAfterMs: limits.get(limitKey) - Date.now()
        });
      }
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_) {
        if (response.ok) throw failure("mdblist_invalid_response");
        payload = null;
      }
      return { status: response.status, payload, headers: response.headers };
    };
    const task = requestQueue.then(run, run);
    requestQueue = task.catch(() => {});
    return task;
  },
  async start() {
    if (!this.configured()) throw failure("mdblist_missing_client");
    const scope = this.scope();
    const response = await this.request(scope, "/oauth/device-authorization/", {
      method: "POST",
      form: { client_id: MDBLIST_CLIENT_ID, scope: "write" }
    });
    if (response.status < 200 || response.status >= 300)
      throw failure("mdblist_unavailable", response.status);
    const p = response.payload;
    if (
      !p?.device_code ||
      !p.user_code ||
      !Number.isInteger(p.interval) ||
      p.interval < 1 ||
      p.interval > 3600 ||
      !(Number(p.expires_in) > 0) ||
      !Number.isSafeInteger(Date.now() + Number(p.expires_in) * 1000)
    )
      throw failure("mdblist_invalid_response");
    const uri = verificationUrl(p.verification_uri);
    const complete = new URL(uri);
    complete.searchParams.set("user_code", p.user_code);
    return {
      scope,
      deviceCode: p.device_code,
      userCode: p.user_code,
      url: uri,
      completeUrl: verificationUrl(p.verification_uri_complete || complete.href),
      interval: p.interval,
      expiresAt: Date.now() + Number(p.expires_in) * 1000,
      nextPollAt: Date.now() + p.interval * 1000
    };
  },
  async poll(session, isCurrent = () => true) {
    if (!isCurrent()) throw failure("mdblist_scope_changed");
    this.check(session.scope);
    if (Date.now() >= session.expiresAt) throw failure("mdblist_code_expired");
    if (Date.now() < session.nextPollAt) return false;
    session.nextPollAt = Date.now() + session.interval * 1000;
    const { status, payload } = await this.request(session.scope, "/oauth/token/", {
      method: "POST",
      form: {
        client_id: MDBLIST_CLIENT_ID,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: session.deviceCode,
        scope: "write"
      }
    });
    if (status >= 200 && status < 300) {
      if (!isCurrent()) throw failure("mdblist_scope_changed");
      this.check(session.scope);
      const savedTokens = tokens(payload);
      const generation = `${Date.now()}:${Math.random()}`;
      write(session.scope.profileId, { generation, tokens: savedTokens, user: null });
      const scope = { ...session.scope, generation };
      await this.refreshUser(scope);
      return true;
    }
    if (payload?.error === "authorization_pending") return false;
    if (payload?.error === "slow_down") {
      session.interval = Math.min(3600, session.interval + 5);
      session.nextPollAt = Date.now() + session.interval * 1000;
      return false;
    }
    throw failure(
      payload?.error === "expired_token"
        ? "mdblist_code_expired"
        : payload?.error === "access_denied"
          ? "mdblist_access_denied"
          : "mdblist_unavailable",
      status
    );
  },
  async authorization(scope, rejected = null) {
    this.check(scope);
    const key = `${scope.sessionGeneration}:${scope.profileId}:${scope.generation}:${scope.profileRevision}:${scope.profileVersion}`;
    if (refreshes.has(key)) return refreshes.get(key);
    const task = (async () => {
      const current = read(scope.profileId);
      if (!current?.tokens) throw failure("mdblist_authorization_revoked");
      if (
        (rejected && current.tokens.accessToken !== rejected) ||
        (!rejected && current.tokens.expiresAt > Date.now() + 60000)
      )
        return current.tokens.accessToken;
      const { status, payload } = await this.request(scope, "/oauth/token/", {
        method: "POST",
        form: {
          client_id: MDBLIST_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: current.tokens.refreshToken
        }
      });
      if (status < 200 || status >= 300) {
        if (["invalid_grant", "invalid_token"].includes(payload?.error))
          write(scope.profileId, { generation: `${Date.now()}:${Math.random()}` });
        throw failure("mdblist_authorization_revoked", status);
      }
      this.check(scope);
      const updated = tokens(payload, current.tokens.refreshToken);
      write(scope.profileId, { ...current, tokens: updated });
      return updated.accessToken;
    })();
    refreshes.set(key, task);
    try {
      return await task;
    } finally {
      if (refreshes.get(key) === task) refreshes.delete(key);
    }
  },
  async api(scope, path, options = {}) {
    let accessToken = await this.authorization(scope);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.request(scope, path, { ...options, accessToken });
      if (response.status === 401 && attempt === 0) {
        accessToken = await this.authorization(scope, accessToken);
        continue;
      }
      if (response.status === 401 && read(scope.profileId)?.tokens?.accessToken === accessToken)
        write(scope.profileId, { generation: `${Date.now()}:${Math.random()}` });
      if (response.status < 200 || response.status >= 300)
        throw failure(
          response.status === 401 ? "mdblist_authorization_revoked" : "mdblist_unavailable",
          response.status
        );
      return response;
    }
  },
  async refreshUser(scope = this.scope()) {
    const { payload } = await this.api(scope, "/user");
    if (!Number.isSafeInteger(payload?.id) || payload.id <= 0)
      throw failure("mdblist_invalid_response");
    this.check(scope);
    write(scope.profileId, {
      ...read(scope.profileId),
      user: { id: payload.id, name: String(payload.name || payload.username || "") }
    });
    return payload;
  },
  async disconnect() {
    const scope = this.scope();
    const previous = read(scope.profileId);
    write(scope.profileId, { generation: `${Date.now()}:${Math.random()}` });
    // Local deletion is immediate; credentials must never survive a reused profile slot.
    const cache = LocalStore.get("mdbListLibraries", {});
    delete cache[scope.profileId];
    LocalStore.set("mdbListLibraries", cache);
    const tracking = LocalStore.get("mdbListTracking", {});
    delete tracking[scope.profileId];
    LocalStore.set("mdbListTracking", tracking);
    const playback = LocalStore.get("mdbListTrackingPlayback", {});
    delete playback[scope.profileId];
    LocalStore.set("mdbListTrackingPlayback", playback);
    if (!previous?.tokens?.refreshToken) return true;
    try {
      const response = await this.request(this.scope(), "/oauth/revoke_token/", {
        method: "POST",
        form: {
          client_id: MDBLIST_CLIENT_ID,
          token: previous.tokens.refreshToken,
          token_type_hint: "refresh_token"
        }
      });
      return response.status >= 200 && response.status < 300;
    } catch (_) {
      return false;
    }
  }
};
