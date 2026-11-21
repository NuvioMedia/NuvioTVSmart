// Media-server ids reference a connection that only exists on this device, so
// they must stay out of the cloud watch snapshot, like Android's ServerItemRef.
export function isDeviceLocalWatchId(contentId) {
  return String(contentId || "")
    .trim()
    .startsWith("server:");
}
