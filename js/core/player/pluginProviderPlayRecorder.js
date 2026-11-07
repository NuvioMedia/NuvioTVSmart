import { registerSessionTeardownHandler } from "../auth/sessionLifecycle.js";
import { PluginProviderPlaysStore } from "../../data/local/pluginProviderPlaysStore.js";
import { scraperIdFromPluginBingeGroup } from "../streams/pluginBingeGroup.js";

// Remember a plugin provider only once its playback is confirmed, with the same
// group+identity deduplication Android uses, so a re-confirmed frame or a resume does
// not inflate the play count.

let recordedIdentity = null;

export function recordDistinctPluginPlay(bingeGroup, playbackIdentity = "") {
  const group = String(bingeGroup || "").trim();
  const scraperId = scraperIdFromPluginBingeGroup(group);
  if (!scraperId) {
    return false;
  }
  const identity = String(playbackIdentity || "").trim();
  const key = `${group}|${identity}`;
  if (key === recordedIdentity) {
    return false;
  }
  recordedIdentity = key;
  PluginProviderPlaysStore.record(scraperId);
  return true;
}

export function resetPluginProviderPlayRecording() {
  recordedIdentity = null;
}

registerSessionTeardownHandler(() => resetPluginProviderPlayRecording());
