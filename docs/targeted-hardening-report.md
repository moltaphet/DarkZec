# Targeted security and UI hardening

Date: 2026-10-18. Scope: mock-only vault credentials, readable typography, mobile wallet/results UX, MIT licensing and basic build/unit CI.

## Applied changes

- The scanner accepts only `mock:node07:` plus exactly 64 lowercase hex characters. Validation precedes storage access and mock key derivation. Real Unified Viewing Keys, malformed mock strings, appended material and trailing newlines are rejected.
- The real-key storage-only branch is removed from validation, UI and telemetry types. Exact encrypted record sizing and post-decryption validation prevent legacy non-mock records from unlocking. Existing valid encrypted mock sessions remain usable; Forget removes a saved record.
- Mock credentials remain passphrase-wrapped with PBKDF2-SHA256 at 600,000 iterations and AES-256-GCM using random salts/IVs and authenticated domain separation. Raw credentials and passphrases are not persisted. This mock-only storage is not a real-key security adapter.
- The former real-key acceptance test now asserts rejection of checksum-valid `uview` and `uviewtest` envelopes. Privacy coverage additionally proves invalid credentials do not read, write or remove storage. Network/persistence/unsafe-DOM source guards remain active.
- All explicit CSS text below 11px was raised to 11px, including media-query overrides. Canvas labels use 11px. The collapsed telemetry indicator now updates its text directly instead of hiding a character with a zero font size. Mobile navigation and counters wrap as needed.
- Bid and wallet price/quantity inputs have descriptive example placeholders. Auction and scanner tables are horizontally scrollable within their containers, keyboard focusable, labeled for assistive technology and accompanied by visible mobile scroll hints.
- The root MIT license includes the DarkZec contributors notice. Push/PR CI runs `npm install`, `npm run build` and `npm test` on Node 22 and 24. Actions are pinned to verified official commit SHAs; repository permissions are read-only and checkout credentials are not retained. No dependency was added.

## Changed-file inventory

Paths are relative to the repository root.

| Status | Files | Purpose |
| --- | --- | --- |
| Modified | `src/lib/viewing-key-session.ts` | Mock-only validation, bounded encrypted records and typed mock-only key kind. |
| Modified | `src/lib/mock-note-scanner.ts`, `src/lib/security-events.ts` | Reject non-mock derivation and remove real-key success telemetry paths. |
| Modified | `src/components/ViewingKeyVault.tsx`, `src/main.ts` | Mock-only credential UX, clear boundaries and scanner table scroll affordances. |
| Modified | `index.html`, `src/style.css` | Descriptive placeholders, accessible scrolling results, mobile hints and text floor. |
| Modified | `src/components/terminal-effects.css`, `src/components/ViewingKeyVault.css`, `src/components/LiveTerminalStream.css`, `src/components/ProtocolSpecs.css` | At least 11px labels/logs at all breakpoints, wrapping and readable terminal layouts. |
| Modified | `src/components/BlindOrderflow.ts`, `src/components/TelemetryRail.ts` | Readable canvas labels and direct collapse-symbol updates. |
| Modified | `tests/viewing-vault.test.ts`, `tests/privacy.test.ts` | Real/malformed-key denial, authentic legacy-session rejection, storage isolation and CSS/canvas minimum. |
| Modified | `tests/e2e/live-terminal.spec.ts` | Wait for the initial async memo before clearing history; retain CSP and counter assertions. |
| Created | `tests/e2e/targeted-hardening.spec.ts` | Browser key rejection, mobile scrolling/placeholders and five-width typography/overflow checks. |
| Created | `LICENSE`, `.github/workflows/ci.yml` | MIT license and Node 22/24 push/PR build/unit workflow. |
| Modified | `README.md`, `DARKZEC-STANDARD.md`, `docs/engineering-report.md`, `docs/viewing-key-vault-report.md` | Current mock-only policy, accessibility, CI and verification details. |
| Created | `docs/targeted-hardening-report.md` | This change inventory and audit record. |

## Verification evidence

| Check | Result |
| --- | --- |
| `npm test` | 62 tests passed across 9 files, including the previous 58-test suite. |
| `npm run build` | Strict TypeScript and 39-module production build passed. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | 30 E2E tests passed, including all previous 27 scenarios. The command rebuilds first. |
| Node 22.18.0 and 24.0.0 | Each passed all 62 unit tests, strict type checking and the 39-module Vite build. |
| Responsive browser checks | At least 11px computed text and no horizontal page overflow at widths 320, 390, 768, 1280 and 1440px. Mobile tables scroll with ArrowRight. |
| Privacy checks | Existing offline/CSP tests passed; real-key attempts leave storage empty, accepted mock sessions contain ciphertext only, and audit messages exclude credential inputs. |
| CI YAML | Parsed and validated triggers, read-only permissions, Node matrix, exact command order, SHA pins and disabled checkout credential persistence. |

Security and typography regressions were observed failing before their fixes. During browser validation, a pre-existing log-clear timing race was reproduced: the initial memo preparation could complete after clearing and legitimately append three events. The test now waits for that operation to finish rather than muting later audit events. Desktop and mobile screenshots were inspected under ignored `test-results/`.

The temporary Playwright configuration selects this machine's cached Chromium. Standard local verification is:

```sh
npm install
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run dev
```

The app is served at [127.0.0.1:4173](http://127.0.0.1:4173). Test installation and CI dependency downloads are development activity; the browser terminal retains its no-external-runtime-request policy. The GitHub workflow has not been run remotely, and no commit or push was performed during this change.
