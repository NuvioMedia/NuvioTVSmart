import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonCredits,
  calculatePersonAge,
  filmographyView,
  parsePersonDate,
  releaseYearSortKey,
  shouldPreferCrewCredits
} from "../js/core/tmdb/personCredits.js";

// Android TmdbMetadataService.fetchPersonDetail and CastDetailScreen (e13bf2275, 51ebccc1c).
const movie = (id, title, date, vote, extra = {}) => ({
  id,
  media_type: "movie",
  title,
  release_date: date,
  vote_average: vote,
  poster_path: `/${id}.jpg`,
  ...extra
});
const tv = (id, name, date, vote, extra = {}) => ({
  id,
  media_type: "tv",
  name,
  first_air_date: date,
  vote_average: vote,
  poster_path: `/${id}.jpg`,
  ...extra
});

test("credits keep posters only, skip talk show guest spots and use the TMDB ids", () => {
  const { movieCredits, seriesCredits } = buildPersonCredits({
    credits: {
      cast: [
        movie(1, "Heat", "1995-12-15", 8),
        movie(2, "No Poster", "2000-01-01", 9, { poster_path: null }),
        movie(1, "Heat", "1995-12-15", 8),
        tv(3, "The Tonight Show", "1954-09-27", 6, {
          genre_ids: [10767],
          character: "Self - Guest"
        }),
        tv(4, "Late Show", "2015-09-08", 6, { genre_ids: [10767], character: "Self - Host" }),
        tv(5, "Drama", "2010-01-01", 7, { genre_ids: [18] })
      ]
    }
  });
  assert.deepEqual(
    movieCredits.map((item) => [item.id, item.type, item.releaseInfo]),
    [["tmdb:1", "movie", "1995"]]
  );
  assert.equal(movieCredits[0].poster, "https://image.tmdb.org/t/p/w500/1.jpg");
  assert.deepEqual(
    seriesCredits.map((item) => item.id),
    ["tmdb:5", "tmdb:4"]
  );
});

test("Creator, Director and Writer open the crew filmography", () => {
  const credits = { cast: [movie(1, "Cameo", "2001", 5)], crew: [movie(2, "Directed", "2003", 7)] };
  assert.equal(shouldPreferCrewCredits("Director"), true);
  assert.equal(shouldPreferCrewCredits("Bob"), false);
  assert.deepEqual(
    buildPersonCredits({ credits, preferCrew: true }).movieCredits.map((item) => item.id),
    ["tmdb:2"]
  );
  assert.deepEqual(
    buildPersonCredits({ credits }).movieCredits.map((item) => item.id),
    ["tmdb:1"]
  );
  assert.deepEqual(
    buildPersonCredits({ credits: { crew: credits.crew } }).movieCredits.map((item) => item.id),
    ["tmdb:2"],
    "crew is the fallback when there is no cast credit"
  );
});

test("CJK titles fall back to the English credit title", () => {
  const { movieCredits } = buildPersonCredits({
    credits: { cast: [movie(7, "七人の侍", "1954-04-26", 9)] },
    englishCredits: { cast: [movie(7, "Seven Samurai", "1954-04-26", 9)] },
    language: "it-IT"
  });
  assert.equal(movieCredits[0].name, "Seven Samurai");
});

test("the filmography is newest first, and the tabs show only with both types", () => {
  const movies = [
    { id: "tmdb:1", releaseInfo: "1999" },
    { id: "tmdb:2", releaseInfo: "2020" }
  ];
  const series = [
    { id: "tmdb:3", releaseInfo: "2010" },
    { id: "tmdb:1", releaseInfo: "2005" }
  ];
  assert.deepEqual(
    filmographyView(movies, series, "all").credits.map((item) => item.id),
    ["tmdb:2", "tmdb:3", "tmdb:1"]
  );
  assert.equal(filmographyView(movies, series).showFilter, true);
  assert.deepEqual(
    filmographyView(movies, series, "movies").credits.map((item) => item.id),
    ["tmdb:2", "tmdb:1"]
  );
  assert.deepEqual(
    filmographyView(movies, series, "series").credits.map((item) => item.id),
    ["tmdb:3", "tmdb:1"]
  );
  const onlyMovies = filmographyView(movies, [], "series");
  assert.equal(onlyMovies.showFilter, false);
  assert.equal(onlyMovies.credits.length, 2, "without tabs the whole filmography shows");
  assert.equal(releaseYearSortKey(null), 0);
  assert.equal(releaseYearSortKey("20x1"), 0);
});

test("age and dates follow Android's parsing", () => {
  assert.equal(calculatePersonAge("1940-04-25", "2020-04-24"), 79);
  assert.equal(calculatePersonAge("1940-04-25", "2020-04-25"), 80);
  assert.equal(calculatePersonAge("25-04-1940", null, new Date(2000, 3, 25)), 60);
  assert.equal(parsePersonDate("1940-02-30"), null);
  assert.equal(parsePersonDate("1940"), null);
});
