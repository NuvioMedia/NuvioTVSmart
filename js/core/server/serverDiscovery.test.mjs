import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DISCOVERY_DOCUMENT_BYTES,
  discoverServer,
  normalizeDiscoveryUrl,
  parseDiscoveryDocument
} from "./serverDiscovery.js";

const VALID_DOCUMENT = {
  version: 1,
  service: "nuvio",
  self_hosted: true,
  backend_url: "https://backend.example.com/",
  publishable_key: "public-client-key",
  capabilities: { email_password_auth: true, tv_login: true }
};

test("normalizes a public HTTPS backend to its discovery endpoint", () => {
  assert.equal(
    normalizeDiscoveryUrl("backend.example.com/"),
    "https://backend.example.com/.well-known/nuvio"
  );
  assert.equal(
    normalizeDiscoveryUrl("https://backend.example.com/.well-known/nuvio"),
    "https://backend.example.com/.well-known/nuvio"
  );
});

test("rejects insecure and private backend addresses", () => {
  assert.throws(() => normalizeDiscoveryUrl("http://backend.example.com"), {
    code: "invalid_url"
  });
  assert.throws(() => normalizeDiscoveryUrl("https://192.168.1.10"), {
    code: "invalid_url"
  });
  for (const address of [
    "https://0.0.0.0",
    "https://100.64.0.1",
    "https://172.31.255.255",
    "https://[::1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://[::ffff:192.168.1.1]"
  ]) {
    assert.throws(() => normalizeDiscoveryUrl(address), { code: "invalid_url" });
  }
});

test("parses the Nuvio self-host discovery contract", () => {
  const configuration = parseDiscoveryDocument(
    "https://backend.example.com/.well-known/nuvio",
    JSON.stringify(VALID_DOCUMENT)
  );
  assert.equal(configuration.backendUrl, "https://backend.example.com");
  assert.equal(configuration.publishableKey, "public-client-key");
  assert.deepEqual(configuration.capabilities, {
    emailPasswordAuth: true,
    tvLogin: true
  });
  assert.equal(
    configuration.avatarPublicBaseUrl,
    "https://backend.example.com/storage/v1/object/public/avatars"
  );
});

test("rejects discovery documents without a supported auth capability", () => {
  assert.throws(
    () =>
      parseDiscoveryDocument(
        "https://backend.example.com/.well-known/nuvio",
        JSON.stringify({
          ...VALID_DOCUMENT,
          capabilities: { email_password_auth: false, tv_login: false }
        })
      ),
    { code: "no_supported_auth" }
  );
});

test("rejects discovery responses larger than 64 KiB", async () => {
  const oversized = `${JSON.stringify(VALID_DOCUMENT)}${" ".repeat(MAX_DISCOVERY_DOCUMENT_BYTES)}`;
  await assert.rejects(
    discoverServer("https://backend.example.com", {
      fetchImpl: async (url) => ({
        ok: true,
        url,
        headers: { get: () => String(oversized.length) },
        text: async () => oversized
      })
    }),
    { code: "response_too_large" }
  );
});

test("times out while a discovery response body is stalled", async () => {
  await assert.rejects(
    discoverServer("https://backend.example.com", {
      timeoutMs: 5,
      fetchImpl: async (url) => ({
        ok: true,
        url,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: () => new Promise(() => {}),
            cancel: async () => {}
          })
        }
      })
    }),
    { code: "connection_failed" }
  );
});
