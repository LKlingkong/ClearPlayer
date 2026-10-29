# Online music implementation plan

> Use superpowers:subagent-driven-development / dispatching-parallel-agents for independent provider and UI work, then review the integrated result. The user has approved implementation.

**Goal:** Add music search/download to CLEAR and remove obsolete transcription application.
**Architecture:** One loopback Node service owns provider requests, downloads, history and static/dev pages. React consumes same-origin API and reuses local library playback.
**Tech stack:** Node >=22.18, standard HTTP/crypto/fs, React/TypeScript/Vite, existing music-metadata and Playwright.
**Spec:** docs/superpowers/specs/2026-10-29-online-music-design.md

## Constraints and review focus

- Keep three themes and existing playback/library data; no automatic playback on download.
- Validate media and Range semantics before finalizing; never disable TLS globally.
- Fixed providers and opaque song/job keys prevent arbitrary network/path input.
- Partial provider failures preserve other search results. Lyrics failure preserves audio.
- Completed history restores across restart; frontend imports each completion once and can explicitly import again.

## Tasks

1. [x] Provider adapters: independent modules for Kuwo/Kugou and NetEase/QQ/Yinyueku, using shared http helpers and contract in spec. Write endpoint/response fixtures first and run them failing, then port routes and crypto. No UI or download storage changes in provider tasks.
2. [x] Local service: server/providers/http.mjs; registry, downloader, job manager, API and startup modules in server/. First add local HTTP integration tests for valid MP3, HTML rejection, invalid range, partial resume, cancellation and origin/path restrictions. Implement durable history and same-origin production/dev hosting. Run tests until green.
3. [x] Player UI: add online search/result/task component and API client; modify App/types/library for completed download imports and supported real formats. Preserve file import, settings, lyrics and current playback. Add browser tests at network boundary before implementing controls.
4. [x] Integration and cleanup: copy upstream licenses to licenses/, update launchers, scripts and both README files. Verify cleanup targets resolve inside project, then remove only obsolete Python-specific artifacts and docs named in spec. Preserve fixtures and original LenoMusic inputs.
5. [x] Verification/review: run npm test, build and browser suites against real service; perform public endpoint checks with timeouts and record limits honestly. Independent review then fix confirmed findings and rerun affected checks.

## Progress

- Design reflects existing user approval; current checkout is a non-Git project, so no worktree or commits apply.
- Implementation starting with tests and disjoint file ownership.

## Completion evidence

- All five tasks complete. User explicitly authorized full legacy cleanup; every listed target was removed and absence verified.
- npm test: 53/53 pass. npm run build: pass.
- npm run test:e2e: all four browser files pass against production service on original port 5173.
- Real Kuwo search in final production UI: 30 results; desktop/mobile checks and screenshots pass.
- Real Kuwo audio smoke: 7,391,083-byte FLAC, 70.056-second parsed duration, synchronized LRC saved; temporary smoke files removed.
- Independent backend review findings (DNS/IP checks, search deadline, AAC format, HMR binding) fixed and rechecked. UI findings (online lyrics navigation and reimport/removal race) reproduced, fixed and covered by passing browser regressions.
- Public NetEase and QQ search probes succeeded; Kugou verified TLS web search fallback and lyrics succeeded. Music-library site timed out. Other complete downloads remain dependent on live upstream access.
