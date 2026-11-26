import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = {
  NUVIO_SUPABASE_URL: "https://primary.supabase.co",
  NUVIO_SUPABASE_FALLBACK_URL: "https://fallback.supabase.co",
  NUVIO_SUPABASE_ANON_KEY: "anon-key"
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

const { fetchSupabaseAuth } = await import("./supabaseAuthFetch.js");

test("fetchSupabaseAuth skips response.clone() on 200 OK even when body mentions cloudflare, while falling back on 403", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), hasSignal: Boolean(init.signal) });
      return {
        ok: true,
        status: 200,
        clone() {
          throw new Error("must not clone ok responses");
        },
        text: async () => '{"note":"cloudflare"}'
      };
    };
    const okRes = await fetchSupabaseAuth("/auth/v1/user");
    assert.equal(okRes.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hasSignal, true);

    calls.length = 0;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("https://primary.supabase.co")) {
        return {
          ok: false,
          status: 403,
          clone() {
            return { text: async () => "cf-error-code cloudflare challenge" };
          }
        };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const fallbackRes = await fetchSupabaseAuth("/auth/v1/user");
    assert.equal(fallbackRes.status, 200);
    assert.deepEqual(calls, [
      "https://primary.supabase.co/auth/v1/user",
      "https://fallback.supabase.co/auth/v1/user"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
