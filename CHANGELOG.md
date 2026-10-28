## Unreleased

### Improvements & Fixes

- Home and detail-rail focus moves snap to their target on LG webOS instead of tweening, removing the ~0.7s scroll-settling lag measured on modern panels (#1153) (@malkstar)

## 1.2.10

### Improvements & Fixes

- Reduced Home artwork memory growth and released poster observers and buffers when they are no longer needed (@malkstar, @WhiteGiso)
- Improved Back navigation on webOS by retaining Home under restored routes and preserving focus and scroll state (@malkstar, @WhiteGiso)
- Refined Home, Search and Discover focus scrolling while keeping immediate scrolling scoped to runtimes that require it (@malkstar, @WhiteGiso)
- Added webOS title deep links from launch parameters, aligned with Android TV (@WhiteGiso)
- Added MDBList watched-state tracking and scrobbling, including tracking-source selection and account authorization improvements (@WhiteGiso)
- Added SDH text-subtitle filtering using Android TV rules (@WhiteGiso)
- Improved live-player controls, remote focus and accessibility, and fixed direct playback startup and unmuting outside webOS (@WhiteGiso)
- Preserved multiline addon stream names and reported the actual HTTP status when playback fails (@WhiteGiso)
- Restored unfinished detail enrichment after returning from streams and refreshed Continue Watching metadata (@WhiteGiso)
- Improved collection pagination and GIF source selection; regular covers now remain in use when Focus GIF is disabled (@WhiteGiso)
- Improved profile data isolation and removal, reset Search at profile selection, and aligned supporter avatar fallbacks with Android TV (@WhiteGiso)
- Improved Tizen embedded-audio metadata handling and webOS audio-track selection recovery (@WhiteGiso)
- Exposed native webOS network-service errors in Console debug to support diagnosis of TMDB and provider failures (@WhiteGiso)

## 1.2.8

### Improvements & Fixes

- Revalidated cached addon manifests at each app session so addon updates are picked up without reinstalling (@WhiteGiso)
- Kept Library filter and sort selections when returning to the screen, per profile, aligned with Android TV (@WhiteGiso)
- Discarded stale Discover results when changing filters quickly, aligned with Android TV (@WhiteGiso)
- Fixed audio transcoding stalls on webOS when the player requests frames beyond the buffer limit (@WhiteGiso)

## 1.2.7

### Improvements & Fixes

- Fixed seeking and resume on Samsung Tizen AVPlay: addon redirect sources now play directly instead of through the local proxy, resume seeks wait until the player is prepared, and the seek spinner no longer gets stuck (@Riccardo1451, @WhiteGiso)
- Made Watch Party seeks land exactly on the requested position with the webOS native file player (@WhiteGiso)
- Kept an episode marked as watched for the rest of the playback after it completes, aligned with Android TV (@WhiteGiso)
- Kept the player layout in place while browsing the Watch Party panel (@WhiteGiso)
- Prevented Skip Intro from seeking past the end of the video (@WhiteGiso)
- Added AVPlay seek and source diagnostics to Console Debug on Tizen (@Riccardo1451)

## 1.2.6

### Improvements & Fixes

- Added Watch Party with realtime sync, QR invites, a party preview before joining, host-only control, member catch-up, shared streams and episode switching, aligned with Android TV (@WhiteGiso)
- Added Ambient mode with idle slideshow, blocked during trailer playback and closing open dialogs when it starts (@WhiteGiso)
- Added episode shuffle on detail and player screens with persisted history (@WhiteGiso)
- Added MDBList account sign-in and library lists, including liked, dynamic and external lists with release-date sorting (@WhiteGiso)
- Added custom poster configuration from the phone companion page with profile sync (@WhiteGiso)
- Added media server watched-state import and sync, mixed movie/show libraries and server-watched notices (@WhiteGiso)
- Improved playback with ASS subtitle placement, subtitles kept clear of player controls, a stream info overlay on the Info key, filename-based episode matching and stream link reuse (@WhiteGiso)
- Preserved playback proxy headers across HLS/DASH redirects and child playlists on webOS (@WhiteGiso)
- Improved Trakt and Simkl tracking with activity-gated refreshes, Continue Watching kept when progress requests fail, restored tracking sources after signing back in and tracking error messages (@WhiteGiso)
- Kept post-play recommendations available when watched-state lookups fail (@WhiteGiso)
- Removed settings not present on Android TV (effects mode, minimal buffering UI, webOS audio compatibility) and the built-in Cinemeta fallback manifest (@WhiteGiso)
- Updated and refined Hungarian translations (@ToxicLand)

## 1.2.5

### Improvements & Fixes

- Fixed duplicate webOS OK/click activation on the sign-in screen and sign-out confirmation, preventing unintended login-mode changes while preserving text input and consecutive remote actions (@nenad, @WhiteGiso)
- Preserved active text editing when pointer hover moves across controls, keeping the TV keyboard open until an explicit click or D-pad navigation changes focus (@WhiteGiso)
- Retained loaded Discover posters across grid and screen updates to prevent visible artwork from blanking during re-renders (@WhiteGiso)
- Fixed Home hero logos inserted during transitions so incremental updates can correctly reuse or remove them (@WhiteGiso)
- Preserved unset TMDB rating and vote-count filters in collections instead of converting empty values to zero (@WhiteGiso)
- Reduced repeated stream badge settings reads during virtualized rendering and avoided unnecessary Tizen native-surface lookups on other platforms (@WhiteGiso)

## 1.2.4

### Improvements & Fixes

- Added bounded, seek-aware DTS and TrueHD to AC-3 conversion for supported webOS Matroska playback, with fallback to the original audio track when conversion cannot proceed (@WhiteGiso)
- Added configurable MDBList ratings to Home hero cards in Modern and Classic/Grid layouts, including provider visibility and order, certified Rotten Tomatoes states, and bounded lookups (@WhiteGiso)
- Improved Home catalog loading with deferred-row prefetch reuse within TV budgets, more efficient retained-row updates, and refreshed rows after effects-mode changes; expanded Trakt collection artwork and metadata (@nenad, @WhiteGiso)
- Improved profile and Home sync behavior by showing local profiles while remote lock checks resolve and applying synced catalog preferences only to installed rows (@WhiteGiso)
- Added a persisted device-local reduced-effects override, restored automatic mode, and hid the browser control when the runtime does not support it (@perinazzoo, @WhiteGiso)
- Improved webOS responsiveness by avoiding Home layer stalls, delaying unnecessary proxy startup, and keeping cached badge image payloads out of stream markup (@WhiteGiso)
- Improved TV sign-in with QR-first login and a login-mode switch while preserving Android's email/password default (@nenad, @WhiteGiso)
- Improved TV playback controls and recovery with safer webOS audio and subtitle selection, synchronized pause and buffering state, and better post-play focus and localized recommendations; native Back now dismisses post-play dialogs (@WhiteGiso)
- Routed hidden Samsung playback through the existing player exit lifecycle for consistent cleanup and navigation (@WhiteGiso)
- Added stream refresh and preserved D-pad focus while results reload; superseded loads no longer replace current results (@WhiteGiso)
- Updated the loading indicator to follow the selected theme accent colors, including on legacy TV runtimes (@WhiteGiso)

## 1.2.3

### Improvements & Fixes

- Fixed Tizen AIOStreams playback through the local proxy, including redirects, relative HLS segment and key URLs, non-default ports, declared playback headers, and upstream connection cleanup (@O1Abdulrahman, @WhiteGiso)
- Improved discovery of late AVPlay tracks and prevented outdated audio-selection callbacks from affecting newer selections or playback sessions; retained native buffering defaults and supported audio-selection states (@O1Abdulrahman, @WhiteGiso)
- Kept focus changes immediate for additional legacy Tizen detail and sidebar controls (@O1Abdulrahman)
- Improved Home poster loading when catalog rows scroll and retained the four-line Modern Home synopsis limit on constrained TVs (@WhiteGiso)
- Reduced repeated stream badge matching work while preserving filter semantics (@WhiteGiso)
- Fixed Library updates arriving before the content mount is ready (@WhiteGiso)
- Applied the Continue Watching recent-title limit after series deduplication and aligned marking previous episodes as watched with the current-season Android behavior (@WhiteGiso)
- Displayed episode sources progressively while preserving source focus and ignoring results after the panel closes (@WhiteGiso)
- Allowed slower address connection attempts for embedded subtitle range requests while preserving larger configured timeouts and older Node runtime compatibility (@WhiteGiso)

## 1.2.2

### Improvements & Fixes

- Improved Home catalog refreshes with incremental row updates that preserve focused cards, artwork, expanded posters, trailers, and scroll position; deferred rows now appear progressively on constrained TVs too (@WhiteGiso)
- Fixed delayed Home focus restoration overriding remote navigation, and kept catalog pagination attached to the current row state (@WhiteGiso)
- Preserved active TV keyboard composition during search updates, cancelled superseded searches, and prevented stale results from replacing the current query (@WhiteGiso)
- Cancelled outdated Trakt comment requests when changing titles or leaving Details, preventing comments from a previous title from appearing (@WhiteGiso)
- Added profile-synced subtitle preferences per title, including embedded tracks, addon subtitles, and subtitles turned off; restored saved selections after track discovery and respected preferred audio-language priority (@WhiteGiso)
- Improved post-play mini-player positioning and animation across TV playback surfaces, including Tizen viewport scaling and visibility through the recommendation background (@WhiteGiso)
- Added a next-episode countdown toggle, preserved Home return navigation across episode transitions, and committed seek previews when releasing the remote direction key (@WhiteGiso)
- Fixed plugin HTTP forwarding on webOS 5/6 by using the Node 8 request contract for fetch and cancellation (@WhiteGiso)
- Improved legacy TV layout compatibility by guarding modern CSS math in custom properties and retaining supported fallback values (@WhiteGiso)

## 1.2.1

### Improvements & Fixes

- Improved constrained-Tizen navigation with faster menu transitions, lighter D-pad handling, and bounded Home image work (@agbabaumut, @WhiteGiso)
- Added profile-synced custom theme colors and episode-rating visibility controls, and kept poster depth inside card shapes (@WhiteGiso)
- Improved TV browsing with a CSS Grid fallback, short-screen entity layouts, normalized Continue Watching artwork, and correct handling of unnumbered live TV in episode details (@WhiteGiso)
- Improved webOS subtitles by restoring addon tracks after source reopening, keeping usable embedded windows active, and shipping static fonts for HTML subtitle styles (@WhiteGiso)
- Added Tizen AVPlay subtitle callback diagnostics to the console debug screen (@WhiteGiso)
- Fixed manual Addons refresh to reload enabled manifests and clear catalog response data so Discovery reflects the updated definitions (@agbabaumut)
- Preferred explicit audio language codes when they conflict with track labels, including Finnish aliases and legacy labels (@agbabaumut, @WhiteGiso)
- Refreshed Smart TV app icons (@WhiteGiso)

## 1.2.0

### Improvements & Fixes

- Aligned profile startup with Android TV by routing from local settings and running account sync in the background, while refreshing Home only when synced inputs change (@WhiteGiso)
- Improved Home responsiveness on older TV runtimes by prioritizing focused artwork and spreading image requests across frames; added background catalog refresh without rebuilding unchanged Home state (@WhiteGiso)
- Aligned watch-progress recovery and deletion with Android by restoring remote rows when local data is missing and retrying pending remote deletions (@WhiteGiso)
- Hardened Tizen HLS playback so browser engines preserve request headers through EngineFS, with a safe AVPlay fallback when the proxy is unavailable; added limited retries for post-startup AVPlay connection failures (@WhiteGiso)
- Matched Android's bounded provider-search waves, propagated TMDB cancellation and deadlines, and reused PluginService connections while preferring healthy network routes (@WhiteGiso)
- Preserved binary plugin request and response bytes across the TV fetch bridge, including typed-array bodies and `response.arrayBuffer()` (@joojoooo, @WhiteGiso)
- Added the webOS minimal-buffering control, corrected Movie Credits translation lookup, and clarified when ASS/SSA styles remain managed by the subtitle renderer (@WhiteGiso)
- Precompiled locale dictionaries for TV runtimes and retained Android string-escape decoding (@WhiteGiso)

## 1.1.9

### Improvements & Fixes

- Improved legacy webOS Home responsiveness by disabling per-track compositor layers and using TV-sized TMDB artwork while leaving unrelated image URLs unchanged (@WhiteGiso)
- Batched watched-series reconciliation across local storage, Trakt, and Simkl, and excluded seasons whose premiere has not been released (@WhiteGiso)
- Kept the webOS companion service alive during playback and stopped its keep-alive when playback ends (@WhiteGiso)
- Cached bitmap subtitle cue frames in a bounded cache to reduce repeated reads (@WhiteGiso)
- Added D-pad navigation between Close and Try Anyway in the unsupported-device warning (@WhiteGiso)
- Fixed Stream Back navigation to preserve Detail returns and route Home only for explicit Home-return flows (@WhiteGiso)

## 1.1.8

### Improvements & Fixes

- Reworked CSS build output into a single ordered bundle compatible with Tizen and webOS wrapper runtimes while preserving stylesheet cascade order and static-page references (@WhiteGiso)
- Fixed Tizen clock formatting to prefer the browser Intl hour cycle when the platform-reported pattern conflicts with the actual formatter (@WhiteGiso)
- Aligned player completion with Android by preserving natural-completion state through post-play dismissal, preventing an AVPlay resume after stream completion, and restoring movie-detail fallback navigation (@WhiteGiso)
- Refreshed embedded webOS subtitle styling after enabling the selected subtitle track during playback (@WhiteGiso)
- Normalized Samsung Back key aliases and removed the duplicate Tizen hardware-key path to prevent repeated navigation while preserving packaged input handling (@WhiteGiso)
- Fixed Tizen EngineFS proxy-header normalization so encoded header values and HLS segment URLs are serialized correctly (@WhiteGiso)

## 1.1.7

### Improvements & Fixes

- Broke the Smart TV router and screen import cycle so Tizen startup no longer captures an undefined navigation router and remains stuck loading on affected TVs (@WhiteGiso)

## 1.1.6

### Improvements & Fixes

- Restored the Tizen install compatibility floor at 2.3 while keeping the runtime support warning at Tizen 4.0, so older TVs can install the app and choose whether to continue (@WhiteGiso)

## 1.1.5

### Improvements & Fixes

- Added an always-visible unsupported-device warning with localized Close and Try Anyway actions; the bypass lasts for the current session only, so the warning returns on the next launch (@WhiteGiso)
- Removed the Tizen package-level minimum-version block so older TVs can reach the in-app compatibility decision while runtime capability checks remain active (@WhiteGiso)
- Completed unsupported-device warning translations across all 36 app locales (@WhiteGiso)
- Fixed the Essential playback settings crash on unsupported Tizen TVs and clearly disabled the unavailable P2P option (@WhiteGiso)
- Restored direct and managed Debrid stream classification and local-resolution helpers in the shared presentation API (@WhiteGiso)
- Expanded runtime lint coverage and removed stale self-imports from player and profile modules (@WhiteGiso)

## 1.1.4

### Improvements & Fixes

- Reconciled Tizen audio metadata with AVPlay stream and container codec order so track labels and selections remain consistent with Android TV ordering (@WhiteGiso)
- Preserved the live playback resume position when returning from the player to an existing Streams screen, preventing stale route parameters from reopening a stream at an older position (@WhiteGiso)
- Unified Tizen HLS engine selection around hls.js when MSE is available, including live playback, while retaining AVPlay and native HLS fallbacks (@WhiteGiso)
- Added a bounded, cancellable queue for bursty plugin HTTP requests while preserving the active concurrency limit, cancellation, and diagnostics (@WhiteGiso)
- Improved live stream detection and recovery across direct-file, HLS, and native playback transitions (@WhiteGiso)
- Updated TV streaming and build dependencies while preserving compatibility with the legacy webOS packaging path (@WhiteGiso)
- Reorganized Smart TV UI, player, data, synchronization, and stylesheet code into focused responsibility-based modules while preserving Android TV-aligned runtime contracts (@WhiteGiso)

## 1.1.3

### Improvements & Fixes

- Hardened stream and subtitle header isolation across hosts, redirects, and HTTPS downgrades while preserving provider request contracts (@WhiteGiso)
- Added Android-aligned movie credits, post-credits skip intervals, precise seeking, settings, and post-play integration (@WhiteGiso)
- Aligned binge-group defaults, TMDB collection ordering, Simkl TVDB preferences, RTL text detection, subtitle language aliases, and Continue Watching theming (@WhiteGiso)
- Added certified Rotten Tomatoes and audience rating states to MDBList metadata and playback/detail surfaces (@WhiteGiso)

## 1.1.2

### Improvements & Fixes

- Added Android-aligned subtitle delay persistence and remote-friendly Auto Sync controls for addon subtitles (@WhiteGiso)
- Improved Discover poster hydration by loading visible and nearby artwork explicitly inside TV scroll containers (@WhiteGiso)

## 1.1.1

### Improvements & Fixes

- Aligned Tizen VOD HLS playback with Android by preferring hls.js when MSE is available while retaining AVPlay and native HLS fallbacks (@WhiteGiso)
- Preserved Tizen playback-proxy startup for packaged EngineFS services when generic web-service capability is unavailable (@WhiteGiso)
- Prevented bright seams in Arabic HTML subtitles by compositing text opacity separately from the outline layer (@WhiteGiso)
- Improved plugin provider connectivity by trying all resolved DNS addresses within the existing request deadline and tracing per-address connection timeouts (@WhiteGiso)

## 1.1.0

### Improvements & Fixes

- Aligned series detail episode rendering with Android TV through stable season and episode updates, duplicate-card removal, long-season virtualization, and focused title marquee behavior (@WhiteGiso)
- Published focused Home heroes immediately, stabilized artwork crossfades and focused GIF cleanup, and prevented preserved Home content from bleeding into other routes (@WhiteGiso)
- Improved Continue Watching Next Up resolution by enriching the selected season and episode, applying TMDB release dates independently, and filtering unavailable episodes (@WhiteGiso)
- Kept Skip Intro visibility and D-pad focus synchronized with playback loading while containing left and right overlay navigation events (@WhiteGiso)
- Restored Android-aligned poster focus scaling across Home layouts and fixed subtitle rail sizing on legacy Chromium TV runtimes (@WhiteGiso)

## 1.0.10

### Improvements & Fixes

- Confirmed the Tizen 6.0 minimum for plugins after Tizen 5.5 service-runtime testing; retained the existing Tizen 5.x plugin and synchronization block while preserving EngineFS torrent support (@WhiteGiso)
- Kept the production PluginService transport with certificate verification and excluded experimental Tizen 5.5 bundling and network adaptations (@WhiteGiso)
- Refresh addon catalog responses after manual synchronization, including failed sync attempts, matching Android's refresh behavior (@WhiteGiso)
- Isolated catalog cache entries by addon URL and prevented in-flight responses from repopulating invalidated cache entries (@WhiteGiso)

## 1.0.9

### Improvements & Fixes

- Improved HLS request budgets, buffering and webOS playback recovery, and reduced transient stall log noise (@WhiteGiso)
- Fixed next-episode overlay focus and extended next-episode source resolution time (@WhiteGiso)
- Improved Home image hydration efficiency, hero overflow and Library Discover navigation (@WhiteGiso)
- Expanded directional remote key normalization and added a webOS service path for TMDB lookups (@WhiteGiso)
- Reconciled verified empty cloud plugin snapshots while preserving dirty local state, restricted plugin HTTP access to loopback clients and aligned provider request timeouts (@WhiteGiso)

## 1.0.8

### Improvements & Fixes

- Restored animated Home focus transitions and spring scrolling on modern webOS while retaining constrained-runtime safeguards (@WhiteGiso)
- Fixed progressive Home catalog rendering and visible poster hydration so lower rows and artwork no longer arrive late during D-pad navigation (@WhiteGiso)
- Prevented an unavailable optional webOS PluginService from blocking watched items, watch progress, and Continue Watching refreshes (@WhiteGiso)
- Decoded escaped Android newline sequences when importing localized strings (@WhiteGiso)

## 1.0.7

### Improvements & Fixes

- Disabled executable plugins and plugin pull/push synchronization on Samsung Tizen 4.x and 5.x while preserving the supported EngineFS/P2P path, and documented the platform limits (@WhiteGiso)
- Standardized the supported Tizen 6+ service pipeline with fixed service ports, canonical WGT packaging, strict health readiness, watchdog recovery, and actionable plugin diagnostics (@WhiteGiso)
- Unified the webOS media and plugin companion layout and hardened Smart TV service, playback, subtitle, navigation, and remote-request handling (@WhiteGiso)
- Improved profile-scoped plugin and watched-state synchronization with provider identity matching and local-state preservation when tracking services fail (@WhiteGiso)
- Removed obsolete Tizen compatibility bridges, legacy service definitions, and unused repository/store-submission assets (@WhiteGiso)

## 1.0.6

### Improvements & Fixes

- Aligned Smart TV playback with Android TV, including post-play recommendations, next-episode and trailer playback, TMDB/Trakt/MDBList metadata, player preferences, subtitle positioning, localized UI, and richer Tizen/webOS diagnostics (@WhiteGiso)
- Stabilized plugin execution and playback across Tizen and webOS, with safer companion-service handling, proxy fallbacks, provider actions, profile synchronization, and reliable Plugins-screen D-pad focus (@WhiteGiso)
- Improved Smart TV navigation and startup responsiveness by rendering Home, Library, Search, Discover, Catalogs, Collections, Detail, Settings, QR login, and TMDB routes before remote work completes while preserving focus and Back behavior (@WhiteGiso)
- Preserved library and watched state across profiles and remote synchronization, including safe empty addon snapshots, Trakt watched movies, cross-provider title identity matching, and consistent native search navigation (@WhiteGiso)
- Made startup update detection reliable on slow Tizen boots with route coordination and transient-request retries, and corrected the README release links for installer, Tizen WGT, and webOS downloads (@WhiteGiso)

## 1.0.5

### Improvements & Fixes

- Aligned Smart TV plugin execution and stream searching with Android TV, including exception containment, provider scheduling, shared sessions, profile synchronization, and pause/resume lifecycle (@WhiteGiso)
- Kept Tizen EngineFS and PluginService independent, on-demand, and separately packaged for direct installation and Apps2Samsung while preserving their distinct ports and identifiers (@WhiteGiso)
- Added runtime notices and translations for TVs where plugin execution is unsupported or limited, without adding messages on fully supported runtimes (@WhiteGiso)
- Hardened TV input/navigation and Tizen/WebOS service handling while retaining warnings and errors for real failures only (@WhiteGiso)

## 1.0.4

### Improvements & Fixes

- Hardened Continue Watching, library loading, and remote progress state so profile changes and delayed synchronization do not replace valid TV content with a temporary empty view (@WhiteGiso)
- Aligned plugin execution with Android behavior by preserving eligible provider work in a cancellable queue and isolating legacy plugin data and migrations per profile (@WhiteGiso)
- Improved Home hero metadata and artwork transitions, Tizen live HLS fallback, and Library/Plugins focus restoration for Samsung TV navigation (@WhiteGiso)
- Aligned plugin synchronization with Android by pulling the remote snapshot before any pending push, so opaque legacy rows cannot block classification and provider hydration (@WhiteGiso)
- Added independent Tizen EngineFS and PluginService lifecycles and ports, preserving lazy P2P startup and starting PluginService on demand during plugin synchronization or the first plugin request, with runtime diagnostics and duplicate-port handling (@WhiteGiso)
- Strengthened Tizen WGT packaging and Samsung installer validation so both service files, bridge, and manifest declarations are checked before installation (@WhiteGiso)

## 1.0.3

### Improvements & Fixes

- Finalized the Tizen plugin-service lifecycle, packaging contract, local health probing, launcher fallbacks, plugin HTTP playback proxy, and localized plugin UI handling (@WhiteGiso)
- Scoped plugin repositories, provider code, and cloud synchronization to the effective profile, including revision and dirty-state protection against cross-profile updates (@WhiteGiso)
- Preserved profile-bound local repository changes during remote reconciliation so stale snapshots cannot overwrite recent TV updates (@WhiteGiso)
- Moved provider-code caching from synchronous `localStorage` to profile-keyed asynchronous IndexedDB with bounded eviction, memory fallback, cleanup handling, authentication/profile integration, and the required Tizen storage privilege (@WhiteGiso)
- Restored the existing detail route after playback, targeting the correct history entry and avoiding duplicate detail screens while retaining stream cleanup (@WhiteGiso)
- Removed test programs and plugin fixtures from tracked application directories, keeping local test assets exclusively under the ignored root `tests/` directory (@WhiteGiso)
