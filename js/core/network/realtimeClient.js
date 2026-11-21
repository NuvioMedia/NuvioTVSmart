// Minimal Supabase Realtime (Phoenix protocol v1) client with the subset
// Android uses through supabase-kt: private channels, broadcast and presence.
// Android connects with a 3 s reconnect delay and the default 15 s heartbeat.

const PHOENIX = "phoenix";
const SOCKET_OPEN = 1;

export const RealtimeChannelStatus = Object.freeze({
  Unsubscribed: "unsubscribed",
  Subscribing: "subscribing",
  Subscribed: "subscribed",
  Unsubscribing: "unsubscribing"
});

/** Android core/network/RealtimeUrl.kt: the server routes this query to its realtime proxy. */
export function realtimeUrl(backendUrl) {
  const base = String(backendUrl || "")
    .trim()
    .replace(/\/+$/, "");
  let socketBase = base;
  if (/^https:\/\//i.test(base)) socketBase = `wss://${base.slice("https://".length)}`;
  else if (/^http:\/\//i.test(base)) socketBase = `ws://${base.slice("http://".length)}`;
  return `${socketBase}/realtime/v1?nuvio_realtime=1`;
}

/** supabase-kt appends the websocket path, the publishable key and the protocol version. */
export function realtimeWebsocketUrl(backendUrl, apiKey) {
  const url = new URL(realtimeUrl(backendUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/websocket`;
  url.searchParams.set("apikey", String(apiKey || ""));
  url.searchParams.set("vsn", "1.0.0");
  return url.toString();
}

function presenceStates(value) {
  const result = {};
  if (!value || typeof value !== "object") return result;
  Object.keys(value).forEach((key) => {
    const meta = Array.isArray(value[key]?.metas) ? value[key].metas[0] : null;
    if (!meta || typeof meta !== "object") return;
    const state = { ...meta };
    delete state.phx_ref;
    delete state.phx_ref_prev;
    result[key] = state;
  });
  return result;
}

export class RealtimeChannel {
  constructor(socket, topic, { presenceKey = "", isPrivate = true } = {}) {
    this.socket = socket;
    this.topic = `realtime:${topic}`;
    this.presenceKey = presenceKey;
    this.isPrivate = isPrivate;
    this.status = RealtimeChannelStatus.Unsubscribed;
    this.joinRef = null;
    this.rejoinTimer = null;
    this.broadcastListeners = new Set();
    this.presenceListeners = new Set();
    this.statusListeners = new Set();
  }

  get isSubscribed() {
    return this.status === RealtimeChannelStatus.Subscribed;
  }

  onBroadcast(listener) {
    this.broadcastListeners.add(listener);
    return () => this.broadcastListeners.delete(listener);
  }

  onPresence(listener) {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  onStatus(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe() {
    this.socket.addChannel(this);
    return this.join();
  }

  async join() {
    this.clearRejoin();
    if (!this.socket.channels.has(this.topic)) return;
    this.setStatus(RealtimeChannelStatus.Subscribing);
    if (!this.socket.isOpen) {
      this.socket.connect();
      return;
    }
    const token = await this.socket.currentAccessToken();
    if (!this.socket.channels.has(this.topic) || !this.socket.isOpen) return;
    const payload = {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: this.presenceKey, enabled: true },
        postgres_changes: [],
        private: this.isPrivate
      }
    };
    if (token) payload.access_token = token;
    this.joinRef = this.socket.nextRef();
    this.socket.lastSentAccessToken = token || null;
    this.socket.push({
      topic: this.topic,
      event: "phx_join",
      payload,
      ref: this.joinRef,
      join_ref: this.joinRef
    });
  }

  scheduleRejoin() {
    this.clearRejoin();
    if (!this.socket.channels.has(this.topic)) return;
    this.rejoinTimer = this.socket.setTimer(() => {
      this.rejoinTimer = null;
      void this.join();
    }, this.socket.reconnectDelayMs);
  }

  clearRejoin() {
    if (this.rejoinTimer != null) {
      this.socket.clearTimer(this.rejoinTimer);
      this.rejoinTimer = null;
    }
  }

  send(event, payload) {
    if (!this.isSubscribed || !this.socket.isOpen) return false;
    this.socket.push({
      topic: this.topic,
      event: "broadcast",
      payload: { type: "broadcast", event, payload },
      ref: this.socket.nextRef(),
      join_ref: this.joinRef
    });
    return true;
  }

  track(state) {
    if (!this.isSubscribed || !this.socket.isOpen) return false;
    this.socket.push({
      topic: this.topic,
      event: "presence",
      payload: { type: "presence", event: "track", payload: state },
      ref: this.socket.nextRef(),
      join_ref: this.joinRef
    });
    return true;
  }

  updateAuth(token) {
    if (!this.isSubscribed || !this.socket.isOpen) return;
    this.socket.push({
      topic: this.topic,
      event: "access_token",
      payload: { access_token: token },
      ref: this.socket.nextRef(),
      join_ref: this.joinRef
    });
  }

  unsubscribe() {
    this.clearRejoin();
    if (this.socket.isOpen && this.status !== RealtimeChannelStatus.Unsubscribed) {
      this.socket.push({
        topic: this.topic,
        event: "phx_leave",
        payload: {},
        ref: this.socket.nextRef(),
        join_ref: this.joinRef
      });
    }
    this.setStatus(RealtimeChannelStatus.Unsubscribed);
  }

  handleSocketClosed() {
    this.setStatus(RealtimeChannelStatus.Unsubscribed);
  }

  handleMessage(message) {
    const { event, payload = {} } = message;
    if (event === "phx_reply") {
      if (message.ref == null || message.ref !== this.joinRef) return;
      if (payload.status === "ok") {
        this.setStatus(RealtimeChannelStatus.Subscribed);
      } else {
        this.setStatus(RealtimeChannelStatus.Unsubscribed);
        this.scheduleRejoin();
      }
      return;
    }
    if (event === "system") {
      if (payload.status === "ok" && this.status === RealtimeChannelStatus.Subscribing)
        this.setStatus(RealtimeChannelStatus.Subscribed);
      return;
    }
    if (event === "phx_close" || event === "phx_error") {
      if (message.join_ref != null && this.joinRef != null && message.join_ref !== this.joinRef)
        return;
      this.setStatus(RealtimeChannelStatus.Unsubscribed);
      this.scheduleRejoin();
      return;
    }
    if (event === "broadcast") {
      const name = typeof payload.event === "string" ? payload.event : "";
      const body = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
      this.broadcastListeners.forEach((listener) => listener(name, body));
      return;
    }
    if (event === "presence_state") {
      const joins = presenceStates(payload);
      this.presenceListeners.forEach((listener) => listener(joins, {}));
      return;
    }
    if (event === "presence_diff") {
      const joins = presenceStates(payload.joins);
      const leaves = presenceStates(payload.leaves);
      this.presenceListeners.forEach((listener) => listener(joins, leaves));
    }
  }

  setStatus(status) {
    if (this.status === status) return;
    const wasSubscribed = this.isSubscribed;
    this.status = status;
    if (wasSubscribed !== this.isSubscribed) {
      this.statusListeners.forEach((listener) => listener(this.isSubscribed));
    }
  }
}

export class RealtimeSocket {
  constructor({
    url,
    createWebSocket = (target) => new WebSocket(target),
    getAccessToken = async () => null,
    heartbeatIntervalMs = 15000,
    reconnectDelayMs = 3000,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (id) => clearTimeout(id),
    setRepeating = (callback, ms) => setInterval(callback, ms),
    clearRepeating = (id) => clearInterval(id)
  }) {
    this.url = url;
    this.createWebSocket = createWebSocket;
    this.getAccessToken = getAccessToken;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.setRepeating = setRepeating;
    this.clearRepeating = clearRepeating;
    this.channels = new Map();
    this.ws = null;
    this.ref = 0;
    this.pendingHeartbeatRef = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.lastSentAccessToken = null;
    this.closedByUser = false;
  }

  get isOpen() {
    return Boolean(this.ws) && this.ws.readyState === SOCKET_OPEN;
  }

  nextRef() {
    this.ref += 1;
    return String(this.ref);
  }

  async currentAccessToken() {
    try {
      return (await this.getAccessToken()) || null;
    } catch (_) {
      return null;
    }
  }

  channel(topic, options) {
    const channel = new RealtimeChannel(this, topic, options);
    const existing = this.channels.get(channel.topic);
    return existing || channel;
  }

  addChannel(channel) {
    this.channels.set(channel.topic, channel);
  }

  removeChannel(channel) {
    channel.unsubscribe();
    this.channels.delete(channel.topic);
    if (!this.channels.size) this.disconnect();
  }

  connect() {
    if (this.ws || this.reconnectTimer != null) return;
    this.closedByUser = false;
    let socket;
    try {
      socket = this.createWebSocket(this.url);
    } catch (error) {
      console.warn("[realtime] connection failed", error);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.pendingHeartbeatRef = null;
      this.startHeartbeat();
      this.channels.forEach((channel) => void channel.join());
    };
    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      this.onMessage(event?.data);
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.handleClosed();
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      try {
        socket.close();
      } catch (_) {}
      this.handleClosed();
    };
  }

  handleClosed() {
    this.stopHeartbeat();
    this.ws = null;
    this.pendingHeartbeatRef = null;
    this.channels.forEach((channel) => {
      channel.clearRejoin();
      channel.handleSocketClosed();
    });
    if (!this.closedByUser && this.channels.size) this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser && this.channels.size) this.connect();
    }, this.reconnectDelayMs);
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer != null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.ws;
    this.ws = null;
    this.pendingHeartbeatRef = null;
    this.channels.forEach((channel) => {
      channel.clearRejoin();
      channel.handleSocketClosed();
    });
    if (socket) {
      try {
        socket.close();
      } catch (_) {}
    }
  }

  push(message) {
    if (!this.isOpen) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.warn("[realtime] send failed", error);
      this.reconnectNow();
      return false;
    }
  }

  reconnectNow() {
    const socket = this.ws;
    this.handleClosed();
    if (socket) {
      try {
        socket.close();
      } catch (_) {}
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = this.setRepeating(
      () => void this.sendHeartbeat(),
      this.heartbeatIntervalMs
    );
  }

  stopHeartbeat() {
    if (this.heartbeatTimer != null) {
      this.clearRepeating(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async sendHeartbeat() {
    if (!this.isOpen) return;
    if (this.pendingHeartbeatRef != null) {
      // The previous heartbeat was never answered: the connection is stale.
      console.warn("[realtime] heartbeat timeout, reconnecting");
      this.reconnectNow();
      return;
    }
    this.pendingHeartbeatRef = this.nextRef();
    this.push({ topic: PHOENIX, event: "heartbeat", payload: {}, ref: this.pendingHeartbeatRef });
    const token = await this.currentAccessToken();
    if (token && token !== this.lastSentAccessToken) {
      this.lastSentAccessToken = token;
      this.channels.forEach((channel) => channel.updateAuth(token));
    }
  }

  onMessage(data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : null;
    } catch (_) {
      message = null;
    }
    if (!message || typeof message !== "object") return;
    if (message.topic === PHOENIX) {
      if (message.ref != null && message.ref === this.pendingHeartbeatRef)
        this.pendingHeartbeatRef = null;
      return;
    }
    this.channels.get(message.topic)?.handleMessage({ ...message, payload: message.payload || {} });
  }
}
