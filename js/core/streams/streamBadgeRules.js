const STREAM_BADGE_IMPORT_LIMIT = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColor(value = "") {
  const text = normalizeText(value);
  if (/^(transparent|rgba?\([\d\s,%.]+\))$/i.test(text)) {
    return text;
  }
  const hex = text.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    return "";
  }
  if (hex.length === 6) {
    return `#${hex}`.toUpperCase();
  }
  const alpha = parseInt(hex.slice(0, 2), 16);
  const red = parseInt(hex.slice(2, 4), 16);
  const green = parseInt(hex.slice(4, 6), 16);
  const blue = parseInt(hex.slice(6, 8), 16);
  if (alpha >= 255) {
    return `#${hex.slice(2)}`.toUpperCase();
  }
  if (alpha <= 0) {
    return "transparent";
  }
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
}

function toBadgeArray(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry != null);
  }
  return value == null ? [] : [value];
}

function normalizeStreamBadgeFilter(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const name = normalizeText(source.name);
  const pattern = normalizeText(source.pattern);
  if (!name || !pattern) {
    return null;
  }
  return {
    id: normalizeText(source.id),
    groupId: normalizeText(source.groupId),
    name,
    pattern,
    imageURL: normalizeText(source.imageURL),
    isEnabled: source.isEnabled !== false,
    tagColor: normalizeColor(source.tagColor),
    tagStyle: normalizeText(source.tagStyle),
    textColor: normalizeColor(source.textColor),
    borderColor: normalizeColor(source.borderColor)
  };
}

function normalizeStreamBadgeGroup(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    id: normalizeText(source.id),
    name: normalizeText(source.name),
    color: normalizeColor(source.color),
    isExpanded: source.isExpanded !== false
  };
}

function normalizeStreamBadgeImport(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const sourceUrl = normalizeText(source.sourceUrl);
  const filters = toBadgeArray(source.filters)
    .map((entry) => normalizeStreamBadgeFilter(entry))
    .filter(Boolean);
  const groups = toBadgeArray(source.groups)
    .map((entry) => normalizeStreamBadgeGroup(entry))
    .filter(Boolean);
  if (!sourceUrl || !filters.length) {
    return null;
  }
  return {
    sourceUrl,
    filters,
    groups,
    isActive: source.isActive !== false && source.active !== false
  };
}

export function normalizeStreamBadgeRules(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const importsSource = Array.isArray(source.imports)
    ? source.imports
    : source.streamBadgeRules && Array.isArray(source.streamBadgeRules.imports)
      ? source.streamBadgeRules.imports
      : [];
  const normalizedImports = [];

  importsSource.forEach((entry) => {
    const normalized = normalizeStreamBadgeImport(entry);
    if (!normalized) {
      return;
    }
    const existingIndex = normalizedImports.findIndex(
      (importItem) => importItem.sourceUrl.toLowerCase() === normalized.sourceUrl.toLowerCase()
    );
    if (existingIndex >= 0) {
      normalizedImports[existingIndex] = normalized;
    } else if (normalizedImports.length < STREAM_BADGE_IMPORT_LIMIT) {
      normalizedImports.push(normalized);
    }
  });

  if (!normalizedImports.length) {
    return { imports: [] };
  }

  const activeIndex = normalizedImports.findIndex((importItem) => importItem.isActive);
  const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0;

  return {
    imports: normalizedImports.map((importItem, index) => ({
      ...importItem,
      isActive: index === resolvedActiveIndex
    }))
  };
}

function parseBadgePayload(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return isPlainObject(value) ? value : null;
}

