const DEFAULT_COMPLETED_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 12;
const EMPTY_RESULT = Object.freeze({ status: "success", data: [] });

function normalizeKey(key = {}) {
  return {
    profileId: String(key.profileId ?? "1"),
    type: String(key.type || "").toLowerCase(),
    videoId: String(key.videoId || ""),
    season: key.season == null ? null : Number(key.season),
    episode: key.episode == null ? null : Number(key.episode),
    searchMode: String(key.searchMode || ""),
    sourceConfiguration: String(key.sourceConfiguration || "")
  };
}

function keyString(key) {
  const normalized = normalizeKey(key);
  return JSON.stringify([
    normalized.profileId,
    normalized.type,
    normalized.videoId,
    normalized.season,
    normalized.episode,
    normalized.searchMode,
    normalized.sourceConfiguration
  ]);
}

function normalizeResult(result) {
  if (!result || typeof result !== "object") {
    return EMPTY_RESULT;
  }
  if (result.status === "success") {
    return {
      ...result,
      data: Array.isArray(result.data) ? result.data : []
    };
  }
  return {
    ...result,
    status: result.status || "error"
  };
}

function hasSuccessfulData(result) {
  return result?.status === "success" && Array.isArray(result.data) && result.data.length > 0;
}

function errorResult(error) {
  return {
    status: "error",
    error: String(error?.message || error || "Failed to fetch streams")
  };
}

function safeNotify(callback, value, message) {
  if (typeof callback !== "function") return;
  try {
    callback(value);
  } catch (error) {
    console.warn(message, error);
  }
}

/**
 * Keeps source searches alive independently of a single screen and shares an
 * in-flight/completed result across the stream route and the player source
 * panel. This is the JavaScript equivalent of Android's
 * StreamSearchSessionCache: profile/source configuration are part of the key,
 * failed-only sessions are not retained, and completed entries expire quickly.
 */
export class StreamSearchSessionCache {
  constructor({
    now = () => Date.now(),
    completedTtlMs = DEFAULT_COMPLETED_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES
  } = {}) {
    this.now = typeof now === "function" ? now : () => Date.now();
    this.completedTtlMs = Math.max(0, Number(completedTtlMs) || DEFAULT_COMPLETED_TTL_MS);
    this.maxEntries = Math.max(1, Math.trunc(Number(maxEntries) || DEFAULT_MAX_ENTRIES));
    this.sessions = new Map();
  }

  observe(
    key,
    { forceRefresh = false, signal = null, onAddon = null, onChunk = null, producer } = {}
  ) {
    if (signal?.aborted) {
      return Promise.resolve(EMPTY_RESULT);
    }
    if (typeof producer !== "function") {
      return Promise.resolve(errorResult(new Error("Stream search producer is unavailable")));
    }

    const normalizedKey = normalizeKey(key);
    const selected = this.acquire(normalizedKey, Boolean(forceRefresh), producer);
    const subscriber = { onAddon, onChunk };

    if (selected.completed) {
      this.replayCompleted(selected, subscriber);
      return Promise.resolve(selected.result || EMPTY_RESULT);
    }

    selected.subscribers.add(subscriber);
    this.replayInFlight(selected, subscriber);
    const removeSubscriber = () => selected.subscribers.delete(subscriber);
    let resolveAborted;
    const aborted =
      signal && typeof signal.addEventListener === "function"
        ? new Promise((resolve) => {
            resolveAborted = resolve;
          })
        : null;
    const abortSubscriber = () => {
      removeSubscriber();
      resolveAborted?.(EMPTY_RESULT);
    };
    signal?.addEventListener?.("abort", abortSubscriber, { once: true });

    const observed = aborted ? Promise.race([selected.promise, aborted]) : selected.promise;
    return observed.finally(() => {
      signal?.removeEventListener?.("abort", abortSubscriber);
      removeSubscriber();
    });
  }

  acquire(key, forceRefresh, producer) {
    this.removeExpired();
    this.removeObsolete(key);
    const id = keyString(key);
    if (forceRefresh) {
      const previous = this.sessions.get(id);
      if (previous) {
        this.sessions.delete(id);
        this.invalidate(previous);
      }
    } else {
      const existing = this.sessions.get(id);
      if (existing && !existing.invalidated) {
        this.touch(id, existing);
        return existing;
      }
    }

    const session = this.createSession(key, producer);
    this.sessions.set(id, session);
    this.trimToSize();
    return session;
  }

  createSession(key, producer) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const session = {
      key: normalizeKey(key),
      controller,
      subscribers: new Set(),
      addons: [],
      chunks: [],
      completed: false,
      invalidated: false,
      result: null,
      lastSuccessfulResult: null,
      completedAt: null,
      settled: false,
      resolve: null,
      promise: null
    };
    session.promise = new Promise((resolve) => {
      session.resolve = resolve;
    });

