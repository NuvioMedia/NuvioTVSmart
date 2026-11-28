/**
 * Subtitle-driven profanity filter.
 *
 * Pure module (no DOM, no player, no storage) so it can be unit tested in
 * Node and reused by every subtitle path in the player.
 *
 * Ideas borrowed from existing tools for other players:
 * - Kodi "Mute Profanity": mute the audio while a subtitle containing a
 *   filtered word is on screen ("line" precision).
 * - vulgarr (Plex/Jellyfin): mute only around the word itself instead of the
 *   whole line, with configurable padding ("word" precision, estimated here
 *   from the word's position inside the cue).
 * - Advanced Profanity Filter (browser): censor / substitute / remove filter
 *   methods, an allow list and custom words with wildcards.
 * - Clean Media Player: word categories (strong language, mild language,
 *   slurs, religious exclamations) that can be switched on individually.
 *
 * Every regular expression here avoids lookbehind, named groups, the `s` flag
 * and Unicode property escapes: older Samsung Tizen engines (Chromium 47-69)
 * do not support them and esbuild does not transpile regex syntax.
 */

export const PROFANITY_CATEGORIES = Object.freeze(["strong", "slurs", "mild", "religious"]);
// "censor" (first letter kept) is now "stars" plus showFirstLetter; it is
// still accepted as an alias for older saved settings.
export const PROFANITY_MASK_STYLES = Object.freeze(["stars", "substitute", "bleep", "remove"]);
export const PROFANITY_MUTE_PRECISIONS = Object.freeze(["word", "line"]);

const LETTER = "a-z0-9\\u00c0-\\u024f";
const LEADING_BOUNDARY = `(^|[^${LETTER}])`;
const TRAILING_BOUNDARY = `(?=$|[^${LETTER}])`;

// Minimum time a single word is assumed to take when its position inside a
// cue is estimated. Short cues with long lines would otherwise produce
// windows far shorter than the spoken word.
const MIN_WORD_SECONDS = 0.3;
// Ranges closer than this are merged so the audio does not flicker on/off
// between two filtered words in the same sentence.
const MERGE_GAP_SECONDS = 0.2;

