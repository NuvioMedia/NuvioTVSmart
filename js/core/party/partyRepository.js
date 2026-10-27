// Watch party session state, mirroring Android core/party/PartyRepository.kt.
import { AuthManager } from "../auth/authManager.js";
import { AuthState } from "../auth/authState.js";
import { SessionStore } from "../storage/sessionStore.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import { ProfileManager } from "../profile/profileManager.js";
import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";
import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";
import { RealtimeSocket, realtimeWebsocketUrl } from "../network/realtimeClient.js";
import { PartyApi } from "./partyApi.js";
import { PartyClock } from "./partyClock.js";
import { PartySync } from "./partySync.js";
import {
  PartyError,
  PartyEventType,
  PartyMemberStatus,
  canControlParty,
  compactJson,
  decodePartyMedia,
  decodePartyPlayback,
  decodePartyPresence,
  decodePartyStream,
  isPartyHost,
  isShareableStreamUrl,
  mediaKeyOf,
  normalizePartyCode,
  partyErrorOf,
  partyMember,
  sameJson
} from "./partyModels.js";

const DEFAULT_NAME = "Nuvio";
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const PERSIST_DELAY_MS = 1500;
const COORDINATOR_TICK_MS = 500;
const RESUME_GRACE_MS = 3000;
const WAIT_LIMIT_MS = 15000;
const CLOCK_SAMPLE_GAP_MS = 400;
const CLOCK_SAMPLES = 4;
const PRESENCE_DELAY_MS = 250;
const SIGNED_AVATAR_SECONDS = 24 * 60 * 60;

