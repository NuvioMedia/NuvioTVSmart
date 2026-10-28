// Watch party parity with Android PartySyncTest, PartyStreamTest,
// RealtimeSocketFactoryTest and PartyRepository behaviour.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

const models = await import("../js/core/party/partyModels.js");
const { PartySync, PartyCorrectionType, OwnSeekType } =
  await import("../js/core/party/partySync.js");
const { PartyClock } = await import("../js/core/party/partyClock.js");
const { RealtimeSocket, realtimeUrl, realtimeWebsocketUrl } =
  await import("../js/core/network/realtimeClient.js");
const { createPartyRepository } = await import("../js/core/party/partyRepository.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { PartyAction, PartyMemberStatus, PartyError, PartyEventType } = models;
// Expected failures below (offline request, stale socket) log warnings; keep the output readable.
const realWarn = console.warn;
console.warn = (...args) => {
  const text = String(args[0] ?? "");
  if (text.startsWith("[realtime]") || text.startsWith("[party]")) return;
  realWarn(...args);
};

// ---------- PartySync (Android PartySyncTest) ----------
const playback = ({
  seq = 1,
  paused = false,
  positionMs = 10000,
  rate = 1,
  at = 1000000,
  memberId = "a",
  waiting = false,
  mediaKey = null
} = {}) => ({
  seq,
  member_id: memberId,
  paused,
  position_ms: positionMs,
  rate,
  at,
  media_key: mediaKey,
  waiting
});
const media = (overrides = {}) => ({
  type: "movie",
  meta_id: "tt1",
  meta_type: "movie",
  season: null,
  episode: null,
  title: "",
  ...overrides
});
const party = ({ memberId, hostMemberId, online, hostOnly = false }) => ({
  id: "p",
  code: "ABC234",
  memberId,
  hostMemberId,
  members: ["a", "b", "c"].map((id) => ({
    id,
    display_name: id.toUpperCase(),
    avatar_url: null,
    avatar_color: null
  })),
  presence: Object.fromEntries(
    online.map((id) => [
      id,
      { member_id: id, status: PartyMemberStatus.Ready, media_key: null, behind_ms: null }
    ])
  ),
  media: media(),
  mediaKey: models.mediaKeyOf(media()),
  maxMembers: 3,
  connected: true,
  hostOnly
});

assert.equal(
  PartySync.expectedPositionMs(playback({ rate: 1.5 }), 1002000),
  13000,
  "playing timeline advances with rate"
);
assert.equal(
  PartySync.expectedPositionMs(playback({ paused: true }), 1500000),
  10000,
  "paused timeline stays put"
);
assert.equal(
  PartySync.expectedPositionMs(playback({ positionMs: 99000 }), 1010000, 100000),
  100000,
  "clamped to duration"
);
assert.equal(
  PartySync.expectedPositionMs(playback(), 999000),
  10000,
  "clock skew before anchor does not rewind"
);
assert(PartySync.isNewer(playback({ seq: 3 }), playback({ seq: 2 })));
assert(!PartySync.isNewer(playback({ seq: 2 }), playback({ seq: 3 })));
assert(PartySync.isNewer(playback({ seq: 1 }), null));
const first = playback({ seq: 4, memberId: "aaa" });
const second = playback({ seq: 4, memberId: "bbb" });
assert(PartySync.isNewer(second, first));
assert(!PartySync.isNewer(first, second));
assert(!PartySync.isNewer(first, first));
assert.deepEqual(PartySync.correction(10200, 10000, playback(), false), {
  type: PartyCorrectionType.InSync
});
let correction = PartySync.correction(10600, 10000, playback(), false);
assert(correction.type === PartyCorrectionType.Nudge && correction.rate < 1, "ahead slows down");
correction = PartySync.correction(9400, 10000, playback(), false);
assert(correction.type === PartyCorrectionType.Nudge && correction.rate > 1, "behind speeds up");
assert.equal(PartySync.correction(10150, 10000, playback(), true).type, PartyCorrectionType.Nudge);
assert.deepEqual(PartySync.correction(10050, 10000, playback(), true), {
  type: PartyCorrectionType.InSync
});
assert.deepEqual(PartySync.correction(4000, 10000, playback(), false), {
  type: PartyCorrectionType.Seek,
  positionMs: 10000
});
assert.deepEqual(PartySync.correction(10300, 10000, playback({ paused: true }), false), {
  type: PartyCorrectionType.InSync
});
assert.deepEqual(PartySync.correction(12000, 10000, playback({ paused: true }), false), {
  type: PartyCorrectionType.Seek,
  positionMs: 10000
});
assert.equal(
  PartySync.coordinatorId(party({ memberId: "b", hostMemberId: "a", online: ["a", "b"] })),
  "a"
);
assert.equal(
  PartySync.coordinatorId(party({ memberId: "c", hostMemberId: "a", online: ["b", "c"] })),
  "b"
);
assert.equal(
  PartySync.coordinatorId(
    party({ memberId: "c", hostMemberId: "a", online: ["b", "c"], hostOnly: true })
  ),
  "a"
);
assert(models.canControlParty(party({ memberId: "b", hostMemberId: "a", online: [] })));
assert(
  !models.canControlParty(party({ memberId: "b", hostMemberId: "a", online: [], hostOnly: true }))
);
assert(
  models.canControlParty(party({ memberId: "a", hostMemberId: "a", online: [], hostOnly: true }))
);
const playing = playback({ seq: 1, at: 1000000 });
const pausedState = playback({ seq: 2, paused: true, positionMs: 12000, at: 1002000 });
assert.equal(PartySync.actionOf(playing, pausedState), PartyAction.Paused);
assert.equal(
  PartySync.actionOf(pausedState, { ...pausedState, seq: 3, paused: false }),
  PartyAction.Resumed
);
assert.equal(
  PartySync.actionOf(playing, playback({ seq: 2, positionMs: 12400, at: 1002000 })),
  null,
  "small drift is not a seek"
);
assert.equal(
  PartySync.actionOf(playing, playback({ seq: 2, positionMs: 22000, at: 1002000 })),
  PartyAction.Seeked
);
assert.equal(
  PartySync.actionOf(playing, playback({ seq: 2, rate: 1.5, at: 1000500 })),
  PartyAction.Speed
);
const waitingState = playback({ seq: 2, paused: true, waiting: true, at: 1000500 });
assert.equal(PartySync.actionOf(null, playing), null);
assert.equal(PartySync.actionOf(playing, waitingState), null);
assert.equal(PartySync.actionOf(waitingState, playback({ seq: 3, at: 1001000 })), null);
const key = models.mediaKeyOf(media());
const waitingParty = {
  ...party({ memberId: "a", hostMemberId: "a", online: [] }),
  presence: {
    a: { member_id: "a", status: PartyMemberStatus.Ready, media_key: key },
    b: { member_id: "b", status: PartyMemberStatus.Buffering, media_key: key },
    c: { member_id: "c", status: PartyMemberStatus.Loading, media_key: "movie|tt2||" },
    d: { member_id: "d", status: PartyMemberStatus.Loading, media_key: key }
  }
};
assert.deepEqual(PartySync.waitingMemberIds(waitingParty, new Set()), ["b", "d"]);
assert.deepEqual(PartySync.waitingMemberIds(waitingParty, new Set(["d"])), ["b"]);
const behindParty = {
  ...party({ memberId: "a", hostMemberId: "a", online: [] }),
  presence: {
    b: { member_id: "b", status: PartyMemberStatus.Behind, media_key: key, behind_ms: 30000 },
    c: { member_id: "c", status: PartyMemberStatus.Buffering, media_key: key }
  }
};
assert.deepEqual(
  PartySync.waitingMemberIds(behindParty, new Set()),
  ["c"],
  "members behind never hold up the party"
);
assert.deepEqual(PartySync.ownSeek(50000, 60000, false), {
  type: OwnSeekType.Behind,
  positionMs: 50000
});
assert.deepEqual(PartySync.ownSeek(55000, 60000, true), {
  type: OwnSeekType.Behind,
  positionMs: 55000
});
assert.deepEqual(PartySync.ownSeek(59000, 60000, true), { type: OwnSeekType.CatchUp });
assert.deepEqual(PartySync.ownSeek(90000, 60000, true), { type: OwnSeekType.CatchUp });
assert.deepEqual(PartySync.ownSeek(70000, 60000, false), { type: OwnSeekType.Blocked });
assert(PartySync.shouldRejoin(1500, true));
assert(PartySync.shouldRejoin(-4000, true));
assert(!PartySync.shouldRejoin(1500, false));
assert(!PartySync.shouldRejoin(10000, true));
assert.equal(PartySync.reportedGapMs(1200), 5000);
assert.equal(PartySync.reportedGapMs(8000), 10000);
assert.equal(PartySync.reportedGapMs(81900), 80000);

// ---------- PartyClock ----------
let mono = 0;
const clock = new PartyClock({ monotonicMs: () => mono, wallClockMs: () => 0 });
const slow = clock.mark();
mono += 400;
clock.addSample(5000000, slow);
assert.equal(clock.nowMs(), 5000200);
const fast = clock.mark();
mono += 40;
clock.addSample(5000500, fast);
assert.equal(clock.nowMs(), 5000520);
const slower = clock.mark();
mono += 900;
clock.addSample(9999999, slower);
assert.equal(clock.nowMs(), 5001420, "clock keeps the fastest sample");
const unsynced = new PartyClock({ monotonicMs: () => 0, wallClockMs: () => 42 });
assert(!unsynced.isSynced);
assert.equal(unsynced.nowMs(), 42);

// ---------- codes, keys, wire decoding ----------
assert.equal(models.normalizePartyCode(" abc-234 "), "ABC234");
assert(models.isValidPartyCode("abc 234"));
assert(!models.isValidPartyCode("ABC10"));
assert.equal(models.formatPartyCode("abc234"), "ABC 234");
const episodeMedia = media({
  type: "series",
  meta_id: "tt9",
  meta_type: "series",
  season: 1,
  episode: 2,
  source: { info_hash: "x" }
});
assert.equal(
  models.mediaKeyOf(episodeMedia),
  models.mediaKeyOf({ ...episodeMedia, source: { info_hash: "y" }, title: "Other" })
);
assert.notEqual(
  models.mediaKeyOf(episodeMedia),
  models.mediaKeyOf({ ...episodeMedia, episode: 3 })
);
assert.equal(models.partyMediaKey("Series", "tt9", 1, 2), "series|tt9|1|2");
assert.equal(models.partyMediaKey("movie", "tt1", null, null), "movie|tt1||");
const behindPresence = {
  member_id: "b",
  status: PartyMemberStatus.Behind,
  media_key: "movie|tt1||",
  behind_ms: 15000
};
assert.deepEqual(
  models.decodePartyPresence(JSON.parse(JSON.stringify(models.compactJson(behindPresence)))),
  behindPresence,
  "behind presence survives the wire"
);
const preview = models.decodePartyPreview(
  JSON.parse(
    '{"host":{"id":"h","avatar_url":null,"avatar_color":"#48B461","display_name":"Aju"},' +
      '"media":{"type":"series","title":"Ted Lasso","season":1,"episode":6,"description":"Richmond plays Everton.",' +
      '"meta_id":"tt10986410","video_id":"tt10986410:1:6","meta_type":"series"},"members":1,"max_members":3}'
  )
);
assert.equal(preview.media.title, "Ted Lasso");
assert.equal(preview.media.episode, 6);
assert.equal(preview.media.description, "Richmond plays Everton.");
assert.equal(preview.media.source, null);
assert.deepEqual(preview.host, {
  id: "h",
  display_name: "Aju",
  avatar_url: null,
  avatar_color: "#48B461"
});
assert(!models.isPartyPreviewFull(preview));
assert(models.isPartyPreviewFull({ ...preview, members: 3 }));
const missing = models.decodePartyPreview({ error: "party_not_found" });
assert.equal(models.partyErrorOf(missing.error), PartyError.NotFound);
assert.equal(missing.media, null);
assert.equal(models.partyErrorOf("not_member"), PartyError.Removed);
assert.equal(models.partyErrorOf("something_new"), PartyError.Network);
assert.deepEqual(
  models.compactJson({ a: null, b: { c: undefined, d: 1 }, e: [null] }),
  { b: { d: 1 }, e: [null] },
  "nulls are left out like Android explicitNulls=false"
);

// ---------- shared streams (Android PartyStreamTest) ----------
const sharedStream = {
  media_key: "movie|tt1||",
  url: "https://cdn.example.com/movie.mkv",
  headers: { Referer: "https://example.com" },
  response_headers: { "Content-Type": "video/x-matroska" },
  name: "TB HD",
  description: "Movie 2017\n1.5 GB",
  addon_name: "Torrentio",
  addon_id: "addon:torrentio",
  addon_logo: "https://example.com/logo.png",
  filename: "movie.mkv",
  video_size: 1500000000,
  binge_group: "torrentio|720p",
  stream_type: null,
  badges: [{ name: "HDR", imageURL: "https://example.com/hdr.png" }]
};
assert(models.isShareableStreamUrl("https://cdn.example.com/movie.mkv"));
assert(models.isShareableStreamUrl("http://192.168.1.20:8096/video"));
[
  "http://127.0.0.1:11470/stream",
  "http://localhost:8080/video",
  "http://[::1]:8080/video",
  "http://0.0.0.0/video",
  "file:///data/movie.mkv",
  "magnet:?xt=urn:btih:abc"
].forEach((url) => assert(!models.isShareableStreamUrl(url), url));
const entry = models.partyStreamToEntry(sharedStream);
assert.equal(entry.url, "https://cdn.example.com/movie.mkv");
assert.equal(entry.name, "TB HD");
assert.equal(entry.description, "Movie 2017\n1.5 GB");
assert.equal(entry.addonName, "Torrentio");
assert.equal(entry.addonLogo, "https://example.com/logo.png");
assert.equal(entry.behaviorHints.videoSize, 1500000000);
assert.equal(entry.behaviorHints.filename, "movie.mkv");
assert.deepEqual(entry.behaviorHints.proxyHeaders.request, { Referer: "https://example.com" });
assert.equal(entry.badges[0].name, "HDR");
assert.equal(entry.infoHash, null, "shared stream is not a torrent");
assert(models.isPartySharedStream(entry) && models.isPartySharedStream({ raw: entry.raw }));
assert.deepEqual(
  models.decodePartyStream(JSON.parse(JSON.stringify(models.compactJson(sharedStream)))),
  sharedStream,
  "shared stream survives the wire"
);
const mobile = models.decodePartyStream(
  JSON.parse(
    '{"media_key":"movie|tt1||","url":"https://cdn.example.com/a.mkv","stream_type":"debrid","badges":[{"name":"4K","imageURL":"https://example.com/4k.png"}],"unknown":1}'
  )
);
assert.equal(mobile.stream_type, "debrid");
assert.equal(mobile.badges[0].name, "4K");
const torrentStream = { infoHash: "ABCDEF", fileIdx: 2, url: null, behaviorHints: {} };
assert(models.partySourceMatches({ info_hash: "abcdef", file_idx: 2 }, torrentStream));
assert(!models.partySourceMatches({ info_hash: "abcdef", file_idx: 3 }, torrentStream));
assert(models.partySourceMatches({ info_hash: "abcdef" }, torrentStream));
const directStream = {
  url: "https://cdn.example.com/a.mkv",
  behaviorHints: { filename: "Movie.2017.1080p.mkv" }
};
assert(models.partySourceMatches({ filename: "movie.2017.1080p.mkv" }, directStream));
assert(!models.partySourceMatches({ filename: "other.mkv" }, directStream));
assert(!models.partySourceMatches({ name: "TB HD" }, directStream));

// ---------- Realtime socket ----------
assert.equal(
  realtimeUrl("https://api.example.com/"),
  "wss://api.example.com/realtime/v1?nuvio_realtime=1"
);
assert.equal(
  realtimeUrl("http://192.168.1.5:8000"),
  "ws://192.168.1.5:8000/realtime/v1?nuvio_realtime=1"
);
assert.equal(
  realtimeWebsocketUrl("https://api.example.com", "pk"),
  "wss://api.example.com/realtime/v1/websocket?nuvio_realtime=1&apikey=pk&vsn=1.0.0",
  "same URL supabase-kt builds from the custom URL"
);

function createTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimer(callback, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, callback, every: 0 });
      return id;
    },
    clearTimer(id) {
      tasks.delete(id);
    },
    setRepeating(callback, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, callback, every: ms });
      return id;
    },
    clearRepeating(id) {
      tasks.delete(id);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let nextIdKey = null;
        let next = null;
        for (const [id, task] of tasks)
          if (task.at <= end && (!next || task.at < next.at)) {
            next = task;
            nextIdKey = id;
          }
        if (!next) break;
        now = next.at;
        if (next.every) next.at += next.every;
        else tasks.delete(nextIdKey);
        next.callback();
        await flush();
      }
      now = end;
      await flush();
    },
    get now() {
      return now;
    }
  };
}
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  messages(event) {
    return this.sent.filter((message) => message.event === event);
  }
}
FakeWebSocket.instances = [];

