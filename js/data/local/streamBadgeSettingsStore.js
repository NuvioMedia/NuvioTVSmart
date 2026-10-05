import { createProfileScopedStore } from "./profileScopedStore.js";
import {
  normalizeStreamBadgeRules,
  prepareStreamBadgeRules,
  parseStreamBadgeRulesFromPayload,
  STREAM_BADGE_IMPORT_LIMIT
} from "../../core/streams/streamBadgeRules.js";

const KEY = "streamBadgeSettings";
const LEGACY_DEBRID_KEY = "debridSettings";

const DEFAULT_STREAM_BADGE_SETTINGS = {
  rules: { imports: [] },
  showFileSizeBadges: true,
  showAddonLogo: true,
  badgePlacement: "BOTTOM"
};

function normalizeBadgePlacement(value = "") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized === "TOP" ? "TOP" : "BOTTOM";
}

function normalizeStreamBadgeSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rulesSource =
    source.rules ??
    source.streamBadgeRules ??
    source.stream_badge_rules ??
    source.badgeRules ??
    source.payload ??
    null;
  const showFileSizeBadges = source.showFileSizeBadges ?? source.show_file_size_badges;
  const showAddonLogo = source.showAddonLogo ?? source.show_addon_logo;
  const badgePlacement =
    source.badgePlacement ??
    source.badge_placement ??
    source.streamBadgePlacement ??
    source.stream_badge_placement;
  return {
    rules: normalizeStreamBadgeRules(rulesSource),
    showFileSizeBadges: showFileSizeBadges !== false,
    showAddonLogo: showAddonLogo !== false,
    badgePlacement: normalizeBadgePlacement(badgePlacement)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeStreamBadgeSettings
});

async function fetchText(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit"
  });
  if (!response.ok) {
    throw new Error(`Badge import failed (${response.status}).`);
  }
  return response.text();
}

function normalizeSourceUrlInput(value = "") {
  return String(value || "").trim();
}

function sameSourceUrl(left = "", right = "") {
  return (
    normalizeSourceUrlInput(left).toLowerCase() === normalizeSourceUrlInput(right).toLowerCase()
  );
}

function parseImportInput(value = "") {
  const normalized = normalizeSourceUrlInput(value);
  if (!normalized) {
    return { error: "Enter a badge JSON URL." };
  }

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    const rules = parseStreamBadgeRulesFromPayload(normalized, "Pasted badge rules");
    if (!rules || !rules.imports.length) {
      return { error: "Invalid badge JSON." };
    }
    return { sourceUrl: "Pasted badge rules", rules };
  }

  if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) {
    return { error: "Badge URL must start with http:// or https://." };
  }

  return { sourceUrl: normalized };
}

export const StreamBadgeSettingsStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  async importStreamBadgeRulesFromUrl(value) {
    const parsed = parseImportInput(value);
    if (parsed.error) {
      return { status: "error", message: parsed.error };
    }

    const current = normalizeStreamBadgeSettings(this.get());
    const currentRules = normalizeStreamBadgeRules(current.rules);
    const normalizedSource = normalizeSourceUrlInput(value);
    const isExistingImport = currentRules.imports.some((importItem) =>
      sameSourceUrl(importItem.sourceUrl, parsed.sourceUrl)
    );
    if (!isExistingImport && currentRules.imports.length >= STREAM_BADGE_IMPORT_LIMIT) {
      return {
        status: "error",
        message: `You can import up to ${STREAM_BADGE_IMPORT_LIMIT} badge URLs.`
      };
    }

    try {
      const payload = parsed.rules
        ? JSON.stringify(parsed.rules)
        : await fetchText(normalizedSource);
      const rules = parseStreamBadgeRulesFromPayload(payload, normalizedSource);
      if (!rules || !rules.imports.length) {
        return { status: "error", message: "Badge import did not contain any usable filters." };
      }

      if (rules.imports.length > 1) {
        const nextRules = normalizeStreamBadgeRules(rules);
        store.set({ rules: nextRules });
        return { status: "success", rules: nextRules };
      }

      const nextImport = {
        ...rules.imports[0],
        sourceUrl: rules.imports[0].sourceUrl || parsed.sourceUrl,
        isActive: true
      };
      const nextImports = currentRules.imports
        .filter((importItem) => !sameSourceUrl(importItem.sourceUrl, nextImport.sourceUrl))
        .concat(nextImport);
      const nextRules = normalizeStreamBadgeRules({ imports: nextImports });
      store.set({ rules: nextRules });
      return { status: "success", rules: nextRules };
    } catch (error) {
      return {
        status: "error",
        message: String(error?.message || error || "Badge import failed.")
      };
    }
  },

  setActiveStreamBadgeRulesSource(sourceUrl) {
    const current = normalizeStreamBadgeSettings(this.get());
    const currentRules = normalizeStreamBadgeRules(current.rules);
    const normalizedSource = normalizeSourceUrlInput(sourceUrl);
    const nextRules = {
      imports: currentRules.imports.map((importItem) => ({
        ...importItem,
        isActive: sameSourceUrl(importItem.sourceUrl, normalizedSource)
      }))
    };
    store.set({ rules: normalizeStreamBadgeRules(nextRules) });
  },

  deleteStreamBadgeRulesSource(sourceUrl) {
    const current = normalizeStreamBadgeSettings(this.get());
    const currentRules = normalizeStreamBadgeRules(current.rules);
    const normalizedSource = normalizeSourceUrlInput(sourceUrl);
    const nextRules = {
      imports: currentRules.imports.filter(
        (importItem) => !sameSourceUrl(importItem.sourceUrl, normalizedSource)
      )
    };
    store.set({ rules: normalizeStreamBadgeRules(nextRules) });
  },

  setShowFileSizeBadges(enabled) {
    store.set({ showFileSizeBadges: Boolean(enabled) });
  },

  setShowAddonLogo(enabled) {
    store.set({ showAddonLogo: Boolean(enabled) });
  },

  setBadgePlacement(placement) {
    store.set({ badgePlacement: normalizeBadgePlacement(placement) });
  },

  snapshot() {
    const settings = normalizeStreamBadgeSettings(this.get());
    settings.rules = prepareStreamBadgeRules(settings.rules);
    return settings;
  }
};

export {
  DEFAULT_STREAM_BADGE_SETTINGS,
  LEGACY_DEBRID_KEY,
  normalizeBadgePlacement,
  normalizeStreamBadgeSettings
};
