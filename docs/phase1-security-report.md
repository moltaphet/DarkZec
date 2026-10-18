# Phase 1 — registry, commitments and clearing security

Implemented against the existing Vite/strict TypeScript terminal, preserving the earlier vault, live stream and README work. Address/URI code lives in `src/protocol/`, not a pre-existing `src/lib/zip321.ts`. The clearing calculation now lives in `src/lib/darkpool.ts` and is called by the existing sandbox.

## Fixes and file inventory

| Files | Change |
| --- | --- |
| `.npmrc`, `package-lock.json` | Project registry pinned to official npm; regenerated lockfile from official metadata without the previous installed dependency tree. All 88 artifact URLs use `registry.npmjs.org`, with SHA-512 integrity. No dependency versions or root pins changed. |
| `src/lib/darkpool.ts` | New pure, bounded uniform-price clearing engine with exact-demand/single-envelope reserve handling, highest-unfilled competitive pricing, accepted-order ties and integer-zatoshi accounting. |
| `src/simulation.ts` | Delegates clearing to that engine; repeats refund/vault checks during submission and unsealing. Keeps authenticated envelopes, phase guards and Merkle audit behavior. |
| `src/protocol/crypto.ts` | `computeBidCommitment` and its existing `commitment` alias bind the refund UA, salt, canonical price, quantity and auction context in a versioned canonical tuple. |
| `src/protocol/address.ts` | Accepts standard Orchard-capable wallet UAs, projects them to Orchard-only payment destinations and rejects equivalent refund/vault receivers. Existing encoding, network, length and Orchard-point checks remain. |
| `src/protocol/memo.ts` | Snapshots preparation input before asynchronous work, normalizes vault/refund UAs and rejects self-refunds before generating salt. URI output remains Orchard-only; UTF-8/512-byte and unpadded Base64url guards remain. |
| `src/fixtures.ts`, `src/main.ts` | Distinct public vault/refund fixtures; both are blocked from wallet handoff. Auction and wallet paths use the new policies. |
| `src/lib/mock-note-scanner.ts`, `src/lib/vault-memo.ts` | Mock-note commitments use the same refund-bound algorithm. Authenticated notes refunding to the vault are quarantined with a fixed security error. |
| `src/components/ProtocolSpecs.ts`, `index.html` | Updates live clearing, commitment and wallet-compatibility text; explains Orchard-only projection before wallet review. |
| `tests/fixtures.ts`, `tests/security-core.test.ts`, `tests/darkpool.test.ts`, `tests/registry.test.ts`, `tests/e2e/security.spec.ts` | New shared public/synthetic test encodings and focused security/registry/clearing/browser coverage. |
| `tests/protocol.test.ts`, `tests/simulation.test.ts`, `tests/viewing-vault.test.ts`, `tests/security-events.test.ts`, `tests/e2e/terminal.spec.ts` | Updates independent commitment vectors, address acceptance expectations, distinct refunds and tie rules; retains existing privacy and lifecycle checks. |
| `DARKZEC-STANDARD.md`, `README.md` | Documents the authorized commitment revision, wallet-UA acceptance, self-refund policy and clearing rules. |
| `docs/engineering-report.md`, `docs/viewing-key-vault-report.md`, `docs/live-terminal-report.md` | Marks earlier protocol/fixture/verification statements as historical. |
| `docs/superpowers/plans/2026-10-17-phase1-security.md`, `docs/phase1-security-report.md` | Implementation checklist and this verification/security record. |

## Official registry and clean installation

The prior `node_modules` and lockfile were preserved outside the repository, then removed from dependency resolution. npm regenerated the lockfile using official registry metadata. The resulting package versions match the previous lockfile; this change replaces mirror origins rather than introducing a dependency upgrade. Optional platform artifacts account for the difference between 88 lockfile artifacts and 45 packages installed on this machine.

After downloading artifacts from official npm into a fresh task cache, a clean locked installation succeeded:

```sh
npm ci --offline --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/darkzec-phase1-npm --no-audit --no-fund
```