let token = "token-1";
const timers = createTimers();
const socket = new RealtimeSocket({
  url: "wss://test/realtime/v1/websocket",
  createWebSocket: (url) => new FakeWebSocket(url),
  getAccessToken: async () => token,
  ...timers
});
const channel = socket.channel("watch-party:p1", { presenceKey: "m1", isPrivate: true });
const statuses = [];
const broadcasts = [];
const presences = [];
channel.onStatus((connected) => statuses.push(connected));
channel.onBroadcast((event, payload) => broadcasts.push([event, payload]));
channel.onPresence((joins, leaves) => presences.push([joins, leaves]));
await channel.subscribe();
let ws = FakeWebSocket.instances.at(-1);
assert.equal(ws.url, "wss://test/realtime/v1/websocket");
ws.open();
await flush();
const join = ws.messages("phx_join")[0];
assert.equal(join.topic, "realtime:watch-party:p1");
assert.deepEqual(join.payload.config, {
  broadcast: { ack: false, self: false },
  presence: { key: "m1", enabled: true },
  postgres_changes: [],
  private: true
});
assert.equal(join.payload.access_token, "token-1", "private channel joins with the session token");
assert(!channel.send("state", { a: 1 }), "nothing is broadcast before the join reply");
ws.receive({
  topic: "realtime:watch-party:p1",
  event: "phx_reply",
  payload: { status: "ok", response: { postgres_changes: [] } },
  ref: join.ref
});
assert.deepEqual(statuses, [true]);
assert(channel.send("state", { seq: 1 }));
assert.deepEqual(ws.messages("broadcast").at(-1).payload, {
  type: "broadcast",
  event: "state",
  payload: { seq: 1 }
});
assert(channel.track({ member_id: "m1", status: "ready" }));
assert.deepEqual(ws.messages("presence").at(-1).payload, {
  type: "presence",
  event: "track",
  payload: { member_id: "m1", status: "ready" }
});
ws.receive({
  topic: "realtime:watch-party:p1",
  event: "broadcast",
  payload: { type: "broadcast", event: "control", payload: { host_only: true } },
  ref: null
});
assert.deepEqual(broadcasts.at(-1), ["control", { host_only: true }]);
ws.receive({
  topic: "realtime:watch-party:p1",
  event: "presence_state",
  payload: { m2: { metas: [{ phx_ref: "x", member_id: "m2", status: "loading" }] } }
});
assert.deepEqual(presences.at(-1), [{ m2: { member_id: "m2", status: "loading" } }, {}]);
ws.receive({
  topic: "realtime:watch-party:p1",
  event: "presence_diff",
  payload: { joins: {}, leaves: { m2: { metas: [{ phx_ref: "x" }] } } }
});
assert.deepEqual(presences.at(-1), [{}, { m2: {} }]);
// Heartbeats every 15 s; a token change is pushed to subscribed channels.
token = "token-2";
await timers.advance(15000);
const heartbeat = ws.messages("heartbeat").at(-1);
assert.equal(heartbeat.topic, "phoenix");
assert.equal(ws.messages("access_token").at(-1).payload.access_token, "token-2");
ws.receive({ topic: "phoenix", event: "phx_reply", payload: { status: "ok" }, ref: heartbeat.ref });
await timers.advance(15000);
assert.equal(FakeWebSocket.instances.length, 1, "answered heartbeat keeps the socket");
// An unanswered heartbeat reconnects after 3 s and rejoins the channel.
await timers.advance(15000);
assert.deepEqual(statuses, [true, false], "stale socket reports the channel disconnected");
await timers.advance(3000);
ws = FakeWebSocket.instances.at(-1);
assert.equal(FakeWebSocket.instances.length, 2);
ws.open();
await flush();
const rejoin = ws.messages("phx_join")[0];
ws.receive({
  topic: "realtime:watch-party:p1",
  event: "phx_reply",
  payload: { status: "ok", response: {} },
  ref: rejoin.ref
});
assert.deepEqual(statuses, [true, false, true]);
// A refused join is retried.
ws.receive({ topic: "realtime:watch-party:p1", event: "phx_error", payload: {}, ref: rejoin.ref });
assert.deepEqual(statuses, [true, false, true, false]);
await timers.advance(3000);
await flush();
assert.equal(ws.messages("phx_join").length, 2);
socket.removeChannel(channel);
assert.equal(ws.readyState, 3, "no channels left closes the socket");
await timers.advance(10000);
assert.equal(FakeWebSocket.instances.length, 2, "no reconnect after removing the last channel");

