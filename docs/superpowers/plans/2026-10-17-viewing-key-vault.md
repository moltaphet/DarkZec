# Viewing Key Vault & Memo Scanner

Goal: deliver a local, interactive viewing-key/session vault and authenticated simulated note scanner, integrated as a third terminal view. Keep real Orchard operations explicitly outside the mock adapter.

Architecture: `src/components/ViewingKeyVault.tsx` mounts a typed DOM component in the current Vite app (no React dependency). Supporting modules separate memo parsing, authenticated mock notes and passphrase-encrypted session persistence. Existing bid protocol, escrow and public commitment book remain unchanged.

Security boundaries:
- Only the dedicated session adapter may access session storage. Store a versioned AES-GCM ciphertext, random IV/salt and fixed PBKDF2 parameters; never persist the viewing key or unlock passphrase in plaintext.
- Mock note encryption uses a 256-bit mock key and authenticates note metadata. Ciphertext includes an authentication tag; only the decrypted memo field is exactly 512 bytes. Never remove padding from ciphertext.
- Decode exact 512-byte memo fields, remove trailing zero bytes, reject malformed UTF-8 and handle ZIP-302 no-memo/reserved markers. Accept canonical JSON directly, or explicitly marked strict unpadded Base64url text. Reuse existing schema, Orchard refund, canonical amount and commitment validation.
- Wrong keys, invalid schemas, wrong auctions/networks/vaults, mismatched commitments/escrow and duplicate notes are isolated as rejected rows. No key, memo, salt, address or decrypted bid enters public state or telemetry.
- Real Unified Viewing Keys may be stored with clear format/compatibility boundaries; actual Orchard note decryption requires a future audited adapter. All current note scanning is labeled simulation.
- Lock/view switch clears live key references and private rows. Forget removes the encrypted record. Reload requires the unlock passphrase; no automatic unlock or network calls.

Tasks:
- [x] Implement strict memo-field parser and authenticated mock-note fixtures, with boundary/tamper/wrong-key tests.
- [x] Implement encrypted session adapter, corruption/wrong-passphrase/storage-denial tests and a narrow privacy-guard exception.
- [x] Add TSX vault component, private results table, mock note controls, lock/forget/restore behavior and responsive styling.
- [x] Integrate navigation and isolated control ownership. Preserve auction/wallet tests and update protocol docs to describe the real scanner boundary accurately.
- [x] Run unit/privacy tests, strict production build and browser tests for session restoration, scan isolation, lock/forget, responsive layout and zero outbound requests; inspect screenshots and report evidence.
