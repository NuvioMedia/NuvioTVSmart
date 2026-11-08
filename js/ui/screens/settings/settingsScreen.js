import { escapeMediaServerText } from "./settingsMediaServersSection.js";
import { createTrackingSettingsMethods } from "./trackingSettingsMethods.js";
/* global __NUVIO_APP_VERSION__ */
import { createSettingsScreenMethods01 } from "./settingsScreenMethods-01-get-current-rail-scroll-top.js";
import { createSettingsScreenMethods02 } from "./settingsScreenMethods-02-render-action-row.js";
import { createSettingsScreenMethods03 } from "./settingsScreenMethods-03-render-text-dialog.js";
import { createSettingsScreenMethods04 } from "./settingsScreenMethods-04-render-collapsible-row.js";
import { createSettingsScreenMethods05 } from "./settingsScreenMethods-05-render-advanced-section.js";
import { createSettingsScreenMethods06 } from "./settingsScreenMethods-06-render-layout-section.js";
import { createSettingsScreenMethods07 } from "./settingsScreenMethods-07-render-plugins-section.js";
import { createSettingsScreenMethods08 } from "./settingsScreenMethods-08-render-integration-detail.js";
import { createSettingsScreenMethods09 } from "./settingsScreenMethods-09-render-integration-section.js";
import { createSettingsScreenMethods10 } from "./settingsScreenMethods-10-render-playback-section.js";
import { createSettingsScreenMethods11 } from "./settingsScreenMethods-11-start-trakt-device-auth.js";
import { createSettingsScreenMethods12 } from "./settingsScreenMethods-12-render-trakt-stats-strip.js";
import { createSettingsScreenMethods13 } from "./settingsScreenMethods-13-apply-focus.js";
import { createSettingsScreenMethods14 } from "./settingsScreenMethods-14-activate-focused.js";
import { createSettingsScreenMethods15 } from "./settingsScreenMethods-15-cleanup.js";
import { createSettingsScreenMethods16 } from "./settingsScreenMethods-16-p2p-cache.js";
import { createSettingsScreenMethods17 } from "./settingsScreenMethods-17-network-tests.js";

export * from "./settingsScreenContext.js";
export const SettingsScreen = {
  escapeMediaServerText,
  ...createSettingsScreenMethods01(),
  ...createSettingsScreenMethods02(),
  ...createSettingsScreenMethods03(),
  ...createSettingsScreenMethods04(),
  ...createSettingsScreenMethods05(),
  ...createSettingsScreenMethods06(),
  ...createSettingsScreenMethods07(),
  ...createSettingsScreenMethods08(),
  ...createSettingsScreenMethods09(),
  ...createSettingsScreenMethods10(),
  ...createSettingsScreenMethods11(),
  ...createSettingsScreenMethods12(),
  ...createSettingsScreenMethods13(),
  ...createSettingsScreenMethods14(),
  ...createSettingsScreenMethods15(),
  ...createSettingsScreenMethods16(),
  ...createSettingsScreenMethods17(),
  ...createTrackingSettingsMethods()
};