// ---------- PartyRepository ----------
function fakeAuth() {
  let state = AuthState.AUTHENTICATED;
  const listeners = new Set();
  return {
    getAuthState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = next;
      listeners.forEach((listener) => listener(next));
    }
  };
}
function fakeChannelSocket() {
  const sockets = [];
  return {
    sockets,
    create() {
      const sent = [];
      const tracked = [];
      const channelListeners = { broadcast: new Set(), presence: new Set(), status: new Set() };
      const fake = {
        channels: new Map(),
        sent,
        tracked,
        removed: false,
        channel(topic, options) {
          fake.topic = topic;
          fake.options = options;
          return {
            onBroadcast: (listener) => (
              channelListeners.broadcast.add(listener),
              () => channelListeners.broadcast.delete(listener)
            ),
            onPresence: (listener) => (
              channelListeners.presence.add(listener),
              () => channelListeners.presence.delete(listener)
            ),
            onStatus: (listener) => (
              channelListeners.status.add(listener),
              () => channelListeners.status.delete(listener)
            ),
            subscribe: async () => {
              fake.channels.set(topic, true);
            },
            send: (event, payload) => {
              sent.push([event, payload]);
              return true;
            },
            track: (payload) => {
              tracked.push(payload);
              return true;
            }
          };
        },
        removeChannel() {
          fake.channels.clear();
          fake.removed = true;
        },
        connect(connected) {
          channelListeners.status.forEach((listener) => listener(connected));
        },
        message(event, payload) {
          channelListeners.broadcast.forEach((listener) => listener(event, payload));
        },
        presence(joins, leaves = {}) {
          channelListeners.presence.forEach((listener) => listener(joins, leaves));
        }
      };
      sockets.push(fake);
      return fake;
    }
  };
}
const MEDIA = { type: "movie", meta_id: "tt1", meta_type: "movie", title: "Movie" };
const MEDIA_KEY = "movie|tt1||";
function snapshot({
  memberId = "m1",
  host = "m1",
  members = ["m1"],
  hostOnly = false,
  playbackState = null,
  error = null,
  mediaValue = MEDIA
} = {}) {
  return models.decodePartySnapshot({
    party: {
      id: "p1",
      code: "ABC234",
      host_member_id: host,
      host_only: hostOnly,
      media: mediaValue,
      playback: playbackState,
      max_members: 3
    },
    members: members.map((id) => ({
      id,
      display_name: id.toUpperCase(),
      avatar_url: id === "m2" ? "https://evil.example/a.png" : null
    })),
    member_id: memberId,
    server_time_ms: 1000,
    error
  });
}
function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    create: async (...args) => (calls.push(["create", ...args]), snapshot()),
    join: async (...args) => (
      calls.push(["join", ...args]),
      snapshot({ memberId: "m2", host: "m1", members: ["m1", "m2"] })
    ),
    preview: async () => models.decodePartyPreview({ media: MEDIA, members: 1, max_members: 3 }),
    heartbeat: async () => (calls.push(["heartbeat"]), snapshot({ members: ["m1", "m2"] })),
    update: async (...args) => (
      calls.push(["update", ...args]),
      snapshot({ members: ["m1", "m2"] })
    ),
    leave: async () => (calls.push(["leave"]), { error: null }),
    end: async () => (calls.push(["end"]), { error: null }),
    setHostOnly: async (...args) => (
      calls.push(["setHostOnly", ...args]),
      snapshot({ hostOnly: args[2], members: ["m1", "m2"] })
    ),
    removeMember: async () => snapshot(),
    clock: async () => 5000,
    enabled: async () => true,
    ...overrides
  };
  return api;
}
function setupRepository({ api = fakeApi(), auth = fakeAuth(), capable = true } = {}) {
  const repoTimers = createTimers();
  let repoMono = 0;
  const repoClock = new PartyClock({ monotonicMs: () => repoMono, wallClockMs: () => 1000 });
  const socketFactory = fakeChannelSocket();
  const repo = createPartyRepository({
    api,
    auth,
    clock: repoClock,
    createSocket: () => socketFactory.create(),
    deviceId: () => "device-1",
    identity: async () => ({
      deviceId: "device-1",
      displayName: "Me",
      avatarUrl: null,
      avatarColor: null
    }),
    serverCapable: () => capable,
    isCustomServer: () => false,
    setTimer: repoTimers.setTimer,
    clearTimer: repoTimers.clearTimer
  });
  const events = [];
  const notices = [];
  repo.subscribeEvents((event) => events.push(event));
  repo.subscribeNotices((notice) => notices.push(notice));
  return {
    repo,
    api,
    auth,
    events,
    notices,
    timers: repoTimers,
    socketFactory,
    get socket() {
      return socketFactory.sockets.at(-1);
    },
    async advance(ms) {
      repoMono += ms;
      await repoTimers.advance(ms);
    }
  };
}

