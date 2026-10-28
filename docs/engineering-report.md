# DarkZec engineering report — active repository

Updated: 2026-10-22. Scope: the commit/reveal sealed-bid ledger, NODE 07 interface with the WebGL intro, protocol manual, Viewing Key Vault, live stream, earlier hardening stages and the integration of both development lines.

## Repository and implementation status

The repository is [moltaphet/DarkZec](https://github.com/moltaphet/DarkZec). This report describes the integrated branch that merges the cinematic UI line with the commit/reveal ledger rewrite. Earlier stage reports in this directory are historical and describe the previous encrypted-envelope sandbox where they differ.

This is a Vite application with strict TypeScript, modular typed DOM components and bundled CSS. `.tsx` component paths do not introduce React. The Judge Sandbox and mock scanner run entirely locally. Real Orchard note scanning, custody, transaction submission, decentralized sequencing and cross-chain settlement remain integration work.

Current observed verification (Node 26.10.0): **133 unit/privacy/CLI tests across 19 files, 59 E2E tests and 67 transformed production modules**. The commit/reveal rewrite replaced the earlier AES-GCM sandbox envelopes; E2E specs were updated for the frozen-at-close Merkle root, hash-only commit memos and the shield indicator semantics.

## Runtime and dependency compatibility

`package.json` and the lockfile root declare:

```text
^22.18.0 || ^24.0.0 || >=26.0.0
```

Node 22.18.0 is the floor for running the erasable TypeScript server without additional flags. The supported release lines also match the installed Vitest engine constraints; Node 23 and 25 are not declared supported. See [Node's native TypeScript guide](https://nodejs.org/learn/typescript/run-natively).

| Runtime tested | Full unit/privacy/CLI suite | Strict type check and production bundle |
| --- | --- | --- |
| Node 22.18.0 | Run by CI on every push (not re-run locally after the rewrite) | Run by CI on every push. |
| Node 24.0.0 | Run by CI on every push (not re-run locally after the rewrite) | Run by CI on every push. |
| Node 26.10.0 | 69 passed | Passed; 46 modules. |

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
| `src/lib/darkpool.ts`, `src/simulation.ts`, `src/components/RevealPanel.ts` | Pure uniform-price allocation, hash-only commit/reveal ledger and the bidder receipt workspace. |
| `src/fixtures.ts` | Distinct public vault/refund receiving fixtures; no private test-vector keys. |
| `src/components/NetworkHeader.ts`, `ActionRipples.ts`, `terminal-effects.css` | Local header/glitch effects, click feedback and matte phosphor styling. |
| `src/components/MemoScramble.ts`, `BlindOrderflow.ts` | Gated private memo preview and commitment-only interactive canvas, including corrected unselected ArrowLeft. |
| `src/components/ProtocolSpecs.ts`, `ProtocolSpecs.css` | Bundled protocol manual and native keyboard disclosures. |
| `src/components/ViewingKeyVault.tsx`, `ViewingKeyVault.css` | Local credential controls, mock scanning, private rows and lock/forget behavior. |
| `src/lib/viewing-key-session.ts`, `vault-memo.ts`, `mock-note-scanner.ts` | Passphrase-encrypted tab session, strict 512-byte field parsing and authenticated mock envelopes. |
| `src/components/LiveTerminalStream.tsx`, `LiveTerminalStream.css`, `TelemetryRail.ts` | Bounded typewriter views and synchronized payload/security counters. |
| `src/lib/security-events.ts`, `security-monitor.ts` | Typed fixed metadata, truthful encryption status and passive CSP observation. |
| `src/lib/dom.ts`, `motion.ts`, `blind-mesh.ts` | Cleanup ownership, visibility/reduced-motion scheduling and public-commitment-only geometry. |
| `src/lib/operator-key.ts`, `simulated-chain.ts`, `reminder.ts`, `cosigner.ts`, `scripts/auction.ts`, `scripts/cosign-check.ts`, `scripts/capture-video.ts` | Encrypted operator key backup and resume, the in-memory practice chain, bidder calendar reminders, the co-signer settlement policy, the one-command operator launcher and the 4K still capture. |
| `src/lib/schedule.ts`, `listing.ts`, `settlement.ts`, `src/components/ListingView.ts`, `RealVaultScan.ts`, `PaymentQr.ts`, `scripts/settle.ts`, `verify-chain.ts`, `view-wallet.ts`, `resolve-ts.ts` | Block-height deadlines, signed auction links, on-chain settlement and its verification, the bidder and scanner pages, QR rendering and the zcash-devtool tooling. |
| `tests/*.test.ts`, `tests/fixtures.ts`, `tests/e2e/*.spec.ts` | Unit/privacy/CLI invariants, synthetic/public encodings and complete browser flows. |
| `LICENSE`, `.github/workflows/ci.yml` | MIT licensing and SHA-pinned, read-only push/PR clean-install/build/unit/E2E CI on Node 22/24. |
| `README.md`, `DARKZEC-STANDARD.md`, `docs/` | Current entry point, protocol rules, stage reports, local badge asset and implementation records. |

Dependencies, `dist/`, browser traces/reports and `test-results/` are ignored artifacts. Source and protocol changes remain reviewable in Git.

## Protocol and privacy invariants

**Address policy.** The validator checks lowercase Bech32m, network HRP/padding, inverse F4Jumble, canonical CompactSize, receiver ordering/length and nonidentity Orchard payment-point validity. Standard UAs containing Orchard plus other receivers are accepted as input. Payment URIs and prepared refund instructions use an Orchard-only projection; bare transparent addresses and UAs without Orchard are rejected. Different UA strings carrying the vault's same Orchard receiver cannot bypass the refund guard. Encoding validation does not establish ownership.

**Memo and amount integrity.** Commit memos use the canonical `{v:2,t:"commit",a,c}` schema; reveal receipts use the canonical `{v:1,a,p,q,s,r}` schema with positive canonical decimal prices, whole quantities, an auction identifier, a 256-bit salt and an Orchard refund UA. Invalid Unicode and noncanonical JSON are rejected, and every memo is audited as exact UTF-8 bytes (at most 512) before Base64url encoding.

**Runtime types.** Public commitment preparation rejects non-string auction/price/salt fields and nonnumeric quantities before hashing. The pure clearing engine rejects coerced supply values before allocation. Schema validation and TypeScript checking remain independent layers.

**Commitment revision.** Phase 1 binds the refund instruction while preserving auction separation and field boundaries:

```text
SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))
```

Web Crypto derives fresh salts using secret entropy, a fresh nonce and HMAC-SHA256. Salt grinding remains possible; accepted submission order removes hash-based tie advantages. This is not proof of key ownership, Sybil resistance or decentralized ordering. Legacy commitment receipts do not verify under the new algorithm; memo schema remains `v:1`.

**Clearing.** Bids sort by price and accepted submission order. Eligible demand at or below supply, or one eligible envelope, pays reserve. When one envelope wins all supply, its own excess demand is excluded and the highest losing eligible envelope sets the price, floored at reserve. With multiple winners, the highest unfilled eligible lot sets the price; a partial marginal bid can set it. The single-lot/unit-demand case produces second-price clearing, without a multi-lot VCG claim. Every allocation preserves exact escrow conservation. The built-in 10-lot walkthrough still clears at `0.68 ZEC` with the default submitted bid and three fixtures.

**Commit/reveal ledger and viewing vault.** The sandbox ledger stores only `{commitment, collateral}` per entry; no preimage, ciphertext or decryption key enters it. Reveal receipts live in the bidder-side `RevealPanel` and are verified by recomputing the commitment. The separate mock scanner authenticates 528-byte AES-GCM envelopes bound to note metadata and parses **commit memos only**; it never reads a bid preimage. The scanner and the auction book remain isolated.

**Persistence exception.** Auction bids and telemetry are not persisted. Only the viewing-key session adapter writes mock-key tab-session ciphertext: AES-256-GCM with a passphrase-derived PBKDF2-SHA256 key at 600,000 iterations. Invalid/non-mock input is rejected before storage access. Stored ciphertext must have the exact mock-key-plus-tag length, and decrypted credentials are validated again, so legacy non-mock records cannot unlock. Reload requires the passphrase again. Lock/view changes clear live vault references and private rows; Forget removes the stored record. JavaScript strings, garbage collection and OS clipboards cannot provide reliable secure erasure.

**Non-reveal penalty.** A commitment not revealed (and verified) before the reveal deadline forfeits its full collateral, which is burned rather than credited to the operator (otherwise the operator, who judges reveal validity, would profit from ignoring reveals): `SettlementResult.forfeitedCollateral` is the sum of those collaterals and `payments + refunds + forfeited` equals every posted collateral. Unrevealed commitments stay in the frozen Merkle tree. Actual settlement of the forfeiture is outside the sandbox.

**Operator accountability.** `src/lib/operator-journal.ts` signs canonical close, reveal-acknowledgement and result statements with a per-session, non-extractable ECDSA P-256 key. `src/lib/auction-session.ts` pairs the hash-only `Sandbox` with that journal so every close, accepted reveal and result produces a statement, and exports the audit bundle. `src/lib/audit-bundle.ts` parses bundles strictly (256 KB cap) and runs eight independent checks; `tests/audit-bundle.test.ts` covers honest runs, a censored reveal, edited results, commitments, statements and keys, and malformed input.

**Live testnet auction and on-chain reveals.** `scripts/zcash-rpc.ts` `listVaultMemos` classifies confirmed Ironwood or Orchard-pool notes at the vault into exact commit memos of the auction's collateral tier and reveal-receipt memos, oldest first; `/api/chain/vault-memos` exposes it to the same-origin page. The Wallet request tab builds a `0.0001` ZEC reveal payment whose memo is the receipt. `Sandbox` gained `unitDemand` (truthful (k+1)-th price; Vickrey for one lot), an operator view and reveal acceptance metadata.

**Auction links, block deadlines and settlement.** `src/lib/schedule.ts` defines deadlines as block heights (25-second blocks), the chain-time clock a scheduled ledger uses and the on-time predicates. `src/lib/listing.ts` validates and canonically encodes a listing (title, description, rules, vault, deadlines, anchor), digests it and carries it, with the operator's public key and signature over `DARKZEC/listing/v1`, in a base64url URL fragment that browsers never send to a server; `openListingLink` rejects any change. `AuctionSession.publish` signs only a listing that equals the session's own rules. `src/lib/settlement.ts` derives exact payouts from a verified result (refunds, seller proceeds, a provably unspendable P2SH(OP_RETURN) burn), builds one multi-payment ZIP-321 request and verifies deposits (with schedule, no on-time commit or acceptable on-time reveal omitted) and payouts from what a viewing key sees. `scripts/settle.ts` and `scripts/verify-chain.ts` drive zcash-devtool for the operator and for any verifier; `scripts/view-wallet.ts` builds the view-only wallet. `ListingView`, `LiveAuctionPanel` (seller) and `RealVaultScan` are the pages. Procurement (reverse) auctions reuse the clearing engine with the order reversed and bonds returned whole. Details: [auction links](auction-links.md), [settlement](settlement.md).

**Receipts and wallet memo round trip.** `src/lib/receipt-file.ts` downloads and imports the canonical reveal JSON (size-capped, strictly parsed, never auto-persisted). `src/lib/memo-import.ts` parses a memo copied from a wallet (text, unpadded Base64url or zero-padded hex), accepts only the public commit shape and compares it with the prepared request. `settlementBalance()` independently checks `payments + refunds + forfeited = posted collateral`, and the UI shows the result. See [threat-model.md](threat-model.md) and [testnet-interop.md](testnet-interop.md).

**Merkle audit.** Leaves hash `0x00 || commitment`, parents hash `0x01 || left || right`, and nonempty roots bind `0x02 || uint64be(count) || treeRoot`. Odd nodes duplicate; empty trees have a separate domain. Verification checks index, count, depth, sides and siblings. The inclusion root is local, not externally anchored, and proves membership rather than payment, completeness or correct clearing. The tree covers every accepted commitment and is frozen when the commit phase closes, so a bidder can verify inclusion before reveals and the clear-time root must equal it.

## Phase 2 lifecycle and audit corrections

- From no canvas selection, ArrowLeft now chooses the final node; normal wrapping, one-node navigation and Escape remain correct.
- Closing disables auction input fields and the preview's own enable gate, clears pending timers/private buffers and invalidates late promise callbacks. Synthetic input events cannot restart closed-auction cryptographic work. Independent wallet/scanner controls remain available.
- Reset restores auction, wallet and audit form defaults; clears review/output/error/result/root state; replaces the sandbox/session key; resets seed progress; and starts one valid `0.72`/`4` preview. Reset does not silently remove the separate encrypted viewing-key record; its owner remains Lock/Forget.
- Demo seeding tracks accepted fixture progress. Retrying after a later fixture fails during commitment hashing continues at that fixture, rather than duplicating earlier accepted bids.
- Commit logs hash-only acceptance. The separate **Merkle leaf generated** event appears only after close-time root/proof compilation succeeds for a nonempty set. Empty books and compilation failures produce no such event.
- **SHIELD STATUS** is an explicitly local mock payload indicator: **IDLE** at startup, for hash-only commits, plaintext, reset and lock; **ACTIVE** only after an authenticated and validated mock note scan; **OFFLINE** after a failed local verification. It does not assert real Orchard encryption or chain connectivity.
- CSP block counts remain passive, observed external enforcement events, deduplicated for the existing HTTP/meta pair. They are not a device-wide traffic audit. Log clear preserves security state; reset clears local payload state and preserves observed block counts.

## Offline operation, accessibility and performance

Application code makes no external runtime requests. Scripts/styles are local, fonts are system monospace, icons are inline, and there is no RPC, analytics, remote QR service or background polling. HTTP and fallback meta CSP enforce `connect-src 'none'`, `font-src 'none'`, self-only scripts/styles and no workers/forms. The loopback server also applies no-referrer, no-store, nosniff, frame and permissions restrictions. Explicit wallet handoff leaves this boundary; the selected wallet controls its networking.

The audit API stores fixed messages and bounded numeric metadata, never keys, addresses, salts, amounts, payloads, raw exceptions or blocked URLs. The full history retains 128 events, with 18 rendered in the rail. Pause freezes the full view only. Frame work is capped, pauses while hidden/offscreen, and respects reduced motion; subscriptions, timers and observers are disposed on page exit. The log is keyboard-readable without character-by-character screen-reader announcements. Canvas geometry never uses bid amounts.

All CSS terminal text and canvas labels have a 12px minimum, including responsive overrides. Primary inputs, auction values, receipt values, memo payloads, result cells, commitment readouts and telemetry values/events use at least 14px. A DOM-updated telemetry symbol replaces the earlier zero-font-size hiding technique. Mobile navigation, action buttons and telemetry labels wrap at readable sizes. Both bid forms use exact `0.00 ZEC` and `0 Qty` placeholders. Auction and vault result tables use bounded `max-w-full overflow-x-auto` scroll regions, keyboard focus outlines and visible mobile scroll hints. These utility classes are implemented in the local stylesheet; no Tailwind runtime or dependency is added. Browser checks cover 320, 390, 768, 1280 and 1440px widths, including the expanded manual and telemetry.

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
| `npm test` | 133 tests passed across 19 files. |
| `npm run build` | Strict TypeScript passed; 67 transformed modules. |
| `npm run test:e2e` | Fresh build followed by 60 passing E2E tests. |
| Node 22 / 24 | Exercised by the CI workflow; not re-run locally after the commit/reveal integration. |
| Production bundle | See `npm run build` output (JavaScript and CSS gzip sizes are reported by Vite). |
| `npm ci` | Clean installation succeeded; 45 platform packages installed and lockfile unchanged. |
| CI configuration | YAML validated; push-to-main/PR triggers, a runtime `npm audit` gate, read-only permissions, SHA-pinned actions, Node 22/24, `npm ci`, Chromium dependencies and sequential build/unit/E2E steps. |

The temporary browser config only selects cached Chromium for this workspace. The maintained configuration is portable. Browser coverage includes existing protocol/wallet/vault/security flows, the five reproduced Phase 2 regressions, failed Merkle compilation and an oversized winning bid priced against competing demand; unit coverage includes missing-build CLI failures. Source privacy, registry origin and strict typing checks remain enabled. Desktop/mobile screenshots are generated under `test-results/` and visually reviewed. No public CI or independent audit result is claimed.

The targeted pass additionally rejects checksum-valid real viewing keys before storage and authentic legacy encrypted non-mock records during unlock. Source and runtime privacy guards now restrict the storage exception to encrypted mock credentials. A timing race in the CSP/log-clear test was fixed by waiting for the initial memo operation to finish before asserting that history clears; legitimate later events are not suppressed. See the [targeted hardening report](archive/targeted-hardening-report.md) for the full changed-file inventory and verification commands.

The later [production polish report](archive/production-polish-report.md) records the 12px/14px typography upgrade, exact placeholders, explicit scrolling utilities and complete CI verification. CI has no failure-tolerating steps. GitHub-hosted execution requires pushing the workflow; enforcing merge blocking additionally requires the repository's `main` branch protection to require both Node matrix checks, up-to-date branches and restricted direct pushes/bypasses. Local changes do not assert that those repository settings have been configured.

## References, provenance and remaining integration work

- [ZIP-316](https://zips.z.cash/zip-0316), [ZIP-302](https://zips.z.cash/zip-0302) and [ZIP-321](https://zips.z.cash/zip-0321) define the relevant address, memo and request formats. The local validator deliberately targets Revision 0.
- Public receiving bytes come from the [Zcash unified-address vectors](https://github.com/zcash/zcash-test-vectors/blob/master/test-vectors/json/unified_address.json), account 2/diversifier indices 0 and 5. Only public receiver data is used; no vector seed, spending key or viewing key is shipped. The vectors are MIT/Apache-2.0; attribution is retained in source/test comments. Browser-only synthetic encodings are never funded or opened in a wallet.
- [Zodl](https://github.com/zodl-inc) is the wallet UX/handoff reference; device compatibility and actual payment execution require testing. [NEAR Intents](https://docs.near-intents.org/) is a future settlement reference; no solver/API integration is active.
- Production requires audited Orchard adapters, restricted viewing/spending authority, authenticated bidder/settlement instructions, durable receipts, root publication, deadlines and selective disclosure. The browser/operator/device remain trusted. This is a verified local prototype, not an audited custody system or a ZK proof of auction execution.

See the [comprehensive hardening audit](archive/repo-hardening-report.md), [Phase 1 security audit](archive/phase1-security-report.md), [Phase 2 QA audit](archive/phase2-qa-report.md), [vault report](archive/viewing-key-vault-report.md), [live-stream report](archive/live-terminal-report.md) and [UI report](archive/ui-polish-report.md). Earlier stage reports retain historical measurements; this report and the README describe the active combined checkout.
