import assert from "node:assert/strict";
import { test } from "node:test";

import { addonRepository } from "./addonRepository.js";

test("single addon refresh notifies manifest listeners like bulk refresh", async () => {
  const originalFetchAddon = addonRepository.fetchAddon;
  addonRepository.fetchAddon = async () => ({ status: "success", data: { name: "Test" } });
  try {
    const reasons = [];
    let manifestNotifications = 0;
    const unsubscribeInstalled = addonRepository.onInstalledAddonsChanged((reason) => {
      reasons.push(reason);
    });
    const unsubscribeManifest = addonRepository.onManifestCacheChanged(() => {
      manifestNotifications += 1;
    });
    try {
      const result = await addonRepository.refreshAddon("https://example.com/addon");
      assert.equal(result.status, "success");
      assert.ok(reasons.includes("refresh"));
      assert.equal(manifestNotifications, 1);
    } finally {
      unsubscribeInstalled();
      unsubscribeManifest();
    }
  } finally {
    addonRepository.fetchAddon = originalFetchAddon;
  }
});