{
  // Gates: unavailable server and signed-out users cannot start.
  const offline = setupRepository({ capable: false });
  assert.equal(await offline.repo.create(MEDIA), PartyError.Unavailable);
  const signedOutAuth = fakeAuth();
  signedOutAuth.set(AuthState.SIGNED_OUT);
  const signedOut = setupRepository({ auth: signedOutAuth });
  assert.equal(await signedOut.repo.create(MEDIA), PartyError.SignInRequired);
  const full = setupRepository({
    api: fakeApi({ join: async () => models.decodePartySnapshot({ error: "party_full" }) })
  });
  assert.equal(await full.repo.join("abc 234"), PartyError.Full);
  const disabled = setupRepository({
    api: fakeApi({ create: async () => models.decodePartySnapshot({ error: "unavailable" }) })
  });
  assert.equal(await disabled.repo.create(MEDIA), PartyError.Unavailable);
  assert.equal(disabled.repo.isAvailable(), false, "an unavailable reply hides watch parties");
  const broken = setupRepository({
    api: fakeApi({
      create: async () => {
        throw new Error("offline");
      }
    })
  });
  assert.equal(await broken.repo.create(MEDIA), PartyError.Network);
  assert.equal(broken.repo.getState().busy, false);
}

{
  // Host session: channel, presence, playback publishing, persistence and media switch.
  const t = setupRepository();
  assert.equal(await t.repo.create(MEDIA), null);
  const state = t.repo.getState();
  assert.equal(state.party.code, "ABC234");
  assert.equal(state.party.mediaKey, MEDIA_KEY);
  assert.equal(state.party.inviteLink, "https://nuvio.tv/party/ABC234");
  assert.equal(t.socket.topic, "watch-party:p1");
  assert.deepEqual(t.socket.options, { presenceKey: "m1", isPrivate: true });
  assert.equal(t.api.calls[0][0], "create");
  t.socket.connect(true);
  assert.equal(t.repo.getState().party.connected, true);
  assert.equal(t.socket.tracked.length, 1, "presence is tracked on connect");
  assert.deepEqual(
    t.socket.sent.map(([event]) => event),
    ["status", "state_request"]
  );
  t.repo.publishPlayback(false, 12000, 1);
  const published = t.repo.getPlayback();
  assert.equal(published.seq, 1);
  assert.equal(published.member_id, "m1");
  assert.equal(published.media_key, MEDIA_KEY);
  assert.equal(t.socket.sent.at(-1)[0], "state");
  assert.equal(t.socket.sent.at(-1)[1].waiting, false);
  await t.advance(1500);
  assert(
    t.api.calls.some(([name]) => name === "update"),
    "playback is persisted after 1.5 s"
  );
  // A newer state from someone else is accepted and announced.
  t.socket.message("member_joined", { member_id: "m2" });
  await flush();
  assert.equal(t.events.at(-1).type, PartyEventType.MemberJoined);
  assert.equal(t.events.at(-1).name, "M2");
  assert.equal(
    t.repo.getState().party.members.find((m) => m.id === "m2").avatar_url,
    null,
    "foreign avatar URLs are dropped"
  );
  t.socket.message("state", {
    seq: 2,
    member_id: "m2",
    paused: true,
    position_ms: 15000,
    rate: 1,
    at: 2000,
    media_key: MEDIA_KEY
  });
  assert.equal(t.repo.getPlayback().seq, 2);
  assert.equal(t.notices.at(-1).action, PartyAction.Paused);
  assert.equal(t.notices.at(-1).name, "M2");
  t.socket.message("state", {
    seq: 1,
    member_id: "m2",
    paused: false,
    position_ms: 0,
    rate: 1,
    at: 2000,
    media_key: MEDIA_KEY
  });
  assert.equal(t.repo.getPlayback().seq, 2, "older state is ignored");
  t.socket.message("state", {
    seq: 3,
    member_id: "m2",
    paused: false,
    position_ms: 0,
    rate: 1,
    at: 2000,
    media_key: "movie|tt9||"
  });
  assert.equal(t.repo.getPlayback().seq, 2, "state for another title is ignored");
  // Presence: status debounced 250 ms; state requests answered.
  const sentBefore = t.socket.sent.length;
  t.repo.setLocalStatus(PartyMemberStatus.Ready, MEDIA_KEY);
  t.repo.setLocalStatus(PartyMemberStatus.Ready, MEDIA_KEY);
  assert.equal(t.socket.sent.length, sentBefore);
  await t.advance(250);
  assert.deepEqual(t.socket.sent.at(-1), [
    "status",
    { member_id: "m1", status: "ready", media_key: MEDIA_KEY }
  ]);
  t.socket.message("state_request", { member_id: "m2" });
  assert.deepEqual(
    t.socket.sent.slice(-2).map(([event]) => event),
    ["status", "state"]
  );
  // Switching media publishes media plus a fresh playing state at the given position.
  const nextMedia = { ...MEDIA, meta_id: "tt2", title: "Other" };
  await t.repo.publishMedia(nextMedia, 0);
  const update = t.api.calls.filter(([name]) => name === "update").at(-1);
  assert.deepEqual(update[3], nextMedia);
  assert.equal(update[4].media_key, "movie|tt2||");
  assert.equal(update[4].paused, false);
  // Sharing: only the host shares, and turning it off clears the link.
  t.repo.setSharing(true);
  t.repo.shareStream({ ...sharedStream, media_key: "movie|tt2||" });
  assert.equal(t.socket.sent.at(-1)[0], "stream");
  t.repo.setSharing(false);
  assert.deepEqual(t.socket.sent.at(-1), ["stream", { member_id: "m1", stream: null }]);
  // Host-only toggle reaches the server.
  await t.repo.setHostOnly(true);
  assert.deepEqual(
    t.api.calls
      .filter(([name]) => name === "setHostOnly")
      .at(-1)
      .slice(1),
    ["p1", "device-1", true]
  );
  assert.equal(t.repo.getState().party.hostOnly, true);
  // Disconnect keeps only our own presence.
  t.socket.presence({ m2: { status: "ready", media_key: MEDIA_KEY } });
  assert(t.repo.getState().party.presence.m2);
  t.socket.connect(false);
  assert.deepEqual(Object.keys(t.repo.getState().party.presence), ["m1"]);
  // Leaving stops the session and tells the server.
  await t.repo.leave();
  assert.equal(t.repo.getState().party, null);
  assert(t.socket.removed);
  assert(t.api.calls.some(([name]) => name === "leave"));
  await t.advance(5 * 60 * 1000);
  assert.equal(
    t.api.calls.filter(([name]) => name === "heartbeat").length,
    1,
    "no timers survive the session"
  );
}

