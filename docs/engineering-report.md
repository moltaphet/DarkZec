# DarkZec engineering report

Date: 2026-10-17. Module: **Zero-Leakage Sealed Bidding & ZIP-321 URI Generator**, using the example in the supplied module placeholder.

Later addition: the [Viewing Key Vault](viewing-key-vault-report.md) adds an explicit, isolated exception to this original module's no-persistence policy: a passphrase-encrypted viewing-key record in tab session storage. Auction bids and telemetry remain unpersisted. This report describes the original module; the newer report documents the mock scanner and current persistence boundary.

## Delivered behavior

The NODE 07 terminal supports private bid preparation, exact escrow computation, ZIP-321 generation, session-only sealed commitment submission, auction close, uniform-price clearing, partial fills, refund accounting, Merkle inclusion verification and reset. A separate wallet request view supports explicit Zodl/Orchard-wallet handoff. No real transaction, wallet connection, key import, RPC or external service is required for the judge walkthrough.

## Created / modified files

All paths below are relative to the workspace. These are newly created files; the pre-existing `DARKZEC-STANDARD.md` was read and left unchanged. The workspace did not contain a Git checkout, so no branch, worktree or commit was created.

| Relative path | Responsibility |
| --- | --- |
| `.gitignore` | Excludes dependencies, build output and browser artifacts. |
| `package.json` | Exact dependency versions, Node requirement and development/verification commands. |
| `package-lock.json` | Reproducible dependency resolution. |
| `tsconfig.json` | Strict TypeScript configuration for browser, server, tests and configuration. |
| `vite.config.ts` | Local production bundling; no source maps; unit test selection. |
| `playwright.config.ts` | Chromium browser tests and local server setup; optional browser executable override. |
| `index.html` | Accessible auction/wallet interface and restrictive CSP fallback. |
| `src/env.d.ts` | Explicitly typed CSS import declaration. |
| `src/style.css` | Responsive NODE 07 styling, local monospace, focus states and reduced motion. |
| `src/main.ts` | UI state, private request visibility, wallet review, clearing/audit/reset interactions. |
| `src/fixtures.ts` | Public, unfunded test receiver and local auction configuration. |
| `src/protocol/address.ts` | ZIP-316 Bech32m, F4Jumble, CompactSize, padding and Orchard-point checks. |
| `src/protocol/amount.ts` | Canonical amounts, BigInt zatoshis, monetary limits and quantity/ID validation. |
| `src/protocol/crypto.ts` | Web Crypto HMAC salts and the mandated SHA-256 commitment. |
| `src/protocol/memo.ts` | Canonical bid JSON, UTF-8 auditing, Base64url and ZIP-321 serialization. |
| `src/protocol/merkle.ts` | Domain-separated SHA-256 tree, size-bound root and inclusion proofs. |
| `src/simulation.ts` | Isolated local vault, AES-GCM envelopes, guarded phases and clearing/accounting. |
| `scripts/serve.ts` | Loopback static server with security headers and no request logging. |
| `tests/protocol.test.ts` | Official address fixture, malformed inputs, hash vectors, memo/URI and proof checks. |
| `tests/simulation.test.ts` | State transitions, tampering, races, ties, reserve, fills and conservation. |
| `tests/privacy.test.ts` | Guards application sources against network/persistence APIs, unsafe sinks and external resources. |
| `tests/e2e/terminal.spec.ts` | Full browser loop, wallet review gating, responsive rendering and network isolation. |
| `docs/superpowers/plans/2026-10-17-sealed-bidding.md` | Implementation scope, interfaces, invariants and verification plan. |
| `README.md` | Setup, judge walkthrough, wallet behavior and verification commands. |
| `docs/engineering-report.md` | This report. |

Generated `dist/`, `node_modules/` and `test-results/` are ignored artifacts, rather than maintained source files. Browser screenshots: `test-results/terminal-desktop.png` and `test-results/terminal-mobile.png`.

## Privacy and integrity invariants

