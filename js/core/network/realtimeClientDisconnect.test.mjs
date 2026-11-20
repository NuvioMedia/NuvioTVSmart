import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeSocket } from "./realtimeClient.js";

test("realtimeClient.disconnect clears channel rejoin timers", () => {
  let cleared = 0;
  let closed = 0;
  const socket = new RealtimeSocket({ url: "wss://example.test", apiKey: "k" });
  socket.channels.set("topic:1", {
    clearRejoin() {
      cleared += 1;
    },
    handleSocketClosed() {
      closed += 1;
    }
  });
  socket.disconnect();
  assert.equal(cleared, 1);
  assert.equal(closed, 1);
});