{
  // Member: host-only states, shared links, removal, rejoin and end.
  const t = setupRepository();
  assert.equal(await t.repo.join("abc-234"), null);
  assert.equal(t.api.calls[0][1], "ABC234", "codes are normalized before joining");
  assert.equal(t.repo.getState().party.memberId, "m2");
  t.socket.connect(true);
  t.socket.message("control", { host_only: true });
  assert.equal(t.events.at(-1).type, PartyEventType.ControlChanged);
  assert.equal(t.repo.getState().party.hostOnly, true);
  t.socket.message("state", {
    seq: 5,
    member_id: "m3",
    paused: true,
    position_ms: 0,
    rate: 1,
    at: 1000,
    media_key: MEDIA_KEY
  });
  assert.equal(t.repo.getPlayback(), null, "in host-only parties only the host's states count");
  t.repo.publishPlayback(true, 1000, 1);
  assert.equal(t.repo.getPlayback(), null, "members cannot publish in host-only parties");
  t.socket.message("stream", {
    member_id: "m1",
    stream: { ...sharedStream, url: "http://127.0.0.1:11470/x" }
  });
  assert.equal(t.repo.getSharedStream(), null, "local links are never accepted");
  t.socket.message("stream", { member_id: "m3", stream: sharedStream });
  assert.equal(t.repo.getSharedStream(), null, "only the host shares links");
  t.socket.message("stream", { member_id: "m1", stream: sharedStream });
  assert.equal(t.repo.getSharedStream().url, sharedStream.url);
  t.socket.message("media", { media: { ...MEDIA, meta_id: "tt5" }, playback: null });
  assert.equal(t.events.at(-1).type, PartyEventType.MediaChanged);
  assert.equal(t.repo.getSharedStream(), null, "a new title clears the old shared link");
  t.socket.message("member_left", { member_id: "m1", reason: "left", host_member_id: "m2" });
  assert.equal(t.events.at(-1).type, PartyEventType.MemberLeft);
  assert.equal(t.repo.getState().party.hostMemberId, "m2", "host role moves on");
  // Our own membership vanished: rejoin keeps the session when the id is unchanged.
  t.socket.message("member_left", { member_id: "m2", reason: "timeout" });
  await flush();
  assert(t.repo.getState().party, "rejoined");
  assert.equal(t.api.calls.filter(([name]) => name === "join").length, 2);
  t.socket.message("member_left", { member_id: "m2", reason: "removed" });
  await flush();
  assert.equal(t.repo.getState().party, null);
  assert.equal(t.events.at(-1).type, PartyEventType.Removed);
}

