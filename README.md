# DarkZec / NODE 07

A self-contained sealed-bid auction terminal and ZIP-321 request generator for ZECATHON / PRIVATE MARKETS. The request's module name was a placeholder; this implementation uses its example: **Zero-Leakage Sealed Bidding & ZIP-321 URI Generator**.

Requires Node.js 24+ and npm. Install dependencies once; the running application needs no external service.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The dev command builds and serves the production bundle, with no HMR websocket. Restart it after editing. To serve an existing build, use `npm run preview`.

## Judge walkthrough

1. Choose **Load 3 demo bids**. The book shows only commitment hashes.
2. Leave price `0.72` and quantity `4`; choose **Prepare sealed bid**. Inspect the commitment and UTF-8 memo audit. The sensitive demo URI is visible only when deliberately expanded.
3. Choose **Commit to local vault**, then **Close auction**.
4. Verify inclusion for entry `4` against the frozen Merkle root.
5. Choose **Unseal & clear**. The uniform price is `0.68 ZEC`; all 10 demo lots fill. The `0.68` bidder receives a partial fill. Each allocation's payment plus refund equals its original escrow.
6. Choose **Reset local session**, or reload, to discard the book and its session key.

No funds move. Public test-vector addresses are never offered as wallet links.

## Wallet requests

The separate **Wallet request** view accepts a verified vault address and your refund/settlement address, network, auction ID, price and quantity. It requires Orchard-only Unified Addresses and refuses the built-in demo receiver. Editing a field invalidates the prepared request and its review acknowledgement. The `zcash:` link activates only after explicit address/network/amount review. The application does not connect to a wallet, submit a transaction, or claim payment confirmation.

ZIP-321 Base64url **does not encrypt** the URI. A generated URI includes the full bid, salt and refund address. Only a trusted Orchard-capable wallet should receive it; the wallet performs real note/memo encryption. Zodl handling must be verified on the target device before production use.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# All three checks, once Chromium is installed:
npm run verify
```

If Chromium is already installed elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to that executable when running Playwright. The browser suite writes desktop/mobile previews into ignored `test-results/`.

See [the engineering report](docs/engineering-report.md) for the full file inventory, privacy model, protocol details, verification results, fixture provenance and production boundaries. The original [DARKZEC-STANDARD](DARKZEC-STANDARD.md) is unchanged.
