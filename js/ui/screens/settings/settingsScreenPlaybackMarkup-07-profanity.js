/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import { ProfanityFilterStore } from "../../../data/local/profanityFilterStore.js";

export function profanityModeLabel(t, mode) {
  if (mode === "always") return t("profanity_mode_always", {}, "All titles");
  if (mode === "rated") return t("profanity_mode_rated", {}, "Titles with mature ratings");
  return t("profanity_mode_manual", {}, "Only titles I switch on");
}

export function profanityActionLabel(t, action) {
  if (action === "mask") return t("profanity_action_mask", {}, "Censor subtitles only");
  if (action === "mute") return t("profanity_action_mute", {}, "Mute audio only");
  return t("profanity_action_mute_and_mask", {}, "Mute audio and censor subtitles");
}

export function profanityMaskStyleLabel(t, style) {
  switch (style) {
    case "substitute":
      return t("profanity_style_substitute", {}, "Family-friendly words (freaking, shoot)");
    case "bleep":
      return t("profanity_style_bleep", {}, "[bleep]");
    case "remove":
      return t("profanity_style_remove", {}, "Remove the word");
    default:
      return t("profanity_style_stars_hidden", {}, "Stars (****)");
  }
}

export function profanityCategoryLabel(t, category) {
  switch (category) {
    case "strong":
      return t("profanity_category_strong", {}, "Strong language");
    case "slurs":
      return t("profanity_category_slurs", {}, "Slurs");
    case "mild":
      return t("profanity_category_mild", {}, "Mild language (damn, hell, ass)");
    case "religious":
      return t("profanity_category_religious", {}, "Religious exclamations (oh my God)");
    default:
      return category;
  }
}

export function profanityPrecisionLabel(t, precision) {
  return precision === "line"
    ? t("profanity_precision_line", {}, "Whole subtitle line")
    : t("profanity_precision_word", {}, "Just the word (estimated)");
}

function countLabel(t, count, singular, plural) {
  if (!count) return t("profanity_none", {}, "None");
  return count === 1 ? t(singular, [count], `${count} word`) : t(plural, [count], `${count} words`);
}

