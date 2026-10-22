# DarkZec // Sealed-Bid Auctions & OTC Dark Pools on Zcash

![ZECATHON · Track: Private Markets · NODE 07 · Local prototype](docs/assets/darkzec-badges.svg)

**Private order submission. Deterministic price discovery. Verifiable inclusion.**

DarkZec is a browser-local market terminal for **commit/reveal sealed-bid auctions** settled through Zcash's Orchard shielded pool. Built for **ZECATHON — Track: Private Markets**. A bidder commits a salted hash plus fixed collateral, reveals the private bid in a short window, and any participant can verify that their commitment is in the frozen Merkle root.

[Quick start](#local-development) · [Judge walkthrough](#judge-walkthrough) · [What is real vs mock](#what-is-real-and-what-is-mock) · [ZIP compliance](#core-architecture--zip-compliance) · [Clearing and audit](#clearing-engine--merkle-audit) · [Security boundaries](#security--privacy-boundaries)

## What is real and what is mock

| Capability | Status |
| --- | --- |
| ZIP-316 Unified Address validation (Bech32m, F4Jumble, receiver ordering, Orchard point check) | **Real**, tested against official vectors. Mixed wallet UAs are accepted and projected to Orchard-only destinations. |
| ZIP-302 memo sizing (exact UTF-8 ≤ 512 bytes) and ZIP-321 `zcash:` URI generation (unpadded Base64url) | **Real**. |
| Salted, domain-separated bid commitments and SHA-256 Merkle inclusion proofs | **Real**, computed locally with Web Crypto. |
| Commit/reveal ledger, uniform-price clearing and zatoshi-exact collateral/refund accounting | **Real** local engine; refunds are accounting results, not transactions. |
| Viewing Key Vault and note scanner | **Mock**: `mock:node07:` keys only, authenticated AES-GCM mock notes. Real viewing keys are rejected. |
| Orchard IVK scanning, transaction submission, escrow, NEAR Intents settlement | **Not implemented** (integration work). No RPC, relayer or solver runs. |
| Zodl Wallet handoff | Standard `zcash:` request; installed-wallet compatibility needs device testing. |
| QR rendering | Not included in this build. |

No funds move in the Judge Sandbox. The build has not had an independent security audit.

## The dark-pool thesis

Public orderflow can reveal a trader's limits, size, timing and address relationships before a trade completes, which enables front-running, inventory inference and counterparty profiling. DarkZec keeps bid instructions out of the public book: during the commit phase only an auction ID and a salted hash travel in the shielded memo. Prices, quantities and refund addresses stay with the bidder until the reveal window, and the clearing service publishes only the clearing result plus an inclusion root.

Shielding reduces on-chain disclosure; it does not erase every metadata channel. Timing, pool crossings, wallet behavior and cross-chain endpoints still matter. The vault operator sees revealed bids, so privacy against public observers and confidentiality from the operator are distinct properties. The OTC direction reuses the same private-instruction model; a live OTC matching service is not implemented.

## Core architecture & ZIP compliance

```text
COMMIT   bid inputs -> canonical JSON + fresh salt -> salted SHA-256 commitment
         commit memo {v:2,t:"commit",a,c} (auction ID + hash, <= 512 bytes)
         ZIP-321 request for an Orchard-only vault + fixed collateral -> wallet review
CLOSE    freeze ordered commitments -> Merkle root over ALL commitments
REVEAL   bidder submits the private receipt {a,p,q,s,r} -> ledger recomputes the hash
CLEAR    verified reveals only -> uniform-price clearing -> payment/refund accounting

Local only, no chain dependency:
  encrypted mock notes -> viewing-key vault -> authenticate -> parse commit memo
Fixed event metadata -> shared audit store -> terminal stream + telemetry rail
```

The sandbox auction and the vault scanner are isolated: scanned mock notes never enter the auction book. The wallet builder produces a payment instruction; it does not confirm payment or deposit a bid into the local book. The governing repository policy is [DARKZEC-STANDARD.md](DARKZEC-STANDARD.md); implementation lives in [src/protocol/](src/protocol/), [src/simulation.ts](src/simulation.ts) and [src/lib/](src/lib/).

### ZIP-316: Orchard-only payment instructions

A `u1…` prefix alone does not establish Orchard support. DarkZec accepts standard wallet UAs containing a valid Orchard receiver (Sapling and transparent companions allowed) and rebuilds an Orchard-only UA for the payment URI and refund destination, so no transparent fallback is generated. Bare transparent addresses and UAs without Orchard are refused. Supported encodings are Revision 0 `u1…` (mainnet) and `utest1…` (testnet). The validator checks Bech32m, inverse F4Jumble, HRP padding, canonical CompactSize, receiver ordering/length and a valid nonidentity Orchard payment point. Refund and vault must resolve to different Orchard receivers even when their UA strings differ. See [ZIP-316](https://zips.z.cash/zip-0316).

### ZIP-302: memos within 512 bytes

Two canonical JSON shapes are used, both validated as exact UTF-8 byte length (`new TextEncoder().encode(json).length <= 512`, so exactly 512 passes):

| Shape | Fields | Where it goes |
| --- | --- | --- |
| Commit memo | `v:2`, `t:"commit"`, `a` auction ID, `c` 64-hex commitment | Payment URI memo / shielded note. Public data only. |
| Reveal receipt | `v:1`, `a`, `p` price, `q` quantity, `s` 64-hex salt, `r` Orchard refund UA | Held privately by the bidder; submitted in the reveal window. |

Invalid Unicode, noncanonical JSON, wrong versions and extra fields are rejected. JSON itself provides no encryption; the wallet creates the encrypted note. See [ZIP-302](https://zips.z.cash/zip-0302).

### ZIP-321: payment requests and wallet handoff

```text
zcash:<orchard-only-UA>?amount=<collateral-ZEC>&memo=<unpadded-Base64url(commit memo)>
```

The URI is a readable instruction, but it carries only the auction ID and commitment hash. The reveal receipt is the sensitive artifact: it holds price, quantity, salt and refund address, and the UI shows it separately. Editing an input erases the previous request and acknowledgement; **Open wallet** activates only after destination, network and escrow review, and public demo receivers are refused. Remote QR services would violate the zero-external-request boundary, so QR rendering is left out. See [ZIP-321](https://zips.z.cash/zip-0321).

## Clearing engine & Merkle audit

The local auction follows `open -> reveal -> cleared`:

1. **Commit:** accept only `{auctionId, commitment, collateral}`; collateral is fixed (10 ZEC per commitment), duplicates are refused, and the sandbox holds up to 128 commitments. No preimage enters the ledger.
2. **Close:** stop commits, freeze the ordered commitment set and publish the Merkle root over **all** commitments. A 60-second reveal window starts.
3. **Reveal:** the bidder submits the receipt; the ledger rebuilds the memo, rejects refund-to-vault, recomputes the commitment, matches it to a recorded one and checks `price x quantity <= collateral`.
4. **Clear:** after all reveals verify or the deadline passes, only verified reveals are allocated. Unrevealed bids get no allocation; their collateral stays held (no forfeiture or recovery policy is defined in this prototype).
5. **Allocate:** descending price, ties broken by accepted commit order (never by hash). The marginal bid can be partially filled.
6. **Price:** eligible demand at or below supply, or a single eligible bid, pays reserve. If one winning envelope captures all supply, price against the highest losing eligible envelope; with several winners, all filled lots pay the highest unfilled eligible price, floored at reserve. For a single lot with unit-demand bidders this equals second-price (Vickrey) clearing; multi-lot bidding is **not** claimed to be VCG or strategyproof.
7. **Account:** integer zatoshi arithmetic with `payment + refund = collateral` for every revealed bid.

The default market has 10 lots and a `0.50 ZEC` reserve. The three demo bids plus the default `0.72 x 4` user bid clear at `0.68 ZEC` with `10 / 10` lots filled.

### Commitments and inclusion proofs

```text
C = SHA256(UTF8(JSON.stringify([
  "DARKZEC/bid/v2", auction_id, refund_ua, salt, canonical_price, quantity
])))

leaf       = SHA256(0x00 || commitmentBytes)
parent     = SHA256(0x01 || left || right)
frozenRoot = SHA256(0x02 || uint64be(leafCount) || treeRoot)
```

The typed tuple avoids ambiguous concatenation, binds the refund instruction and separates commitments across auctions. `freshSalt()` derives a 256-bit salt with HMAC-SHA256 from secret browser entropy and a 128-bit nonce. Binding the refund address prevents substitution; it does not prove ownership or rule out salt grinding. A bidder can verify their commitment's inclusion without disclosing price, quantity, salt or identity.

**What the proof establishes:** membership in the frozen commit set (revealed or not). It does not prove payment, correct clearing, completeness of received commitments, or an independently published deadline. The root is local and not externally anchored, and the repository generates no zero-knowledge proof of auction execution.

### Viewing-key unsealing and disclosure authority

In production, a restricted viewing-key service would scan incoming Orchard notes and recover commit memos; viewing authority permits observation without spending ([ZIP-316](https://zips.z.cash/zip-0316)). A viewing key is not a time lock: its holder can inspect incoming notes at any time, so the holder, disclosure timing and abuse constraints must be specified. The current **Viewing Key Vault** is a mock: only `mock:node07:` plus exactly 64 lowercase hex characters is accepted, real `uview1…` keys are refused before storage is touched, and scanned notes are authenticated AES-GCM envelopes containing commit memos.

## Ecosystem synergy

- **Zodl Wallet** ([iOS](https://github.com/zodl-inc/zodl-ios), [Android](https://github.com/zodl-inc/zodl-android)) is the intended UX reference for reviewing shielded payment requests. DarkZec supplies a standard `zcash:` instruction; the wallet handles review, signing and broadcast. No certified compatibility or partnership is claimed.
- **[NEAR Intents](https://docs.near-intents.org/)** is an integration reference for future cross-chain OTC settlement, not a dependency. Cross-chain routes can reintroduce linkage through endpoints, solvers and timing. No NEAR calls or bridge deposits exist here.

## Local development

Requirements: **Node.js 22.18+ (22.x), 24.x or 26+**, npm and a browser with Web Crypto. Serve over localhost or HTTPS; opening `index.html` directly is unsupported.

```sh
git clone https://github.com/moltaphet/DarkZec.git
cd DarkZec
npm ci
npm run dev
```

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)**. The stack is Vite + strict TypeScript + typed DOM components with locally bundled CSS, a WebGL intro scene and system monospace fonts. It needs no wallet, RPC URL, API key or secret. `npm run dev` builds the production bundle and serves it through the loopback-only static server (no HMR); `npm run preview` serves an existing `dist/`. The project `.npmrc` selects the official npm registry and a registry-origin test rejects mirror URLs in the lockfile.

## Judge walkthrough

### 1. Commit, reveal, clear and audit

1. Open **Auction sandbox** and choose **+ Load 3 demo bids**. The book shows three commitments; prices stay out of it.
2. Keep the default `0.72` / `4`, choose **Prepare sealed bid**, inspect the commit-memo byte audit, then **Commit to local vault**. The book has four commitments.
3. Choose **Close auction**. The Merkle root is frozen. In **Inclusion audit** select entry `4` and **Verify inclusion**.
4. In **Commit → Reveal**, choose **Reveal all local receipts / demo** (or reveal one receipt). To see non-revealers excluded, skip a reveal and use **Advance reveal deadline / judge only**.
5. Choose **Finalize & clear**. Expect `0.68 ZEC`, `10 / 10` lots and payment + refund equal to collateral for each reveal.
6. **Reset local session** restarts the demo. Reload also discards the in-memory auction; receipts are not exported.

Fixtures are public test-vector receiving data, not deposit instructions; no wallet link is offered for them.

### 2. Viewing Key Vault

1. Open **Vault scanner**, choose **Use demo credentials**, then **Save & unlock** (public demo passphrase `node07-demo-passphrase`; mock data only).
2. **Load demo notes**: five envelopes scan to **3 accepted commit memos**, **1 quarantined invalid schema** and **1 empty ZIP-302 memo**, across JSON and Base64url transports.
3. **Rescan** or **Simulate incoming note**; inspect private detail only through row disclosure. **Lock vault** clears decrypted rows; reload keeps only ciphertext and requires the passphrase; a wrong passphrase refuses; **Forget saved key** removes the record.

Saved mock keys are wrapped with AES-256-GCM using PBKDF2-SHA256 (600,000 iterations) and a 12–128 character passphrase in tab session storage. Never enter real viewing keys, seed phrases or spending keys.

### 3. Security stream and wallet request

The **Security event stream** records fixed-vocabulary events with numeric metadata only (no keys, salts, addresses, amounts or payloads). `LEAKS BLOCKED` counts observed CSP blocks; `MEMO BYTE CAPACITY` reports validated JSON bytes; the `ORCHARD SHIELD` indicator is ACTIVE only after an authenticated mock note scan, because the commit/reveal ledger itself stores hashes only. History keeps 128 events (18 shown in the rail).

**Wallet request** builds a payment URI from addresses you supply for the selected network. Review the Orchard destination, network and escrow before **Open wallet** enables; opening a wallet is an explicit transfer of the request to that handler.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e` runs a fresh strict build first; `npm run verify` runs unit tests plus that command. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to reuse an installed Chromium. Current local results on Node 26.10.0: **69 unit/privacy tests (9 files), 34 end-to-end tests and a strict production build**; CI runs the same commands on Node 22 and 24 (see the [engineering report](docs/engineering-report.md#build-serve-and-verification)). Coverage includes address vectors, independent SHA-256/HMAC checks, exact money arithmetic, 512-byte ASCII/multibyte boundaries, commit/reveal tampering, frozen-root consistency, partial fills, proof tampering, authenticated scanner failures, encrypted session behavior, event redaction, CSP enforcement, a 12px/14px text floor and responsive layouts. Screenshots go to ignored `test-results/`. These are local results, not a hosted CI badge or an audit.

## Security & privacy boundaries

- **No external runtime requests:** local scripts/styles, inline icons, system fonts; no RPC, analytics, trackers or polling. CSP uses `connect-src 'none'` and `font-src 'none'`; the server binds to loopback and does not log requests.
- **Private data stays out of logs:** the audit API accepts fixed event types and validated numeric metadata.
- **Controlled persistence:** bids, receipts and logs are never persisted. Only the passphrase-encrypted mock-key record lives in tab session storage.
- **Local trust:** the browser, same-origin scripts, extensions and device are inside the trust boundary. JavaScript strings, GC-managed keys and clipboard contents cannot be reliably zeroized. The sandbox hosts the bidder and operator roles in one browser and does not isolate them from a compromised device.
- **Known prototype limits:** no penalty or recovery policy for non-revealers, no Sybil resistance or decentralized sequencing, no authenticated bidder identity, no externally anchored root, and no real Orchard scanning or settlement. These are production work.

## Repository map

```text
src/
  components/   Terminal UI, WebGL intro, protocol manual, reveal panel, viewing vault, live stream
  protocol/     Address, amount, memo, commitment and Merkle primitives
  lib/          Mock-note scanner, session encryption, security events and UI helpers
  fixtures.ts   Public test-vector receiver and local auction configuration
  simulation.ts Commit/reveal ledger and uniform-price clearing
  main.ts       Application integration and lifecycle
scripts/        Loopback static server and security headers
tests/          Unit/privacy checks and Playwright browser scenarios
docs/           Engineering reports and local badge asset
```

| Document | Purpose |
| --- | --- |
| [DARKZEC-STANDARD](DARKZEC-STANDARD.md) | Governing protocol and privacy invariants. |
| [Engineering report](docs/engineering-report.md) | Current repository state, design and verification matrix. |
| Stage reports in [docs/](docs/) | Historical per-stage notes (UI polish, vault, live stream, Phase 1/2, hardening, production polish). Their test counts, commitment wording and sandbox-encryption descriptions predate the commit/reveal ledger; this README and the standard describe the current build. |

## License and continuous integration

DarkZec is licensed under the [MIT License](LICENSE). Public receiving vectors retain their upstream attribution.

The [CI workflow](.github/workflows/ci.yml) runs on pushes and pull requests with Node.js 22 and 24: `npm ci`, Chromium install, `npm run build`, `npm test`, `npm run test:e2e` in sequence, with SHA-pinned actions, read-only permissions and no persisted checkout credentials. Merge blocking on `main` needs GitHub branch protection requiring both `Node 22 / build, unit and E2E tests` and `Node 24 / build, unit and E2E tests`; a workflow file cannot enforce that by itself.
