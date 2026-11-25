// Android RatingDialog / RatingPanel / RatingStars: five stars for a 1-10 score, Left/Right
// in single points, digit keys jump (0 = 10), OK saves, Remove clears an existing rating.
import { I18n } from "../../i18n/index.js";
import { NuvioDialog } from "./nuvioDialog.js";
import { RATING_MAX, TrackingRatings } from "../../core/tracking/trackingRatings.js";
import { focusWithoutScroll } from "../navigation/focusWithoutScroll.js";

const STAR_COUNT = 5;
const STAR_PATH =
  "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

/** Android trackingProviderNameRes. */
export function ratingProviderName(provider) {
  if (provider === "simkl") return t("simkl_name", {}, "Simkl");
  if (provider === "mdblist") return t("mdblist_name", {}, "MDBList");
  if (provider === "trakt") return t("trakt_name", {}, "Trakt");
  return "";
}

/** Android formatRating: whole numbers without decimals, otherwise one decimal. */
export function formatRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (Number.isInteger(number)) return String(number);
  try {
    return new Intl.NumberFormat(I18n.getLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(number);
  } catch (_) {
    return number.toFixed(1);
  }
}

/** Android RatingStars select(): one star is two points; clamp to 1..10. */
export function nextRatingValue(current, key, rtl = false) {
  if (key.step) {
    const step = rtl ? -key.step : key.step;
    return Math.min(RATING_MAX, Math.max(1, current + step));
  }
  if (key.digit != null) {
    return key.digit === 0 ? RATING_MAX : key.digit;
  }
  return current;
}

function digitFor(event) {
  const code = Number(event?.keyCode || 0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 96 && code <= 105) return code - 96;
  return null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function starSvg(className) {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}" fill="currentColor"/></svg>`;
}

/**
 * Opens the rating dialog.
 * onBack runs on Back (defaults to closing); onFinished(result) runs after a save or removal,
 * with { saved, removed, provider }.
 */