export function parseStreamBadgeRulesFromPayload(value, sourceUrl = "") {
  const parsed = parseBadgePayload(value);
  if (!parsed) {
    return null;
  }

  if (Array.isArray(parsed.imports)) {
    const normalized = normalizeStreamBadgeRules(parsed);
    return normalized.imports.length ? normalized : null;
  }

  const nestedRules = parsed.streamBadgeRules || parsed.settings?.streamBadgeRules;
  if (nestedRules) {
    const normalizedNested = normalizeStreamBadgeRules(
      parseBadgePayload(nestedRules) || nestedRules
    );
    if (normalizedNested.imports.length) {
      return normalizedNested;
    }
  }

  const filters = Array.isArray(parsed.filters) ? parsed.filters : [];
  const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
  const normalizedImport = normalizeStreamBadgeImport({
    sourceUrl: normalizeText(sourceUrl || parsed.sourceUrl || "Pasted badge rules"),
    filters,
    groups,
    isActive: parsed.isActive !== false && parsed.active !== false
  });

  if (!normalizedImport) {
    return null;
  }

  return normalizeStreamBadgeRules({
    imports: [normalizedImport]
  });
}

function streamBadgeDedupeKey(badge = {}) {
  return normalizeText(badge.imageURL || badge.name).toLowerCase();
}

function mergeStreamBadges(existing = [], matched = []) {
  const merged = new Map();
  [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(matched) ? matched : [])
  ].forEach((badge) => {
    if (!badge) {
      return;
    }
    const key = streamBadgeDedupeKey(badge);
    if (!key || merged.has(key)) {
      return;
    }
    merged.set(key, badge);
  });
  return Array.from(merged.values());
}

