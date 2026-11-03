# Radar and playlists implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add personal discovery and QQ/NetEase playlist import with smooth desktop interaction.
**Architecture:** Metadata-only song references live independently of local audio. A bounded client coordinator persists playlist/download state; a server discovery boundary normalizes public platform metadata and registers playable candidates with the existing music service.
**Tech Stack:** React 19, TypeScript, Node ESM, IndexedDB, Electron, Playwright.
**Spec:** docs/superpowers/specs/2026-11-03-radar-playlists-design.md

## Global Constraints
- Preserve existing audio, artwork/crops, themes and user profile; use a feature branch in the existing checkout.
- Public QQ and NetEase links only. No login, paid AI or external preference storage.
- Default daily 30 / 70% new, strict recording versions, import auto-downloads missing audio.
- Maintain playback and scroll state; respect reduced motion and keyboard use.

## Review Focus
- Truncated upstream lists and short-link redirects must not silently look complete.
- Same title with different performer/live/instrumental version must not auto-match.
- Restart, pause or disk/import failure must not lose list entries or silently duplicate audio.
- A seek or restored pause must not inflate listening history; dislikes must survive refresh.
- Large queues and page switches must not restart current audio or hide the last row.

### Task 1: identity, discovery model and ranking
Files: shared/music-identity.mjs + declarations; src/lib/discovery.ts; src/types.ts; src/lib/storage.ts; src/lib/library.ts; tests/discovery.test.mjs.
Interfaces: recordingMatch(a,b), songIdentity(song); SongRef, PersonalPlaylist, ListeningStats; rankRadar(candidates,tracks,stats,preferences,ratio,seed).
- [x] Add tests asserting recordingMatch rejects Live/covers, handles traditional/simplified names and missing album; duplicate IDs normalize.
- [x] Run `node --test tests/discovery.test.mjs`; expect missing module failure.
- [x] Implement normalization, ranking, completion measurement and storage migration with dedicated document records.
- [x] Run the same tests; expect all pass; `npm run build` verifies type compatibility.

### Task 2: public platform boundary
Files: server/discovery.mjs; server/api.mjs; server/music-service.mjs; tests/discovery-service.test.mjs.
Interfaces: DiscoveryService.playlist(input,signal), candidates(seeds,tags,signal); MusicService.register(song), prepare(song,signal).
- [x] Test invalid hosts, multi-time query links, private errors, incomplete list counts and strict fallback using injected JSON/provider fixtures.
- [x] Run `node --test tests/discovery-service.test.mjs`; expect missing module failure.
- [x] Implement whitelist link parsing, bounded short redirects, NetEase full-ID details, QQ pagination/count checking, similarity/tag candidates and strict download preparation.
- [x] Register POST /playlists/preview, /radar/candidates and /songs/prepare; enforce existing origin boundary and bounded body size.
- [x] Re-run service and existing music API tests; expect pass.

### Task 3: persistent playlist and listening coordinator
Files: src/hooks/useDiscovery.ts; src/hooks/useListening.ts; src/hooks/usePlayer.ts; src/App.tsx; tests/discovery.e2e.mjs.
Interfaces: useDiscovery({tracks,ready,onImport,onPlay,notify}); playlist operations and bounded resumable preparation; setQueue(ids).
- [x] Add browser scenarios for auto-download/import receipt, persisted pause, original order, update diff, duplicate import, sequential queue and real playback continuity.
- [x] Run the browser scenarios before wiring features; expect missing navigation/control assertion.
- [x] Implement snapshot persistence, serialized writes, bounded download workers, real-time listening stats and independent queue without rebuilding audio resources.
- [x] Run browser scenarios against fixture API plus core tests; expect pass.

### Task 4: fluid user interface
Files: src/components/DiscoverySpace.tsx; DiscoverySpace.css; DiscoveryDialog.tsx; App integration.
Interfaces: durable hidden pages and focused modal dialogs using coordinator actions.
- [x] Extend browser scenarios for keyboard dialog close, rapid stale preview, list bottom, radar feedback, preference adjustment and theme continuity.
- [x] Build sidebar songlists, import preview, editable list, background progress and daily radar orbit with immediate state feedback.
- [x] Run focused browser test and inspect screenshots in all themes/small desktop; correct overflow/focus problems.

### Task 5: final verification and desktop delivery
Files: README.md; desktop build output (ignored); verification report.
- [x] Run `npm test`, `npm run build`, focused discovery E2E, existing online/player/desktop regressions.
- [x] Live-check public QQ/NetEase import and similarity separately, report exact coverage.
- [x] Fresh review of full changes; fix important findings and run affected tests.
- [x] Package current local desktop and launch; keep existing v1.0.0 release untouched.

## Execution ledger
2026-11-03: Design approved. Native execution in existing checkout on codex/radar-playlists. User asked implementation and smoother UX; no additional design approval round. Interfaces follow metadata refs -> server registration -> client coordinator -> views. No destructive data migration or automatic publishing.

2026-11-03 Task 1-4: complete. 115/115 unit/service tests; discovery browser and v2 migration passed. Live public metadata: NetEase 200/200, QQ 17/17; similarity + rock-tag sources returned 25 candidates in 329ms. Full body transfer/download success remains provider-dependent.
2026-11-03 Review: fixed eight reported behaviors, with RED/GREEN regressions for receipt restoration, transport intent supersession, shared task ownership (including delayed prepare after delete), restart resume, all-source outage, recovered placeholder rows, storage-error retry gating, and stale update responses. Existing browser online and player regression suites passed.
2026-11-03 Ruling: use same-origin cover proxy through the existing bounded ArtworkService rather than relaxing desktop CSP; official NetEase/QQ CDNs only, validated image signatures. Desktop protocol custom-scheme tests replace localhost bridge responses in main process because browser HTTP route interception does not apply to clear:.

2026-11-03 Task 5: complete. Final npm test 116/116; production build and package passed; full test:desktop passed, followed by focused native discovery pass on the last package. Final test:discovery and v2 migration passed. Existing online/player regression suites passed. Root ClearPlayer.exe launched and a real main window was observed. Full evidence: docs/discovery-verification.md. No GitHub push or Release update performed.
