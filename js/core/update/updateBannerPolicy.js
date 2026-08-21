// Ported from Android NuvioTV updater/UpdateBannerPolicy.kt so the web update
// prompt behaves like the app: an automatic check does not keep showing a
// version the user already dismissed, while a manual check always shows it.

export function shouldShowUpdate({
  isRemoteNewer,
  force = false,
  bannerEnabled = true,
  dismissedTag = null,
  updateTag
}) {
  if (!isRemoteNewer) {
    return false;
  }
  if (force) {
    return true;
  }
  return bannerEnabled && dismissedTag !== updateTag;
}