function badgeMatchCandidates(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const raw = resolve.stream?.raw || stream.raw || {};
  const parsed = raw.parsed || {};
  const presentation = stream.streamPresentation || stream.raw?.streamPresentation || {};
  const candidates = [
    raw.filename,
    resolve.filename,
    stream.behaviorHints?.filename,
    stream.debridCacheStatus?.cachedName,
    raw.torrentName,
    resolve.torrentName,
    stream.name,
    stream.title,
    stream.description,
    stream.addonName,
    stream.addonLogo,
    stream.sourceType,
    stream.quality,
    presentation.resolution,
    presentation.quality,
    presentation.encode,
    ...(Array.isArray(presentation.visualTags) ? presentation.visualTags : []),
    ...(Array.isArray(presentation.audioTags) ? presentation.audioTags : []),
    ...(Array.isArray(presentation.audioChannels) ? presentation.audioChannels : []),
    ...(Array.isArray(presentation.languages) ? presentation.languages : []),
    parsed.rawTitle,
    parsed.parsedTitle,
    parsed.resolution,
    parsed.quality,
    parsed.codec,
    parsed.edition,
    parsed.group,
    ...(Array.isArray(parsed.audio) ? parsed.audio : []),
    ...(Array.isArray(parsed.channels) ? parsed.channels : []),
    ...(Array.isArray(parsed.hdr) ? parsed.hdr : [])
  ]
    .flatMap((value) => String(value || "").split(/\r?\n/))
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter(
      (value, index, array) =>
        array.findIndex((entry) => entry.toLowerCase() === value.toLowerCase()) === index
    );

  if (candidates.length <= 1) {
    return candidates;
  }
  return [...candidates, candidates.join(" ")];
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const compiledBadgeCache = new Map();

function compileStreamBadgeFilters(rules = {}) {
  const normalized = normalizeStreamBadgeRules(rules);
  const fingerprint = stableStringify(normalized);
  const cached = compiledBadgeCache.get(fingerprint);
  if (cached) {
    return cached;
  }

  const compiled = normalized.imports
    .filter((importItem) => importItem.isActive)
    .flatMap((importItem) =>
      importItem.filters
        .map((filter) => {
          try {
            const pattern = String(filter.pattern || "").trim();
            let source = pattern;
            let flags = "";
            let inlineMatch = source.match(/^\(\?([imxs]+)\)/i);
            while (inlineMatch) {
              const inlineFlags = String(inlineMatch[1] || "").toLowerCase();
              if (inlineFlags.includes("i")) {
                flags += "i";
              }
              if (inlineFlags.includes("m")) {
                flags += "m";
              }
              if (inlineFlags.includes("s")) {
                flags += "s";
              }
              source = source.slice(inlineMatch[0].length);
              inlineMatch = source.match(/^\(\?([imxs]+)\)/i);
            }
            flags = Array.from(new Set(flags.split(""))).join("");
            return {
              name: filter.name,
              badge: {
                name: filter.name,
                imageURL: filter.imageURL,
                tagColor: filter.tagColor,
                tagStyle: filter.tagStyle,
                textColor: filter.textColor,
                borderColor: filter.borderColor
              },
              regex: new RegExp(source, flags)
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );

  compiledBadgeCache.set(fingerprint, compiled);
  return compiled;
}

export function matchStreamBadges(stream = {}, rules = {}) {
  const filters = compileStreamBadgeFilters(rules);
  if (!filters.length) {
    return [];
  }
  const candidates = badgeMatchCandidates(stream);
  if (!candidates.length) {
    return [];
  }

  const matched = new Map();
  filters.forEach((filter) => {
    if (candidates.some((candidate) => filter.regex.test(candidate))) {
      const key = streamBadgeDedupeKey(filter.badge);
      if (!key || matched.has(key)) {
        return;
      }
      matched.set(key, filter.badge);
    }
  });
  return Array.from(matched.values());
}

export function applyStreamBadgePresentation(groups = [], rules = {}) {
  const normalizedRules = normalizeStreamBadgeRules(rules);
  if (!normalizedRules.imports.length) {
    return groups;
  }
  return (groups || []).map((group) => ({
    ...group,
    streams: (group.streams || []).map((stream) => {
      const matchedBadges = matchStreamBadges(stream, normalizedRules);
      if (!matchedBadges.length) {
        return stream;
      }
      return {
        ...stream,
        badges: mergeStreamBadges(stream.badges, matchedBadges)
      };
    })
  }));
}

export function getStreamBadgePreviewSections(importItem = {}) {
  const filters = (Array.isArray(importItem.filters) ? importItem.filters : []).filter((filter) =>
    normalizeText(filter?.imageURL)
  );
  if (!filters.length) {
    return [];
  }
  const groups = Array.isArray(importItem.groups) ? importItem.groups : [];
  const sections = [];
  const used = new Set();

  groups.forEach((group, index) => {
    const groupId = normalizeText(group?.id);
    const groupFilters = filters.filter((filter) => normalizeText(filter.groupId) === groupId);
    if (groupFilters.length) {
      used.add(groupId);
      sections.push({
        id: groupId || `group-${index}`,
        title: normalizeText(group?.name) || `Group ${index + 1}`,
        filters: groupFilters
      });
    }
  });

  const other = filters.filter((filter) => !used.has(normalizeText(filter.groupId)));
  if (other.length) {
    sections.push({
      id: "other",
      title: "Other Fusion badges",
      filters: other
    });
  }

  return sections;
}

export function formatStreamBadgeImportSummary(importItem = {}, index = 0) {
  const enabledFilterCount = Array.isArray(importItem.filters)
    ? importItem.filters.filter((filter) => filter?.isEnabled !== false).length
    : 0;
  const groupCount = Array.isArray(importItem.groups) ? importItem.groups.length : 0;
  const sourceLabel = importItem.isActive === false ? "Inactive" : "Active";
  return `${sourceLabel}, ${enabledFilterCount} enabled badges, ${groupCount} groups`;
}

export function normalizeStreamBadgeChipColor(value = "") {
  return normalizeColor(value);
}

export function normalizeStreamBadgeChipText(value = "") {
  return normalizeText(value);
}

export function normalizeStreamBadgeImportUrl(value = "") {
  return normalizeText(value);
}

export { STREAM_BADGE_IMPORT_LIMIT };
