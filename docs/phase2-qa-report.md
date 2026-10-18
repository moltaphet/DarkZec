# Phase 2 — UI, telemetry and documentation audit

Audit finalized: 2026-10-18.

All requested areas were corrected in the existing strict TypeScript terminal. Phase 1 cryptographic, address, registry and clearing changes remain intact. The current full suite is larger than the requested historical 15-unit/9-E2E/29-module baseline: final measurements are **55 tests across 9 unit/privacy/CLI files, 26 E2E tests and 39 bundled modules**.

## Applied fixes

| Requirement | Implementation and evidence |
| --- | --- |
| Unselected ArrowLeft | `src/components/BlindOrderflow.ts` treats no selection separately before modular wrapping. Left chooses `n-1`, Right chooses `0`; zero-node arithmetic is guarded. Browser coverage includes three-node wrapping, Escape and a one-node book. |
| Closed-auction preview lock | `src/components/MemoScramble.ts` owns an enable gate. Disabling clears private buffers/timers and invalidates revisions; preparation refuses while locked, updates do nothing and stale observer/promise completions are discarded. `src/main.ts` disables price/quantity fields and rejects late/programmatic input events outside an open auction. |
| Complete reset | The three auction/wallet/audit forms return to defaults. Prepared output, review state, URI, errors, roots, proof/result rows, preview and seed progress clear; a new sandbox key is created and one valid default preview restarts. Wallet/scanner mode controls remain independent. |
| Partial seed retry | Accepted fixture progress advances only after successful submission. A simulated failure on the second encryption reproduced the old four-bid duplication bug; retry now finishes at three bids. Repeated resets permit one fresh three-fixture set. |
| Merkle event timing | Commit now logs encrypted local acceptance. Close freezes the auction and awaits root/proof compilation before emitting the separate Merkle event. Empty books and a simulated digest failure emit no leaf-generation success. |
| Truthful shield badge | `src/lib/security-events.ts` derives IDLE/ACTIVE/OFFLINE from fixed local payload-state identifiers. Startup and readable URI generation are IDLE. Successfully sealed auction envelopes and authenticated/validated mock bids activate it. Lock/reset/unseal clear it; failed mock verification is OFFLINE. Both renderers show explicit local/mock detail text. |
| Fresh E2E build | `package.json` now runs `npm run build && playwright test`; `verify` runs unit tests then that command, avoiding a redundant build. The full E2E command visibly rebuilt before all 26 scenarios. |
| Missing-build CLI | `scripts/serve.ts` checks the directory, entry file and readability before listening. Missing/incomplete builds exit 1 with build/dev commands. Two isolated subprocess tests verify the guidance and absence of a raw stack. |
| Runtime compatibility | Manifest/lock root support Node 22.18+ on 22.x, 24.x and 26+. Native TypeScript execution and the installed Vitest release constraints determine this range. Official Node 22.18.0 and 24.0.0 archives were checksum-verified and used for actual tests/builds. |
| Current documentation | `docs/engineering-report.md` was rewritten for the Git-enabled `main` working tree, active file inventory, protocol rules, truthful telemetry, current results and runtime matrix. README and stage-report notices were updated. |

## Files changed for this phase

- `src/components/BlindOrderflow.ts`
- `src/components/MemoScramble.ts`
- `src/main.ts`
- `src/lib/security-events.ts`
- `src/components/TelemetryRail.ts`
- `src/components/LiveTerminalStream.tsx`
- `index.html`
- `package.json`, `package-lock.json`
- `scripts/serve.ts`
- `tests/security-events.test.ts`, new `tests/serve.test.ts`
- New `tests/e2e/phase2.spec.ts`
- `tests/e2e/polish.spec.ts`, `tests/e2e/live-terminal.spec.ts`, `tests/e2e/viewing-vault.spec.ts`
- `README.md`, `docs/engineering-report.md`, `docs/live-terminal-report.md`, `docs/ui-polish-report.md`
- `docs/superpowers/plans/2026-10-17-phase2-qa.md`, this report

Earlier phase changes remain uncommitted alongside this work; no unrelated edits were discarded. No new application dependencies or external services were introduced.

## Security and behavior boundaries

The ORCHARD SHIELD name remains part of the requested terminal UI, but it is explicitly a **local mock payload indicator**. It does not assert live Orchard encryption, chain synchronization or an independently secure device. UA validation and URI encoding alone cannot activate it. Changing workspaces changes the relevant payload context; returning to an auction with sealed envelopes restores its ACTIVE state. A vault's saved key ciphertext alone does not count as a verified bid payload.

The full and floating audit views share one model. They keep fixed messages/numeric metadata only, retain at most 128/18 events, and preserve observed CSP block counts across log clear/reset. No private payloads, keys, salts, bid values, addresses, raw errors or blocked URLs are added to telemetry. The private error area can display an actionable operation failure. Browser coverage continues observing zero external requests; CSP/source guards remain enabled.

Closing is terminal for bid entry even if subsequent Merkle compilation fails. This preserves the frozen commitment set: no false success label/root panel is shown, and Reset starts a fresh session. Reset restores the auction and wallet forms but does not remove the separate passphrase-encrypted viewing-key record; users retain the explicit Lock/Forget controls.

Official Node archives were downloaded only for development verification, outside maintained source. The running terminal still needs no external network service, font CDN, tracker, RPC or polling. Package-lock artifact origins remain official npm with SHA-512 integrity.

## Verification evidence

The five initial browser regressions were run against the old production build and failed for the intended reasons: `n-2` selection, enabled closed inputs, retained invalid form values, false startup ACTIVE and duplicate partial seeds. After fixes, they passed. A sixth scenario verifies failed Merkle compilation cannot log success. Existing vault scenarios now explicitly check ACTIVE after valid scanning and OFFLINE after wrong-key scanning.

| Check | Result |
| --- | --- |
| `npm test` on Node 26.10.0 | **55 passed**, 9 files. |
| Same full suite on Node 22.18.0 | **55 passed**, 9 files. |
| Same full suite on Node 24.0.0 | **55 passed**, 9 files. |
| Strict check + Vite build on all three runtimes | **Passed**, 39 modules each; matching generated bundle names/sizes. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | **Fresh build + 26 passed**; all prior browser scenarios retained. |
| Markdown lint, local links/assets and `git diff --check` | Passed. |

The temporary Playwright config selects cached Chromium in this workspace. Normal portable verification is:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npx playwright install chromium
npm run verify
```

For an installed compatible Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. To view locally, run `npm run dev` and open the [loopback terminal](http://127.0.0.1:4173). To serve an existing bundle, run `npm run preview`.

Generated desktop/mobile terminal, vault and live-stream screenshots remain under ignored `test-results/`. Layouts are visually reviewed with the revised payload status detail. No commits, pushes or deployments were performed.
