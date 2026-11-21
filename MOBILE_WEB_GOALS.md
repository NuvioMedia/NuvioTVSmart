# NuvioTVWeb — Mobile Web Goal

**Ultimate objective:** a web-based version of Nuvio usable on phones and tablets.
**Initial goal:** mimic the NuvioMobile app in the mobile browser.

Grounded in branch `feat/web-touch-client` (8 commits ahead of origin). Screens in the codebase: account, cast, catalog, collection, debug, detail, home, library, onboarding, party, player, plugin, search, settings, stream, supporters, tmdb, trakt. No manifest/service worker yet. Touch tier already covers auth/QR, home, bottom nav, detail, settings, search, library, player tokens.

## Phase 1 — Close out the touch-tier branch (finish what's in flight)

- [x] Merge `feat/web-touch-client` → main after the 8 unpushed commits pass review (push first)
- [ ] Verify text-entry focus flow on a real device (keyboard covering inputs, scroll-into-view) — the known open item
- [ ] Validate the player tier live with an authenticated account that has stream sources (guest checkout has none; so far only verified via the static harness)
- [x] Run the Playwright probe suite (390x844, hasTouch) over every re-derived screen as a regression gate, not just ad hoc
- [x] Confirm Tizen/webOS rendering is byte-identical after all tier changes (the core convention)

## Phase 2 — NuvioMobile screen parity (mimic the app screens)

- [ ] Profile selection + PIN overlay on touch tier (`profileSelectionScreen*` exists, DPAD-oriented — needs tap handling)
- [ ] Onboarding / server-connection screen (`serverConnectionScreen`, `syncCodeScreen`) for the touch tier
- [ ] Collections & folders (`collectionsScreen`, `collectionEditorScreen`, `folderDetailScreen`) — editor is form-heavy, needs 44px tap targets and touch-friendly reordering
- [ ] Catalog "see all" grid (`catalogSeeAllScreen`) — currently DPAD-grid keyed
- [ ] Cast screen (`castDetailScreen`) on touch
- [ ] Plugins/add-ons management (`plugin`) on touch tier
- [ ] TMDB/Trakt connect flows (NuvioMobile surfaces these in settings)
- [ ] Account/membership screen (`accountScreen`, `membershipOverviewRepository`) on touch

## Phase 3 — Mobile-web shell behaviors the app has but the browser lacks

- [x] PWA: manifest, icons (192/512/maskable), standalone, theme color (bd335356; icons derived from assets/images/largeIcon.png)
- [x] Installable/offline shell via service worker (UA-gated to browser tier; streams/media never cached; offline boot verified headless)
- [x] Swipe gestures: horizontal carousels with touch drag/scroll (native scroll; camera spring now yields on touch tier in homeScreenMethods-16/17; detail rails snap-scrolled in components-66.css; regression probe has a home-swipe gate)
- [x] Safe-area insets (notch/home bar) via `env(safe-area-inset-*)` on bottom nav and player controls (`--touch-safe-*` vars components-66.css:38-41; nav padding + `--player-overlay-bottom` offsets; `viewport-fit=cover` added to index.html meta, asserted by pwa-check; Tizen override untouched)
- [ ] Landscape layout for tablets (currently the tier assumes 390dp portrait geometry)
- [ ] Picture-in-Picture for background playback (browser substitute for the app's background play)
- [ ] Session persistence so reopening the PWA returns to the same screen (deep links / history)

## Phase 4 — Mobile UX gaps vs NuvioMobile

- [ ] Touch-native player controls: scrubber with large thumb, double-tap side to seek ±10s, tap-to-toggle-then-autohide
- [x] Auth on touch tier: servers with `emailPasswordAuth` capability land on the native email/password form by default (capability default, all tiers); inline one-tap QR<->email switch added for the touch tier when both flows exist (`renderModeSwitch`, components-66.css). Official nuvio.tv backend is tvLogin-only, so the phone path there is QR + >=44px open-on-this-device link (audited by auth-qr-phone + auth-email-form probe gates). Full form replacement on official servers needs the backend to expose the capability.
- [ ] Pull-to-refresh on home/library
- [x] Press-and-hold on poster cards (home, discover, library grid) opens the title-actions menu (Play, Watch Later, Add to/Remove from Library, Manage Lists, Details) at phone scale, with haptic tick; the release click is suppressed at the card and NuvioDialog swallows all clicks for 450ms after mount (Chromium retargets the release onto the freshly mounted menu and used to activate an option silently). Gated by the home-hold-menu, discover-hold-menu and library-hold-menu probe gates using real CDP touch holds.
- [x] Library grid scale on phones: the ATV GridCells token (252dp x 2) rendered one 365x603 mega-card at 390px; compact viewports now use 108x162 posters / 16px gaps (3 columns).
- [x] Settings + settings-player phone tier (26px titles, 56px rows, ellipsized descriptions, 52px account buttons) — previously pure ATV 2x dp scale.
- [x] Virtual-keyboard behavior: sign-in fields carry `autocomplete=username`/`current-password`, `type=email`, `autocapitalize=none` (authQrSignInScreenMethods-01-mount.js renderLoginContent; asserted by the auth-email-form probe gate). Search field inputmode still open if needed.
- [ ] Performance pass on phone-class hardware: lazy poster loading, image sizing (no 1920-canvas poster sizes on a 390px screen)

## Phase 5 — Release readiness

- [ ] Test matrix: iPhone Safari, Android Chrome, iPad; portrait + landscape
- [ ] Accessibility: focus order for screen readers, contrast on the tier sheet
- [ ] Decide the deployment story for the mobile tier (same URL as TV app vs separate host/path)
- [x] Touch-tier probe suite in CI (.github/workflows/mobile-web-probe.yml: npm test + build + test:mobile-web, incl. route audit + PWA checks)

---

**Strategic note:** the highest-leverage items are Phase 3's QR-auth replacement and the PWA shell — those make it _feel_ like NuvioMobile rather than a resized TV app.
