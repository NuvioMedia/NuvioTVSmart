import { normalizeContinueWatchingClickAction } from "../../../data/local/layoutPreferences.js";

/**
 * Android ContinueWatchingClickAction.opensDetails: whether selecting a Continue
 * Watching card opens the title's details instead of its stream. The item menu
 * (resume, start over, play manually) always opens the stream.
 */
export function continueWatchingClickOpensDetails(action, item = null) {
  switch (normalizeContinueWatchingClickAction(action)) {
    case "DETAILS":
      return true;
    case "DETAILS_FOR_UPCOMING":
      return Boolean(item?.isNextUp) && item?.hasAired === false;
    default:
      return false;
  }
}
