export function renderEpisodesSection(meta) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  if (!videos.length) {
    return `<div class="row"><p>No episodes available.</p></div>`;
  }

  const rows = videos
    .slice(0, 20)
    .map(
      (video) => `
    <div class="card">
      <div style="font-weight:700;">${video.title || video.id || "Episode"}</div>
      <div style="opacity:0.8;">${video.released || ""}</div>
    </div>
  `
    )
    .join("");

  return `<div class="row"><h3>Episodes</h3>${rows}</div>`;
}