function preserveCase(source, replacement) {
  const text = String(source || "");
  if (!text || !replacement) {
    return replacement;
  }
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(text)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function rootSubstitute(rootPattern, replacement) {
  const root = new RegExp(rootPattern, "i");
  return (match) => match.replace(root, (found) => preserveCase(found, replacement));
}

/**
 * Built-in word list. `pattern` is a regex fragment (non-capturing groups
 * only) matched as a whole token. `focus`, when set, limits masking to part of
 * a phrase ("oh my g**" instead of masking the whole phrase). `sub` is the
 * family-friendly substitution used by the "substitute" style.
 */
export const PROFANITY_WORDS = Object.freeze([
  // Religious exclamations: phrases first so they win over single words.
  {
    id: "omg",
    category: "religious",
    pattern:
      "oh,?\\s+my\\s+(?:god|lord)|oh,?\\s+(?:god|lord)|my\\s+god|good\\s+god|thank\\s+god|for\\s+god'?s\\s+sake|god\\s+almighty",
    focus: "god|lord",
    sub: (match) =>
      match
        .replace(/god/i, (found) => preserveCase(found, "gosh"))
        .replace(/lord/i, (found) => preserveCase(found, "gosh"))
  },
  {
    id: "jesus",
    category: "religious",
    pattern: "jesus(?:\\s+h\\.?)?(?:\\s+christ)?|christ(?:\\s+almighty)?|jeez(?:us)?",
    focus: "jesus|christ|jeez",
    sub: (match) => preserveCase(match, "geez")
  },
  // Strong language.
  {
    id: "motherfucker",
    category: "strong",
    pattern: "m[ou]th(?:er|a)\\s?-?f+[u*]+c*k+[a-z']*",
    sub: (match) => preserveCase(match, "mother-trucker")
  },
  {
    id: "fuck",
    category: "strong",
    pattern: "[a-z]*f+u+c+k+[a-z']*",
    sub: rootSubstitute("f+u+c+k+", "freak")
  },
  {
    id: "fck",
    category: "strong",
    pattern: "f(?:ck|kn|kin|cking|ckin|uk|ukin|uking|ux)[a-z']*|wtf|stfu|fml",
    sub: () => "freak"
  },
  {
    id: "shit",
    category: "strong",
    pattern: "(?:bull|horse|dip|chicken|ape|bat|dog|jack|cow|pig|dumb|holy)?sh[i1!]t+[a-z']*",
    sub: (match) => {
      if (/^bull/i.test(match)) return preserveCase(match, "baloney");
      if (/t(?:ty|tier|tiest)$/i.test(match)) return preserveCase(match, "crummy");
      if (/(?:head|face|bag|hole)s?$/i.test(match)) return preserveCase(match, "jerk");
      return match.replace(/sh[i1!]+t+/i, (found) => preserveCase(found, "shoot"));
    }
  },
  { id: "cunt", category: "strong", pattern: "cunts?|cunty", sub: () => "jerk" },
  { id: "cock", category: "strong", pattern: "cocks?|cocksuck(?:er|ers|ing)?", sub: () => "jerk" },
  { id: "pussy", category: "strong", pattern: "puss(?:y|ies)", sub: () => "wimp" },
  { id: "twat", category: "strong", pattern: "twats?", sub: () => "jerk" },
  {
    id: "wanker",
    category: "strong",
    pattern: "wank(?:er|ers|ing|ed)?|tossers?",
    sub: () => "jerk"
  },
  {
    id: "whore",
    category: "strong",
    pattern: "whor(?:e|es|ing)|sluts?|slutty",
    sub: () => "tramp"
  },
  // Already-censored text in the source subtitle ("f***ing", "****"). It is
  // still profanity on the audio track, so it must trigger a mute.
  {
    id: "censored",
    category: "strong",
    pattern: "[a-z]*\\*{2,}[a-z]*|[a-z]+[*#@$]+[a-z]+",
    sub: (match) => (/in'?g?$/i.test(match) ? "freaking" : "freak")
  },
  // Slurs. Substitution is not offered for these; the censor style is used.
  { id: "nword", category: "slurs", pattern: "nigg(?:a|as|ah|az|er|ers|uh)" },
  { id: "fslur", category: "slurs", pattern: "fag(?:s|got|gots|gy)?" },
  { id: "rslur", category: "slurs", pattern: "retard(?:s|ed)?" },
  {
    id: "eslurs",
    category: "slurs",
    pattern: "spics?|chinks?|kikes?|wetbacks?|trann(?:y|ies)|dykes?|gooks?"
  },
  // Mild language.
  {
    id: "goddamn",
    category: "mild",
    pattern: "god\\s?-?dam(?:n|mit|nit|ned|n'd|n-it)?|god\\s+damn(?:it|ed)?",
    sub: (match) => preserveCase(match, "gosh darn")
  },
  {
    id: "damn",
    category: "mild",
    pattern: "dam(?:n|ned|nit|mit|n'd|ns)|dammit",
    sub: rootSubstitute("dam+n?", "darn")
  },
  {
    id: "ass",
    category: "mild",
    pattern:
      "ass|asses|arse|arses|ass\\s?holes?|arseholes?|jackass(?:es)?|dumbass(?:es)?|smartass(?:es)?|fatass(?:es)?|kickass|badass(?:es)?|asswipes?|asshats?",
    sub: (match) =>
      /hole|wipe|hat|jack|dumb|smart|fat/i.test(match)
        ? preserveCase(match, "jerk")
        : preserveCase(match, "butt")
  },
  {
    id: "bitch",
    category: "mild",
    pattern: "son\\s+of\\s+a\\s+bitch|sonofabitch|bitch(?:es|y|ing|ed|in')?|biatch",
    sub: (match) =>
      /son/i.test(match) ? preserveCase(match, "son of a gun") : preserveCase(match, "jerk")
  },
  { id: "bastard", category: "mild", pattern: "bastards?", sub: () => "jerk" },
  { id: "dick", category: "mild", pattern: "dicks?|dickheads?|dickhole", sub: () => "jerk" },
  {
    id: "piss",
    category: "mild",
    pattern: "piss(?:ed|es|ing|y|er)?",
    sub: rootSubstitute("piss", "tick")
  },
  { id: "hell", category: "mild", pattern: "hell|hells|hellhole", sub: () => "heck" },
  {
    id: "crap",
    category: "mild",
    pattern: "crap|craps|crappy|crapped",
    sub: rootSubstitute("crap", "crud")
  },
  { id: "prick", category: "mild", pattern: "pricks?", sub: () => "jerk" },
  { id: "douche", category: "mild", pattern: "douche(?:s|bag|bags)?", sub: () => "jerk" },
  {
    id: "british",
    category: "mild",
    pattern: "bollocks|bugger(?:s|ed)?|sod\\s+off",
    sub: () => "darn"
  }
]);

export const DEFAULT_PROFANITY_CATEGORIES = Object.freeze(["strong", "slurs", "mild"]);

function escapeRegex(value) {
  return String(value || "").replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** "frak*" style custom words: `*` is a wildcard for the rest of the word. */
export function customWordToPattern(word) {
  const cleaned = String(word || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.replace(/\*/g, "").length < 2) {
    return "";
  }
  return escapeRegex(cleaned).replace(/\*/g, "[a-z']*").replace(/ /g, "\\s+");
}

export function normalizeWordList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,\n;]+/);
  const seen = new Set();
  const result = [];
  source.forEach((entry) => {
    const word = String(entry || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!word || word.length > 40 || seen.has(word)) {
      return;
    }
    seen.add(word);
    result.push(word);
  });
  return result.slice(0, 200);
}

