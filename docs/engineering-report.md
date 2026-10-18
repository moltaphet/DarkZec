# DarkZec engineering report — active repository

Updated: 2026-10-18. Scope: the combined sealed-bid module, NODE 07 interface, protocol manual, Viewing Key Vault, live stream and Phase 1/Phase 2 refinements.

## Repository and implementation status

The workspace is an active **Git repository on `main`**, with origin configured for [moltaphet/DarkZec](https://github.com/moltaphet/DarkZec). Verification covers the current working tree, including uncommitted implementation work. No commit, push or deployment was performed during these refinements.

This is a Vite application with strict TypeScript, modular typed DOM components and bundled CSS. `.tsx` component paths do not introduce React. The Judge Sandbox and mock scanner run entirely locally. Real Orchard note scanning, custody, transaction submission, decentralized sequencing and cross-chain settlement remain integration work.

Current observed verification: **58 unit/privacy/CLI tests across 9 files, 27 E2E tests, and 39 transformed production modules**. The earlier 15-unit/9-E2E/29-module target describes a smaller stage; it is not the current result. No tests or functionality were removed to match historical counts.

## Runtime and dependency compatibility

`package.json` and the lockfile root declare:

```text
^22.18.0 || ^24.0.0 || >=26.0.0
```

Node 22.18.0 is the floor for running the erasable TypeScript server without additional flags. The supported release lines also match the installed Vitest engine constraints; Node 23 and 25 are not declared supported. See [Node's native TypeScript guide](https://nodejs.org/learn/typescript/run-natively).

| Runtime tested | Full unit/privacy/CLI suite | Strict type check and production bundle |
| --- | --- | --- |
| Node 22.18.0 | 58 passed | Passed; 39 modules. |
| Node 24.0.0 | 58 passed | Passed; 39 modules. |
| Node 26.10.0 | 58 passed | Passed; 39 modules. |

The Node 22/24 matrix used official release archives, verified against their published SHA-256 checksums, outside the repository. E2E verification used Node 26.10.0 and cached Chromium. This does not claim that every future Node/browser release has been tested.

The project `.npmrc` selects official npm. The regenerated lockfile contains **88 official registry artifacts with SHA-512 integrity**, with dependency versions unchanged by the registry migration. A fresh official-artifact installation and clean `npm ci` succeeded during Phase 1. Optional platform artifacts explain the difference from 45 packages installed on this machine. The registry test checks provenance on every unit-suite run. The comprehensive hardening pass removed the installed tree and lockfile from resolution, regenerated from the verified official cache and repeated clean `npm ci`; the recreated lockfile was byte-identical and all versions stayed fixed. No runtime dependencies were added.

## Active file inventory

| Relative paths | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `.npmrc`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts` | Exact dependencies, official registry, supported runtimes, strict checking, builds and verification. |
| `scripts/serve.ts` | Loopback static server, readable-build preflight, restrictive headers and no request logging. |
| `index.html`, `src/main.ts`, `src/style.css` | Terminal layout, view/action state, form defaults, private artifact erasure and lifecycle integration. |
| `src/protocol/address.ts` | Revision 0 UA decoding, Orchard validation/projection and equivalent receiver refund guard. |
| `src/protocol/amount.ts`, `src/protocol/crypto.ts`, `src/protocol/memo.ts` | Integer amounts, private salts, refund-bound commitments, canonical bid JSON, UTF-8 sizing and ZIP-321. |
| `src/protocol/merkle.ts` | Domain-separated, size-bound SHA-256 roots and inclusion proofs. |
| `src/lib/darkpool.ts`, `src/simulation.ts` | Pure uniform-price allocation and authenticated local sandbox lifecycle. |
| `src/fixtures.ts` | Distinct public vault/refund receiving fixtures; no private test-vector keys. |
| `src/components/NetworkHeader.ts`, `ActionRipples.ts`, `terminal-effects.css` | Local header/glitch effects, click feedback and matte phosphor styling. |
| `src/components/MemoScramble.ts`, `BlindOrderflow.ts` | Gated private memo preview and commitment-only interactive canvas, including corrected unselected ArrowLeft. |
| `src/components/ProtocolSpecs.ts`, `ProtocolSpecs.css` | Bundled protocol manual and native keyboard disclosures. |
| `src/components/ViewingKeyVault.tsx`, `ViewingKeyVault.css` | Local credential controls, mock scanning, private rows and lock/forget behavior. |
| `src/lib/viewing-key-session.ts`, `vault-memo.ts`, `mock-note-scanner.ts` | Passphrase-encrypted tab session, strict 512-byte field parsing and authenticated mock envelopes. |
| `src/components/LiveTerminalStream.tsx`, `LiveTerminalStream.css`, `TelemetryRail.ts` | Bounded typewriter views and synchronized payload/security counters. |
| `src/lib/security-events.ts`, `security-monitor.ts` | Typed fixed metadata, truthful encryption status and passive CSP observation. |
| `src/lib/dom.ts`, `motion.ts`, `blind-mesh.ts` | Cleanup ownership, visibility/reduced-motion scheduling and public-commitment-only geometry. |
| `tests/*.test.ts`, `tests/fixtures.ts`, `tests/e2e/*.spec.ts` | Unit/privacy/CLI invariants, synthetic/public encodings and complete browser flows. |
| `README.md`, `DARKZEC-STANDARD.md`, `docs/` | Current entry point, protocol rules, stage reports, local badge asset and implementation records. |

Dependencies, `dist/`, browser traces/reports and `test-results/` are ignored artifacts. Source and protocol changes remain reviewable in Git.

## Protocol and privacy invariants

**Address policy.** The validator checks lowercase Bech32m, network HRP/padding, inverse F4Jumble, canonical CompactSize, receiver ordering/length and nonidentity Orchard payment-point validity. Standard UAs containing Orchard plus other receivers are accepted as input. Payment URIs and prepared refund instructions use an Orchard-only projection; bare transparent addresses and UAs without Orchard are rejected. Different UA strings carrying the vault's same Orchard receiver cannot bypass the refund guard. Encoding validation does not establish ownership.

**Memo and amount integrity.** The exact `{v,a,p,q,s,r}` schema uses canonical JSON, positive canonical decimal prices, whole quantities, an auction identifier, a 256-bit salt and refund UA. Invalid Unicode and noncanonical schema/values are refused. UTF-8 is validated at **at most 512 bytes before encoding**; ZIP-321 uses unpadded Base64url. Arithmetic uses integer zatoshis and enforces monetary bounds. A URI is readable sensitive data; real wallet transaction machinery performs Orchard encryption.

**Runtime types.** Public commitment preparation rejects non-string auction/price/salt fields and nonnumeric quantities before hashing. The pure clearing engine rejects coerced supply values before allocation. Schema validation and TypeScript checking remain independent layers.

**Commitment revision.** Phase 1 binds the refund instruction while preserving auction separation and field boundaries:

```text
SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))
```

Web Crypto derives fresh salts using secret entropy, a fresh nonce and HMAC-SHA256. Salt grinding remains possible; accepted submission order removes hash-based tie advantages. This is not proof of key ownership, Sybil resistance or decentralized ordering. Legacy commitment receipts do not verify under the new algorithm; memo schema remains `v:1`.

**Clearing.** Bids sort by price and accepted submission order. Eligible demand at or below supply, or one eligible envelope, pays reserve. When one envelope wins all supply, its own excess demand is excluded and the highest losing eligible envelope sets the price, floored at reserve. With multiple winners, the highest unfilled eligible lot sets the price; a partial marginal bid can set it. The single-lot/unit-demand case produces second-price clearing, without a multi-lot VCG claim. Every allocation preserves exact escrow conservation. The built-in 10-lot walkthrough still clears at `0.68 ZEC` with the default submitted bid and three fixtures.

**Local sealing and viewing vault.** Sandbox bids are retained as AES-256-GCM ciphertext with random IVs and commitment AAD under a nonextractable session key. The separate mock scanner authenticates 528-byte envelopes before recovering exact 512-byte fields. It strips padding after authentication, decodes the declared transport, validates schema/commitment/escrow/refund and isolates rejected notes. Real Unified Viewing Keys can be stored after envelope checks but cannot perform real Orchard decryption here.

**Persistence exception.** Auction bids and telemetry are not persisted. Only the viewing-key session adapter writes tab-session ciphertext: AES-256-GCM with a passphrase-derived PBKDF2-SHA256 key at 600,000 iterations. Reload requires the passphrase again. Lock/view changes clear live vault references and private rows; Forget removes the stored record. JavaScript strings, garbage collection and OS clipboards cannot provide reliable secure erasure.

**Merkle audit.** Leaves hash `0x00 || commitment`, parents hash `0x01 || left || right`, and nonempty roots bind `0x02 || uint64be(count) || treeRoot`. Odd nodes duplicate; empty trees have a separate domain. Verification checks index, count, depth, sides and siblings. The inclusion root is local, not externally anchored, and proves membership rather than payment, completeness or correct clearing.

## Phase 2 lifecycle and audit corrections

- From no canvas selection, ArrowLeft now chooses the final node; normal wrapping, one-node navigation and Escape remain correct.
- Closing disables auction input fields and the preview's own enable gate, clears pending timers/private buffers and invalidates late promise callbacks. Synthetic input events cannot restart closed-auction cryptographic work. Independent wallet/scanner controls remain available.
- Reset restores auction, wallet and audit form defaults; clears review/output/error/result/root state; replaces the sandbox/session key; resets seed progress; and starts one valid `0.72`/`4` preview. Reset does not silently remove the separate encrypted viewing-key record; its owner remains Lock/Forget.
- Demo seeding tracks accepted fixture progress. Retrying after a later fixture fails encrypting continues at that fixture, rather than duplicating earlier accepted bids.
- Commit logs successful local encrypted acceptance. The separate **Merkle leaf generated** event appears only after close-time root/proof compilation succeeds for a nonempty set. Empty books and compilation failures produce no success label. A failed compilation leaves the book closed and inputs locked; Reset starts a new session.
- **ORCHARD SHIELD** is an explicitly local mock payload indicator: **IDLE** at startup/plaintext/reset/lock/unsealed view, **ACTIVE** for sealed auction payloads or authenticated and validated mock bids, and **OFFLINE** after failed local verification. Detail text identifies mock AES-GCM and the absence of real Orchard decryption. Changing workspaces updates the context; merely validating a UA or generating a URI never activates encryption status.
- CSP block counts remain passive, observed external enforcement events, deduplicated for the existing HTTP/meta pair. They are not a device-wide traffic audit. Log clear preserves security state; reset clears local payload state and preserves observed block counts.

## Offline operation, accessibility and performance

Application code makes no external runtime requests. Scripts/styles are local, fonts are system monospace, icons are inline, and there is no RPC, analytics, remote QR service or background polling. HTTP and fallback meta CSP enforce `connect-src 'none'`, `font-src 'none'`, self-only scripts/styles and no workers/forms. The loopback server also applies no-referrer, no-store, nosniff, frame and permissions restrictions. Explicit wallet handoff leaves this boundary; the selected wallet controls its networking.

The audit API stores fixed messages and bounded numeric metadata, never keys, addresses, salts, amounts, payloads, raw exceptions or blocked URLs. The full history retains 128 events, with 18 rendered in the rail. Pause freezes the full view only. Frame work is capped, pauses while hidden/offscreen, and respects reduced motion; subscriptions, timers and observers are disposed on page exit. The log is keyboard-readable without character-by-character screen-reader announcements. Canvas geometry never uses bid amounts.

## Build, serve and verification

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run dev
```

Open the [local terminal](http://127.0.0.1:4173). `dev` builds and serves the production bundle without HMR. Rebuild/refresh or restart after edits. `preview` requires a readable `dist/index.html`; absent/incomplete builds now print an actionable build command and exit nonzero before opening a socket.

```sh
npm test
npm run test:e2e
# Equivalent complete verification; E2E already performs the build:
npm run verify
```

Install Chromium once with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible executable. `test:e2e` is **`npm run build && playwright test`**, and `verify` is **`npm test && npm run test:e2e`**; the combined command builds once.

| Check | Observed current result |
| --- | --- |
| `npm test` | 58 tests passed across 9 files. |
| `npm run build` | Strict TypeScript passed; 39 transformed modules. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | Fresh build followed by 27 passing E2E tests. |
| Node 22.18.0 / 24.0.0 matrix | Each: 58 tests, strict check and 39-module bundle passed. |
| Production bundle | JavaScript 88.10 kB / 30.96 kB gzip; CSS 37.22 kB / 8.66 kB gzip. |

The temporary browser config only selects cached Chromium for this workspace. The maintained configuration is portable. Browser coverage includes existing protocol/wallet/vault/security flows, the five reproduced Phase 2 regressions, failed Merkle compilation and an oversized winning bid priced against competing demand; unit coverage includes missing-build CLI failures. Source privacy, registry origin and strict typing checks remain enabled. Desktop/mobile screenshots are generated under `test-results/` and visually reviewed. No public CI or independent audit result is claimed.

## References, provenance and remaining integration work

- [ZIP-316](https://zips.z.cash/zip-0316), [ZIP-302](https://zips.z.cash/zip-0302) and [ZIP-321](https://zips.z.cash/zip-0321) define the relevant address, memo and request formats. The local validator deliberately targets Revision 0.
- Public receiving bytes come from the [Zcash unified-address vectors](https://github.com/zcash/zcash-test-vectors/blob/master/test-vectors/json/unified_address.json), account 2/diversifier indices 0 and 5. Only public receiver data is used; no vector seed, spending key or viewing key is shipped. The vectors are MIT/Apache-2.0; attribution is retained in source/test comments. Browser-only synthetic encodings are never funded or opened in a wallet.
- [Zodl](https://github.com/zodl-inc) is the wallet UX/handoff reference; device compatibility and actual payment execution require testing. [NEAR Intents](https://docs.near-intents.org/) is a future settlement reference; no solver/API integration is active.
- Production requires audited Orchard adapters, restricted viewing/spending authority, authenticated bidder/settlement instructions, durable receipts, root publication, deadlines and selective disclosure. The browser/operator/device remain trusted. This is a verified local prototype, not an audited custody system or a ZK proof of auction execution.

See the [comprehensive hardening audit](repo-hardening-report.md), [Phase 1 security audit](phase1-security-report.md), [Phase 2 QA audit](phase2-qa-report.md), [vault report](viewing-key-vault-report.md), [live-stream report](live-terminal-report.md) and [UI report](ui-polish-report.md). Earlier stage reports retain historical measurements; this report and the README describe the active combined checkout.
