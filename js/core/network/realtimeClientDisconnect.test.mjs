import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeSocket } from "./realtimeClient.js";

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function fakeWebSocket(url) {
  return {
    url,
    readyState: 1,
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data));
    },
    receive(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    },
    close() {
      this.readyState = 3;
    }
  };
}

test("disconnect cancels a scheduled channel rejoin", async () => {
  const sockets = [];
  const socket = new RealtimeSocket({
    url: "wss://example.test",
    createWebSocket: (url) => {
      const ws = fakeWebSocket(url);
      sockets.push(ws);
      return ws;
    },
    getAccessToken: async () => null,
    reconnectDelayMs: 5
  });
  const channel = socket.channel("watch-party:p1");
  const subscribed = [];
  channel.onStatus((value) => subscribed.push(value));

  await channel.subscribe();
  sockets[0].onopen();
  await flush();
  const join = sockets[0].sent.find((message) => message.event === "phx_join");
  sockets[0].receive({
    topic: "realtime:watch-party:p1",
    event: "phx_reply",
    payload: { status: "ok", response: {} },
    ref: join.ref
  });
  assert.deepEqual(subscribed, [true]);

  // A channel error arms the rejoin timer.
  sockets[0].receive({
    topic: "realtime:watch-party:p1",
    event: "phx_error",
    payload: {},
    join_ref: join.join_ref
  });
  assert.deepEqual(subscribed, [true, false]);

  socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(sockets.length, 1, "a pending rejoin must not reopen the socket");
  assert.equal(socket.closedByUser, true);
  assert.equal(channel.status, "unsubscribed");
});
