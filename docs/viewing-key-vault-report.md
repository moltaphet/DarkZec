# Viewing Key Vault & Memo Devault — Step 1

Historical Step 1 report. [Phase 1 security changes](phase1-security-report.md) add refund-bound commitments, distinct fixtures, Orchard-capable UA input compatibility and self-refund quarantine to this scanner.

The terminal now includes a fully local **Vault scanner** view with viewing-key input, encrypted tab-session persistence, authenticated mock-note scanning, validated bid results, live incoming-note simulation, lock, forget and reload restoration. The requested `src/components/ViewingKeyVault.tsx` integrates with the existing Vite/TypeScript DOM architecture without adding React or other dependencies.

## Files

Created:

- `src/components/ViewingKeyVault.tsx` — private credentials, scanner state, results table, bounded memo inspector, cancellation and lifecycle cleanup.
- `src/components/ViewingKeyVault.css` — responsive NODE 07 styling and mobile navigation spacing.
- `src/lib/viewing-key-session.ts` — viewing-key envelope checks and the sole permitted encrypted session-persistence adapter.
- `src/lib/vault-memo.ts` — exact memo-field parsing, strict Base64url, UTF-8, schema and fixed error categories.
- `src/lib/mock-note-scanner.ts` — mock key derivation, authenticated note fixtures and isolated batch scan validation.
- `tests/viewing-vault.test.ts` — 13 parser, crypto, session and adversarial unit tests.
- `tests/e2e/viewing-vault.spec.ts` — four browser flows covering the private vault and persistence lifecycle.
- `docs/superpowers/plans/2026-10-17-viewing-key-vault.md` — implementation and verification scope.
- `docs/viewing-key-vault-report.md` — this report.

Modified: `src/main.ts`, `index.html`, `tsconfig.json`, `tests/privacy.test.ts`, `src/components/ProtocolSpecs.ts`, `README.md` and `docs/engineering-report.md`. Dependency files, the original DARKZEC standard and the auction clearing algorithm are unchanged.

## Cryptographic and privacy boundaries

**Session persistence.** Only a validated mock key is wrapped with AES-256-GCM using a PBKDF2-SHA256 key derived from the local unlock passphrase, a fresh 16-byte random salt and 600,000 iterations. A fresh 12-byte IV and domain-separated authenticated data protect the record. Only version, fixed KDF parameters, salt, IV and ciphertext are saved under `darkzec.viewing-vault.v1`. The passphrase, raw mock key, decrypted bids and notes are never persisted as plaintext. Wrong passphrases, modified ciphertext, corrupted records and unavailable/denied storage fail closed. Pending saves can be cancelled before they repopulate a forgotten record. Derived Web Crypto keys are nonextractable.

The source privacy guard permits `sessionStorage` only in `viewing-key-session.ts` for encrypted mock credentials. Other network/persistence APIs remain prohibited throughout application sources. Runtime regression tests ensure arbitrary and real keys are rejected before touching this boundary. No browser storage is written unless the user explicitly saves a valid mock key. Auction-only browser tests still observe empty local/session storage.

**Mock versus Orchard.** Public demo credentials derive a mock AES-GCM note key via HKDF-SHA256. The demo producer always uses that fixture key, so a different mock key correctly fails authentication rather than silently revealing fixture bids. The vault now accepts only `mock:node07:` plus exactly 64 lowercase hex characters. Real Unified Viewing Keys are rejected, including checksum-valid `uview`/`uviewtest` envelopes. The earlier storage-only real-key path has been removed; legacy encrypted records containing non-mock credentials cannot unlock. Real key handling remains disabled until an audited WASM adapter is ready. This boundary is visible in the UI and README. No spending-key or seed input is accepted.

**Correct field size.** A memo field is 512 bytes after note decryption; ciphertext is not a ZIP-302 plaintext field. This mock format uses 528 bytes of AES-GCM ciphertext including its 16-byte authentication tag, plus a separate 12-byte IV. Only after successful authentication does the scanner extract a 1024-character hex encoding of the 512-byte field, remove trailing `0x00` padding and decode fatal UTF-8. It handles the ZIP-302 no-memo marker and refuses reserved/binary/invalid encodings. Interior zeros are not stripped.