function createEmitter() {
  const listeners = new Set();
  return {
    emit(value) {
      [...listeners].forEach((listener) => {
        try {
          listener(value);
        } catch (error) {
          console.warn("[party] listener failed", error);
        }
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function createMutex() {
  let tail = Promise.resolve();
  return {
    withLock(task) {
      const run = tail.then(() => task());
      tail = run.catch(() => {});
      return run;
    }
  };
}

function storageObjectUrl() {
  return `${String(ServerConfigurationStore.getActive().backendUrl || "").replace(/\/+$/, "")}/storage/v1/object/`;
}

function withSafeAvatars(members) {
  const prefix = storageObjectUrl();
  return members.map((member) => ({
    ...member,
    avatar_url: member.avatar_url && member.avatar_url.startsWith(prefix) ? member.avatar_url : null
  }));
}

function withMedia(party, media) {
  return { ...party, media, mediaKey: mediaKeyOf(media) };
}

function encodePresence(presence) {
  return compactJson(presence);
}

function encodePlayback(playback) {
  return compactJson(playback);
}

function stringField(payload, key) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

async function activeProfile() {
  const activeId = String(ProfileManager.getActiveProfileId() || "1");
  const profiles = await ProfileManager.getProfiles().catch(() => []);
  return (
    profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === activeId) ||
    null
  );
}

async function signedMemberAvatarUrl(storagePath) {
  const { backendUrl, publishableKey } = ServerConfigurationStore.getActive();
  const { httpRequest } = await import("../network/httpClient.js");
  const path = String(storagePath || "")
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const response = await httpRequest(
    `${backendUrl}/storage/v1/object/sign/membership-profile-avatars/${path}`,
    {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      includeSessionAuth: true,
      body: JSON.stringify({ expiresIn: SIGNED_AVATAR_SECONDS })
    }
  );
  const signed = String(response?.signedURL || response?.signedUrl || "");
  if (!signed) return null;
  return `${String(backendUrl).replace(/\/+$/, "")}/storage/v1${signed.startsWith("/") ? signed : `/${signed}`}`;
}

/** Android AvatarRepository.shareableImageUrl: only backend storage URLs other members can load. */
async function shareableImageUrl(profile) {
  if (!profile) return null;
  const prefix = storageObjectUrl();
  const direct = String(profile.avatarUrl || "").trim();
  if (direct) return direct.startsWith(prefix) ? direct : null;
  const avatarId = String(profile.avatarId || "").trim();
  if (!avatarId) return null;
  const standard = AvatarRepository.getCachedAvatarCatalog(false).find(
    (avatar) => avatar.id === avatarId
  );
  if (standard)
    return standard.imageUrl && standard.imageUrl.startsWith(prefix) ? standard.imageUrl : null;
  const member = AvatarRepository.getCachedAvatarCatalog(true).find(
    (avatar) => avatar.id === avatarId
  );
  if (!member?.storagePath) return null;
  try {
    return await signedMemberAvatarUrl(member.storagePath);
  } catch (error) {
    console.warn("[party] Unable to share supporter avatar", error);
    return null;
  }
}

export function createPartyRepository({
  api = PartyApi,
  clock = new PartyClock(),
  createSocket = () => {
    const { backendUrl, publishableKey } = ServerConfigurationStore.getActive();
    return new RealtimeSocket({
      url: realtimeWebsocketUrl(backendUrl, publishableKey),
      getAccessToken: async () => {
        if (AuthManager.isAccessTokenExpired?.()) await AuthManager.refreshSessionIfNeeded?.();
        return SessionStore.accessToken || null;
      }
    });
  },
  auth = AuthManager,
  deviceId = () => getSyncClientId(),
  identity: identityOverride = null,
  serverCapable = () => ServerConfigurationStore.getActive().capabilities?.watchParty === true,
  isCustomServer = () => ServerConfigurationStore.getActive().isCustom === true,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  const mutex = createMutex();
  const stateEmitter = createEmitter();
  const playbackEmitter = createEmitter();
  const eventsEmitter = createEmitter();
  const noticesEmitter = createEmitter();
  const sharedStreamEmitter = createEmitter();
  const availableEmitter = createEmitter();

  let state = { party: null, busy: false };
  let playback = null;
  let sharedStream = null;
  let available = serverCapable();
  let socket = null;
  let channel = null;
  let channelCleanup = [];
  let session = null;
  let localPresence = null;
  let waitStartedAt = null;
  let resumedAt = null;
  const ignoredWaiting = new Set();
  let rejoining = false;

  function isAuthenticated() {
    return auth.getAuthState?.() === AuthState.AUTHENTICATED;
  }

  function setState(next) {
    state = next;
    stateEmitter.emit(state);
  }

  function updateParty(transform) {
    if (!state.party) return;
    setState({ ...state, party: transform(state.party) });
  }

  function setPlayback(next) {
    playback = next;
    playbackEmitter.emit(playback);
  }

  function setSharedStream(next) {
    if (sameJson(next, sharedStream)) return;
    sharedStream = next;
    sharedStreamEmitter.emit(sharedStream);
  }

  function setAvailable(next) {
    if (available === next) return;
    available = next;
    availableEmitter.emit(available);
  }

  async function runRemote(task) {
    try {
      return await task();
    } catch (error) {
      console.warn("[party] Watch party call failed", error);
      return null;
    }
  }

  function sessionActive(current) {
    return Boolean(current) && session === current && !current.cancelled;
  }

  function later(current, ms, task) {
    if (!sessionActive(current)) return null;
    const id = setTimer(() => {
      current.timers.delete(id);
      if (sessionActive(current)) task();
    }, ms);
    current.timers.add(id);
    return id;
  }

  function cancelTimer(current, id) {
    if (id == null || !current) return;
    clearTimer(id);
    current.timers.delete(id);
  }

  async function identity() {
    if (identityOverride) return identityOverride();
    const profile = await activeProfile();
    const name = String(profile?.name || "").trim();
    const avatarUrl = await shareableImageUrl(profile);
    const color = String(profile?.avatarColorHex || "");
    return {
      deviceId: deviceId(),
      displayName: name ? name.slice(0, 40) : DEFAULT_NAME,
      avatarUrl:
        avatarUrl && avatarUrl.startsWith("https://") && avatarUrl.length <= 512 ? avatarUrl : null,
      avatarColor: COLOR_PATTERN.test(color) ? color : null,
      profileIndex: profile ? Number(profile.id ?? profile.profileIndex) : null
    };
  }

  function toActiveParty(snapshot) {
    const info = snapshot.party;
    const self = snapshot.member_id;
    if (!info || !self) return null;
    const party = {
      id: info.id,
      code: info.code,
      memberId: self,
      hostMemberId: info.host_member_id,
      members: withSafeAvatars(snapshot.members),
      presence: {},
      maxMembers: info.max_members,
      connected: false,
      hostOnly: info.host_only,
      sharing: false,
      inviteLink: isCustomServer()
        ? `nuvio://party/${info.code}`
        : `https://nuvio.tv/party/${info.code}`
    };
    return withMedia(party, info.media);
  }

  function ownPresence(party) {
    return (
      localPresence || {
        member_id: party.memberId,
        status: PartyMemberStatus.Browsing,
        media_key: null,
        behind_ms: null
      }
    );
  }

  function send(event, payload) {
    try {
      channel?.send(event, payload);
    } catch (error) {
      console.warn("[party] broadcast failed", error);
    }
  }

  function startSession(party, initialPlayback) {
    const current = {
      cancelled: false,
      timers: new Set(),
      persistTimer: null,
      presenceTimer: null
    };
    session = current;
    localPresence = null;
    ignoredWaiting.clear();
    waitStartedAt = null;
    resumedAt = null;
    setPlayback(
      initialPlayback &&
        (initialPlayback.media_key == null || initialPlayback.media_key === party.mediaKey)
        ? initialPlayback
        : null
    );
    setState({ party, busy: state.busy });
    try {
      socket = socket || createSocket();
      channel = socket.channel(`watch-party:${party.id}`, {
        presenceKey: party.memberId,
        isPrivate: true
      });
      channelCleanup = [
        channel.onBroadcast((event, payload) => {
          if (sessionActive(current)) void onMessage(event, payload);
        }),
        channel.onPresence((joins, leaves) => {
          if (sessionActive(current)) onPresence(joins, leaves, current);
        }),
        channel.onStatus((connected) => {
          if (sessionActive(current)) onConnection(connected);
        })
      ];
      void channel.subscribe();
    } catch (error) {
      console.warn("[party] Watch party channel failed", error);
    }
    scheduleHeartbeat(current);
    refineClock(current, CLOCK_SAMPLES);
    scheduleCoordinator(current);
  }

  function stopSession() {
    const current = session;
    if (current) {
      current.cancelled = true;
      current.timers.forEach((id) => clearTimer(id));
      current.timers.clear();
    }
    session = null;
    channelCleanup.forEach((cleanup) => cleanup());
    channelCleanup = [];
    if (channel && socket) {
      try {
        socket.removeChannel(channel);
      } catch (_) {}
    }
    channel = null;
    if (socket && !socket.channels?.size) socket = null;
    localPresence = null;
    setPlayback(null);
    setSharedStream(null);
    setState({ party: null, busy: state.busy });
  }

  function finish(eventType) {
    const partyId = state.party?.id;
    if (!partyId) return;
    void mutex.withLock(() => {
      if (state.party?.id !== partyId) return;
      stopSession();
      eventsEmitter.emit({ type: eventType });
    });
  }

  function onConnection(connected) {
    if (!connected) {
      updateParty((current) => {
        const presence = {};
        if (current.presence[current.memberId])
          presence[current.memberId] = current.presence[current.memberId];
        return { ...current, connected: false, presence };
      });
      return;
    }
    updateParty((current) => ({ ...current, connected: true }));
    const party = state.party;
    if (!party) return;
    const presence = encodePresence(ownPresence(party));
    try {
      channel?.track(presence);
    } catch (_) {}
    send("status", presence);
    if (playback) send("state", encodePlayback(playback));
    if (isPartyHost(party) && party.sharing && sharedStream) sendStream(sharedStream);
    requestState(party);
  }

  async function onMessage(event, payload) {
    const party = state.party;
    if (!party) return;
    switch (event) {
      case "state": {
        const decoded = decodePartyPlayback(payload);
        if (decoded) accept(decoded);
        break;
      }
      case "state_request": {
        if (stringField(payload, "member_id") === party.memberId) return;
        send("status", encodePresence(ownPresence(party)));
        if (isPartyHost(party) && party.sharing && sharedStream) sendStream(sharedStream);
        if (playback) send("state", encodePlayback(playback));
        break;
      }
      case "status": {
        const decoded = decodePartyPresence(payload);
        if (decoded) applyStatus(decoded);
        break;
      }
      case "control": {
        const hostOnly = payload?.host_only;
        if (typeof hostOnly !== "boolean" || party.hostOnly === hostOnly) return;
        updateParty((current) => ({ ...current, hostOnly }));
        if (!isPartyHost(party))
          eventsEmitter.emit({ type: PartyEventType.ControlChanged, hostOnly });
        break;
      }
      case "member_joined":
        await refreshMembers(stringField(payload, "member_id"));
        break;
      case "member_left":
        onMemberLeft(
          stringField(payload, "member_id"),
          stringField(payload, "reason"),
          stringField(payload, "host_member_id")
        );
        break;
      case "ended":
        if (stringField(payload, "reason") === "disabled") setAvailable(false);
        finish(PartyEventType.Ended);
        break;
      case "media": {
        const media = decodePartyMedia(payload?.media);
        if (!media) return;
        const nextPlayback =
          payload?.playback == null ? null : decodePartyPlayback(payload.playback);
        applyMedia(media, nextPlayback);
        break;
      }
      case "stream": {
        if (isPartyHost(party) || stringField(payload, "member_id") !== party.hostMemberId) return;
        const stream = payload?.stream == null ? null : decodePartyStream(payload.stream);
        setSharedStream(stream && isShareableStreamUrl(stream.url) ? stream : null);
        break;
      }
      default:
        break;
    }
  }

  function onPresence(joins, leaves, current) {
    const party = state.party;
    if (!party) return;
    const presence = { ...party.presence };
    const left = Object.keys(leaves).filter((key) => key !== party.memberId && !(key in joins));
    left.forEach((key) => delete presence[key]);
    Object.keys(joins).forEach((key) => {
      if (key === party.memberId || key in presence) return;
      const decoded = decodePartyPresence({ member_id: key, ...joins[key] }) || {
        member_id: key,
        status: PartyMemberStatus.Browsing,
        media_key: null,
        behind_ms: null
      };
      presence[key] = { ...decoded, member_id: key };
      if (decoded.status === PartyMemberStatus.Ready) ignoredWaiting.delete(key);
    });
    updateParty((existing) => ({ ...existing, presence }));
    if (left.length && sessionActive(current)) requestState(party);
  }

  function requestState(party) {
    send("state_request", { member_id: party.memberId });
  }

  function applyStatus(status) {
    const party = state.party;
    if (!party || status.member_id === party.memberId) return;
    if (status.status === PartyMemberStatus.Ready) ignoredWaiting.delete(status.member_id);
    updateParty((current) => ({
      ...current,
      presence: { ...current.presence, [status.member_id]: status }
    }));
  }

  function onMemberLeft(memberId, reason, hostMemberId) {
    const party = state.party;
    if (!party || memberId == null) return;
    if (memberId === party.memberId) {
      if (reason === "removed") finish(PartyEventType.Removed);
      else rejoinOrFinish();
      return;
    }
    const name = partyMember(party, memberId)?.display_name;
    if (memberId === party.hostMemberId) setSharedStream(null);
    updateParty((current) => {
      const presence = { ...current.presence };
      delete presence[memberId];
      return {
        ...current,
        members: current.members.filter((member) => member.id !== memberId),
        presence,
        hostMemberId: hostMemberId ?? current.hostMemberId
      };
    });
    ignoredWaiting.delete(memberId);
    if (name != null) eventsEmitter.emit({ type: PartyEventType.MemberLeft, name });
  }

  async function refreshMembers(announceMemberId) {
    const party = state.party;
    if (!party) return;
    const snapshot = await runRemote(() => api.heartbeat(party.id, deviceId()));
    if (!snapshot || state.party?.id !== party.id) return;
    applySnapshot(snapshot);
    const name = partyMember(state.party, announceMemberId)?.display_name;
    if (announceMemberId != null && announceMemberId !== party.memberId && name != null) {
      eventsEmitter.emit({ type: PartyEventType.MemberJoined, name });
    }
  }

  function applySnapshot(snapshot) {
    if (snapshot.error != null) {
      if (snapshot.error === "not_member") rejoinOrFinish();
      else if (snapshot.error === "party_ended") finish(PartyEventType.Ended);
      return;
    }
    const info = snapshot.party;
    if (!info) return;
    const members = withSafeAvatars(snapshot.members);
    updateParty((current) => {
      const presence = {};
      Object.keys(current.presence).forEach((key) => {
        if (members.some((member) => member.id === key)) presence[key] = current.presence[key];
      });
      return {
        ...current,
        members,
        hostMemberId: info.host_member_id,
        maxMembers: info.max_members,
        hostOnly: info.host_only,
        presence
      };
    });
    if (mediaKeyOf(info.media) !== state.party?.mediaKey) applyMedia(info.media, info.playback);
    if (info.playback) accept(info.playback);
  }

  function applyMedia(media, nextPlayback) {
    const party = state.party;
    if (!party) return;
    const key = mediaKeyOf(media);
    const changed = key !== party.mediaKey;
    updateParty((current) => withMedia(current, media));
    if (changed) {
      setPlayback(
        nextPlayback && (nextPlayback.media_key == null || nextPlayback.media_key === key)
          ? nextPlayback
          : null
      );
      if (sharedStream?.media_key !== key) setSharedStream(null);
      ignoredWaiting.clear();
      waitStartedAt = null;
      eventsEmitter.emit({ type: PartyEventType.MediaChanged, media });
    } else if (nextPlayback) {
      accept(nextPlayback);
    }
  }

  function accept(candidate) {
    const party = state.party;
    if (!party) return;
    if (candidate.media_key != null && candidate.media_key !== party.mediaKey) return;
    if (party.hostOnly && candidate.member_id !== party.hostMemberId) return;
    const current = playback;
    if (!PartySync.isNewer(candidate, current)) return;
    if (current && current.paused && !candidate.paused) {
      resumedAt = clock.mark();
      if (current.waiting)
        PartySync.waitingMemberIds(party, new Set()).forEach((id) => ignoredWaiting.add(id));
    }
    setPlayback(candidate);
    if (candidate.member_id === party.memberId) return;
    const action = PartySync.actionOf(current, candidate);
    if (!action) return;
    const name = partyMember(party, candidate.member_id)?.display_name;
    if (name == null) return;
    noticesEmitter.emit({ name, action, positionMs: candidate.position_ms, rate: candidate.rate });
  }

  function nextPlayback(party, paused, positionMs, rate, waiting, mediaKey, at) {
    return {
      seq: (playback?.seq ?? 0) + 1,
      member_id: party.memberId,
      paused,
      position_ms: Math.max(0, Math.trunc(positionMs)),
      rate: Math.min(4, Math.max(0.25, rate)),
      at,
      media_key: mediaKey,
      waiting
    };
  }

  function publish(paused, positionMs, rate, waiting, at = clock.nowMs()) {
    const party = state.party;
    if (!party || !canControlParty(party)) return;
    const current = playback;
    const next = nextPlayback(party, paused, positionMs, rate, waiting, party.mediaKey, at);
    if (current && current.paused && !paused) {
      resumedAt = clock.mark();
      if (current.waiting && !waiting)
        PartySync.waitingMemberIds(party, new Set()).forEach((id) => ignoredWaiting.add(id));
    }
    if (!waiting) waitStartedAt = null;
    setPlayback(next);
    send("state", encodePlayback(next));
    schedulePersist();
  }

  function schedulePersist() {
    const current = session;
    if (!current) return;
    cancelTimer(current, current.persistTimer);
    current.persistTimer = later(current, PERSIST_DELAY_MS, async () => {
      current.persistTimer = null;
      const party = state.party;
      const latest = playback;
      if (!party || !latest) return;
      const snapshot = await runRemote(() => api.update(party.id, deviceId(), null, latest));
      if (snapshot && sessionActive(current)) applySnapshot(snapshot);
    });
  }

  function scheduleHeartbeat(current) {
    later(current, HEARTBEAT_INTERVAL_MS, async () => {
      const party = state.party;
      if (!party) return;
      const snapshot = await runRemote(() => api.heartbeat(party.id, deviceId()));
      if (snapshot && sessionActive(current)) applySnapshot(snapshot);
      scheduleHeartbeat(current);
    });
  }

  function refineClock(current, remaining) {
    if (remaining <= 0) return;
    later(current, CLOCK_SAMPLE_GAP_MS, async () => {
      const sentAt = clock.mark();
      const serverMs = await api.clock().catch(() => null);
      if (serverMs != null && sessionActive(current)) clock.addSample(serverMs, sentAt);
      refineClock(current, remaining - 1);
    });
  }

  function scheduleCoordinator(current) {
    later(current, COORDINATOR_TICK_MS, () => {
      coordinatorTick();
      scheduleCoordinator(current);
    });
  }

  function coordinatorTick() {
    const party = state.party;
    if (!party || !party.connected) return;
    if (PartySync.coordinatorId(party) !== party.memberId) {
      waitStartedAt = null;
      return;
    }
    const latest = playback;
    if (!latest) return;
    if (latest.media_key != null && latest.media_key !== party.mediaKey) return;
    const waiting = PartySync.waitingMemberIds(party, ignoredWaiting);
    if (!latest.paused) {
      const graceOver = resumedAt == null || clock.elapsedSince(resumedAt) > RESUME_GRACE_MS;
      if (waiting.length && graceOver) {
        const position = PartySync.expectedPositionMs(latest, clock.nowMs());
        publish(true, position, latest.rate, true);
        waitStartedAt = clock.mark();
      }
    } else if (latest.waiting) {
      if (waitStartedAt == null) waitStartedAt = clock.mark();
      if (!waiting.length || clock.elapsedSince(waitStartedAt) > WAIT_LIMIT_MS) {
        waiting.forEach((id) => ignoredWaiting.add(id));
        publish(false, latest.position_ms, latest.rate, false);
      }
    }
  }

  function rejoinOrFinish() {
    const party = state.party;
    if (!party || rejoining) return;
    rejoining = true;
    void mutex
      .withLock(async () => {
        if (state.party?.id !== party.id) return;
        const snapshot = await runRemote(async () => api.join(party.code, await identity()));
        const rejoined = snapshot && snapshot.error == null ? toActiveParty(snapshot) : null;
        if (state.party?.id !== party.id) return;
        if (!rejoined) {
          stopSession();
          eventsEmitter.emit({
            type: snapshot?.error === "removed" ? PartyEventType.Removed : PartyEventType.Ended
          });
          return;
        }
        if (rejoined.memberId === party.memberId) {
          updateParty((current) => ({
            ...current,
            members: rejoined.members,
            hostMemberId: rejoined.hostMemberId
          }));
          return;
        }
        const previousPlayback = playback;
        stopSession();
        startSession(rejoined, previousPlayback);
      })
      .finally(() => {
        rejoining = false;
      });
  }

  function sendStream(stream) {
    const party = state.party;
    if (!party) return;
    setSharedStream(stream);
    send("stream", { member_id: party.memberId, stream: stream ? compactJson(stream) : null });
  }

  async function start(request) {
    if (!available) return PartyError.Unavailable;
    if (!isAuthenticated()) return PartyError.SignInRequired;
    return mutex.withLock(async () => {
      setState({ ...state, busy: true });
      try {
        const sentAt = clock.mark();
        const snapshot = await request(await identity());
        const error = partyErrorOf(snapshot.error);
        if (error) {
          if (error === PartyError.Unavailable) setAvailable(false);
          return error;
        }
        const party = toActiveParty(snapshot);
        if (!party) return PartyError.Network;
        stopSession();
        clock.reset();
        if (snapshot.server_time_ms != null) clock.addSample(snapshot.server_time_ms, sentAt);
        startSession(party, snapshot.party?.playback || null);
        return null;
      } catch (error) {
        console.warn("[party] Watch party request failed", error);
        return PartyError.Network;
      } finally {
        setState({ ...state, busy: false });
      }
    });
  }

  auth.subscribe?.((authState) => {
    if (authState !== AuthState.AUTHENTICATED && authState !== AuthState.LOADING && state.party) {
      void mutex.withLock(() => stopSession());
    }
  });

  return {
    getState: () => state,
    getPlayback: () => playback,
    getSharedStream: () => sharedStream,
    isAvailable: () => available,
    canUse: () => available && isAuthenticated(),
    nowMs: () => clock.nowMs(),
    subscribeState: (listener) => stateEmitter.subscribe(listener),
    subscribePlayback: (listener) => playbackEmitter.subscribe(listener),
    subscribeEvents: (listener) => eventsEmitter.subscribe(listener),
    subscribeNotices: (listener) => noticesEmitter.subscribe(listener),
    subscribeSharedStream: (listener) => sharedStreamEmitter.subscribe(listener),
    subscribeAvailable: (listener) => availableEmitter.subscribe(listener),

    async refreshAvailability() {
      if (!serverCapable()) {
        setAvailable(false);
        return;
      }
      const enabled = await runRemote(() => api.enabled());
      if (enabled == null) return;
      setAvailable(enabled);
      if (!enabled) finish(PartyEventType.Ended);
    },

    create(media) {
      return start((who) => api.create(who, media, null));
    },

    join(code) {
      return start((who) => api.join(normalizePartyCode(code), who));
    },

    async preview(code) {
      try {
        return await api.preview(normalizePartyCode(code));
      } catch (error) {
        console.warn("[party] Watch party preview failed", error);
        return { media: null, host: null, members: 0, max_members: 0, error: "network" };
      }
    },

    leave() {
      return mutex.withLock(async () => {
        const party = state.party;
        if (!party) return;
        stopSession();
        await runRemote(() => api.leave(party.id, deviceId()));
      });
    },

    end() {
      return mutex.withLock(async () => {
        const party = state.party;
        if (!party) return;
        const result = await runRemote(() => api.end(party.id, deviceId()));
        if (result && result.error == null && state.party?.id === party.id) stopSession();
      });
    },

    async removeMember(memberId) {
      const party = state.party;
      if (!party) return;
      const snapshot = await runRemote(() => api.removeMember(party.id, deviceId(), memberId));
      if (snapshot && state.party?.id === party.id) applySnapshot(snapshot);
    },

    async setHostOnly(enabled) {
      const party = state.party;
      if (!party || !isPartyHost(party) || party.hostOnly === enabled) return;
      updateParty((current) => ({ ...current, hostOnly: enabled }));
      const snapshot = await runRemote(() => api.setHostOnly(party.id, deviceId(), enabled));
      if (state.party?.id !== party.id) return;
      if (!snapshot?.party) updateParty((current) => ({ ...current, hostOnly: party.hostOnly }));
      if (snapshot) applySnapshot(snapshot);
    },

    setSharing(enabled) {
      const party = state.party;
      if (!party || !isPartyHost(party) || party.sharing === enabled) return;
      updateParty((current) => ({ ...current, sharing: enabled }));
      if (!enabled) sendStream(null);
    },

    shareStream(stream) {
      const party = state.party;
      if (!party || !isPartyHost(party) || !party.sharing || sameJson(stream, sharedStream)) return;
      sendStream(stream);
    },

    publishPlayback(paused, positionMs, rate) {
      publish(paused, positionMs, rate, false, clock.nowMs());
    },

    async publishMedia(media, positionMs) {
      const party = state.party;
      if (!party || sameJson(media, party.media) || !isPartyHost(party)) return;
      const key = mediaKeyOf(media);
      const sameContent = key === party.mediaKey;
      updateParty((current) => withMedia(current, media));
      let next = playback;
      if (!sameContent) {
        next = nextPlayback(party, false, positionMs, 1, false, key, clock.nowMs());
        setPlayback(next);
      }
      const current = session;
      if (current) {
        cancelTimer(current, current.persistTimer);
        current.persistTimer = null;
      }
      const snapshot = await runRemote(() => api.update(party.id, deviceId(), media, next));
      if (snapshot && sessionActive(current)) applySnapshot(snapshot);
    },

    setLocalStatus(status, mediaKey, behindMs = null) {
      const party = state.party;
      if (!party) return;
      const next = {
        member_id: party.memberId,
        status,
        media_key: mediaKey ?? null,
        behind_ms: behindMs ?? null
      };
      if (sameJson(next, localPresence)) return;
      localPresence = next;
      if (status === PartyMemberStatus.Ready) ignoredWaiting.delete(party.memberId);
      updateParty((current) => ({
        ...current,
        presence: { ...current.presence, [party.memberId]: next }
      }));
      const current = session;
      if (!current) return;
      cancelTimer(current, current.presenceTimer);
      current.presenceTimer = later(current, PRESENCE_DELAY_MS, () => {
        current.presenceTimer = null;
        send("status", encodePresence(next));
      });
    },

    async getProfile() {
      const profile = await activeProfile();
      let imageUrl = String(profile?.avatarUrl || "").trim() || null;
      if (!imageUrl && profile?.avatarId) {
        const memberAccess = MemberAccessRepository.getCachedAccess?.() || null;
        const hasMemberAvatars =
          MemberAccessRepository.hasEntitlement?.(memberAccess, "PROFILE_AVATARS") === true;
        const catalog = await AvatarRepository.getAvatarCatalog(hasMemberAvatars).catch(() => []);
        imageUrl = AvatarRepository.getAvatarImageUrl(profile.avatarId, catalog);
      }
      return {
        name: String(profile?.name || ""),
        imageUrl: imageUrl || null,
        color: profile?.avatarColorHex || null
      };
    }
  };
}

export const PartyRepository = createPartyRepository();