{
  // Ended and disabled.
  const t = setupRepository();
  await t.repo.create(MEDIA);
  t.socket.message("ended", { reason: "disabled" });
  await flush();
  assert.equal(t.repo.getState().party, null);
  assert.equal(t.events.at(-1).type, PartyEventType.Ended);
  assert.equal(t.repo.isAvailable(), false);
  const heartbeatEnded = setupRepository({
    api: fakeApi({ heartbeat: async () => models.decodePartySnapshot({ error: "party_ended" }) })
  });
  await heartbeatEnded.repo.create(MEDIA);
  await heartbeatEnded.advance(2 * 60 * 1000);
  await flush();
  assert.equal(heartbeatEnded.repo.getState().party, null, "heartbeat notices a finished party");
  const auth = fakeAuth();
  const signOut = setupRepository({ auth });
  await signOut.repo.create(MEDIA);
  auth.set(AuthState.SIGNED_OUT);
  await flush();
  assert.equal(signOut.repo.getState().party, null, "signing out leaves the session");
}

{
  // Coordinator: the host waits for buffering members, then resumes; ignores them after 15 s.
  const t = setupRepository({
    api: fakeApi({ create: async () => snapshot({ members: ["m1", "m2"] }) })
  });
  await t.repo.create(MEDIA);
  t.socket.connect(true);
  t.repo.publishPlayback(false, 10000, 1);
  t.socket.presence({ m2: { status: "buffering", media_key: MEDIA_KEY } });
  await t.advance(3500);
  assert.equal(t.repo.getPlayback().paused, true, "party pauses while someone buffers");
  assert.equal(t.repo.getPlayback().waiting, true);
  t.socket.message("status", { member_id: "m2", status: "ready", media_key: MEDIA_KEY });
  await t.advance(500);
  assert.equal(t.repo.getPlayback().paused, false, "and resumes once they are ready");
  assert.equal(t.repo.getPlayback().waiting, false);
  t.socket.message("status", { member_id: "m2", status: "buffering", media_key: MEDIA_KEY });
  await t.advance(3500);
  assert.equal(t.repo.getPlayback().waiting, true);
  await t.advance(16000);
  assert.equal(
    t.repo.getPlayback().paused,
    false,
    "a member stuck for 15 s no longer holds the party"
  );
  await t.advance(5000);
  assert.equal(t.repo.getPlayback().paused, false, "and stays ignored");
  // Members behind never pause the party.
  t.socket.message("status", {
    member_id: "m2",
    status: "behind",
    media_key: MEDIA_KEY,
    behind_ms: 30000
  });
  await t.advance(5000);
  assert.equal(t.repo.getPlayback().paused, false);
}

