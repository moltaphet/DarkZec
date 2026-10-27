# Live terminal security stream / Step 2

> **Historical stage report.** Written before the commit/reveal ledger rewrite and the UI merge: its test counts, commitment/sandbox-encryption wording and Merkle timing may be outdated. See the [engineering report](../engineering-report.md) and the README for the current build.

Historical Step 2 report. [Phase 1 security changes](phase1-security-report.md) supersede its commitment/address/clearing policies; [Phase 2 QA changes](phase2-qa-report.md) supersede its startup shield, Merkle-event timing and verification counts. ACTIVE now describes verified local mock payloads, not address-policy readiness.

Implemented a dedicated NODE 07 security stream below the active workspace, available in auction, wallet and vault views. This checkout uses Vite and strict TypeScript with typed DOM components. `LiveTerminalStream.tsx` follows that architecture without adding React, dependencies, network services or persistence.

## File inventory

| Relative path | Change |
| --- | --- |
| `src/components/LiveTerminalStream.tsx` | New complete stream, shared bounded typewriter renderer, UTC event timestamps, counters, capacity meter, pause/resume, clear and lifecycle cleanup. |
| `src/components/LiveTerminalStream.css` | New responsive matte black/phosphor layout, crisp borders, restrained text glow and warning colors; inherits local monospace and existing glass panels. |
| `src/components/TelemetryRail.ts` | Replaced independent log/counter storage with a compact projection of the shared audit model. Existing dock controls and identifiers remain. |
| `src/lib/security-events.ts` | New typed event vocabulary, fixed messages, numeric validation, immutable snapshots, bounded memory store and isolated observer/subscriber delivery. |
| `src/lib/security-monitor.ts` | New lifecycle-owned passive CSP listener. Confirms the configured outbound guard, counts enforced external violations once for the existing HTTP/meta policy pair and discards destinations. |
| `src/components/MemoScramble.ts` | Forwards protocol events only for the current draft revision; superseded async work cannot emit late events. |
| `src/protocol/memo.ts` | Optional observer in `prepareBid`, called after actual UTF-8 validation, commitment hashing and URI creation, with generic failure classification. |
| `src/lib/mock-note-scanner.ts` | Optional observer at mock authentication, memo extraction, validated bid and scan-summary boundaries; cancellation checked after hashing. |
| `src/components/ViewingKeyVault.tsx` | Observes actual save/unlock starts, successes/failures, scanner operations, lock and forget; private error messages stay in the private vault view. |
| `src/main.ts` | Owns the shared model/monitor, mounts both views, instruments composer/wallet/auction preparations and connects the vault observer. |
| `index.html` | Adds the stream host to the common terminal layout. |
| `tests/security-events.test.ts` | Seven new model/protocol/scanner tests. |
| `tests/e2e/live-terminal.spec.ts` | Four new integrated browser tests and responsive screenshots. |
| `README.md` | Documents stream behavior and truthful counter semantics. |
| `docs/superpowers/plans/2026-10-17-live-terminal-stream.md` | Implementation checklist and privacy boundaries. |
| `docs/live-terminal-report.md` | This report. |

## Event interception

Callbacks observe completed operations rather than merely clicks. `prepareBid` validates UTF-8 JSON before Base64url encoding, emits commitment completion after Web Crypto resolves, then emits ZIP-321 creation only after destination/payment validation succeeds. Failed preparation never emits URI success. The debounced memo preview uses a revision guard so stale operations cannot restore a cleared draft's audit state. Explicit Prepare reuses the existing draft; the subsequent review event identifies that user action without rerunning the cryptography.

The vault records encrypted session saves and successful/failed local unlock attempts. The mock scanner reports each attempted AES-GCM authentication, successful extraction of an exact 512-byte memo field, accepted bid schema/commitment/escrow checks, quarantine and final accepted/rejected/empty totals. The JSON byte counter changes only after successful validation. Authentication failures do not claim extraction success. Cancellation stops late acceptance or completion events. Mock operations carry a visible SIM label; real Orchard decryption is not implemented by this step.

