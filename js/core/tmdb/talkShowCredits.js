// Android TmdbMetadataService.isTalkShowGuestAppearance: TMDB lists every late night and
// morning show a person visited as a TV credit, which crowds out their actual work.
const TMDB_TALK_GENRE_ID = 10767;
const TALK_SHOW_HOST_CHARACTER = /\b(co-?)?host(s|ess)?\b/i;

/** A TV credit in the Talk genre where the person is not credited as the host. */
export function isTalkShowGuestAppearance(credit = {}) {
  if (credit?.media_type !== "tv") return false;
  const genreIds = Array.isArray(credit?.genre_ids) ? credit.genre_ids : [];
  if (!genreIds.some((id) => Number(id) === TMDB_TALK_GENRE_ID)) return false;
  return !TALK_SHOW_HOST_CHARACTER.test(String(credit?.character || ""));
}
