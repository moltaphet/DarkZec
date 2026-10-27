# Comprehensive repository hardening audit

> **Historical stage report.** Written before the commit/reveal ledger rewrite and the UI merge: its test counts, commitment/sandbox-encryption wording and Merkle timing may be outdated. See the [engineering report](../engineering-report.md) and the README for the current build.

Date: 2026-10-18. Scope: A1, B1, B2, B3, B6 and D1–D4 against the combined active Git working tree. Earlier Phase 1/Phase 2 work was preserved and reverified. No commit, push or deployment was performed.

## Findings and disposition

| Finding | Disposition and implementation |
| --- | --- |
| A1 / official registry | Removed the existing installed tree and lockfile from resolution after backing them up outside the repository. Regenerated with official registry configuration and previously verified official npm metadata, then ran clean `npm ci`. All 88 artifacts have official origins and SHA-512 integrity. The lockfile is byte-identical to the already-hardened baseline; zero versions changed. |
| B1 / clearing edge cases | Existing reserve handling for no/insufficient/exact demand and solitary bids remains. Fixed an additional case: when an oversized bid alone wins the whole supply, its own unfilled quantity cannot set the price. The highest losing eligible envelope sets the competing margin, floored at reserve. Multi-winner partial-margin pricing remains unchanged. |
| B2 / commitment and grinding | Reverified the existing refund-bound, versioned, unambiguously encoded SHA-256 commitment and accepted-order ties. Added strict runtime field guards. A UA is not immutable identity or proof of ownership, and including it cannot prevent salt variation. Removing hash-dependent priority removes grinding's allocation advantage. |
| B3 / self-refund | Reverified explicit rejection before salt generation, at submission/unsealing/clearing and during authenticated mock scanning. Comparison covers both identical strings and mixed UAs carrying the same Orchard receiver. |
| B6 / wallet UAs | Reverified standard mixed UAs containing Orchard, including Sapling/transparent companion receivers. Payment and prepared refund output use Orchard-only projections. Bare transparent addresses, UAs without Orchard and malformed/wrong-network encodings remain rejected. The implementation is in `src/protocol/address.ts` and `memo.ts`, not a duplicate `src/lib/zip321.ts`. |
| D1 / build and serve | Reverified `test:e2e` is exactly `npm run build && playwright test`. Missing or incomplete `dist/index.html` exits with friendly build/dev guidance before listening. Existing CLI tests cover both cases. |
| D2–D4 / environment and report | Updated the active engineering report and README with measured results: 58 unit/privacy/CLI tests, 27 E2E scenarios, 39 modules. Git is enabled on `main`. Node 22.18.0, 24.0.0 and 26.10.0 unit/build checks pass. The historical 15/9/29 targets were not substituted for actual measurements. |

## New fixes in this pass

Three added regression groups failed against the incoming code and passed after implementation:

1. **Own-demand pricing:** supply 10, reserve 0.50, winner 0.90/11, competitors 0.75/5 and 0.60/3 previously cleared at 0.90. It now clears at 0.75; ten lots cost 7.50. Winner quantities 10, 11 and 100 are covered. With no eligible competitor, reserve applies.
2. **Supply coercion:** the pure clearing API previously accepted string/array representations of supply. It now requires a numeric safe integer before range validation and allocation.
3. **Commitment coercion:** direct callers could previously pass coerced quantity or auction/salt fields despite the TypeScript signature. Runtime guards now enforce string auction/price/salt fields and numeric safe-integer quantity before constructing the canonical tuple. Valid bid preimages and commitment format remain unchanged.

A new full browser scenario seeds the three demo competitors, submits a 0.90/11 bid and checks clearing at 0.74, ten filled lots, payment 7.40 and refund 2.50, with no external requests. Existing exact-demand, solitary-bid, tie invariance, refund-substitution, wallet compatibility, CLI, vault and telemetry scenarios remain enabled.

## Files modified or recreated

