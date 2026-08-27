import { test } from "node:test";
import assert from "node:assert/strict";

import { isTraktRefreshTokenRejected } from "./traktRefreshFailure.js";

test("a rejected refresh token clears the credentials", () => {
  assert.equal(isTraktRefreshTokenRejected(400), true);
  assert.equal(isTraktRefreshTokenRejected(401), true);
  assert.equal(isTraktRefreshTokenRejected(403), true);
});

test("other failures keep the credentials for a later retry", () => {
  assert.equal(isTraktRefreshTokenRejected(429), false);
  assert.equal(isTraktRefreshTokenRejected(500), false);
  assert.equal(isTraktRefreshTokenRejected(502), false);
  assert.equal(isTraktRefreshTokenRejected(0), false);
});
