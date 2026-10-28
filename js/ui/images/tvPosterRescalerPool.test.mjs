import { test } from "node:test";
import assert from "node:assert/strict";

// The pool has to be driven for real to show these: both defects are about
// what happens between a job being queued and a worker answering, so a mocked
// worker is the only way to hold a job open and inspect the result.
Object.defineProperty(globalThis, "navigator", {
  value: { hardwareConcurrency: 2, deviceMemory: 1 },
  configurable: true
});

const created = [];
const revoked = [];
let nextUrl = 0;
URL.createObjectURL = () => `blob:fake-${(nextUrl += 1)}`;
URL.revokeObjectURL = (url) => revoked.push(url);

class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    created.push(this);
  }
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;

const { rescaleHomeArtwork, releaseHomeArtwork, resetHomeArtworkRescaler } =
  await import("./tvPosterRescaler.js");

function reset() {
  resetHomeArtworkRescaler();
  created.length = 0;
  revoked.length = 0;
}

/** Answer every job the pool has handed out, newest batch included. */
function drain() {
  let answered = 0;
  for (let round = 0; round < 2000; round += 1) {
    const worker = created.find((candidate) => !candidate.terminated && candidate.posted.length);
    if (!worker) {
      return answered;
    }
    const job = worker.posted.shift();
    worker.onmessage({ data: { id: job.id, ok: true, blob: { size: 1 } } });
    answered += 1;
  }
  return answered;
}

const BOX = { width: 220, height: 338, fit: "cover" };

test("two cards sharing one rescale each hold a reference to its url", async () => {
  reset();
  // Both cards ask for the same artwork before the worker answers, so they
  // share one job and one url.
  const first = rescaleHomeArtwork("https://art/shared.jpg", BOX);
  const second = rescaleHomeArtwork("https://art/shared.jpg", BOX);
  drain();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, "both cards must get the same url");

  // One card scrolls away and hands its reference back. The other is still
  // painting from the url, so it must survive cache pressure.
  releaseHomeArtwork(a);
  for (let index = 0; index < 220; index += 1) {
    const filler = rescaleHomeArtwork(`https://art/filler-${index}.jpg`, BOX);
    drain();
    releaseHomeArtwork(await filler);
  }
  assert.ok(
    !revoked.includes(a),
    "a url a second card is still painting must not be revoked when the cache is trimmed"
  );
});

test("a shared url is reclaimed once every card has released it", async () => {
  reset();
  const first = rescaleHomeArtwork("https://art/both.jpg", BOX);
  const second = rescaleHomeArtwork("https://art/both.jpg", BOX);
  drain();
  const [a, b] = await Promise.all([first, second]);
  releaseHomeArtwork(a);
  releaseHomeArtwork(b);
  for (let index = 0; index < 220; index += 1) {
    const filler = rescaleHomeArtwork(`https://art/spill-${index}.jpg`, BOX);
    drain();
    releaseHomeArtwork(await filler);
  }
  assert.ok(revoked.includes(a), "nothing holds the url any more, so the slot must be reclaimed");
});

test("tearing the pool down settles the jobs a worker is still holding", async () => {
  reset();
  const running = rescaleHomeArtwork("https://art/inflight.jpg", BOX);
  assert.ok(
    created.some((worker) => worker.posted.length),
    "the job must actually be with a worker before teardown"
  );
  resetHomeArtworkRescaler();
  assert.equal(
    await running,
    null,
    "a caller waiting on a dead pool must fall back to the original url"
  );
});

test("tearing the pool down settles queued jobs and every shared waiter", async () => {
  reset();
  // More jobs than workers, so some are still in the queue at teardown.
  const promises = [
    rescaleHomeArtwork("https://art/q1.jpg", BOX),
    rescaleHomeArtwork("https://art/q2.jpg", BOX),
    rescaleHomeArtwork("https://art/q3.jpg", BOX),
    rescaleHomeArtwork("https://art/q4.jpg", BOX),
    rescaleHomeArtwork("https://art/q1.jpg", BOX)
  ];
  resetHomeArtworkRescaler();
  assert.deepEqual(await Promise.all(promises), [null, null, null, null, null]);
});

test("teardown never produces a url from a dead pool", async () => {
  reset();
  const running = rescaleHomeArtwork("https://art/late.jpg", BOX);
  const worker = created.find((candidate) => candidate.posted.length);
  const job = worker.posted.shift();
  resetHomeArtworkRescaler();
  // A reply that was already in flight when the pool went away.
  worker.onmessage({ data: { id: job.id, ok: true, blob: { size: 1 } } });
  assert.equal(await running, null, "artwork from a torn-down pool must never be handed to a card");
});

test("an unsupported fit is refused before any worker is started", async () => {
  reset();
  assert.equal(
    await rescaleHomeArtwork("https://art/x.jpg", { width: 220, height: 338, fit: "contain" }),
    null
  );
  assert.equal(created.length, 0, "nothing should spin up for artwork that cannot be rescaled");
});