    Promise.resolve()
      .then(() =>
        producer({
          signal: controller?.signal || null,
          emitAddon: (addon) => this.emitAddon(session, addon),
          emitChunk: (chunk) => this.emitChunk(session, chunk),
          emitResult: (result) => this.rememberResult(session, result)
        })
      )
      .then(
        (result) => this.complete(session, normalizeResult(result)),
        (error) => this.complete(session, errorResult(error))
      );
    return session;
  }

  emitAddon(session, addon) {
    if (session.invalidated || !addon) return;
    session.addons.push(addon);
    if (session.addons.length > 512) session.addons.shift();
    session.subscribers.forEach((subscriber) =>
      safeNotify(subscriber.onAddon, addon, "Stream addon callback failed")
    );
  }

  emitChunk(session, chunk) {
    if (session.invalidated || !chunk || chunk.status !== "success") return;
    const data = Array.isArray(chunk.data) ? chunk.data : [];
    if (!data.length) return;
    const replayable = { ...chunk, data: [...data] };
    session.chunks.push(replayable);
    if (session.chunks.length > 512) session.chunks.shift();
    session.subscribers.forEach((subscriber) =>
      safeNotify(subscriber.onChunk, replayable, "Stream chunk callback failed")
    );
  }

  rememberResult(session, result) {
    const normalized = normalizeResult(result);
    if (!hasSuccessfulData(normalized)) return;
    session.lastSuccessfulResult = {
      ...normalized,
      data: [...normalized.data]
    };
  }

  replayInFlight(session, subscriber) {
    session.addons.forEach((addon) =>
      safeNotify(subscriber.onAddon, addon, "Stream addon callback failed")
    );
    session.chunks.forEach((chunk) =>
      safeNotify(subscriber.onChunk, chunk, "Stream chunk callback failed")
    );
  }

  replayCompleted(session, subscriber) {
    session.addons.forEach((addon) =>
      safeNotify(subscriber.onAddon, addon, "Stream addon callback failed")
    );
    const result = session.result || EMPTY_RESULT;
    if (hasSuccessfulData(result)) {
      safeNotify(
        subscriber.onChunk,
        { ...result, data: [...result.data] },
        "Stream chunk callback failed"
      );
    }
  }

  complete(session, result) {
    if (session.settled || session.invalidated) return;
    session.settled = true;
    session.completed = true;
    const completedResult = hasSuccessfulData(result)
      ? result
      : session.lastSuccessfulResult || result;
    session.result = completedResult;
    session.resolve(completedResult);
    if (hasSuccessfulData(completedResult)) {
      session.completedAt = this.now();
      return;
    }
    const id = keyString(session.key);
    if (this.sessions.get(id) === session) {
      this.sessions.delete(id);
    }
  }

  invalidate(session) {
    if (session.settled) return;
    session.invalidated = true;
    session.completed = true;
    session.settled = true;
    session.result = EMPTY_RESULT;
    session.resolve(EMPTY_RESULT);
    try {
      session.controller?.abort?.();
    } catch (_) {
      // Abort is best effort; the producer result is ignored after invalidation.
    }
  }

  removeObsolete(requestedKey) {
    const normalized = normalizeKey(requestedKey);
    [...this.sessions.entries()].forEach(([id, session]) => {
      const existing = session.key;
      const otherProfile = existing.profileId !== normalized.profileId;
      const sameMedia =
        existing.profileId === normalized.profileId &&
        existing.type === normalized.type &&
        existing.videoId === normalized.videoId &&
        existing.season === normalized.season &&
        existing.episode === normalized.episode;
      const sourceChanged =
        sameMedia && existing.sourceConfiguration !== normalized.sourceConfiguration;
      if (otherProfile || sourceChanged) {
        this.sessions.delete(id);
        this.invalidate(session);
      }
    });
  }

  removeExpired() {
    const now = this.now();
    [...this.sessions.entries()].forEach(([id, session]) => {
      if (session.completedAt != null && now - session.completedAt >= this.completedTtlMs) {
        this.sessions.delete(id);
        this.invalidate(session);
      }
    });
  }

  touch(id, session) {
    this.sessions.delete(id);
    this.sessions.set(id, session);
  }

  trimToSize() {
    while (this.sessions.size > this.maxEntries) {
      const first = this.sessions.entries().next().value;
      if (!first) return;
      const [id, session] = first;
      this.sessions.delete(id);
      this.invalidate(session);
    }
  }

  clear() {
    [...this.sessions.values()].forEach((session) => this.invalidate(session));
    this.sessions.clear();
  }

  get size() {
    return this.sessions.size;
  }
}