// Real RPC payloads and Android's narrowly scoped legacy fallback.
const { PartyApi } = await import("../js/core/party/partyApi.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const requests = [];
let rpcError = null;
globalThis.fetch = async (url, options) => {
  requests.push({ functionName: String(url).split("/").at(-1), body: JSON.parse(options.body) });
  const error = rpcError;
  rpcError = null;
  return new Response(JSON.stringify(error ? { code: error } : {}), { status: error ? 400 : 200 });
};
const who = {
  deviceId: "fixture-device",
  displayName: "Profile",
  avatarUrl: null,
  avatarColor: null,
  profileIndex: 4
};
for (const invoke of [
  () => PartyApi.create(who, media(), null),
  () => PartyApi.join("ABC234", who)
]) {
  requests.length = 0;
  await invoke();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.p_profile_index, 4);
  requests.length = 0;
  rpcError = "PGRST202";
  await invoke();
  assert.equal(requests.length, 2);
  const { p_profile_index, ...legacy } = requests[0].body;
  assert.equal(p_profile_index, 4);
  assert.deepEqual(requests[1].body, legacy);
  for (const code of ["42501", "PGRST203"]) {
    requests.length = 0;
    rpcError = code;
    await assert.rejects(invoke(), (error) => error.code === code);
    assert.equal(requests.length, 1, "other errors must not retry create/join");
  }
}
requests.length = 0;
await PartyApi.join("ABC234", { ...who, profileIndex: null });
assert(!Object.hasOwn(requests[0].body, "p_profile_index"));
assert.equal(requests.length, 1);
// Use the production identity builder, including a change of active profile.
const savedProfiles = ProfileManager.getProfiles;
const savedActiveId = ProfileManager.getActiveProfileId;
let activeId = "4";
ProfileManager.getActiveProfileId = () => activeId;
ProfileManager.getProfiles = async () => [
  { id: "4", name: "Four" },
  { id: "2", name: "Two" }
];
const identities = [];
const identityRepo = createPartyRepository({
  api: {
    create: async (identity) => {
      identities.push(identity);
      return { error: "party_full" };
    },
    join: async (_code, identity) => {
      identities.push(identity);
      return { error: "party_full" };
    }
  },
  auth: { getAuthState: () => AuthState.AUTHENTICATED, subscribe() {} },
  serverCapable: () => true,
  deviceId: () => "fixture-device"
});
await identityRepo.create(media());
activeId = "2";
await identityRepo.join("ABC234");
assert.deepEqual(
  identities.map((identity) => identity.profileIndex),
  [4, 2]
);
ProfileManager.getProfiles = savedProfiles;
ProfileManager.getActiveProfileId = savedActiveId;

console.log(
  "Watch party parity passed: sync rules, clock, codes/keys/wire, shared streams, realtime protocol, repository sessions (host, member, removal, rejoin, end, sign-out, coordinator)"
);

const { codeSlotsMarkup } = await import("../js/ui/screens/party/partyUi.js");
for (const code of ["", "ABC234"]) {
  const slots = codeSlotsMarkup(code, { activeIndex: 0 });
  assert(slots.includes('dir="ltr"'));
  if (code) assert(slots.indexOf(">A</span>") < slots.indexOf(">4</span>"));
}