const matcherCache = new Map();

/**
 * Compiles the enabled word list into one global regex. The result is cached
 * per configuration, so callers can ask for it on every cue render.
 */
export function createProfanityMatcher({
  categories = DEFAULT_PROFANITY_CATEGORIES,
  customWords = [],
  allowedWords = []
} = {}) {
  const enabledCategories = (Array.isArray(categories) ? categories : []).filter((category) =>
    PROFANITY_CATEGORIES.includes(category)
  );
  const custom = normalizeWordList(customWords);
  const allowed = normalizeWordList(allowedWords);
  const cacheKey = JSON.stringify([enabledCategories.slice().sort(), custom, allowed]);
  if (matcherCache.has(cacheKey)) {
    return matcherCache.get(cacheKey);
  }
  const entries = [];
  custom.forEach((word, index) => {
    const pattern = customWordToPattern(word);
    if (pattern) {
      entries.push({ id: `custom-${index}`, category: "custom", pattern });
    }
  });
  PROFANITY_WORDS.forEach((entry) => {
    if (enabledCategories.includes(entry.category)) {
      entries.push(entry);
    }
  });
  let regex = null;
  if (entries.length) {
    const body = entries.map((entry) => `(${entry.pattern})`).join("|");
    regex = new RegExp(`${LEADING_BOUNDARY}(${body})${TRAILING_BOUNDARY}`, "gi");
  }
  const allowedSet = new Set(allowed);
  const matcher = { regex, entries, allowed: allowedSet, key: cacheKey };
  if (matcherCache.size > 16) {
    matcherCache.clear();
  }
  matcherCache.set(cacheKey, matcher);
  return matcher;
}

/**
 * Returns every filtered word in `text` as { start, end, word, entry }, with
 * `start`/`end` as character offsets into `text`.
 */
export function findProfanity(text, matcher) {
  const source = String(text || "");
  if (!source || !matcher?.regex) {
    return [];
  }
  const regex = matcher.regex;
  regex.lastIndex = 0;
  const found = [];
  let match = regex.exec(source);
  let guard = 0;
  while (match && guard < 500) {
    guard += 1;
    const lead = match[1] || "";
    const word = match[2] || "";
    if (!word) {
      regex.lastIndex += 1;
      match = regex.exec(source);
      continue;
    }
    const start = match.index + lead.length;
    let entry = null;
    for (let index = 0; index < matcher.entries.length; index += 1) {
      if (match[index + 3] !== undefined) {
        entry = matcher.entries[index];
        break;
      }
    }
    if (!matcher.allowed.has(word.toLowerCase().replace(/\s+/g, " "))) {
      found.push({ start, end: start + word.length, word, entry });
    }
    regex.lastIndex = start + word.length;
    match = regex.exec(source);
  }
  return found;
}

export function containsProfanity(text, matcher) {
  return findProfanity(text, matcher).length > 0;
}

// Hides every letter ("****"), or every letter but the first of each word
// ("s** o* a b****") when showFirstLetter is on.
function maskLetters(value, keepFirst) {
  return String(value || "").replace(/[a-z0-9À-ɏ*#@$!']+/gi, (word) =>
    keepFirst ? word.charAt(0) + word.slice(1).replace(/./g, "*") : word.replace(/./g, "*")
  );
}

function maskWord(found, style, keepFirst) {
  const word = found.word;
  const entry = found.entry || {};
  if (style === "bleep") {
    return "[bleep]";
  }
  if (style === "remove") {
    return "";
  }
  if (style === "substitute" && typeof entry.sub === "function") {
    return preserveCase(word, entry.sub(word)) || maskLetters(word, keepFirst);
  }
  if (entry.focus) {
    const focus = new RegExp(entry.focus, "gi");
    return word.replace(focus, (part) => maskLetters(part, keepFirst));
  }
  return maskLetters(word, keepFirst);
}

/**
 * Masks every filtered word in `text`. Line breaks are preserved.
 * `showFirstLetter` keeps the first letter in star masking ("f***"); off by
 * default because the first letter makes the word easy to guess.
 */
export function maskProfanity(text, matcher, style = "stars", { showFirstLetter = false } = {}) {
  const keepFirst = Boolean(showFirstLetter) || style === "censor";
  const source = String(text || "");
  const found = findProfanity(source, matcher);
  if (!found.length) {
    return source;
  }
  let output = "";
  let cursor = 0;
  found.forEach((item) => {
    output += source.slice(cursor, item.start) + maskWord(item, style, keepFirst);
    cursor = item.end;
  });
  output += source.slice(cursor);
  if (style === "remove") {
    output = output
      .split("\n")
      .map((line) =>
        line
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\s+([,.!?;:])/g, "$1")
          .replace(/^[\s,;:]+/, "")
          .trim()
      )
      .filter((line) => /[a-z0-9\u00c0-\u024f]/i.test(line))
      .join("\n");
  }
  return output;
}