**Strict inputs and amounts.** TypeScript uses `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, unknown catch values and unused-code checks. No application-owned TypeScript contains an `any` type. Untrusted memo JSON starts as `unknown`, must match an exact versioned schema and must round-trip to canonical JSON. Quantities are whole lots from 1 to 999999. Prices use at most eight decimal places and are normalized before committing. BigInt zatoshis avoid floating-point rounding; individual escrow cannot exceed 21 million ZEC. Auction IDs reject delimiters, preventing ambiguity in the standard's colon-separated commitment formula.

**Salt and commitment.** Each bid receives a fresh 32-byte `crypto.getRandomValues` secret and a fresh 16-byte nonce. HMAC-SHA256 derives a deterministic salt from that secret and the domain-separated `DARKZEC/salt/v1:auctionId:nonce` context. Reproducibility requires the same secret and context; salts are never derived from public bid fields alone. Temporary entropy buffers are overwritten after derivation. The commitment is exactly `SHA256(auction_id + ':' + canonical_bid_price + ':' + quantity + ':' + salt)`. Web Crypto creates the HMAC and hash locally.

**Orchard destinations.** The validator checks Bech32m checksum, lowercase encoding, network HRP, inverse F4Jumble, HRP padding, canonical CompactSize, ascending unique typecodes, receiver lengths and a valid nonidentity Orchard Pallas payment point. The payment policy is deliberately stricter than generic ZIP-316: only a single Orchard receiver is accepted. Mixed-receiver UAs, unknown extensions, transparent receivers and bare transparent/Sapling addresses are refused. This prevents fallback to a transparent receiver in wallet selection. Known official mixed UAs are decoded in interoperability tests, but are not accepted for payment. The validator supports the requested active Revision 0 `u` / `utest` encodings with a local 2048-character bound; draft Revision 2 prefixes are not supported. It checks encoding and point validity, not ownership or the vault operator's trustworthiness.

**Memo format and byte audit.** Memos pack `{v,a,p,q,s,r}` for version, auction ID, canonical price, whole quantity, 256-bit salt and Orchard refund/settlement UA. `TextEncoder().encode(text).length` is checked against **512 bytes before encoding**. Invalid UTF-16 is rejected instead of silently replacing surrogates. Base64url substitutes `-` and `_` and strips all padding. ASCII and multibyte 512-byte boundaries, 513/516-byte rejection, and `+`/`/` replacement have explicit tests. The canonical URI is `zcash:<orchard-only-UA>?amount=<decimal-ZEC>&memo=<unpadded-Base64url>`. No plaintext label, bid price or salt is added as a separate public metadata parameter.

**Private/public state boundary.** Public simulator snapshots contain only phase and commitment hashes. Caller-owned configuration and snapshots are frozen/copied. Submitted memo, escrow, byte audit, URI and commitment must agree before accepting a bid. Memos are retained only as AES-256-GCM ciphertext with random 96-bit IVs and the commitment as authenticated additional data. The session key is nonextractable. The simulator does not retain the payment URI or plaintext memo after submission; the UI clears prepared artifacts on submission, editing and view switches. There is no private-key/seed input surface.

**Explicit unsealing.** Closing refuses concurrent submission and freezes the commitment set. Unsealing is a separate deliberate action that authenticates/decrypts envelopes, rechecks commitments and reveals demo bid data. Clearing sorts bids by descending limit price and then lexicographic commitment. Exhausted supply pays the marginal accepted price; undersubscribed supply pays reserve. Below-reserve bids receive a full refund. Every allocation's paid amount plus refund equals original escrow exactly. Results are immutable, and clear cannot be repeated. A local 128-bid limit bounds browser resource use.

**Participant audit.** Merkle leaves hash `0x00 || commitmentBytes`; parents hash `0x01 || left || right`. Odd final nodes duplicate. A nonempty final root hashes `0x02 || uint64be(leafCount) || treeRoot`, binding the count to prevent odd-leaf duplication ambiguity. The empty tree uses a separate domain string. Proofs check leaf index, count, side, depth, duplicated siblings and root. The audit view operates on commitments only; it does not expose bid amounts or addresses. Inclusion proves membership in this local frozen set; it is not a zero-knowledge proof of correct clearing, proof of payment or an independently anchored anti-omission log.

**Zero external application requests.** All runtime code, cryptography and CSS are bundled locally; fonts are system monospace. The app has no RPC, analytics, remote fonts, trackers, fetch/XHR/WebSocket/EventSource, cookies, localStorage, sessionStorage, IndexedDB, service workers or request logging. The loopback server serves static files only. HTTP and fallback HTML CSP set `connect-src 'none'`, `font-src 'none'`, `form-action 'none'`, `worker-src 'none'` and self-only scripts/styles. Headers include no-referrer, no-store, nosniff and frame-ancestors none. The dev command serves the production bundle without a development websocket. Dependency installation/browser setup may use the network; operating the terminal does not.

**User-directed disclosures.** A URI is readable plaintext, including its encoded memo. Its sensitive preview and clipboard copy require user action. Wallet review explicitly names the destination/network/amount. The wallet link is absent until review is acknowledged, is invalidated on edits and uses the standard `zcash:` scheme. It never reports payment success. The built-in public test receiver is blocked from wallet handoff on either network. Wallet handoff transfers sensitive data to the chosen local URI handler by explicit user action; no universal-link server is involved. The selected wallet's own networking and privacy behavior are outside this application's zero-request boundary.

## Verification

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# After browser installation:
npm run verify
```