export function openRatingDialog({
  media,
  title,
  subtitle = null,
  state,
  onFinished = () => {},
  onBack = null
}) {
  const current = state?.rating == null ? null : Number(state.rating);
  const provider = state?.provider || null;
  const rtl = I18n.isRtl();
  let value = current == null ? 0 : Math.min(RATING_MAX, Math.max(0, Math.round(current)));
  let saving = false;
  let zone = "stars";
  let buttonIndex = 0;
  let confirmArmed = false;
  let previousValue = value;
  let dialog = null;

  const content = el("div", "rating-dialog-content");
  content.appendChild(el("div", "rating-dialog-label", t("rating_your_rating", {}, "Your rating")));
  const titleEl = el("div", "rating-dialog-title", title || "");
  titleEl.dir = "auto";
  content.appendChild(titleEl);
  if (subtitle) content.appendChild(el("div", "rating-dialog-subtitle", subtitle));

  const score = el("div", "rating-score");
  const scoreValue = el("span", "rating-score-value");
  score.appendChild(scoreValue);
  score.appendChild(el("span", "rating-score-max", `/${RATING_MAX}`));
  content.appendChild(score);

  const stars = el("div", `rating-stars focusable${rtl ? " is-rtl" : ""}`);
  stars.setAttribute("role", "slider");
  stars.setAttribute("aria-valuemin", "0");
  stars.setAttribute("aria-valuemax", String(RATING_MAX));
  stars.tabIndex = -1;
  const fills = [];
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const star = el("span", "rating-star");
    star.innerHTML = `${starSvg("rating-star-empty")}<span class="rating-star-fill">${starSvg("rating-star-filled")}</span>`;
    stars.appendChild(star);
    fills.push(star);
  }
  content.appendChild(stars);

  content.appendChild(
    el(
      "div",
      "rating-syncs",
      t(
        "rating_syncs_to",
        [ratingProviderName(provider)],
        `Syncs to ${ratingProviderName(provider)}`
      )
    )
  );

  const actions = el("div", "rating-actions");
  const buttons = [];
  if (current != null) {
    const remove = el(
      "button",
      "nuvio-dialog-button rating-action",
      t("rating_remove", {}, "Remove")
    );
    remove.dataset.action = "remove";
    buttons.push(remove);
  }
  const save = el(
    "button",
    "nuvio-dialog-button rating-action rating-action-primary",
    t("action_save", {}, "Save")
  );
  save.dataset.action = "save";
  buttons.push(save);
  buttons.forEach((button) => actions.appendChild(button));
  content.appendChild(actions);

  const canSave = () => !saving && value > 0 && value !== current;
  const enabled = (button) => (button.dataset.action === "save" ? canSave() : !saving);

  function render() {
    scoreValue.textContent = value > 0 ? String(value) : "–";
    score.classList.toggle("is-empty", value <= 0);
    stars.setAttribute("aria-valuenow", String(value));
    stars.setAttribute("aria-valuetext", t("rating_value", [String(value)], `${value} out of 10`));
    const cascadeFrom = Math.floor(Math.min(previousValue, value) / 2);
    fills.forEach((star, index) => {
      const fraction = Math.min(1, Math.max(0, value / 2 - index));
      const before = Math.min(1, Math.max(0, previousValue / 2 - index));
      star.style.setProperty("--rating-fill", `${fraction * 100}%`);
      if (fraction > before) {
        // Android Star: a short pop on every star that fills further, cascading from the change.
        star.classList.remove("is-popping");
        star.style.animationDelay = `${Math.max(0, index - cascadeFrom) * 40}ms`;
        void star.offsetWidth;
        star.classList.add("is-popping");
      }
    });
    previousValue = value;
    buttons.forEach((button) => {
      const isEnabled = enabled(button);
      button.disabled = !isEnabled;
      button.classList.toggle("is-disabled", !isEnabled);
    });
    stars.classList.toggle("focused", zone === "stars");
    buttons.forEach((button, index) =>
      button.classList.toggle("focused", zone === "actions" && index === buttonIndex)
    );
    const target = zone === "stars" ? stars : buttons[buttonIndex];
    if (target) focusWithoutScroll(target);
  }

  function close() {
    dialog?.destroy();
    dialog = null;
  }

  async function submit(rating) {
    if (saving) return;
    saving = true;
    render();
    const saved = await TrackingRatings.rate(media, rating);
    close();
    onFinished({ saved, removed: rating == null, provider });
  }

  function moveToActions() {
    const first = buttons.findIndex((button) => enabled(button));
    if (first < 0) return;
    zone = "actions";
    buttonIndex = first;
    render();
  }

  function onKey(key, event) {
    if (saving) return true;
    if (zone === "stars") {
      const digit = digitFor(event);
      if (key.isLeft || key.isRight) {
        value = nextRatingValue(value || 0, { step: key.isRight ? 1 : -1 }, rtl);
        render();
        return true;
      }
      if (digit != null) {
        if (!event?.repeat) {
          value = nextRatingValue(value, { digit });
          render();
        }
        return true;
      }
      if (key.isEnter) {
        if (!event?.repeat) confirmArmed = true;
        return true;
      }
      if (key.isDown) {
        moveToActions();
        return true;
      }
      return key.isUp;
    }
    if (key.isLeft || key.isRight) {
      const step = (key.isRight ? 1 : -1) * (rtl ? -1 : 1);
      let next = buttonIndex + step;
      while (buttons[next] && !enabled(buttons[next])) next += step;
      if (buttons[next]) {
        buttonIndex = next;
        render();
      }
      return true;
    }
    if (key.isUp) {
      zone = "stars";
      render();
      return true;
    }
    if (key.isEnter) {
      const button = buttons[buttonIndex];
      if (button && enabled(button) && !event?.repeat) {
        void submit(button.dataset.action === "remove" ? null : value);
      }
      return true;
    }
    return key.isDown;
  }

  function onKeyUp(key) {
    if (zone === "stars" && key.isEnter && confirmArmed) {
      confirmArmed = false;
      if (canSave()) void submit(value);
      return true;
    }
    return false;
  }

  buttons.forEach((button, index) =>
    button.addEventListener("click", () => {
      if (!enabled(button)) return;
      zone = "actions";
      buttonIndex = index;
      void submit(button.dataset.action === "remove" ? null : value);
    })
  );

  dialog = new NuvioDialog({
    title: "",
    // Android NuvioDialog width 560dp.
    widthVw: 58.33,
    panelClassName: "rating-dialog-panel",
    content,
    onKey,
    onKeyUp,
    onDismiss: () => {
      if (typeof onBack === "function") onBack();
    }
  });
  dialog.mount(document.body);
  // Android requestFocusAfterFrames on the stars.
  requestAnimationFrame(() => requestAnimationFrame(render));
  render();
  return {
    close,
    get isOpen() {
      return Boolean(dialog);
    }
  };
}