| Files | Change in this pass |
| --- | --- |
| `src/lib/darkpool.ts` | Sole-winner competing-margin correction and runtime configuration validation. |
| `src/protocol/crypto.ts` | Strict runtime preimage types; existing `computeBidCommitment` and v2 encoding retained. |
| `tests/darkpool.test.ts`, `tests/security-core.test.ts` | Three new regression groups for pricing and coercion. |
| `tests/e2e/security.spec.ts` | End-to-end oversized-winner margin/payment/refund regression. |
| `DARKZEC-STANDARD.md` | Precise sole-winner versus multi-winner pricing rule. |
| `src/components/ProtocolSpecs.ts`, `index.html` | Matching local manual/result text; design and assets unchanged. |
| `README.md`, `docs/engineering-report.md` | Active clearing policy, runtime validation and fresh verification results. |
| `docs/superpowers/plans/2026-10-18-repo-hardening.md`, `docs/repo-hardening-report.md` | Execution checklist and this audit. |
| `package-lock.json` | Removed and recreated from official metadata; verified byte-identical to the incoming official lockfile. |

Previously implemented controls verified without further edits in this pass include `.npmrc`, `package.json`, `scripts/serve.ts`, `src/protocol/address.ts`, `src/protocol/memo.ts`, `src/simulation.ts`, refund fixtures and scanner guards. Their existing working-tree changes remain intact.

## Reproducible dependency installation

The dependency tree and lockfile were moved/copied to a task-specific directory under `/private/tmp`. No installed dependency metadata was available to the new lockfile resolution. The existing dedicated cache was populated from official npm during Phase 1; no mirror cache or old installed tree was reused.

```sh
npm install --package-lock-only --offline --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/darkzec-phase1-npm --no-audit --no-fund
npm ci --offline --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/darkzec-phase1-npm --no-audit --no-fund
```

Both commands succeeded. The clean install added 45 platform-applicable packages; the lockfile includes 88 artifacts across supported platforms. Registry origins, SHA-512 integrity, package versions, manifest/lock engines and the fresh non-symlink `node_modules` directory were checked. Official npm documents [clean installation](https://docs.npmjs.com/cli/v11/commands/npm-ci/) and [lockfile artifact metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

For a new machine without this cache, use the portable online form:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
```

## Commitment and privacy boundary

The retained preimage is:

```text
SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))
```

It binds the requested fields while preserving auction separation and unambiguous numeric boundaries. Raw price/quantity concatenation would make price 1/quantity 23 and price 12/quantity 3 indistinguishable at that boundary. Legacy pre-v2 receipts do not verify under v2; this pass does not introduce another commitment-format change.

The sole-winner rule operates on authenticated bid envelopes, not verified beneficial-owner identity. Multiple envelopes/receivers do not establish independent participants. Accepted-order ties are independent of hash grinding but still depend on vault sequencing; this is not Sybil resistance, decentralized sequencing or a proof of strategyproof multi-unit clearing.

The terminal continues to use strict TypeScript and zero application-owned `any` types. UTF-8 memo validation precedes Base64url encoding, with at most 512 decoded bytes. Zero external runtime networking, local fonts/assets, fixed metadata-only logging and the encrypted viewing-key session exception remain enforced by tests and CSP. The NODE 07 layout and interaction model were retained. Real Orchard scanning, custody and settlement remain outside this local prototype.

## Verification results

| Command/runtime | Observed result |
| --- | --- |
| `npm test` — Node 26.10.0 | **58 passed across 9 files**, zero failures. |
| `npm run build` — Node 26.10.0 | **Passed** strict TypeScript; **39 modules**; JS 88.10 kB / 30.96 kB gzip. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | **Fresh production build + 27 passed**, zero failures. |
| Node 22.18.0 | **58 tests**, strict checking and **39-module build passed**. |
| Node 24.0.0 | **58 tests**, strict checking and **39-module build passed**. |
| Official dependency regeneration/clean install | **Passed**; 88 official SHA-512 artifacts; zero version changes. |
| Markdown/local link/manifest checks and `git diff --check` | **Passed**. |

The temporary browser configuration imports the maintained config and selects the existing cached Chromium executable for this workspace. On a normal machine, install Chromium with `npx playwright install chromium` and run `npm run test:e2e`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. No maintained source contains a machine-specific browser path. Earlier reports retain their historical test counts; the active engineering report reflects this pass.
