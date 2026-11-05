import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { booleanOrNull, normalizeFeaturePayload } from "./profileSettingsSyncServiceHelpers-01-pull-rpc.js";

// Android syncs only the provider grouping choice through profile settings.
// Repositories and scraper toggles stay device-local, so a settings pull must
// never rebuild the local plugin state from the cloud.
export const plugin_settings = {
  export(profileId) {
    return {
      group_streams_by_repository: PluginStore.get(profileId).settings.groupStreamsByRepository === true
    };
  },
  project(rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const grouping = booleanOrNull(raw.group_streams_by_repository);
    return grouping == null ? {} : { group_streams_by_repository: grouping };
  },
  import(profileId, rawFeature = {}) {
    // A shared profile uses the primary plugin store; Android writes that
    // alias's own payload to an unused store and pulls the primary separately.
    if (String(getEffectivePluginProfileId(profileId)) !== String(profileId || "1")) {
      return false;
    }
    const projected = this.project(rawFeature);
    if (!Object.prototype.hasOwnProperty.call(projected, "group_streams_by_repository")) {
      return false;
    }
    const state = PluginStore.get(profileId);
    const enabled = projected.group_streams_by_repository;
    if ((state.settings.groupStreamsByRepository === true) === enabled) {
      return false;
    }
    PluginStore.replace(
      {
        ...state,
        settings: { ...state.settings, groupStreamsByRepository: enabled }
      },
      profileId
    );
    return true;
  }
};
