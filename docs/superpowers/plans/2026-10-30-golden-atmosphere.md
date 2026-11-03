# Golden Atmosphere Implementation Plan

> Use superpowers:executing-plans to implement inline. User delegated design and execution; retain the current checkout and user data.

**Goal:** Add gold vinyl detailing, automatic accurate artwork, and a slow animated playback atmosphere.
**Architecture:** Isolated artwork service and local-artwork reader; existing IndexedDB Blob storage; playback background component and scoped CSS.
**Tech Stack:** React, TypeScript, Electron, Node.js.
**Spec:** ../specs/2026-10-30-golden-atmosphere-design.md

## Global constraints
Preserve audio element/resource during updates. One added dependency: opencc-js 1.4.0, justified by live results using traditional Chinese tags where simplified queries must match. No arbitrary URL proxy or path reader. No real profile in tests. Keep three themes/layouts and reduced-motion support. Do not push without a new request.

## Tasks
- [x] Write failing tests for strict online matching, invalid/oversized images, cache, local cover priority and file bounds.
- [x] Implement `server/artwork.mjs` (`ArtworkService.lookup(metadata, signal)`), `/api/artwork` route, and `desktop/artwork.mjs` (`findLocalArtwork(audioPath)`), plus File-only preload wrapper.
- [x] Integrate local/companion cover discovery in imports and current-song online lookup with latest-state checks, persisted preference, status/retry control.
- [x] Implement `PlaybackAtmosphere.tsx`, slow transform-only animation, cover crossfade, gold detailing, all themes and reduced motion.
- [x] Run focused end-to-end tests for real desktop bridge, automatic cover persistence, manual replacement race, uninterrupted playback, animation and small window layout; inspect screenshots.
- [x] Run existing tests/build, rebuild desktop package, and document the solution and any limitations.

## Review focus
Late lookup after song removal/manual replacement; unknown artist and album mismatch; untrusted image URLs/redirects/oversized body; sibling symlink escape; hidden/reduced-motion animation; close-to-tray audio preserved.

## Verification (2026-10-30)
- `npm test`: 59/59 passed, including six artwork tests and a real local HTTP endpoint.
- `npm run build` and `node desktop/build.mjs`: passed; distribution includes OpenCC and its license notices.
- `npm run test:e2e`: all existing browser suites passed, including downloaded-cover reimport persistence.
- `npm run test:desktop`: protocol checks and all three desktop suites passed; long libraries at 1440×1000, 1100×700 and 800×600 remain usable.
- Artwork desktop suite checks native sibling discovery, automatic cover persistence, manual replacement/deletion races, unchanged audio, actual transform movement, pause/reduced motion, hidden-native-window pause with audio advancement, and the persisted online preference.
- Live metadata/CDN request successfully returned a 127692-byte JPEG for 晴天 / 周杰伦 / 叶惠美 through Hong Kong results after simplified/traditional conversion. Network failures and unmatched metadata keep the placeholder.
- Independent review identified `backgroundThrottling:false` keeping page visibility unchanged in tray. A failing hide-window test reproduced it; native visibility IPC fixed it and the test passed. Reviewed dark, light, and lyric-stage screenshots in screenshots/golden-*.png.
- Work and desktop package remain local; no GitHub push or user-data cleanup performed.