export function renderPlaybackProfanityBody(model) {
  const { t, escapeHtml } = internals;
  const settings = model.profanity || ProfanityFilterStore.get();
  const overrides = Object.keys(settings.titleOverrides || {}).length;
  const ratingsLabel = settings.ratings.length ? settings.ratings.join(", ") : t("profanity_none", {}, "None");
  const categoriesLabel = settings.categories.length
    ? settings.categories.map((category) => profanityCategoryLabel(t, category).replace(/\s*\(.*\)$/, "")).join(", ")
    : t("profanity_none", {}, "None");
  const muting = settings.action !== "mask";
  const masking = settings.action !== "mute";
  const enabledRow = this.renderToggleRow({
    focusKey: "playback:profanityEnabled",
    title: t("profanity_enabled_title", {}, "Profanity filter"),
    subtitle: t(
      "profanity_enabled_subtitle",
      {},
      "Mutes and censors swearing using the subtitles. Off by default; nothing changes until you turn it on."
    ),
    checked: settings.enabled
  });
  if (!settings.enabled) {
    return `
          <div class="settings-stack">
            ${enabledRow}
          </div>
        `;
  }
  return `
          <div class="settings-stack">
            ${enabledRow}
            <div class="settings-section-label">${escapeHtml(t("profanity_section_when", {}, "When to filter"))}</div>
            ${this.renderActionRow({
              focusKey: "playback:profanityMode",
              title: t("profanity_mode_title", {}, "Filter titles"),
              subtitle: t("profanity_mode_subtitle", {}, "Switch any title on or off from its details page or the player's Audio menu."),
              value: profanityModeLabel(t, settings.mode)
            })}
            ${
              settings.mode === "rated"
                ? this.renderActionRow({
                    focusKey: "playback:profanityRatings",
                    title: t("profanity_ratings_title", {}, "Mature ratings"),
                    subtitle: t("profanity_ratings_subtitle", {}, "Filter titles with these ratings automatically."),
                    value: ratingsLabel
                  })
                : ""
            }
            ${this.renderActionRow({
              focusKey: "playback:profanityTitles",
              title: t("profanity_titles_title", {}, "Per-title choices"),
              subtitle: t("profanity_titles_subtitle", {}, "Titles you turned the filter on or off for."),
              value: overrides ? t("profanity_titles_count", [overrides], `${overrides}`) : t("profanity_none", {}, "None"),
              disabled: !overrides
            })}
            <div class="settings-section-label">${escapeHtml(t("profanity_section_what", {}, "What to filter"))}</div>
            ${this.renderActionRow({
              focusKey: "playback:profanityAction",
              title: t("profanity_action_title", {}, "When a word is found"),
              subtitle: t("profanity_action_subtitle", {}, "Works from the subtitles of what you are watching."),
              value: profanityActionLabel(t, settings.action)
            })}
            ${
              masking
                ? this.renderActionRow({
                    focusKey: "playback:profanityMaskStyle",
                    title: t("profanity_style_title", {}, "Subtitle censoring"),
                    subtitle: t("profanity_style_subtitle", {}, "How filtered words appear in subtitles."),
                    value: profanityMaskStyleLabel(t, settings.maskStyle)
                  })
                : ""
            }
            ${
              masking && settings.maskStyle === "stars"
                ? this.renderToggleRow({
                    focusKey: "playback:profanityFirstLetter",
                    title: t("profanity_first_letter_title", {}, "Show first letter"),
                    subtitle: t("profanity_first_letter_subtitle", {}, "Show f*** instead of ****. Off keeps the word from being guessed."),
                    checked: settings.showFirstLetter
                  })
                : ""
            }
            ${this.renderActionRow({
              focusKey: "playback:profanityCategories",
              title: t("profanity_categories_title", {}, "Word lists"),
              subtitle: t("profanity_categories_subtitle", {}, "Choose which kinds of language to filter."),
              value: categoriesLabel
            })}
            ${this.renderActionRow({
              focusKey: "playback:profanityCustomWords",
              title: t("profanity_custom_title", {}, "Extra words"),
              subtitle: t("profanity_custom_subtitle", {}, "Also filter these words. Use * as a wildcard, for example frak*."),
              value: countLabel(t, settings.customWords.length, "profanity_word_count_one", "profanity_word_count")
            })}
            ${this.renderActionRow({
              focusKey: "playback:profanityAllowedWords",
              title: t("profanity_allowed_title", {}, "Allowed words"),
              subtitle: t("profanity_allowed_subtitle", {}, "Never filter these words, for example a character named Dick."),
              value: countLabel(t, settings.allowedWords.length, "profanity_word_count_one", "profanity_word_count")
            })}
            ${
              muting
                ? `
                  <div class="settings-section-label">${escapeHtml(t("profanity_section_mute", {}, "Muting"))}</div>
                  ${this.renderActionRow({
                    focusKey: "playback:profanityPrecision",
                    title: t("profanity_precision_title", {}, "Mute length"),
                    subtitle: t(
                      "profanity_precision_subtitle",
                      {},
                      "Word timing is estimated from the subtitle line. Whole line mutes more but misses less."
                    ),
                    value: profanityPrecisionLabel(t, settings.mutePrecision)
                  })}
                  ${this.renderActionRow({
                    focusKey: "playback:profanityPadding",
                    title: t("profanity_padding_title", {}, "Extra mute time"),
                    subtitle: t("profanity_padding_subtitle", {}, "Added before and after each muted word to cover timing errors."),
                    value: t("profanity_padding_value", [settings.mutePaddingMs], `${settings.mutePaddingMs} ms`)
                  })}
                  ${this.renderToggleRow({
                    focusKey: "playback:profanityWithoutSubtitles",
                    title: t("profanity_hidden_subs_title", {}, "Mute with subtitles off"),
                    subtitle: t("profanity_hidden_subs_subtitle", {}, "Load an English add-on subtitle in the background just for timing."),
                    checked: settings.muteWithoutSubtitles
                  })}
                  ${this.renderToggleRow({
                    focusKey: "playback:profanityIndicator",
                    title: t("profanity_indicator_title", {}, "Show “Filtered” while muted"),
                    subtitle: t("profanity_indicator_subtitle", {}, "A small badge in the corner of the player."),
                    checked: settings.showIndicator
                  })}
                `
                : ""
            }
          </div>
        `;
}
