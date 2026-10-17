# DARKZEC PROTOCOL — ENGINEERING STANDARDS & OFF-CHAIN/ON-CHAIN SPECS
Target Hackathon: ZECATHON (Zcash Privacy Hackathon)
Target Track: PRIVATE MARKETS ($15,000 Track Prize + $20,000 Grand Prize)

## 1. OFFICIAL REFERENCES & ECOSYSTEM RESOURCES
- **ZIPS (`zips.z.cash`):** ZIP-321 (Payment URIs), ZIP-316 (Unified Addresses), ZIP-302 (512-byte Encrypted Memos).
- **Zodl Wallet (`github.com/zodl-inc`):** Primary shielded-by-default mobile UX reference, URI deep-linking, and CrossPay standard.
- **NEAR Intents (`docs.near-intents.org`):** Cross-chain asset settlement solver framework for bridging Shielded ZEC <-> EVM/Solana assets without transparent linkage.
- **Zebra / librustzcash:** RPC querying (`z_listreceivedbyaddress`, `z_viewtransaction`) and viewing key unsealing architecture.

## 2. PRIVACY & ZERO-LEAKAGE INVARIANTS
1. **No Transparent Addresses:** Every refund, deposit, and settlement output MUST use Unified Addresses containing an Orchard receiver (`u1...` / `utest1...`). Transparent addresses (`t1...`) are strictly banned to prevent metadata leakage.
2. **Memo Byte Constraint:** All structured protocol data (auction IDs, bid prices, quantities, cryptographic salts) must be packed into JSON and strictly validated to fit under **512 bytes in UTF-8** per ZIP-302 (`TextEncoder().encode().length <= 512`).
3. **ZIP-321 Base64url Compliance:** Memos embedded in payment request URIs must use unpadded Base64url encoding (`+` -> `-`, `/` -> `_`, strip `=`).
4. **Client-Side Sovereignty:** No private keys, spending keys, or seed phrases ever touch external servers. All encryption, salt generation, and commitment hashing occur 100% locally in the browser.
5. **Zero External Network Leaks:** No external CDN font loads (Google Fonts), telemetry, or third-party analytics. Pure local system monospace typography and NODE 07 retro-terminal styling.

## 3. DARK POOL & MERKLE AUDIT SPECIFICATION
- **Commitment Formula:** `SHA256(auction_id || ":" || bid_price || ":" || quantity || ":" || salt)`
- **Clearing Mechanism:** Vickrey (Second-Price) or Uniform-Price Batch clearing executed upon unsealing incoming shielded notes via the Vault's Incoming Viewing Key (IVK).
- **Participant Audit:** A public SHA-256 Merkle tree of bid commitments allows any bidder to cryptographically verify their bid was included in price discovery without revealing their identity or bid amount.