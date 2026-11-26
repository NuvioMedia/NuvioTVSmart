export function renderHeroSection(meta) {
  return `
    <div class="row">
      <h2>${meta?.name || "Untitled"}</h2>
      <p>${meta?.description || ""}</p>
    </div>
  `;
}
