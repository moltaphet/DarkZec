# Zero-Leakage Sealed Bidding Implementation Plan

**Goal:** Implement the example module named in the request, from bid preparation through local uniform-price clearing and inclusion verification.

**Architecture:** A dependency-light TypeScript browser application. Protocol functions validate inputs before hashing or URI serialization. A session-only simulator keeps encrypted envelopes separate from public commitments. The wallet request builder is a separate, explicit handoff surface.

**Tech Stack:** TypeScript strict, Web Crypto, noble BLAKE2b, scure Bech32m, Vite, Vitest, Playwright.

## Global constraints

- Follow DARKZEC-STANDARD.md; leave the source standard unchanged.
- No explicit or implicit `any`; all untrusted JSON starts as `unknown`.
- Validate memo UTF-8 bytes <= 512 before unpadded Base64url.
- Decode ZIP-316, verify checksum, F4Jumble padding and receiver structure; require Orchard. Use an Orchard-only destination to prevent wallet fallback.
- Hash exactly `auction_id:bid_price:quantity:salt`, with canonical decimal strings.
- Derive salt deterministically with HMAC-SHA256 from fresh 256-bit entropy and domain-separated context. Never derive salt from public bid data alone.
- No runtime RPC, fonts, analytics, persistence, or external requests. System monospace, #050806 and #00FF66.
- Mark simulation encryption and payment fixtures explicitly. Never offer wallet handoff for fixtures.

## Tasks

- [x] Protocol and test infrastructure: create `src/protocol/{address,amount,crypto,memo,merkle}.ts`, protocol tests, package/configuration files.
  Interfaces: `validateOrchardAddress(address, network)`, `parseZec(value): bigint`, `deriveSalt(entropy, auctionId, nonce): Promise<string>`, `commitment(bid): Promise<string>`, `encodeMemo(text): string`, `buildPaymentUri(request): string`, `merkleProof(leaves, index)`.
  Verify published ZIP-316 address fixtures, checksum corruption, wrong network, canonical decimals, delimiter rejection, SHA-256/HMAC known answers, 512/513-byte memo boundaries and multibyte text. Run `npm test` after implementation and inspect all failures.
- [x] Local state machine: create `src/simulation.ts` and simulation tests.
  Interface: `Sandbox.create()`; `submit(prepared)`, `close()`, `clear()`, `publicSnapshot()`, `audit(index)`. Freeze configuration; reject duplicate commitments, wrong auction, funding mismatch and illegal phase transitions. Use AES-GCM with commitment as AAD, fresh IV and a nonextractable session key. Clear only after close; use BigInt accounting, marginal accepted price bounded by reserve and deterministic commitment tie breaking. Verify conservation of escrow, partial fills, empty clearing, proof tampering and duplicate/racing actions.
- [x] Browser terminal: create `index.html`, `src/main.ts`, `src/style.css`, `src/fixtures.ts`, `scripts/serve.ts`.
  Design: dense auction instrument panel with a sealed-note stack as its signature. Colors: ink #050806, panel #0b110e, green #00FF66, muted #8caa98, amber #ffce73. Display and body use local system monospace with weight/size hierarchy. Desktop uses bid composer + public commitment book; mobile stacks in reading order. Include accessible forms, status/error live regions, reduced motion, secret visibility toggle, simulation reset, inclusion audit and explicit wallet review.
- [x] Verification and report: create `tests/e2e/terminal.spec.ts`, `tests/privacy.test.ts`, `README.md`, `docs/engineering-report.md`, fixture provenance and protocol references.
  Run `npm run verify`. Exercise commit -> close -> clear -> audit, real address validation failures, private request visibility and wallet handoff gating. Assert zero external requests and zero persistence during the browser flow, inspect desktop/mobile screenshots and document the exact production limitations.

No git checkout exists in this workspace; work in place without initializing or committing a repository. Execute this plan inline under the user's implementation authorization.
