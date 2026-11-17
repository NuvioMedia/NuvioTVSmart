import test from "node:test";
import assert from "node:assert/strict";
import {
  getEmbeddedTrackContainerExtension,
  isEmbeddedTrackContainerSupported,
  isTerminalTrackDiscoveryResponse
} from "./embeddedTrackSupport.js";

test("container extension prefers the filename hint over an extensionless URL", () => {
  assert.equal(
    getEmbeddedTrackContainerExtension(
      "https://nexus.example/dld/569b9b4b?token=abc",
      "Così.Per.Gioco.avi"
    ),
    "avi"
  );
  assert.equal(getEmbeddedTrackContainerExtension("https://host/movie.MKV?token=1", ""), "mkv");
  assert.equal(getEmbeddedTrackContainerExtension("https://host/dld/uuid?token=1.2", ""), "");
});

test("known unsupported containers are skipped, unknown ones are still probed", () => {
  assert.equal(
    isEmbeddedTrackContainerSupported("https://host/dld/uuid?token=1", "movie.avi"),
    false
  );
  assert.equal(isEmbeddedTrackContainerSupported("https://host/movie.wmv", ""), false);
  assert.equal(isEmbeddedTrackContainerSupported("https://host/movie.ts", ""), false);
  assert.equal(isEmbeddedTrackContainerSupported("https://host/dld/uuid", "movie.mkv"), true);
  assert.equal(isEmbeddedTrackContainerSupported("https://host/movie.mp4", ""), true);
  assert.equal(isEmbeddedTrackContainerSupported("https://host/movie.3gp", ""), true);
  assert.equal(isEmbeddedTrackContainerSupported("https://host/dld/uuid?token=1", ""), true);
  assert.equal(isEmbeddedTrackContainerSupported("", ""), true);
});

test("terminal track responses stop retries", () => {
  assert.equal(isTerminalTrackDiscoveryResponse({ statusCode: 415 }), true);
  assert.equal(isTerminalTrackDiscoveryResponse({ terminal: true }), true);
  assert.equal(isTerminalTrackDiscoveryResponse({ returnValue: false, statusCode: 500 }), false);
  assert.equal(isTerminalTrackDiscoveryResponse({ tracks: [] }), false);
  assert.equal(isTerminalTrackDiscoveryResponse(null), false);
});
