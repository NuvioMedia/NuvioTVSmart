// Whether a library status destination accepts the given content type.
// Mirrors the Android LibraryListTab.supportsMembershipFor check so a movie is
// not offered a series only status such as Watching or On Hold. A tab with no
// declared content types accepts anything, and "series" also covers tv, show
// and anime items.
const SERIES_ALIASES = ["tv", "show", "anime"];

export function tabSupportsContentType(tab, contentType) {
  if (!tab || tab.isMembershipDestination === false) {
    return false;
  }
  const supported = tab.supportedContentTypes;
  if (supported == null) {
    return true;
  }
  const type = String(contentType || "").toLowerCase();
  return supported.some((value) => {
    const normalized = String(value).toLowerCase();
    return normalized === type || (normalized === "series" && SERIES_ALIASES.includes(type));
  });
}
