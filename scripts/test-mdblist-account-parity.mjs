import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
globalThis.__NUVIO_ENV__ = { MDBLIST_CLIENT_ID: "fixture" };
const { MdbListAccount: a } = await import("../js/data/repository/mdbListAccount.js");
const { ProfileManager: p } = await import("../js/core/profile/profileManager.js");
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
let pollCount = 0,
  refreshCount = 0;
globalThis.fetch = async (raw, opt) => {
  const path = new URL(raw).pathname,
    form = new URLSearchParams(opt.body);
  if (path === "/oauth/device-authorization/")
    return response({
      device_code: "device",
      user_code: "code",
      verification_uri: "https://mdblist.com/device",
      interval: 1,
      expires_in: 600
    });
  if (path === "/oauth/token/" && form.get("grant_type") === "refresh_token") {
    refreshCount++;
    return response({
      access_token: "new",
      refresh_token: "renewed",
      token_type: "Bearer",
      scope: "write",
      expires_in: 3600
    });
  }
  if (path === "/oauth/token/") {
    pollCount++;
    if (pollCount === 1) return response({ error: "slow_down" }, 400);
    return response({
      access_token: "old",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "write",
      expires_in: 3600
    });
  }
  if (path === "/user") return response({ user_id: 7, username: "fixture-user", name: "Fixture" });
  if (path === "/oauth/revoke_token/") return response({ success: true });
  throw new Error(path);
};
const session = await a.start();
assert.equal(await a.poll(session), false);
assert.equal(pollCount, 0);
session.nextPollAt = 0;
assert.equal(await a.poll(session), false);
assert.equal(session.interval, 6);
session.nextPollAt = 0;
assert.equal(await a.poll(session), true);
assert(a.connected());
assert.equal(a.user().id, 7);
assert.equal(a.user().name, "fixture-user");
const scope = a.scope();
assert.deepEqual(
  await Promise.all([a.authorization(scope, "old"), a.authorization(scope, "old")]),
  ["new", "new"]
);
assert.equal(refreshCount, 1);
assert(await a.disconnect());
assert(!a.connected());
await assert.rejects(a.authorization(scope), (e) => e.code === "mdblist_scope_changed");
globalThis.fetch = async () =>
  response({
    device_code: "device",
    user_code: "code",
    verification_uri: "https://evil.test/device",
    interval: 1,
    expires_in: 600
  });
await assert.rejects(a.start(), (e) => e.code === "mdblist_invalid_response");
// Canceled authorization must not save credentials after an in-flight request.
globalThis.fetch = async () =>
  response({
    device_code: "device",
    user_code: "code",
    verification_uri: "https://mdblist.com/device",
    interval: 1,
    expires_in: 600
  });
const cancelled = await a.start();
cancelled.nextPollAt = 0;
let release;
globalThis.fetch = () =>
  new Promise(
    (r) =>
      (release = () =>
        r(
          response({
            access_token: "stale",
            refresh_token: "stale",
            token_type: "Bearer",
            expires_in: 3600
          })
        ))
  );
let active = true;
const pending = a.poll(cancelled, () => active);
while (!release) await new Promise((r) => setTimeout(r, 0));
active = false;
release();
await assert.rejects(pending, (e) => e.code === "mdblist_scope_changed");
assert(!a.connected());
await p.setActiveProfile("2");
assert(!a.connected());
console.log(
  "MDBList auth fixtures passed: pending/slow_down, account lookup, single-flight refresh, disconnect, URL validation and canceled-token race."
);
