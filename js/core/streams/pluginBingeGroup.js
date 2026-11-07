// Plugin binge groups and variant matching, ported from Android NuvioTV domain/model/Plugin.kt.
// A plugin stream carries `local-plugin-{scraperId}|{sorted identity tokens}` so the next
// episode can continue the same provider variant even when the episode title changes.

export const PLUGIN_BINGE_GROUP_PREFIX = "local-plugin-";
const PLUGIN_BINGE_GROUP_SEPARATOR = "|";
// Unicode property escapes are a SyntaxError on Chromium < 64 (Tizen 5.0) and
// esbuild cannot lower them, so build them at runtime with a fallback.
function unicodeRegExp(source, fallback) {
  try {
    return new RegExp(source, "u");
  } catch (_) {
    return fallback;
  }
}
// Fallback: cased letters (Latin, Greek, Cyrillic, ...) plus common uncased scripts.
const FALLBACK_LETTER = {
  test: (value) => {
    const text = String(value || "");
    return (
      text.toLowerCase() !== text.toUpperCase() ||
      /[\u0590-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text)
    );
  }
};
const LETTER = unicodeRegExp("\\p{L}", FALLBACK_LETTER);
const LETTER_OR_DIGIT = unicodeRegExp("[\\p{L}\\p{N}]", {
  test: (value) => /[0-9]/.test(value) || FALLBACK_LETTER.test(value)
});
const RESOLUTION_HEIGHTS = new Set([360, 480, 540, 576, 720, 800, 900, 1080, 1440, 2160, 4320]);

export function canonicalizePluginToken(token) {
  const value = String(token || "");
  let digits = 0;
  while (digits < value.length && value[digits] >= "0" && value[digits] <= "9") {
    digits += 1;
  }
  const numberOnly = digits === value.length;
  const numberAndP = digits === value.length - 1 && value[digits] === "p";
  return digits > 0 && (numberOnly || numberAndP) ? value.slice(0, digits) : value;
}

export function isResolutionToken(token) {
  const value = String(token || "");
  if (/^\d+$/.test(value)) {
    return RESOLUTION_HEIGHTS.has(Number(value));
  }
  if (/^\d+k$/.test(value)) {
    return [1, 2, 4, 8].includes(Number(value.slice(0, -1)));
  }
  return false;
}

function tokenizePluginText(parts = []) {
  const tokens = new Set();
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const text = String(part ?? "").toLowerCase();
    if (!text.trim()) {
      return;
    }
    let current = "";
    const flush = () => {
      if (!current) {
        return;
      }
      const token = canonicalizePluginToken(current);
      if (token) {
        tokens.add(token);
      }
      current = "";
    };
    for (const char of text) {
      if (LETTER_OR_DIGIT.test(char)) {
        current += char;
      } else {
        flush();
      }
    }
    flush();
  });
  return [...tokens].sort();
}

/** Normalized identity tokens from the fields a plugin actually fills in. */
export function pluginIdentityTokens({
  name = null,
  title = null,
  language = null,
  quality = null
} = {}) {
  return tokenizePluginText([name, title, language, quality]);
}

export function pluginBingeGroup({
  scraperId,
  name = null,
  title = null,
  language = null,
  quality = null
} = {}) {
  const id = String(scraperId || "").trim();
  if (!id) {
    return "";
  }
  const tokens = pluginIdentityTokens({ name, title, language, quality });
  return tokens.length
    ? `${PLUGIN_BINGE_GROUP_PREFIX}${id}${PLUGIN_BINGE_GROUP_SEPARATOR}${tokens.join(" ")}`
    : `${PLUGIN_BINGE_GROUP_PREFIX}${id}`;
}

export function scraperIdFromPluginBingeGroup(bingeGroup) {
  const value = String(bingeGroup || "").trim();
  if (!value.startsWith(PLUGIN_BINGE_GROUP_PREFIX)) {
    return null;
  }
  const id = value
    .slice(PLUGIN_BINGE_GROUP_PREFIX.length)
    .split(PLUGIN_BINGE_GROUP_SEPARATOR)[0]
    .trim();
  return id || null;
}