Existing auction handlers now publish into the same store: local commitment submission, demo notes, closing, uniform-price clearing and Merkle verification. URI payloads, bid values and participant details never enter the audit API. This remains a uniform-price local sandbox, not a new chain integration or Vickrey implementation.

## Privacy and performance

- Event callbacks accept discriminated unions, not free-form messages or exceptions. Stored records are constructed from fixed labels and validated byte/count metadata. Extra event properties are ignored. No keys, passphrases, auction IDs, note IDs, salts, hashes, amounts, addresses, JSON, URIs or blocked URLs are retained.
- All audit data is memory-only. No logs enter session storage, the clipboard, browser console, analytics or a network request. The existing encrypted viewing-key session adapter is unchanged.
- Existing `connect-src 'none'`, self-hosted assets and local monospace fonts remain. No polling, external endpoints, dependency additions or network API monkeypatching. `LEAKS BLOCKED` counts observed enforced external CSP violations; it does not claim all device traffic was inspected.
- Orchard ACTIVE reports the validated Orchard-only address policy. Startup explicitly says there is no live pool connection. ZIP-321 encoding is not called encryption. The 512-byte field extraction message appears only after authenticated mock decryption.
- One store retains at most 128 immutable events, the rail renders the last 18, and evictions are reported. Clear/reset preserve observed security block counts. Pause affects rendering only; Clear still immediately removes paused rows. New scans and vault lock clear stale memo capacity.
- Typewriter work uses the existing 30fps requestAnimationFrame scheduler, stops when complete/offscreen/hidden and becomes immediate under reduced motion. It reads scroll geometry on scroll events rather than during each character update. Scrolling up suspends following. No character-by-character screen-reader announcements (`aria-live="off"`); the log remains keyboard-focusable and readable.
- Page exit releases subscriptions, frames, observers, listeners, rows and retained event records through the existing lifecycle owner.

## Local walkthrough

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. This dev script builds and serves the production bundle without an HMR socket; rebuild/refresh after edits.

1. Inspect the stream below the auction: initialization, policy and memo/commitment/URI events appear with UTC timestamps.
2. Edit price/quantity, prepare and commit a bid; compare the byte meter and rail. Load demo bids, close and clear to see SIM auction events.
3. Pause the stream and perform another operation. Counters still update. Resume to see retained events. Clear the log; both views empty while shield/block counters remain.
4. Open Vault scanner, use demo credentials, save/unlock and load notes: three accepted bids, one quarantined schema and one empty memo are reported. Lock, try a wrong passphrase and unlock again to inspect refusal/success events. Lock resets capacity.
5. Inspect at 390px width and with reduced motion enabled. No external connection is required for these interactions.

## Automated verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable. In this workspace, verification uses the existing temporary cached-browser configuration:

```sh
npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts
git diff --check
```

Observed results: **35 unit/privacy tests passed**, **strict TypeScript/Vite build passed**, and **17 browser tests passed**. Seven added unit tests cover immutable/redacted metadata, UTC monotonicity, retention/clear/reset, runtime numeric guards, observer isolation/disposal, preparation failures, successful/wrong-key scans and cancellation. Four added browser tests cover integrated URI/auction events, shared counters, pause/clear, vault success/failure redaction, CSP deduplication, retention, ordinary/reduced-motion rendering and mobile overflow. Existing thirteen browser scenarios remain passing. Source privacy checks reject external network APIs, trackers, unsafe HTML sinks, console logging and `any` types; the authorized encrypted-session adapter is the sole persistence exception.

Screenshots are generated in ignored `test-results/`: `live-terminal-desktop.png`, `live-terminal-mobile.png` and `live-terminal-mobile-detail.png`. Desktop and mobile layouts are visually reviewed. No commit, push or deployment was performed.
