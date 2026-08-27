// Continue Watching card artwork selection, ported from the Android app.
//
// Poster style shows a portrait poster, so it must ignore the episode thumbnail
// setting and prefer the poster then the backdrop, never the landscape episode
// still. This mirrors continueWatchingUsesEpisodeThumbnails and
// continueWatchingImageModel (preferPosterArtwork) on Android.

export function continueWatchingUsesEpisodeThumbnails(cardStyle, useEpisodeThumbnails) {
  return useEpisodeThumbnails !== false && String(cardStyle || "card") !== "poster";
}

export function continueWatchingImageSources(art = {}, options = {}) {
  const { poster, backdrop, thumbnail, episodeThumbnail, background } = art;
  const isNextUp = Boolean(options.isNextUp);
  const hasAired = options.hasAired !== false;

  if (String(options.cardStyle || "card") === "poster") {
    return [poster, backdrop, background];
  }

  if (continueWatchingUsesEpisodeThumbnails(options.cardStyle, options.useEpisodeThumbnails)) {
    if (!isNextUp) {
      return [episodeThumbnail, backdrop, poster, thumbnail, background];
    }
    if (!hasAired) {
      return [backdrop, poster, thumbnail, background, episodeThumbnail];
    }
    return [thumbnail, episodeThumbnail, backdrop, poster, background];
  }

  return [backdrop, poster, thumbnail, episodeThumbnail, background];
}