**Transport and schema.** Normal wallet memos contain direct JSON after ZIP-321 Base64url transport has been decoded by the wallet. The mock adapter also supports an explicitly authenticated `base64url` text transport for the requested decode demonstration. It rejects padding, `+`/`/`, impossible lengths, noncanonical pad bits, invalid UTF-8 and oversized payloads. Decoded JSON must pass the existing exact canonical `{v,a,p,q,s,r}` schema: `v:1`, auction ID, positive canonical price, whole quantity, 256-bit salt and Orchard-only refund address. The auction, network, vault destination, escrow and SHA-256 commitment must agree with the authenticated note metadata.

**Batch isolation.** Each note is authenticated independently. Bad notes are quarantined without aborting the entire batch. Empty memos are skipped. Duplicate note IDs and duplicate accepted commitments are rejected, scans are idempotent, batch size is capped at 128, and cancellation is checked before/after asynchronous decryption and at completion. The note array and expected scan scope are copied before asynchronous work.

**Private results.** Decrypted values are shown only in the unlocked vault view. Salts, refund addresses and full memo hex enter the DOM only when Inspect memo is opened; collapsing it removes that content. Lock/view switch cancels jobs, drops live-key and parsed-result references, clears inputs and removes result-row listeners. Forget removes only this module's saved record and drops its local note batch. No key, bid, salt, address, exception text or decoded memo is passed to public commitments or telemetry. DOM content uses `textContent`, never unsafe HTML sinks.

**Practical limits.** The encrypted record survives reload within a tab; the unlock passphrase is required again. Fixture notes are memory-only and are regenerated after reload. The public demo passphrase/key protect mock data only. Passphrase encryption is not hardware isolation; same-origin malicious scripts or a compromised browser/device can access an unlocked vault. JavaScript strings, Web Crypto objects and garbage-collected memory cannot be reliably zeroized. Encryption relies on the strength of the user's chosen passphrase. No actual chain receipts, IVK scanning, funds or settlement are involved.

## Local walkthrough and verification

```sh
npm ci
npm run dev
```

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)**, then **Vault scanner → Use demo credentials → Save & unlock → Load demo notes**. Expected: 5 notes, 3 accepted bids, 1 quarantined schema and 1 empty memo. Simulating an incoming note increments the received/accepted counts. Rescan does not duplicate rows. Lock clears private rows; reload requires the demo passphrase again; Forget removes the saved session.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The existing optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override supports an already cached Chromium binary. Workspace browser checks use the temporary cached-browser configuration documented in the earlier engineering report; it contains no maintained machine-specific source changes.

Unit coverage includes direct JSON/Base64url, field bounds, zero padding, empty/reserved markers, UTF-8/NUL errors, canonical Base64url, schema/version/amount/quantity/salt/refund/auction rejection, authenticated fixture scans, wrong keys, ciphertext/AAD tampering, escrow/commitment mismatch, duplicates, cancellation, encrypted mock-session restoration, wrong passphrases, record corruption/tampering, random wrapping, storage denial, strict mock-key matching and rejection of real-key inputs and authentic legacy non-mock sessions.

Browser coverage includes encrypted-only storage, cleared credential inputs, automatic fixture scan, incoming-note updates, idempotent rescan, on-demand private details, lock/view-switch cleanup, reload/unlock, wrong key/passphrase, forget, cancellation, denied storage, mobile overflow and zero outbound requests/page errors in the full vault flow. Existing auction, wallet, CSP and UI suites remain included. Desktop/mobile screenshots are generated in ignored `test-results/`.

Final observed results: `npm test` passed **28 tests across 4 files**; `npm run build` passed strict TypeScript and the Vite production bundle; `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` passed **13 browser tests**, using cached Chromium. `git diff --check` passed. The complete vault browser flow observed zero external requests and zero page errors. Desktop (1440px) and mobile (390px) screenshots were inspected; mobile has no horizontal page overflow.

## Primary references

- [ZIP-302](https://zips.z.cash/zip-0302): memo field interpretation, trailing-zero removal, UTF-8 and empty/reserved markers.
- [ZIP-321](https://zips.z.cash/zip-0321): unpadded Base64url payment-request memos and the decoded 512-byte limit.
- [ZIP-316](https://zips.z.cash/zip-0316): Unified Viewing Key string encoding and viewing authority. The custom mock AES-GCM envelope is explicitly not a ZIP-316/Orchard decryption implementation.
