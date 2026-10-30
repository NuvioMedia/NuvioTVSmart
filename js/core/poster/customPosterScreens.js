export const CUSTOM_POSTER_SCREENS = [
  "home",
  "continue_watching",
  "collections",
  "library",
  "search",
  "details",
  "tv_recommendations"
];

export function toggleCustomPosterScreen(selectedScreens, screen) {
  const selected = new Set(
    Array.isArray(selectedScreens) ? selectedScreens : CUSTOM_POSTER_SCREENS
  );
  if (selected.has(screen)) {
    selected.delete(screen);
  } else {
    selected.add(screen);
  }
  return CUSTOM_POSTER_SCREENS.filter((key) => selected.has(key));
}
