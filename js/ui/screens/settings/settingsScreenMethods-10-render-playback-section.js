import { registerPlaybackActionsPart01 } from "./settingsScreenPlaybackActions-01.js";
import { registerPlaybackActionsPart02 } from "./settingsScreenPlaybackActions-02.js";
import { registerPlaybackActionsPart03 } from "./settingsScreenPlaybackActions-03-profanity.js";
import { renderPlaybackSectionMarkup } from "./settingsScreenPlaybackMarkup-06-section.js";

export function createSettingsScreenMethods10() {
  return {
    renderPlaybackSection(model) {
      this.ensureExpandedState("playback");
      registerPlaybackActionsPart01.call(this, model);
      registerPlaybackActionsPart02.call(this, model);
      registerPlaybackActionsPart03.call(this, model);
      return renderPlaybackSectionMarkup.call(this, model);
    }
  };
}