function tokensOfPluginBingeGroup(bingeGroup) {
  const value = String(bingeGroup || "").trim();
  const start = value.indexOf(PLUGIN_BINGE_GROUP_SEPARATOR);
  if (start < 0) {
    return new Set();
  }
  const payload = value.slice(start + 1);
  if (!payload.trim()) {
    return new Set();
  }
  return new Set(payload.split(/\s+/).map(canonicalizePluginToken).filter(Boolean));
}

function closestPluginVariant(candidates, shared) {
  let best = null;
  candidates.forEach((candidate) => {
    const size = [...candidate.tokens].filter((token) => !shared.has(token)).length;
    if (!best || size < best.size) {
      best = { ...candidate, size };
    }
  });
  return best ? best.index : null;
}

/**
 * Index of the next-episode stream that continues the saved plugin choice.
 * Tokens shared by every candidate are episode boilerplate; tokens of the saved choice found
 * in no candidate were episode-specific. What remains is the plugin's own variant.
 */
export function indexOfPluginBingeMatch(targetGroup, candidateGroups = []) {
  const targetId = scraperIdFromPluginBingeGroup(targetGroup);
  if (!targetId) {
    return null;
  }
  const indexed = [];
  (Array.isArray(candidateGroups) ? candidateGroups : []).forEach((group, index) => {
    if (scraperIdFromPluginBingeGroup(group) === targetId) {
      indexed.push({ index, tokens: tokensOfPluginBingeGroup(group) });
    }
  });
  if (!indexed.length) {
    return null;
  }
  const saved = tokensOfPluginBingeGroup(targetGroup);
  if (!saved.size) {
    return indexed[0].index;
  }
  if (indexed.length === 1) {
    const candidate = indexed[0].tokens;
    const savedResolution = new Set([...saved].filter(isResolutionToken));
    return [...savedResolution].every((token) => candidate.has(token)) ? indexed[0].index : null;
  }

  const sets = indexed.map((entry) => entry.tokens);
  const union = new Set();
  const shared = new Set(sets[0]);
  sets.forEach((tokens) => {
    tokens.forEach((token) => union.add(token));
    [...shared].forEach((token) => {
      if (!tokens.has(token)) {
        shared.delete(token);
      }
    });
  });
  const distinctive = new Set([...saved].filter((token) => union.has(token) && !shared.has(token)));
  const savedResolution = new Set([...saved].filter(isResolutionToken));
  const availableResolution = new Set([...savedResolution].filter((token) => union.has(token)));
  if (savedResolution.size && !availableResolution.size) {
    return null;
  }

  const resolutionEligible = indexed.filter((entry) =>
    [...availableResolution].every((token) => entry.tokens.has(token))
  );
  if (!resolutionEligible.length) {
    return null;
  }
  const labelDistinctive = new Set([...distinctive].filter((token) => !savedResolution.has(token)));
  const fullLabel = resolutionEligible.filter((entry) =>
    [...labelDistinctive].every((token) => entry.tokens.has(token))
  );
  if (fullLabel.length) {
    return closestPluginVariant(fullLabel, shared);
  }

  let best = null;
  resolutionEligible.forEach((entry) => {
    const matched = [...labelDistinctive].filter((token) => entry.tokens.has(token));
    if (!matched.length) {
      return;
    }
    const wordHits = matched.filter((token) => LETTER.test(token)).length;
    if (
      !best ||
      wordHits > best.wordHits ||
      (wordHits === best.wordHits && matched.length > best.matched)
    ) {
      best = { index: entry.index, wordHits, matched: matched.length };
    }
  });
  return best ? best.index : null;
}

export function pluginBingeGroupMatches(candidate, target) {
  const left = String(candidate || "").trim();
  const right = String(target || "").trim();
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return indexOfPluginBingeMatch(right, [left]) != null;
}
