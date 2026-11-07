const APP_SHELL = `
  <div id="app">
    <div id="account" class="screen"></div>
    <div id="profileSelection" class="screen"></div>
    <div id="experienceModeSelection" class="screen"></div>
    <div id="essentialAddonSetup" class="screen"></div>
    <div id="home" class="screen"></div>
    <div id="detail" class="screen"></div>
    <div id="stream" class="screen"></div>
    <div id="castDetail" class="screen"></div>
    <div id="catalogSeeAll" class="screen"></div>
    <div id="tmdbEntityBrowse" class="screen"></div>
    <div id="folderDetail" class="screen"></div>
    <div id="collections" class="screen"></div>
    <div id="collectionEditor" class="screen"></div>
    <div id="library" class="screen"></div>
    <div id="search" class="screen"></div>
    <div id="discover" class="screen"></div>
    <div id="settings" class="screen"></div>
    <div id="debugConsole" class="screen"></div>
    <div id="trakt" class="screen"></div>
    <div id="supportersContributors" class="screen"></div>
    <div id="licensesAttributions" class="screen"></div>
    <div id="watchParty" class="screen"></div>
    <div id="plugin" class="screen"></div>
    <div id="plugins" class="screen"></div>
    <div id="catalogOrder" class="screen"></div>
    <div id="player" class="screen">
      <object id="avPlayerObject" class="tizen-avplay-object" type="application/avplayer"></object>
      <video id="videoPlayer" autoplay playsinline webkit-playsinline preload="auto"></video>
    </div>
  </div>
`;

export function renderAppShell() {
  if (document.getElementById("app")) {
    return;
  }
  document.body.insertAdjacentHTML("afterbegin", APP_SHELL);
}
