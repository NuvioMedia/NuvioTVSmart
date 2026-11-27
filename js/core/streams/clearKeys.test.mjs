import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildClearKeyKeyIdsInitData,
  buildClearKeyLicense,
  hasClearKeys,
  normalizeClearKeyValue,
  normalizeClearKeys,
  parseClearKeys
} from "./clearKeys.js";

const kid = "00112233445566778899aabbccddeeff";
const key = "ffeeddccbbaa99887766554433221100";
const kidB64 = "ABEiM0RVZneImaq7zN3u_w";
const keyB64 = "_-7dzLuqmYh3ZlVEMyIRAA";

test("clear keys: string, object and array shapes normalize to one form", () => {
  assert.equal(normalizeClearKeys(`${kid}:${key}`), `${kid}:${key}`);
  assert.equal(normalizeClearKeys(`${kid.toUpperCase()}:${key.toUpperCase()}`), `${kid}:${key}`);
  assert.equal(normalizeClearKeys({ [kid]: key }), `${kid}:${key}`);
  assert.equal(normalizeClearKeys([{ kid, k: key }]), `${kid}:${key}`);
  assert.equal(normalizeClearKeys([{ kid: kidB64, k: keyB64 }]), `${kid}:${key}`);
  assert.equal(normalizeClearKeys([[kid, key]]), `${kid}:${key}`);
  assert.equal(
    normalizeClearKeys("00112233-4455-6677-8899-aabbccddeeff:ffeeddccbbaa99887766554433221100"),
    `${kid}:${key}`
  );
});

test("clear keys: two pairs survive, duplicate and malformed entries are dropped", () => {
  const second = "0123456789abcdef0123456789abcdef";
  const secondKey = "fedcba9876543210fedcba9876543210";
  assert.deepEqual(parseClearKeys(`${kid}:${key},${kid}:${key};${second}:${secondKey}`), [
    { kid, key },
    { kid: second, key: secondKey }
  ]);
  assert.equal(normalizeClearKeys({ [kid]: "0011" }), null);
  assert.equal(normalizeClearKeys("nokey"), null);
  assert.equal(normalizeClearKeys(42), null);
  assert.equal(normalizeClearKeys(null), null);
  assert.equal(normalizeClearKeys(undefined), null);
  assert.equal(hasClearKeys(`${kid}:${key}`), true);
  assert.equal(hasClearKeys(""), false);
});

test("clear keys: 16-byte values only", () => {
  assert.equal(normalizeClearKeyValue(kid), kid);
  assert.equal(normalizeClearKeyValue(kidB64), kid);
  assert.equal(normalizeClearKeyValue("AAAA"), null);
});

test("clear keys: keyids init data and license carry base64url values", () => {
  const pairs = parseClearKeys(`${kid}:${key}`);
  assert.equal(
    new TextDecoder().decode(buildClearKeyKeyIdsInitData(pairs)),
    `{"kids":["${kidB64}"]}`
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(buildClearKeyLicense(pairs))), {
    keys: [{ kty: "oct", kid: kidB64, k: keyB64 }],
    type: "temporary"
  });
});
