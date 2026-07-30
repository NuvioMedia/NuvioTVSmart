import assert from "node:assert/strict";
import test from "node:test";

import { AuthManager } from "../auth/authManager.js";
import { AuthState } from "../auth/authState.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileSyncService, shouldTryProfileTableFallback } from "./profileSyncService.js";

test("profile table fallback is limited to a missing profiles RPC", () => {
  assert.equal(shouldTryProfileTableFallback({ status: 404 }), true);
  assert.equal(shouldTryProfileTableFallback({ code: "PGRST202" }), true);
  assert.equal(
    shouldTryProfileTableFallback({
      detail: "Could not find the function public.sync_pull_profiles"
    }),
    true
  );

  assert.equal(shouldTryProfileTableFallback({ status: 502 }), false);
  assert.equal(shouldTryProfileTableFallback({ status: 401 }), false);
  assert.equal(shouldTryProfileTableFallback(new TypeError("Failed to fetch")), false);
});

test("a transient profiles RPC failure does not issue a legacy table request", async () => {
  const previousState = AuthManager.state;
  const previousRpc = SupabaseApi.rpc;
  const previousSelect = SupabaseApi.select;
  const previousWarn = console.warn;
  let selectCalls = 0;

  AuthManager.state = AuthState.AUTHENTICATED;
  console.warn = () => {};
  SupabaseApi.rpc = async () => {
    const error = new Error("Bad gateway");
    error.status = 502;
    throw error;
  };
  SupabaseApi.select = async () => {
    selectCalls += 1;
    return [];
  };

  try {
    assert.deepEqual(await ProfileSyncService.pull(), []);
    assert.equal(selectCalls, 0);
  } finally {
    AuthManager.state = previousState;
    SupabaseApi.rpc = previousRpc;
    SupabaseApi.select = previousSelect;
    console.warn = previousWarn;
  }
});
