function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHeroSection(meta) {
  return `
    <div class="row">
      <h2>${escapeHtml(meta?.name || "Untitled")}</h2>
      <p>${escapeHtml(meta?.description || "")}</p>
    </div>
  `;
}