Offline mode used the just-downloaded official artifacts, not the previous mirror cache or installed modules. Lifecycle scripts were disabled. The strict build and browser suite subsequently passed with this fresh tree. For a normal online installation on another machine:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
```

`tests/registry.test.ts` checks official origins, absent URL credentials, SHA-512 integrity, lockfile version and `.npmrc`. The registry configuration and dependency setup do not add network access to application code. npm installation semantics are documented in [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), and artifact metadata in the [lockfile reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

## Clearing price and tie policy

Only bids meeting the reserve count toward eligible demand. Bid limits sort descending; accepted submission order breaks equal-price ties. Caller-supplied hashes do not affect that order.

| Case | Clearing price |
| --- | --- |
| Empty/ineligible book | Reserve; no fills. |
| Eligible demand below supply | Reserve. |
| Eligible demand exactly equals supply | Reserve, including multiple bids. |
| One eligible envelope, including demand above supply | Reserve. |
| Competitive excess demand | Highest unfilled eligible lot price, floored at reserve. |
| Partially filled marginal bid | Its unfilled lots can set the uniform price. |

For one lot with unit-demand bids of `0.90`, `0.75` and `0.60 ZEC`, clearing is `0.75 ZEC`. For a lone bid at `0.90 ZEC` requesting 10 or 11 lots against supply 10/reserve `0.50 ZEC`, clearing is `0.50 ZEC`. The original judge example still fills 10 lots at `0.68 ZEC`.

The engine preserves per-bid limits and exact `paid + refund = original escrow`, rejects malformed configurations/overflow/duplicate commitments and freezes returned results. Unit checks cover 24 small-book supply/quantity combinations in addition to explicit edge cases. The single-lot result does not make multi-lot bidding a VCG mechanism. Multiple envelopes or multiple addresses do not establish independent beneficial owners; no strategyproofness or Sybil resistance is claimed.

## Refund commitment and grinding correction

Binding a UA does **not** make hash grinding impossible: a bidder can vary the salt, and UA encoding alone does not prove control of keys. This implementation removes hash values from tie priority, so searching for a lower hash gives no allocation advantage. Accepted-order priority remains dependent on the vault's sequencing; it is not a decentralized ordering guarantee.

The commitment binds the requested fields with explicit framing and retains the auction domain:

```text
SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))
```

Raw `refund_ua || salt || price || quantity` concatenation would lose auction separation and has ambiguous numeric boundaries: price `1`/quantity `23` and price `12`/quantity `3` have the same numeric suffix. A typed JSON tuple avoids this while binding the refund instruction. Web Crypto performs SHA-256 locally; an independent Node SHA-256 vector verifies the exact preimage.

This is an intentional commitment-format break. Legacy commitment receipts/roots do not verify against v2 hashes. The canonical memo schema stays `v:1`; the new engine always recomputes v2 and does not attempt legacy hash fallback. This sandbox has no persisted auction bids to migrate. A production protocol would need an explicit auction-level commitment-version migration before accepting live funds.

## Wallet compatibility and self-refund protection

Standard Revision 0 wallet UAs containing Orchard plus Sapling or transparent companion receivers are accepted. Bare transparent addresses, UAs without Orchard, malformed receivers, wrong networks and invalid Orchard points remain rejected. The URI and prepared refund field are reconstructed as Orchard-only UAs so a wallet cannot choose another receiver from those instructions. This input/output distinction follows the receiver model in [ZIP-316](https://zips.z.cash/zip-0316).

The refund guard compares both address strings and normalized Orchard destinations. Wrapping the vault receiver in a mixed UA therefore cannot bypass it. It raises `Security error: refund address must differ from the auction vault.` without including private inputs. The check occurs before salt generation during preparation, at envelope submission, during unsealing/clearing and during mock scan validation. Direct callers cannot bypass it by skipping the UI.

The guard detects an identical encoded Orchard receiver; it does not establish ownership or prove different receivers belong to different people. Normalization and distinct public fixtures preserve the existing no-funds judge flow. Both fixture receivers are blocked from actual wallet requests.

## Verification

Six new security scenarios were run against an isolated copy of the baseline implementation and all six failed for the expected behaviors: mixed-UA acceptance, refund binding, self-refund rejection, exact/solitary pricing, second-price single-lot clearing and hash-independent ties. The patched implementation passes those scenarios and the entire existing suite.

| Command/check | Observed result |
| --- | --- |
| Fresh lockfile metadata audit | 88 official-registry artifacts, all SHA-512 integrity, zero version changes. |
| Clean `npm ci` from the new official cache | 45 packages installed successfully; no lifecycle scripts. |
| `npm test` | **51 tests passed across 8 files**, zero failures. |
| `npm run build` | Strict TypeScript and Vite production build passed; 39 modules. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | **20 browser tests passed**, zero failures. |
| `git diff --check` | Passed. |

The temporary Playwright config selects the existing cached Chromium executable for this workspace; it is not maintained application source. The portable command remains `npm run test:e2e` after `npx playwright install chromium`, or with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` pointing to a compatible installed browser.

The 16 additional unit/privacy tests cover registry origin, canonical hashing and refund substitution, preparation snapshots, equivalent-UA guards, authenticated self-refund quarantine, allocation invariants and pricing/tie edges. Three additional E2E scenarios exercise exact/excess single-bid reserve pricing, mixed-wallet requests, Orchard-only URI/memo output, review invalidation and explicit self-refund errors. Prior auction, wallet, vault, live-stream, CSP, zero-request and responsive tests remain green. No commits, pushes or deployments were performed.
