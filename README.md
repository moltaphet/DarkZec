# DarkZec // Decentralized Sealed-Bid Auctions & OTC Dark Pools on Zcash

![ZECATHON · Track: Private Markets · NODE 07 · Local prototype](docs/assets/darkzec-badges.svg)

**Private order submission. Deterministic price discovery. Verifiable inclusion.**

DarkZec is a browser-local market terminal exploring sealed-bid auctions and private OTC settlement using Zcash's Orchard shielded pool. Built for **ZECATHON — Track: Private Markets**, it combines Orchard-only payment requests, compact bid memos, salted commitments, a clearing sandbox and participant inclusion audits in a NODE 07 interface.

**Release scope:** this repository delivers a self-contained hackathon prototype with real local hashing, validation and authenticated mock encryption. The runnable auction uses **uniform-price batch clearing**, with second-price behavior in the engine's single-lot, unit-demand configuration. Production Orchard scanning, decentralized escrow and cross-chain OTC settlement are integration work. No funds move in the Judge Sandbox, and this build has not undergone an independent security audit.

[Quick start](#local-development) · [Judge walkthrough](#judge-walkthrough) · [ZIP compliance](#core-architecture--zip-compliance) · [Clearing and audit](#clearing-engine--merkle-audit) · [Security boundaries](#security--privacy-boundaries)

## Implementation at a glance

| Capability | Repository status |
| --- | --- |
| Orchard-capable wallet UA validation | Implemented locally; mixed wallet UAs are accepted and payment instructions are projected to Orchard-only destinations. |
| ZIP-302 JSON sizing and ZIP-321 URI generation | Implemented; exact UTF-8 audit, unpadded Base64url and explicit wallet review. |
| Judge Sandbox | Implemented; encrypted local bids, sealed commitment book, uniform-price clearing and refund accounting. |
| SHA-256 Merkle inclusion proofs | Implemented; domain separation, leaf-count binding and local verification. |
| Viewing Key Vault | Mock keys only; encrypted tab-session storage and authenticated mock-note scanning. Real viewing keys are rejected. |
| Live security stream | Implemented; fixed metadata events, shared counters and bounded in-memory history. |
| Zodl Wallet handoff | Standard `zcash:` request builder; installed-wallet compatibility requires device testing. |
| QR presentation | Planned local rendering of the same URI; no QR generator is included in this build. |
| Single-lot second-price behavior | Implemented for unit-demand/single-lot engine configuration; the terminal's configured market remains multi-lot. |
| Orchard IVK scanning, settlement and NEAR Intents | Integration work; no RPC, relayer, solver or transaction submission runs in the terminal. |

## The dark-pool thesis

Public orderflow can reveal a trader's limits, size, execution timing and address relationships before a trade completes. Transparent AMMs expose transaction and reserve activity; cross-chain settlement can introduce additional correlations through deposit addresses, amounts and timing. That information can support front-running, inventory inference and counterparty profiling.

DarkZec's proposed market flow keeps bid instructions inside shielded payment memos and publishes salted commitments instead of a readable orderbook. An authorized clearing service would discover eligible bids through viewing authority, apply an announced auction rule and release the clearing result plus an inclusion root. The settlement layer is intended to use Orchard shielded transfers, whose protocol is specified in [ZIP-224](https://zips.z.cash/zip-0224).

The prototype makes that flow inspectable without a chain connection: bids are prepared locally, the sealed book exposes commitments, and explicit unsealing demonstrates allocation and accounting. The OTC direction extends the same private-instruction model to negotiated trades; a live OTC matching or settlement service is not implemented.

Shielding reduces on-chain disclosure; it does not erase every metadata channel. Timing, pool crossings, wallet behavior and cross-chain endpoints still matter. A viewing-key holder can read authorized incoming data, and the local simulator holds its own decryption authority. Privacy against public observers and confidentiality from the vault operator are distinct properties.

## Core architecture & ZIP compliance

```text
Private bid inputs
  -> canonical JSON + fresh salt
  -> UTF-8 byte audit + salted SHA-256 commitment
  -> ZIP-321 request for an Orchard-only destination
       -> explicit wallet review and handoff
       -> wallet constructs the actual shielded transaction

Local judge paths, with no chain dependency:
  encrypted sandbox bids -> freeze commitments -> Merkle audit -> uniform-price clear
  encrypted mock notes  -> viewing-key vault   -> authenticate  -> parse and validate

Fixed event metadata -> shared audit store -> terminal stream + telemetry rail
```

The two local paths are isolated: importing mock notes into the Viewing Key Vault does not submit them to the sandbox auction. The wallet builder creates a payment instruction; it does not confirm payment or deposit a bid into the local book.

The governing repository policy is [DARKZEC-STANDARD.md](DARKZEC-STANDARD.md). Implementation details live in [src/protocol/](src/protocol/), [src/simulation.ts](src/simulation.ts) and [src/lib/](src/lib/).

### ZIP-316: wallet compatibility and Orchard-only payment instructions

Unified Addresses can contain multiple receiver types; a `u1…` prefix alone does not establish Orchard support. DarkZec accepts standard wallet UAs containing a valid Orchard receiver, including Sapling and transparent companion receivers. It then constructs an Orchard-only UA from that receiver for the payment URI and refund memo, preserving shielded destinations without rejecting ordinary wallet addresses. Bare transparent addresses and UAs without Orchard are refused. Supported encodings are Revision 0 `u1…` on mainnet and `utest1…` on testnet; draft address revisions are outside this build's acceptance policy. See [ZIP-316](https://zips.z.cash/zip-0316).

The local validator checks Bech32m, inverse F4Jumble, network/HRP padding, canonical CompactSize, receiver ordering/length and a valid nonidentity Orchard payment point. This removes transparent receiver fallback from generated requests; it does not verify ownership of an address or guarantee the sender's funding path. Both public demo receivers are refused by the wallet handoff flow. Preparation, submission, clearing and mock scanning reject a refund destination matching the vault's Orchard receiver, even when different UA strings wrap it.

### ZIP-302: structured bid memos within 512 bytes

The bid schema uses canonical JSON with exactly six fields:

| Field | Meaning | Validation |
| --- | --- | --- |
| `v` | Protocol version | Exactly `1`. |
| `a` | Auction identifier | Validated, delimiter-safe identifier. |
| `p` | Limit price in ZEC | Positive canonical decimal string, at most eight fractional digits. |
| `q` | Quantity in whole lots | Integer from `1` to `999999`. |
| `s` | Private bid salt | 32 bytes represented as 64 lowercase hexadecimal characters. |
| `r` | Refund/settlement destination | Valid Orchard-only UA for the selected network. |

Before transport encoding, the implementation enforces:

```ts
new TextEncoder().encode(canonicalJson).length <= 512
```

The limit is **at most 512 UTF-8 bytes**, including exactly 512; character count is insufficient. ZIP-302 describes interpretation of the memo field, including removal of trailing zero padding and the `0xF6` no-memo marker. A wallet creates the encrypted shielded note; JSON serialization itself provides no encryption. See [ZIP-302](https://zips.z.cash/zip-0302).

The mock scanner authenticates ciphertext before extracting a 512-byte plaintext field. Its envelopes are 528 bytes including the AES-GCM tag. Direct JSON is the normal bid-memo representation; an explicitly labeled Base64url fixture transport exercises strict decoding. Invalid versions, malformed Unicode, wrong auctions, mismatched commitments/escrow and duplicate notes are rejected or quarantined.

### ZIP-321: payment requests, wallet handoff and QR design

The generator emits a single-recipient request of this schematic form:

```text
zcash:<orchard-only-UA>?amount=<decimal-ZEC>&memo=<unpadded-Base64url>
```

The `memo` parameter encodes the audited JSON bytes using `-` and `_`, with no `=` padding. The decoded byte limit applies before encoding; the URI can be longer than 512 characters. Amounts use exact decimal ZEC. These transport rules follow [ZIP-321](https://zips.z.cash/zip-0321).

The **Wallet request** view is designed for explicit review in **Zodl Wallet** or another compatible Orchard wallet. Editing an input erases the previous request and acknowledgement. The wallet link activates only after destination, network and escrow review. Actual URI-handler behavior must be tested on the installed wallet/device; no wallet SDK is embedded and no transaction status is inferred.

**A payment URI is sensitive readable data.** Its Base64url memo reveals the bid, salt and refund address to whoever receives it. Copy or hand it only to a trusted wallet. A future QR view must encode that same URI entirely locally and receive the same disclosure treatment; remote QR services would violate the application's zero-external-request boundary.

## Clearing engine & Merkle audit

### Vickrey second-price auction: protocol option

For a single-lot Vickrey auction, bids remain sealed during submission. The highest eligible bid wins; the winner pays the second-highest bid, subject to the announced reserve and tie rules. With bids of `0.90`, `0.75` and `0.60 ZEC` and a reserve of `0.50 ZEC`, the winner pays `0.75 ZEC`. A complete specification must also define the single-bid case, eligibility, deadlines and settlement failures before accepting bids.

The engine's single-lot, unit-demand configuration implements this price rule. The terminal is configured for a multi-lot uniform-price market; that allocation should not be described as Vickrey or as automatically inheriting single-unit truthfulness properties.

### Implemented uniform-price batch engine

The local auction follows `open -> closed -> cleared`:

1. **Submit:** validate canonical memo, auction, commitment, escrow, byte count and URI; encrypt the bid under a nonextractable session AES-256-GCM key. The public snapshot contains phase and commitment hashes.
2. **Close:** stop submissions and freeze the ordered commitment set used to derive the audit root.
3. **Unseal:** authenticate/decrypt local envelopes and recompute each commitment before clearing.
4. **Allocate:** sort by descending price, with accepted submission order breaking ties. Hash and salt changes do not affect tied priority. Fill eligible bids against available supply; the marginal bid can be partially filled.
5. **Price:** eligible demand at or below supply, or a single eligible bid envelope, pays reserve. If one winning envelope captures all supply, price against the highest losing eligible envelope, excluding the winner's own excess quantity. With multiple winners, all filled lots pay the highest unfilled eligible lot price, floored at reserve; a partially filled marginal bid can set this price. For a single lot with unit-demand bidders, this produces second-price clearing; multi-lot bidding is not claimed to be VCG or strategyproof.
6. **Account:** calculate payment and refund in integer zatoshis, preserving `payment + refund = original escrow`. Refunds are local accounting results, not submitted transactions.

The default market has 10 lots and a `0.50 ZEC` reserve. With the three demo bids plus the default user bid, it clears at `0.68 ZEC`. Below-reserve bids receive no allocation and retain their full escrow as a refund entry. The sandbox is capped at 128 bids.

### Viewing-key unsealing and disclosure authority

In the production design, a restricted viewing-key service would scan incoming Orchard notes, recover encrypted memo instructions and validate auction membership, commitment and escrow before clearing. Viewing authority permits observation without granting spending authority, as distinguished in [ZIP-316](https://zips.z.cash/zip-0316). Spending and settlement require separate authorization.

The current **Viewing Key Vault** implements authenticated mock AES-GCM scanning. Only `mock:node07:` followed by exactly 64 lowercase hexadecimal characters is accepted. Real Unified Viewing Keys, including `uview1…` / `uviewtest1…`, cannot be saved or unlocked; real key handling requires an audited WASM adapter. This vault is separate from the sandbox session-key decryptor.

A viewing key is not a cryptographic time lock: its holder may inspect incoming notes before the auction closes. The production protocol must define who holds that authority, when results may be disclosed and how abuse is constrained. A public clearing price can be released without publishing participant identities, but selective disclosure is a production responsibility. The judge sandbox deliberately reveals bid prices and allocations on its results screen.

### Salted commitments and participant inclusion proofs

The Phase 1 commitment binds the normalized refund instruction as well as auction context:

```text
C = SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))
```

The canonical typed tuple avoids ambiguous raw concatenation, and the version/auction context separates commitments across auctions. This is a commitment-format change: legacy hash receipts do not verify under the new algorithm. Memo JSON retains its existing `v:1` schema; there is no automatic legacy-hash fallback.

`freshSalt()` uses 32 bytes of secret browser randomness and a fresh 128-bit nonce. HMAC-SHA256 derives the salt with an auction-specific domain. Reproducing a salt requires the same secret entropy and context; public bid fields alone are insufficient. Participants must retain the complete bid preimage, including refund UA and salt, privately if they want to recompute `C` later. Refund binding prevents substitution; it does not prove ownership or make salt grinding impossible. Removing hash-based tie priority removes the allocation advantage from hash grinding. Accepted order still depends on the vault's sequencing and does not provide Sybil resistance.

The SHA-256 tree in [src/protocol/merkle.ts](src/protocol/merkle.ts) uses domain-separated encodings:

```text
leaf        = SHA256(0x00 || commitmentBytes)
parent      = SHA256(0x01 || leftHashBytes || rightHashBytes)
frozenRoot  = SHA256(0x02 || uint64be(leafCount) || treeRootBytes)
```

Odd final nodes are duplicated; the empty tree has a separate domain. Verification checks the commitment, sibling path, index, side, depth, leaf count and final root. A bidder can recompute their commitment with their local salt and verify its inclusion without sharing the salt, price or identity. The current UI verifies the selected local entry; a durable private receipt/export flow is not included.

**What the proof establishes:** membership in the specified frozen set. It does not prove payment, correct clearing, completeness of received bids or an independently published deadline. The demo root is local, not externally anchored. The commitment now binds `r`, but authenticating the original bidder and any settlement change still requires a production authorization design. This repository does not generate a zero-knowledge proof of auction execution.

## Ecosystem synergy

### Zodl Wallet

Zodl is the intended wallet UX reference for reviewing shielded payment requests. Its [iOS](https://github.com/zodl-inc/zodl-ios) and [Android](https://github.com/zodl-inc/zodl-android) repositories are maintained under [Zcash Open Development Lab](https://github.com/zodl-inc). DarkZec supplies a standard `zcash:` instruction; the selected wallet is responsible for review, shielded transaction construction, signing and broadcasting.

Production acceptance requires testing memo preservation, network selection, Orchard receiver selection and URI handling on supported devices. DarkZec does not claim certified compatibility, a partnership or completed mainnet settlement. Wallet networking after an explicit handoff is outside the terminal's local-request boundary.

### NEAR Intents

[NEAR Intents](https://docs.near-intents.org/) provides a cross-chain execution ecosystem, including quote/deposit/status interfaces and market-maker participation. It is an integration reference for future OTC settlement, not a dependency of the running terminal.

A future adapter would connect an authorized settlement instruction to a supported cross-chain route while preserving the Orchard-only refund policy. Supported ZEC routes, deposit-address behavior, counterparties and failure/refund semantics must be verified at integration time. Cross-chain execution is not automatically private: route endpoints, solvers and timing can reintroduce linkage. No NEAR API calls, solver requests, bridge deposits or cross-chain settlement are implemented here.

## Local development

Requirements: **Node.js 22.18+ on the 22.x line, 24.x, or 26+**, npm, and a modern browser with Web Crypto. These supported release lines match native TypeScript serving and the installed test runner. Serve through localhost or HTTPS; opening `index.html` directly is unsupported.

```sh
git clone https://github.com/moltaphet/DarkZec.git
cd DarkZec
npm install
npm run dev
```

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)**. For lockfile-reproducible installation, use `npm ci` instead of `npm install`.

The project `.npmrc` selects the official npm registry, and `package-lock.json` records official registry artifacts with integrity metadata. Use `npm ci --registry=https://registry.npmjs.org` for a clean locked installation. The registry-origin test rejects mirror URLs in the lockfile.

The current stack is **Vite + strict TypeScript + typed DOM components**, with locally bundled CSS and system monospace fonts. It does not require Next.js, React, Tailwind, a wallet, an RPC URL, API keys or environment secrets.

`npm run dev` builds the production bundle and serves it through the loopback-only static server. There is no HMR socket. After an edit, run `npm run build` and refresh, or restart the dev command. `npm run preview` serves an existing `dist/` build. Dependency/browser installation can access the network; terminal operation requires no external service.

## Judge walkthrough

### 1. Sealed auction, clearing and inclusion audit

1. Open **Auction sandbox** and choose **Load 3 demo bids**. The book shows three SHA-256 commitments; prices stay out of the sealed list.
2. Keep the default user price `0.72` and quantity `4`. Choose **Prepare sealed bid** and inspect the UTF-8 memo audit. Expand the sensitive demo URI only when reviewing its contents.
3. Choose **Commit to local vault**. The book now has four commitments and the active draft clears.
4. Choose **Close auction**. In **Inclusion audit**, select entry `4` and choose **Verify inclusion** against the frozen root.
5. Choose **Unseal & clear**. Expect `0.68 ZEC` and `10 / 10` filled lots. The demo `0.68` bid fills partially; inspect payment/refund conservation.
6. Choose **Reset local session** to clear the book, restore the auction/wallet/audit form defaults and restart one valid `0.72`/`4` preview. Reload also discards the in-memory auction. Closed auctions disable bid inputs and ignore late preview events; wallet/scanner controls remain independent.

The fixtures are public test-vector receiving data, not deposit instructions. No wallet link is offered for them and no funds move. Auction reload/reset is intentionally destructive to local demo bids; no reveal backup is exported.

### 2. Viewing Key Vault and memo validation

1. Open **Vault scanner** and choose **Use demo credentials**, then **Save & unlock**. The public demo passphrase is `node07-demo-passphrase`; use it only with mock data.
2. Choose **Load demo notes**. The scanner authenticates five envelopes: **3 accepted bids**, **1 quarantined invalid schema**, and **1 empty ZIP-302 memo**. Direct JSON and explicit Base64url fixture transports are represented.
3. Use **Rescan notes** or **Simulate incoming note**. Inspect private memo details only through the row disclosure. Scanner results do not enter the auction book.
4. Choose **Lock vault**. Decrypted rows and live key references clear. Reload retains the encrypted record but requires the passphrase again; a wrong passphrase refuses unlock.
5. Choose **Forget saved key** to remove the encrypted session record and local scanner state.

Saved mock keys are wrapped with AES-256-GCM using PBKDF2-SHA256 at 600,000 iterations and a local 12–128-character passphrase. Only ciphertext and KDF metadata enter this tab's session storage. The passphrase is not stored. Real viewing keys and non-mock legacy sessions are refused. Use mock credentials to exercise decryption; never enter real viewing keys, seed phrases or spending keys.

### 3. Security stream and interface

Inspect the **Security event stream** below any workspace. Actual memo validation, commitment hashing, URI generation, vault attempts, mock decryption and auction actions produce timestamped events. Mock activity is labeled `SIM`.

The full stream and collapsible rail share `LEAKS BLOCKED`, `ORCHARD SHIELD` and `MEMO BYTE CAPACITY`. Capacity reports validated JSON bytes and source; scans and vault lock clear stale capacity. The shield is a **local mock payload indicator**: IDLE at startup/plaintext/reset/lock/unseal; ACTIVE after auction payload encryption or authenticated valid mock-note scanning; OFFLINE after failed local verification. It does not assert real Orchard encryption or chain connectivity. Commit logs encrypted acceptance; Merkle leaf generation is logged only after successful close-time root compilation for a nonempty book. The leak counter counts observed enforced external CSP blocks, not device-wide network traffic.

**Pause stream** freezes the full view while collection/counters continue. **Clear log** empties both histories and preserves security counters. Retention is 128 events, with 18 shown in the rail. The interface includes reduced-motion support, a commitment-only canvas and a locally bundled **[ PROTOCOL SPECS & FAQ ]** manual. No remote fonts, icons or trackers are loaded.

### 4. Wallet request review

Use **Wallet request** with verified Orchard-capable addresses for the selected network. Standard mixed wallet UAs are accepted; the resulting URI and refund memo contain Orchard-only projections. Refund and vault must resolve to different Orchard receivers. Review that Orchard destination, network and escrow before enabling **Open wallet**. Built-in fixtures are blocked. Inspecting or copying a request needs no payment; opening a wallet is an explicit transfer of sensitive request data to the selected handler. This flow is separate from the judge sandbox and does not track chain acceptance.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e` automatically runs a fresh strict production build before Playwright. After Chromium installation, `npm run verify` runs unit tests and that complete E2E command, with one build. If a compatible Chromium binary is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable for browser tests. Playwright starts the loopback preview server or reuses an existing one. Running `preview` without a readable `dist/index.html` prints build instructions and exits before listening.

Coverage includes address vectors and rejection cases, independent SHA-256/HMAC checks, exact monetary arithmetic, 512-byte ASCII/multibyte boundaries, canonical memo/URI round-trips, escrow conservation, partial fills, proof tampering, authenticated scanner failures, encrypted-session behavior, event redaction/retention, CSP enforcement and responsive auction/wallet/vault interactions. Screenshots are written to ignored `test-results/`.

The [current engineering report](docs/engineering-report.md#build-serve-and-verification) records **62 unit/privacy/CLI tests, 30 E2E tests and 39 bundled modules**, including all of the previous 58/27 suite. Unit tests and strict builds passed on Node 22.18.0, 24.0.0 and 26.10.0; E2E ran on Node 26.10.0 with Chromium. Checks cover mock-only credentials, legacy non-mock sessions, a 12px CSS/canvas minimum with 14px primary readouts, five responsive viewport widths and mobile result scrolling. The full browser suite also passed in CI mode with two workers and a dedicated preview server. These are recorded local results, not a hosted CI badge or an independent audit. Run the commands above against the checkout being reviewed.

## Security & privacy boundaries

- **No external runtime requests:** local scripts/styles, inline icons and system fonts; no RPC, analytics, trackers, remote assets or background polling. CSP includes `connect-src 'none'` and `font-src 'none'`; the server binds to loopback and does not log requests.
- **Private data stays out of logs:** the audit API accepts fixed event types and validated numeric metadata. Keys, salts, addresses, amounts, payloads, raw errors and blocked URLs are excluded. History is memory-only; it is not third-party telemetry.
- **Controlled persistence:** auction bids and audit logs are not persisted. The viewing-key adapter alone stores a passphrase-encrypted mock-key record in tab session storage. Validation rejects real keys before accessing storage and rechecks decrypted records on unlock. Lock/view changes clear live vault data; Forget removes the record.
- **Local trust:** the browser, same-origin scripts, extensions and device remain in the trust boundary. The mock vault is not a substitute for Orchard encryption. JavaScript strings, garbage-collected keys and OS clipboard contents cannot be reliably zeroized.
- **Production work:** audited Orchard scanning and transaction construction, custody/spending authorization, deadline enforcement, durable receipts, root publication, refund authentication and selective disclosure remain required. The current prototype is not a deployed decentralized exchange or an institutional custody product.

## Repository map and engineering notes

```text
src/
  components/     Terminal UI, protocol manual, viewing vault and live stream
  protocol/       Address, amount, memo, commitment and Merkle primitives
  lib/            Mock-note scanner, session encryption, security events and UI helpers
  fixtures.ts     Public test-vector receiver and local auction configuration
  simulation.ts   Local sealed vault and uniform-price clearing
  main.ts         Application integration and lifecycle
scripts/          Loopback static server and security headers
tests/            Unit/privacy checks and Playwright browser scenarios
docs/             Engineering reports, implementation plans and local badge asset
```

| Document | Purpose |
| --- | --- |
| [DARKZEC-STANDARD](DARKZEC-STANDARD.md) | Governing protocol and privacy invariants. |
| [Current engineering report](docs/engineering-report.md) | Active repository, protocol/lifecycle design, file inventory, provenance and full verification matrix. |
| [NODE 07 UI report](docs/ui-polish-report.md) | Canvas, memo animation, local styling and responsive behavior. |
| [Viewing Key Vault report](docs/viewing-key-vault-report.md) | Parser rules, encrypted session storage and mock decryption boundaries. |
| [Live terminal report](docs/live-terminal-report.md) | Event integration, counter semantics, redaction and Step 2 verification coverage. |
| [Phase 1 security report](docs/phase1-security-report.md) | Official-registry resolution, refund binding/guards, wallet UA compatibility and corrected clearing/tie rules. |
| [Phase 2 QA audit](docs/phase2-qa-report.md) | Canvas navigation, closed/reset/seed handling, truthful telemetry, build/serve improvements and regression results. |
| [Comprehensive hardening audit](docs/repo-hardening-report.md) | Finding-by-finding verification, sole-winner competing margins, runtime type guards and repeat clean installation. |

Reports describe their respective implementation stages; their historical test counts, commitment formats, UA policies and clearing rules should be read with the later vault, stream and Phase 1 security changes. The README describes the current combined checkout.

## License and continuous integration

DarkZec is licensed under the [MIT License](LICENSE). Public receiving vectors retain their upstream attribution.

The [CI workflow](.github/workflows/ci.yml) runs on pushes and pull requests with Node.js 22 and 24. It uses `npm ci`, installs Chromium and its Linux dependencies, then runs `npm run build`, `npm test` and `npm run test:e2e` sequentially. A failed step fails that matrix job and prevents later checks from running. E2E rebuilds before testing, forbids focused tests in CI and uses two workers with its own loopback preview server. Actions are pinned to immutable commit SHAs, repository permissions are read-only, and checkout credentials are not persisted.

To enforce merge blocking on `main`, configure [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) to require both `Node 22 / build, unit and E2E tests` and `Node 24 / build, unit and E2E tests`, require branches to be up to date, and restrict direct pushes and bypasses. A workflow file alone cannot enforce repository merge policy. Repository protection settings were not changed by this local implementation; no hosted run is claimed. See the [production polish report](docs/production-polish-report.md) for changed files and verification.