/** Plain spoken text used for timing: no tags, no SDH, no speaker labels. */
export function spokenSubtitleText(text) {
  return String(text || "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[\s-]*[A-Z][A-Z0-9 .'-]{1,30}:\s*/gm, "")
    .replace(/[♪#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Mute windows for a single cue. Offsets are estimated from each word's
 * character position inside the spoken text: speech is not uniform, so the
 * padding absorbs the error.
 */
export function muteRangesForCue(cue, matcher, { precision = "word", paddingMs = 250 } = {}) {
  const start = Number(cue?.start);
  const end = Number(cue?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const spoken = spokenSubtitleText(cue?.text);
  const found = findProfanity(spoken, matcher);
  if (!found.length) {
    return [];
  }
  const pad = clampNumber(Number(paddingMs) || 0, 0, 2000) / 1000;
  if (precision === "line") {
    return [{ start: Math.max(0, start - pad), end: end + pad }];
  }
  const duration = end - start;
  const length = Math.max(1, spoken.length);
  return found.map((item) => {
    let wordStart = start + duration * (item.start / length);
    let wordEnd = start + duration * (item.end / length);
    if (wordEnd - wordStart < MIN_WORD_SECONDS) {
      const center = (wordStart + wordEnd) / 2;
      wordStart = center - MIN_WORD_SECONDS / 2;
      wordEnd = center + MIN_WORD_SECONDS / 2;
    }
    return {
      start: Math.max(0, clampNumber(wordStart - pad, start - pad, end)),
      end: clampNumber(wordEnd + pad, start, end + pad)
    };
  });
}

export function mergeMuteRanges(ranges = []) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .filter(
      (range) =>
        Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start
    )
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start);
  const merged = [];
  sorted.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end <= MERGE_GAP_SECONDS) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  });
  return merged;
}

/** All mute windows for a subtitle track, sorted and merged (seconds). */
export function buildMuteRanges(cues, matcher, options = {}) {
  const list = Array.isArray(cues) ? cues : [];
  const ranges = [];
  for (let index = 0; index < list.length; index += 1) {
    const cueRanges = muteRangesForCue(list[index], matcher, options);
    for (let rangeIndex = 0; rangeIndex < cueRanges.length; rangeIndex += 1) {
      ranges.push(cueRanges[rangeIndex]);
    }
  }
  return mergeMuteRanges(ranges);
}

/**
 * Mute state at `time` (seconds, subtitle clock) over merged ranges, plus the
 * next time the state changes so callers can sleep until then.
 */
export function findMuteState(ranges, time) {
  const list = Array.isArray(ranges) ? ranges : [];
  const t = Number(time);
  if (!list.length || !Number.isFinite(t)) {
    return { muted: false, nextBoundary: Infinity };
  }
  let low = 0;
  let high = list.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (list[mid].start <= t) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (candidate >= 0 && t < list[candidate].end) {
    return { muted: true, nextBoundary: list[candidate].end };
  }
  const next = list[candidate + 1];
  return { muted: false, nextBoundary: next ? next.start : Infinity };
}

/**
 * Ratings are compared loosely: "TV-MA", "tv ma", "TVMA" and "US:TV-MA" are
 * the same rating.
 */
export function normalizeContentRating(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]{2}\s*:\s*/, "")
    .replace(/[\s_]+/g, "-");
  if (!raw) {
    return "";
  }
  const compact = raw.replace(/-/g, "");
  const known = {
    TVMA: "TV-MA",
    TV14: "TV-14",
    TVPG: "TV-PG",
    TVG: "TV-G",
    TVY: "TV-Y",
    TVY7: "TV-Y7",
    NC17: "NC-17",
    PG13: "PG-13",
    R: "R",
    PG: "PG",
    G: "G",
    NR: "NR",
    UNRATED: "NR"
  };
  return known[compact] || raw;
}

export const PROFANITY_RATING_OPTIONS = Object.freeze(["TV-MA", "R", "NC-17", "TV-14", "PG-13"]);
