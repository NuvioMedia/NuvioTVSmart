// Add-ons and watch progress handed to the TV from outside the app.
//
// Without a Nuvio account, add-ons and progress live only in this TV's local
// storage, and typing a long add-on URL with a remote is impractical. The
// local server on the TV (vidaa/serve.cjs) keeps an inbox, filled from a phone
// (its page on port 8101) or over SSH, e.g. when moving a Stremio setup over.
// Entries are add-on URLs (strings), { remove: "<add-on URL>" } objects, or
// { progress: {...} } objects in the shape the player saves. From the first Home paint on, this applies whatever
// is waiting, checking again every POLL_MS while the app is on screen, and
// tells the server which entries it took.
import { addonRepository } from "../../data/repository/addonRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";

const INBOX_PATH = "/__nuvio/addon-inbox";
const POLL_MS = 30 * 1000;

let pollTimer = 0;

export function startVidaaAddonInbox() {
  if (pollTimer) return;
  void importVidaaAddonInbox();
  pollTimer = setInterval(() => {
    if (!document.hidden) void importVidaaAddonInbox();
  }, POLL_MS);
}

const isAddonUrl = (entry) => typeof entry === "string" && /^https?:\/\//i.test(entry);
const isRemoval = (entry) =>
  Boolean(entry && typeof entry === "object" && typeof entry.remove === "string");
const isProgress = (entry) =>
  Boolean(entry && typeof entry === "object" && entry.progress && entry.progress.contentId);

export async function importVidaaAddonInbox() {
  let entries = [];
  try {
    const response = await fetch(INBOX_PATH, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    entries = Array.isArray(body) ? body : [];
  } catch (_) {
    return;
  }
  if (!entries.length || !addonRepository.canEdit()) return;

  const taken = [];
  for (const entry of entries.filter(isAddonUrl)) {
    try {
      await addonRepository.addAddon(entry);
      taken.push(entry);
    } catch (error) {
      console.warn("Add-on from inbox failed", entry, error);
    }
  }
  for (const entry of entries.filter(isRemoval)) {
    try {
      await addonRepository.removeAddon(entry.remove);
      taken.push(entry);
    } catch (error) {
      console.warn("Add-on removal from inbox failed", entry.remove, error);
    }
  }
  const progress = entries.filter(isProgress);
  if (progress.length) {
    try {
      await watchProgressRepository.saveProgressBatch(
        progress.map((entry) => entry.progress),
        { syncRemote: false }
      );
      taken.push(...progress);
    } catch (error) {
      console.warn("Progress from inbox failed", error);
    }
  }
  if (!taken.length) return;
  try {
    await fetch(`${INBOX_PATH}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(taken)
    });
  } catch (_) {
    // The next start applies them again: known add-ons are skipped and
    // progress entries overwrite themselves.
  }
}
