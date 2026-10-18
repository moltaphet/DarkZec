# Phase 1 Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Resolve dependencies from official npm, correct noncompetitive clearing, bind refund instructions and remove hash-based tie advantages while accepting Orchard-capable wallet addresses.

**Architecture:** Modify the existing protocol modules and sandbox; extract the pure clearing calculation to `src/lib/darkpool.ts`. Normalize accepted wallet UAs to their Orchard receiver for payment instructions. Keep all runtime operations local and all prior UI work intact.

**Tech Stack:** Strict TypeScript, Web Crypto, Vite, Vitest, Playwright, npm lockfile v3.

## Global Constraints

- Strict TypeScript, zero `any`.
- Run all unit and E2E tests after changes.
- Official registry: `https://registry.npmjs.org`.
- No external requests in application code; installation is an explicit development operation.
- Refund binding does not make salt grinding impossible. Remove commitment-dependent tie priority instead.
- Preserve auction domain separation and encode commitment fields unambiguously; raw price/quantity concatenation is ambiguous.

### Task 1: Registry resolution and clean install

Files: `.npmrc`, `package-lock.json`; `package.json` only if official registry evidence requires correcting unavailable pins.

- [x] Preserve the baseline dependency tree outside the repository and remove the old lockfile from resolution.
- [x] Generate a new lockfile without installed mirror metadata:

```sh
npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/darkzec-phase1-npm --fetch-retries=0 --fetch-timeout=20000 --no-audit --no-fund
```

- [x] Validate every `resolved` URL has official npm origin and every registry artifact has integrity metadata; clean install with `npm ci --registry=https://registry.npmjs.org`.
- [x] Persist project registry configuration and add a lockfile-origin regression test in `tests/registry.test.ts`.

### Task 2: Refund binding, address compatibility and guards

Files: `src/protocol/address.ts`, `src/protocol/crypto.ts`, `src/protocol/memo.ts`, `src/fixtures.ts`, `src/lib/mock-note-scanner.ts`, `src/main.ts`; protocol/scanner/event tests and `tests/fixtures.ts`.

Interfaces: `validateOrchardAddress(address, network): string` validates Orchard presence; `orchardPaymentAddress(address, network): string` emits an Orchard-only destination; `assertDistinctRefund(refund, vault, network): void` checks both strings and Orchard receiver equivalence; `computeBidCommitment(bid: BidPreimage): Promise<string>` binds refund, salt, canonical price, quantity and auction context. Existing `commitment` delegates to it.

- [x] Add negative/positive tests: mixed Sapling/Orchard UA accepted, invalid/missing Orchard rejected, transparent-only rejected, valid Orchard normalized, same receiver under a different UA encoding rejected as self-refund.
- [x] Add independent SHA-256 known-answer and substitution tests using the complete canonical tuple:

```ts
JSON.stringify(['DARKZEC/bid/v2', bid.auctionId, bid.refund, bid.salt, bid.price, bid.quantity])
```

- [x] Run the targeted tests against the old implementation and confirm failures.
- [x] Implement validation, receiver-safe payment normalization, immutable preparation input snapshots and refund/vault rejection before salt generation. Recheck refund policy at submission, unsealing and mock scan boundaries.
- [x] Replace identical vault/refund fixtures with distinct public official receivers. Update tests to use distinct fixtures and preserve wallet review/privacy behavior.

### Task 3: Clearing without hash priority

Files: `src/lib/darkpool.ts`, `src/simulation.ts`, `tests/darkpool.test.ts`, `tests/simulation.test.ts`.

Interface: pure uniform-price calculator takes a validated auction configuration and bids in accepted submission order; returns immutable clearing price, fills, payments and refunds. No public API accepts a caller-controlled tie rank.

- [x] Test empty/ineligible books, single bidder above/equal/below supply, eligible demand exactly equal to supply, partial marginal fills and reserve bounds. Test tied allocations stay unchanged when only hashes/salts change.
- [x] Implement reserve pricing when eligible demand is at most supply or only one eligible envelope participates. With competitive oversubscription, use the highest unfilled eligible lot price; a partial marginal bid can set it. Tie-breaking uses accepted submission order.
- [x] Preserve integer-zatoshi accounting and reject malformed reserve/supply/bid values. Confirm deterministic allocation, exact escrow conservation and frozen output.

### Task 4: Integration, documentation and final verification

Files: `index.html`, `src/components/ProtocolSpecs.ts`, telemetry fixed labels if needed, `DARKZEC-STANDARD.md`, `README.md`, `docs/phase1-security-report.md`, `tests/e2e/security.spec.ts`, related existing browser tests.

- [x] Add browser coverage for exact-demand/single-bid reserve pricing, wallet mixed-UA preparation and explicit self-refund rejection; retain zero-request checks and complete vault/stream flows.
- [x] Update live policy/clearing text, canonical commitment formula and current README. Mark historical reports as superseded for changed security rules.
- [x] Run `npm test`, `npm run build`, full Playwright suite and `git diff --check`; inspect failures before claiming success. Do not commit/push without a request.
- [x] Report exact registry/install outcome, changed files, passed test counts and remaining trust limits (submission-order priority is not Sybil resistance or a chain-sequencing guarantee).

Verified: official-registry regeneration (88 SHA-512 artifacts, unchanged versions), clean locked installation (45 packages), 51 unit/privacy tests, strict build, 20 browser tests and whitespace checks passed. Six baseline security regressions reproduced before implementation.
