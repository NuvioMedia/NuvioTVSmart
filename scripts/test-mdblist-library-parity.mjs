import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
globalThis.__NUVIO_ENV__ = { MDBLIST_CLIENT_ID: "fixture-client" };
const { MdbListAccount: account } = await import("../js/data/repository/mdbListAccount.js");
const { MdbListLibrary: library } = await import("../js/data/repository/mdbListLibrary.js");
const codec = await import("../js/data/repository/mdbListLibraryCodec.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
let scope = account.scope();
localStorage.setItem(
  "mdbListAccounts",
  JSON.stringify({
    1: {
      generation: scope.generation,
      tokens: { accessToken: "fixture", refreshToken: "refresh", expiresAt: Date.now() + 3600000 },
      user: { id: 7 }
    }
  })
);
let calls = [],
  failDynamic = false,
  loopCursor = false,
  failLiked = false,
  rate = false;
const movie = {
  id: 42,
  mediatype: "movie",
  title: "Fixture",
  ids: { imdb: "tt0042", tmdb: 42 },
  poster: "/p.jpg"
};
globalThis.fetch = async (raw, options) => {
  const url = new URL(raw),
    path = url.pathname;
  calls.push([
    path,
    options.method,
    url.searchParams.get("offset"),
    url.searchParams.get("sort"),
    url.searchParams.get("order")
  ]);
  let data;
  if (rate) return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
  if (path === "/lists/user/add")
    return new Response(JSON.stringify({ id: 99, name: "Created" }), { status: 200 });
  if (path === "/lists/99" && options.method === "PUT")
    return new Response(
      JSON.stringify({ id: 99, name: "Renamed", success: true, private: false }),
      { status: 200 }
    );
  if (path === "/lists/99" && options.method === "DELETE")
    return new Response(null, { status: 204 });
  if (path === "/lists/user")
    data = [
      { id: 1, type: "static", private: false, name: "Static", user_id: 7, updated_at: "a" },
      { id: 2, type: "dynamic", name: "Dynamic", user_id: 7, updated_at: "a" }
    ];
  else if (path === "/external/lists/user") data = [{ id: 3, name: "External", updated_at: "a" }];
  else if (path === "/lists/liked") {
    if (failLiked) return new Response("{}", { status: 500 });
    data =
      url.searchParams.get("offset") === "100"
        ? { lists: [{ id: 4, name: "Liked", user_id: 8 }], pagination: { has_more: false } }
        : {
            lists: [
              { id: 9, name: "Owned", user_id: 7 },
              { id: 4, name: "Liked", user_id: 8 }
            ],
            pagination: { offset: 0, limit: 100, has_more: true }
          };
  } else if (path.endsWith("/add") || path.endsWith("/remove"))
    data = {
      added: { movies: 1 },
      existing: { movies: 0 },
      removed: { movies: 1 },
      not_found: { movies: 0 }
    };
  else if (path.endsWith("/items")) {
    if (failDynamic && path === "/lists/2/items") return new Response("{}", { status: 500 });
    if (loopCursor && path === "/lists/1/items")
      return new Response(JSON.stringify({ items: [movie] }), {
        status: 200,
        headers: { "X-Next-Cursor": "repeated" }
      });
    const second = {
      ...movie,
      id: 43,
      ids: { imdb: "tt0043", tmdb: 43 },
      title: "Second",
      release_date: "2024-01-01"
    };
    const first = { ...movie, release_date: "2020-01-01" };
    let rows = path === "/lists/1/items" ? [first, second] : [movie];
    if (url.searchParams.get("sort") === "added" && url.searchParams.get("order") === "asc")
      rows.reverse();
    data = { items: rows };
  } else throw new Error("Unexpected " + path);
  return new Response(JSON.stringify(data), { status: 200 });
};
let snapshot = await library.snapshot();
assert.deepEqual(
  snapshot.tabs.map((t) => t.key),
  [
    "mdblist:watchlist",
    "mdblist:list:1",
    "mdblist:dynamic:2",
    "mdblist:external:3",
    "mdblist:liked:4"
  ]
);
assert.equal((await library.entries()).length, 2);
assert.equal((await library.entries())[0].listKeys.length, 5);
assert.equal(snapshot.tabs.find((t) => t.key === "mdblist:liked:4").isMembershipDestination, false);
assert.deepEqual(await library.order("mdblist:list:1", "added_desc"), [
  "movie:tt0043",
  "movie:tt0042"
]);
assert.deepEqual(await library.order("mdblist:list:1", "added_asc"), [
  "movie:tt0042",
  "movie:tt0043"
]);
assert.deepEqual(await library.order("mdblist:list:1", "released_desc"), [
  "movie:tt0043",
  "movie:tt0042"
]);
const orderCalls = calls.length;
assert.deepEqual(await library.order("mdblist:list:1", "released_asc"), [
  "movie:tt0042",
  "movie:tt0043"
]);
assert.equal(calls.length, orderCalls);
assert(calls.some((c) => c[3] === "added" && c[4] === "asc"));
assert(calls.some((c) => c[3] === "released" && c[4] === "desc"));
const before = calls.length;
await Promise.all([library.tabs(), library.entries()]);
assert.equal(calls.length, before);
await library.applyMembershipChanges(
  { itemId: "tt0042", itemType: "movie" },
  { desiredMembership: { "mdblist:dynamic:2": false, "mdblist:liked:4": false } }
);
assert.equal(calls.length, before);
await library.applyMembershipChanges(
  { itemId: "tt0042", itemType: "movie" },
  { desiredMembership: { "mdblist:watchlist": false } }
);
assert.equal(
  (await library.membership({ id: "tmdb:42", type: "movie" })).listMembership["mdblist:watchlist"],
  false
);
await library.setVisible("mdblist:dynamic:2", false);
calls = [];
snapshot = await library.snapshot();
assert(!calls.some((c) => c[0] === "/lists/2/items"));
assert(!(await library.tabs()).some((t) => t.key === "mdblist:dynamic:2"));
failLiked = true;
snapshot = await library.snapshot({ force: true });
assert(snapshot.tabs.some((t) => t.key === "mdblist:liked:4"));
assert.equal(snapshot.items["mdblist:liked:4"].length, 1);
assert.throws(() => codec.mdbListNextPage({ pagination: { has_more: true, offset: 0, limit: 0 } }));
assert.throws(() => codec.mdbListItemsPath("mdblist:list:../1"));
const aliases = codec.projectMdbListEntries({
  items: {
    a: codec.decodeMdbListItems([{ id: 42, type: "movie" }]),
    b: codec.decodeMdbListItems([movie])
  },
  hidden: []
});
assert.equal(aliases.length, 1);
assert.equal(aliases[0].id, "tt0042");
// Hidden-to-visible transitions are atomic when downloading the list fails.
failDynamic = true;
await assert.rejects(library.setVisible("mdblist:dynamic:2", true));
assert((await library.snapshot()).hidden.includes("mdblist:dynamic:2"));
failDynamic = false;
await library.setVisible("mdblist:dynamic:2", true);
assert(!(await library.snapshot()).hidden.includes("mdblist:dynamic:2"));
loopCursor = true;
await assert.rejects(
  library.snapshot({ force: true }),
  (e) => e.code === "mdblist_invalid_response"
);
loopCursor = false;
const created = await library.createList("Created", null, "private");
assert.equal(created, "mdblist:list:99");
await library.updateList(created, "Renamed", null, "public");
assert.equal((await library.tabs()).find((t) => t.key === created).title, "Renamed");
await library.deleteList(created);
assert(!(await library.tabs()).some((t) => t.key === created));
await assert.rejects(library.createList("Invalid", null, "friends"));
const beforeReadOnly = calls.length;
await assert.rejects(library.updateList("mdblist:dynamic:2", "Bad", null, "private"));
assert.equal(calls.length, beforeReadOnly);
// Exercise batch limits against fresh and existing snapshots through the real sync path.
const originalFetch = globalThis.fetch;
const originalCache = localStorage.getItem("mdbListLibraries");
let dynamicCount = 0,
  likedCount = 0,
  repeatKind = "",
  pageCalls = [];
const rows = (count, type, start) =>
  Array.from({ length: count }, (_, i) => ({
    id: start + i,
    type,
    name: `List ${start + i}`,
    user_id: type === "dynamic" ? 7 : 8
  }));
globalThis.fetch = async (raw) => {
  const url = new URL(raw),
    path = url.pathname;
  let data;
  if (path === "/lists/user") data = rows(dynamicCount, "dynamic", 100);
  else if (path === "/lists/liked") data = { lists: rows(likedCount, "static", 200) };
  else if (path === "/external/lists/user") data = [{ id: 300, name: "External" }];
  else if (path.endsWith("/items")) {
    pageCalls.push(path);
    const offset = Number(url.searchParams.get("offset") || 0);
    if (repeatKind && path === "/external/lists/300/items") {
      if (offset > 2000) throw new Error("Pagination did not stop");
      data = {
        items:
          repeatKind === "empty" && offset === 1000
            ? []
            : repeatKind === "large"
              ? Array.from({ length: 1000 }, (_, i) => ({
                  ...movie,
                  ids: { imdb: `tt${offset + i + 10000}` }
                }))
              : [movie],
        pagination: { offset, limit: 1000, has_more: offset < 2000 }
      };
    } else data = { items: [movie] };
  } else throw new Error(path);
  return new Response(JSON.stringify(data), { status: 200 });
};
for (const [dynamic, liked, hiddenDynamic, hiddenLiked] of [
  [10, 0, 0, 0],
  [11, 0, 11, 0],
  [0, 10, 0, 0],
  [0, 11, 0, 11],
  [6, 5, 0, 5],
  [11, 1, 11, 1]
]) {
  localStorage.removeItem("mdbListLibraries");
  dynamicCount = dynamic;
  likedCount = liked;
  pageCalls = [];
  const result = await library.snapshot({ force: true });
  assert.equal(result.hidden.filter((k) => k.startsWith("mdblist:dynamic:")).length, hiddenDynamic);
  assert.equal(result.hidden.filter((k) => k.startsWith("mdblist:liked:")).length, hiddenLiked);
  assert(pageCalls.includes("/external/lists/300/items"));
  for (const key of result.hidden) assert(!pageCalls.includes(codec.mdbListItemsPath(key)));
  const repeated = await library.snapshot({ force: true });
  assert.deepEqual(repeated.hidden, result.hidden, "existing visibility survives refresh");
}
// Existing visible lists do not count towards the new batch; deleted hidden keys are pruned.
localStorage.removeItem("mdbListLibraries");
dynamicCount = 1;
likedCount = 0;
await library.snapshot({ force: true });
dynamicCount = 12;
let batch = await library.snapshot({ force: true });
assert(!batch.hidden.includes("mdblist:dynamic:100"));
assert.equal(batch.hidden.length, 11);
await library.setVisible("mdblist:dynamic:101", true);
assert(!(await library.snapshot()).hidden.includes("mdblist:dynamic:101"));
dynamicCount = 1;
assert.deepEqual((await library.snapshot({ force: true })).hidden, []);
for (const kind of ["repeat", "empty", "large"]) {
  repeatKind = kind;
  pageCalls = [];
  batch = await library.snapshot({ force: true });
  assert.equal(batch.items["mdblist:external:300"].length, kind === "large" ? 3000 : 1);
  assert.equal(
    pageCalls.filter((p) => p === "/external/lists/300/items").length,
    kind === "repeat" ? 2 : 3
  );
}
globalThis.fetch = originalFetch;
localStorage.setItem("mdbListLibraries", originalCache);

// A delayed response belonging to profile 1 cannot commit into profile 2.
let release;
globalThis.fetch = () =>
  new Promise((resolve) => {
    release = () => resolve(new Response("[]", { status: 200 }));
  });
const pending = library.snapshot({ force: true });
while (!release) await new Promise((r) => setTimeout(r, 0));
await ProfileManager.setActiveProfile("2");
release();
await assert.rejects(pending, (e) => e.code === "mdblist_scope_changed");
assert.equal(JSON.parse(localStorage.getItem("mdbListLibraries"))["2"], undefined);
await ProfileManager.setActiveProfile("1");
rate = true;
globalThis.fetch = async () => new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
await assert.rejects(library.snapshot({ force: true }), (e) => e.status === 429);
console.log(
  "MDBList parity fixtures passed: categories, pagination, aliases, read-only mutations, cache, hidden lists, partial failure, profile race, 429."
);
