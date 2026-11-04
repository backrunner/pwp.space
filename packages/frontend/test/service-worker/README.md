# Safari / Service Worker regression checks

Run from the repository root (no production account, push delivery, or database required):

```sh
pnpm --filter frontend exec playwright install webkit chromium
pnpm --filter frontend test:sw
pnpm build
pnpm --filter frontend test:webkit-ui
pnpm --filter frontend test test/unit/initialize-sw.test.ts test/unit/clear-cache.test.ts test/unit/push-notification-support.test.ts
pnpm --filter backend test --run src/server/api/endpoints/sw/unregister.test.ts
```

`test:sw` bundles the actual worker source and serves it from a local HTTP server. It runs WebKit and Chromium checks for mutable resources, localized/content-hashed assets, cache isolation, POST/API bypass, an invalid worker update, two-tab waiting and activation, migration from a legacy skipWaiting worker, offline navigation with incomplete translations, denied CacheStorage, and quota failures.

Cache recovery checks also cover explicit `reload`/`no-cache`/`no-store` requests, cached HTML/error responses under script URLs, corrupt locale JSON, retrying a failed locale fetch in the same worker, scoped cache clearing, and stalled cache writes. Unit tests cover registration retry after reconnect, coalesced update checks, messaging failures, and manual cache clearing with unavailable or stalled storage/network.

`test:webkit-ui` loads the production frontend with local, read-only API fixtures at desktop and mobile viewport sizes. It checks visitor startup, the login dialog, reloading, and service-worker control. Login-dialog screenshots are written to `/tmp/pwp-webkit-desktop.png` and `/tmp/pwp-webkit-mobile.png`. No login is submitted.

## Update contract

- The worker is a classic IIFE built for the same minimum browser targets as the frontend (Safari 18.2, Chromium 130, Firefox 132).
- `/sw.js` revalidates, and registration uses `updateViaCache: 'none'`. Foreground resume and reconnect trigger update checks; overlapping checks are coalesced and foreground checks are limited to once per minute. Failed initial registration is retried on resume/reconnect; failures are caught.
- Updates wait until existing controlled clients close. There is no forced page reload, so an update does not discard an in-progress form. Close **all** site tabs / installed PWA windows and reopen to finish activation; one reload is not sufficient while other controlled clients remain.
- Only same-origin GET requests for content-hashed build assets are cached. Mutable URLs use the browser/network path. Activation removes obsolete Misskey cache namespaces and preserves unrelated caches. Storage denial or quota exhaustion does not block activation or successful network responses.
- Document requests revalidate the HTTP cache. Asset requests with `reload` or `no-cache` bypass CacheStorage reads; `no-store` bypasses reads and writes. Invalid cached status/MIME responses are replaced from the network. Asset cache writes run under `waitUntil` without blocking the response.
- Manual cache clearing deletes Misskey CacheStorage and emoji IndexedDB entries explicitly. It preserves account/settings data and unrelated CacheStorage, releases the waiting UI, and reloads even if cleanup fails or takes more than ten seconds. Metadata/emoji refetching happens on startup.
- The offline fallback handles navigations only. API errors retain their real status and body.
- Push APIs are detected separately from Service Worker support. Missing APIs and subscription-read failures leave the push button unsupported.
- `sw/unregister` accepts old endpoint-only requests **only** with direct account credentials, scoped to that account. Anonymous calls require both matching subscription keys; delegated application tokens cannot use the legacy fallback. Old anonymous endpoint-only callers remain rejected. Do not restore anonymous endpoint-only deletion for compatibility.

## Deployment limits

Waiting for worker activation does not make arbitrary backend API or database breaking changes backward compatible. Keep old hashed frontend assets available while old tabs can still request lazy chunks, and preserve compatible API contracts during rollout. A previously installed legacy worker keeps its old cache policy until every controlled tab/window closes; this change cannot retroactively rewrite that running worker.

WebKit automation and a mobile viewport are not physical iPhone / installed-PWA evidence. Native Safari automation requires Safari's “Allow remote automation” setting; it was disabled on the validation machine. Real APNs delivery, notification interaction, authenticated posting/media flows, and suspended iPhone PWA relaunch still require device testing. Apple documents iOS Web Push for [Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); lifecycle details follow the [Service Workers specification](https://www.w3.org/TR/service-workers/).

## Validation for the 2026.10.0 integration

Upstream has no `main` branch. `online/pwp-space` follows stable `upstream/master`, integrated through `8f438a8a00` (2026.10.0).

- PASS: full build; frontend/backend type checks; SW lint/type check; changed-file ESLint; SPDX.
- PASS: frontend unit suite (181 tests), backend unsubscribe/signature checks (18 tests), WebKit/Chromium SW checks, and production visitor UI in both WebKit viewports.
- BASELINE: the generic shipping script flags eight non-Japanese locale files imported from upstream Crowdin commits. Their contents are byte-identical to upstream/master; no non-Japanese locale was manually edited. The existing local Japanese keys are preserved.
- SKIPPED: migration checks (no entity or migration schema changes), database-backed end-to-end tests (Docker daemon unavailable), native Safari and physical iPhone/PWA/APNs tests.