The tests run with no blockchain/RPC setup. Unit checks cover independent Node SHA-256/HMAC results, official ZIP-316 encoding, malformed checksum/network/padding/receiver/point cases, exact amount bounds, noncanonical preimages, memo limits, URI round-trip, duplicate/tampered/wrong-auction submission, racing operations, reserve, ties, partial fills, escrow conservation and proof tampering. The privacy regression guard scans application-owned sources for prohibited network/persistence APIs and unsafe DOM sinks.

The browser suite exercises the complete auction and the wallet builder, verifies review gating and stale-request erasure, tests a CSP-blocked outbound fetch, and observes zero external requests, zero WebSockets, zero cookies, empty local/session storage and no page errors during the full auction flow. Desktop (1440px) and mobile (390px) screenshots were visually inspected; mobile has no horizontal overflow.

Validation environment: Node 26.10.0. A cached Chromium 1243 executable was used through a temporary local Playwright config because the installed Playwright expected uncached revision 1248. The equivalent portable override is `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell npm run test:e2e`. The application and maintained default config contain no machine-specific executable path. A plain approved `npm run dev` successfully served localhost after an environment-prefixed test launch encountered a sandbox bind restriction. No elevated permissions were used.

Final verification results:

| Command | Observed result |
| --- | --- |
| `npm test` | 3 files passed; **15 tests passed**, zero failures. |
| `npm run build` | Strict TypeScript and Vite production build succeeded; 18 modules bundled. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | **4 browser tests passed**, zero failures, using the cached-browser override described above. |

The temporary override is environment-specific and is not part of the delivered source. The maintained test configuration uses Playwright's normal browser installation unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is supplied.

## Production boundaries

- AES-GCM is a local vault simulation. It is **not Orchard note encryption**, not a real IVK implementation and not a replacement for audited Zcash libraries. Real shielded note creation, IVK scanning, escrow custody, consensus timing, anti-replay across sessions and settlement transactions remain integration work.
- The simulator has both encryption and decryption authority in one browser. This models a trusted vault; it does not protect against a hostile browser, extension, compromised device, vault operator or script execution within that session.
- JavaScript strings, garbage-collected keys and OS clipboards cannot be reliably zeroized. Buffers are cleared best-effort; reset drops references. No durable reveal backup is exported. Reload intentionally loses bids.
- The wallet builder generates a request without submitting it to the simulator or tracking chain acceptance. Zodl handler behavior and live mainnet/testnet payments were not tested. Verify the network, full address, Orchard selection and amount inside the installed wallet.
- Full bid reveal here is a clearly labeled judge demonstration. A production private-market design must restrict viewing-key authority and define selective disclosure, root anchoring and audit permissions before deployment.
- The mandated commitment formula binds auction ID, price, quantity and salt. It does not bind the refund address or authenticate bidder identity. AES-GCM authenticates the memo accepted by this local vault, but a production protocol must separately authenticate the original refund/settlement instruction.
- This implementation is a hackathon module with verified local invariants, not an independently audited institutional custody system or a ZK proof system.

## Primary references and fixture provenance

- [ZIP-321 payment request URIs](https://zips.z.cash/zip-0321): scheme, decimal amounts, unpadded Base64url and decoded memo limit.
- [ZIP-316 Unified Addresses, active Revision 0](https://zips.z.cash/zip-0316): receiver encoding, Bech32m checksum, F4Jumble and HRP padding. Draft Revision 2 is intentionally outside this module's accepted prefix policy.
- [ZIP-302 memo format](https://zips.z.cash/zip-0302): memo-field interpretation. The 512-byte field and wallet encryption also depend on the Zcash protocol; Base64url is transport encoding, not encryption.
- [Zcash unified-address test vectors](https://github.com/zcash/zcash-test-vectors/blob/master/test-vectors/json/unified_address.json): account 2, diversifier indices 0 and 5. Only public receiving bytes/addresses are used. No vector seed, spending key or viewing key is shipped. The built-in fixture is Orchard receiver `953f…7138` re-encoded with the testnet HRP; it is not a wallet to fund. Zcash test vectors are published under MIT / Apache-2.0; fixture attribution is retained here and in test comments.
- [Zcash reference F4Jumble](https://github.com/zcash/zcash-test-vectors/blob/master/zcash_test_vectors/f4jumble.py).
- [Zodl](https://github.com/zodl-inc): wallet UX/URI handoff reference. This project does not embed a wallet SDK or claim verified Zodl compatibility.
