import { parseTitleDeepLink } from "./deepLinkParser.js";

/**
 * webOS title deep links, the web side of the Android TV app's title links (launchSingleTop).
 *
 * webOS hands deep links to apps in their launch params as contentTarget, the key LG's own launcher and search
 * use: {"contentTarget": "nuvio://tmdb/movie/603"}. The link waits through authentication, profile/PIN selection
 * and initial setup, and opens once on the detail screen when navigation is ready (see Router.navigate).
 */

let pendingLaunchDeepLink = null;

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
export function readWebOsLaunchDeepLink(params = currentLaunchParams()) {
  const target = params && typeof params.contentTarget === "string" ? params.contentTarget : "";
  return target ? parseTitleDeepLink(target) : null;
}

/**
 * Keeps the link of a launch (at startup, then on each webOSLaunch/webOSRelaunch) for openPendingLaunchDeepLink.
 * A newer link replaces one still waiting; a repeat of the same launch, or a launch without a link, changes nothing.
 *
 * @param {{ params?: object }} [options]
 * @returns {{ type: "movie" | "series", id: string } | null} the title carried by this launch
 */
export function takeWebOsLaunchDeepLink({ params = currentLaunchParams() } = {}) {
  const link = readWebOsLaunchDeepLink(params);
  pendingLaunchDeepLink = link || pendingLaunchDeepLink;
  return link;
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
  if (
    !pendingLaunchDeepLink ||
    !current ||
    router.pendingMountParams ||
    startupRoutes.has(current)
  ) {
    return false;
  }
  const link = pendingLaunchDeepLink;
  pendingLaunchDeepLink = null;
  if (
    current === "detail" &&
    router.currentParams?.itemId === link.id &&
    router.currentParams?.itemType === link.type
  ) {
    return true;
  }
  await router.navigate(
    "detail",
    { itemId: link.id, itemType: link.type },
    current === "detail" ? { replaceHistory: true } : undefined
  );
  return true;
}

/** Test helper: forgets the waiting link. */
export function resetLaunchDeepLinkForTests() {
  pendingLaunchDeepLink = null;
}
