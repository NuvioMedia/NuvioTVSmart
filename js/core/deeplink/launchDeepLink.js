import { parseTitleDeepLink } from "./deepLinkParser.js";

/**
 * webOS title deep links, the web side of the Android TV app's title links (launchSingleTop).
 *
 * webOS hands deep links to apps in their launch params as contentTarget, the key LG's own launcher and search
 * use: {"contentTarget": "nuvio://tmdb/movie/603"}. The link waits through authentication, profile/PIN selection
 * and initial setup, and opens once on the detail screen when navigation is ready (see Router.navigate).
 */

// The same link again this soon is the same launch: a repeated event, or the first launch event after the startup
// read, which can come late while a slow TV boots.
const REPEATED_LAUNCH_MS = 2000;
const STARTUP_LAUNCH_EVENT_MS = 10000;

let pendingLaunchDeepLink = null;
let lastLaunchParams = null;
let lastLaunchAt = 0;
let startupEventPending = false;

function launchParamsOf(system) {
  let params = system?.launchParams;
  if (typeof params === "string") {
    try {
      params = JSON.parse(params || "{}");
    } catch (error) {
      params = null;
    }
  }
  return params && typeof params === "object" ? params : null;
}

function currentLaunchParams() {
  const systems = [globalThis.webOSSystem || null, globalThis.PalmSystem || null];
  for (const system of systems) {
    const params = launchParamsOf(system);
    if (params) {
      return params;
    }
  }
  return null;
}

/**
 * The title deep link in the current webOS launch params, or null.
 *
 * @returns {{ type: "movie" | "series", id: string } | null}
 */
export function readWebOsLaunchDeepLink() {
  const params = currentLaunchParams();
  const target = params && typeof params.contentTarget === "string" ? params.contentTarget : "";
  return target ? parseTitleDeepLink(target) : null;
}

/**
 * Keeps the link of a launch (at startup, then on each webOSLaunch/webOSRelaunch) for openPendingLaunchDeepLink.
 * A newer link replaces one still waiting; a repeat of the same launch, or a launch without a link, changes nothing.
 *
 * @param {{ startup?: boolean, now?: number }} [options]
 * @returns {{ type: "movie" | "series", id: string } | null} the link now waiting
 */
export function takeWebOsLaunchDeepLink({ startup = false, now = Date.now() } = {}) {
  const params = currentLaunchParams();
  const key = JSON.stringify(params?.contentTarget || "");
  const windowMs = startupEventPending ? STARTUP_LAUNCH_EVENT_MS : REPEATED_LAUNCH_MS;
  const repeated = !startup && key === lastLaunchParams && now - lastLaunchAt < windowMs;
  startupEventPending = startup;
  lastLaunchParams = key;
  lastLaunchAt = now;
  if (!repeated) {
    pendingLaunchDeepLink = readWebOsLaunchDeepLink() || pendingLaunchDeepLink;
  }
  return pendingLaunchDeepLink;
}

export function hasPendingLaunchDeepLink() {
  return Boolean(pendingLaunchDeepLink);
}

/**
 * Opens the waiting title on its detail screen once the current route is past startup, over whatever is open (as
 * Android's launchSingleTop keeps the back stack), and only once.
 *
 * @param {{ getCurrent(): string, navigate(route: string, params: object): Promise<void> }} router
 * @param {Set<string>} startupRoutes routes the link waits through (authentication, profiles, setup)
 * @returns {Promise<boolean>} whether it navigated
 */
export async function openPendingLaunchDeepLink(router, startupRoutes) {
  const current = router.getCurrent();
  if (!pendingLaunchDeepLink || !current || startupRoutes.has(current)) {
    return false;
  }
  const link = pendingLaunchDeepLink;
  pendingLaunchDeepLink = null;
  await router.navigate("detail", { itemId: link.id, itemType: link.type });
  return true;
}

/** Test helper: forgets the waiting link and the last launch. */
export function resetLaunchDeepLinkForTests() {
  pendingLaunchDeepLink = null;
  lastLaunchParams = null;
  lastLaunchAt = 0;
  startupEventPending = false;
}
