# Auction links: running a real auction

DarkZec turns a sealed-bid auction into something a seller can run and a buyer can join without installing anything. The seller shares a link; bidders open it on the public site, read the rules, pay with their own shielded wallet and later check what happened to their bid.

## What each person does

| Who | Where | What |
| --- | --- | --- |
| **Seller / operator** | A local DarkZec server (`npm run dev`) with a zcash-devtool wallet | Describes the auction, starts it, shares the link, syncs from the vault, closes, clears, settles |
| **Bidder** | darkzec.xyz, any browser | Opens the link, prepares a bid, pays the collateral by QR, reveals, checks the result |
| **Anyone** | darkzec.xyz or `npm run verify-chain` | Audits the finished auction, including every payment on chain |

## Quick start for an operator

```bash
npm run auction -- --wallet <wallet dir> --devtool <path to zcash-devtool>
```

It checks Node, zcash-devtool and the wallet (a testnet wallet that views the auction's vault account), builds if needed, keeps the wallet in sync in the background (`sync` and `enhance` every 20 seconds, retrying dropped connections), serves DarkZec and opens it. The page's **Sync from vault** button then always reads fresh notes.

**No wallet?** Open the same panel on darkzec.xyz and press **Practice with a simulated chain**: the full seller flow runs on an in-memory chain, the buttons play three bidders, and the audit at the end is the real one. The practice listing uses the public demo vault, so its bidder page opens with a PRACTICE banner and cannot be paid.

## Reading the chain safely

The page trusts what the local wallet reports, so the server is strict about it:

- **Freshness.** A wallet only knows its own height, so "synced" is judged by the age of its newest scanned block: older than 5 minutes (12 blocks, `DARKZEC_MAX_TIP_AGE_SECONDS`) means it is behind the network and the auction will not start or sync. A wallet a few blocks behind is allowed, and its lag is **added to the deadlines**, so they count from the chain's real height; the listing's anchor is the wallet's own block time.
- **Confirmations.** A payment counts only after 3 confirmations by default (`--confirmations`, `DARKZEC_MIN_CONFIRMATIONS`), because one block is not final on testnet. Closing and finalizing wait until the last payments before each deadline have that many confirmations.
- **Reorganisations.** Every sync re-checks that what was imported is still on the chain. If a payment disappears, the page warns, refuses to close or finalize, and points to **Resume**, which rebuilds the ledger from the chain as it is now.
- **No silent cuts.** Every note at the vault is read. More than 8192 notes, 512 commits or 1024 reveal-shaped memos is an explicit error ("use a fresh vault account"), never a quietly shortened list.

## The seller flow

1. Create a fresh account in the operator wallet for this auction (its viewing key will be published at the end, so never reuse it).
2. In the sandbox tab open **Run this auction against a real Zcash testnet vault** and fill in the title, a short description, the vault address, the clearing mode, the lots, the reserve (or ceiling), the collateral tier, how long bidding stays open and how long the reveal window lasts.
3. **Start live testnet auction.** The page reads the wallet's block height, turns the durations into **block heights**, signs the listing with this session's key and shows the **auction link**.
4. Share the link. **Keep the downloaded operator key file** (`darkzec-operator-key-<auction>.json`, encrypted with the passphrase you entered, at least 8 characters). The signing key itself exists only in this tab and is never stored in the browser.
5. After the commit deadline block, **Sync from vault**, then **Close auction**. Sync again during the reveal window, and once the reveal deadline block has passed, sync one last time and **Finalize & clear**.
6. Publish the audit bundle and settle (`npm run settle`, see [settlement](settlement.md)).

### If the tab is lost

A closed tab, a crash or a dropped connection does not end the auction, because everything it knew is on the chain. Open **Resume an auction** in the same panel, paste the auction link, choose the key file and enter the passphrase. The page restores the same signing key (the file is PBKDF2-SHA256, 600,000 rounds, AES-256-GCM, and bound to its public key), adopts the **original signed listing** from the link instead of re-signing it, and then **Sync, Close, sync reveals and Finalize** replay the commits and reveals from the chain. Close and reveal statements are signed again over the same deterministic content (the close statement's times are the schedule's block times), so the audit verifies exactly as if nothing had happened.

## The bidder flow

1. Open the link. The page verifies the operator's signature and shows the title, description, the rules in plain words, the vault address, the deadlines and a countdown.
2. **Bid on this auction** opens the wallet tab already filled in and locked to the listing: vault, auction ID, collateral and, for unit-demand auctions, one lot. Enter a price and a refund address.
3. Download the receipt (it is the only way to reveal), tick the review box, and scan the QR code with a shielded Orchard-capable wallet to pay the collateral.
4. After the commit deadline, load the receipt under **Reveal on chain** and pay the small reveal memo before the reveal deadline.
5. **Download calendar reminders (.ics)** on the listing page puts both deadlines in your calendar with alarms, because a bid that is not revealed loses its collateral. The times are estimates from the listing's anchor; the blocks decide.
6. When the operator publishes the bundle, import it on the same page (**Check your result**) with your receipt to see whether you won, what you paid and what was refunded.

## Why the deadlines are block heights

A clock can be argued with; a block height cannot. Each commit payment and reveal memo is mined at a specific height, visible to anyone holding the vault's viewing key. The operator signs the deadlines in the listing before taking any bid, and the audit then checks them on chain:

- every commit counted in the frozen root was mined at or before `commitUntil`;
- every **on-time commit payment at the vault is in the root**. A payment the operator left out is proven missing;
- every reveal counted was mined after `commitUntil` and at or before `revealUntil`;
- every **acceptable on-time reveal is in the result**. A reveal the ledger rightly refuses (wrong price class, wrong lots, refund equal to the vault) is not reported as censorship.

**Allow generous windows.** A payment is only counted if it is mined by the deadline, and on testnet inclusion can take many blocks (an attempted short run saw every commit arrive after a 14-block window and be refused, as designed). Give bidders at least 15–30 minutes to commit and the same to reveal.

Ledger time for a scheduled auction is chain time (height × 25 seconds), so the signed close and acknowledgement statements agree with the schedule exactly.

Countdowns on the listing page are estimates: a browser on the public site has no chain access, so it extends the tip from the height and time recorded in the listing. The listing says so, and the blocks decide.

## What travels in the link

The listing (title, description, rules, vault, deadlines), the operator's public key and its signature, all base64url-encoded in the URL **fragment**. Browsers never send the fragment to a server, so darkzec.xyz neither stores nor sees which auctions are opened. A link whose text, rules or signature were changed is refused. The link proves who signed the listing, not that the seller is honest: bidders should still compare the vault address with other channels the seller uses.

## Modes

| Mode | Winners | Price |
| --- | --- | --- |
| Uniform price | The highest bids, until the lots run out | All winners pay the highest losing bid, at least the reserve |
| Unit demand | One lot per bid | Same, truthful |
| Vickrey | One lot | The second-highest bid, at least the reserve |
| **Procurement** | The **lowest** offers (one unit each) | The next-lowest offer, at most the ceiling |

In procurement the collateral is a **bid bond**: it is returned in full to everyone who reveals, burned if a bid is never revealed, and nothing is collected from bidders. The buyer pays the winners outside the vault. Because a bond is not the payment, an offer is not capped by it. The use case is a buyer who wants quotes that competitors cannot copy from each other.

## Running the operator somewhere other than a laptop (next step)

Today the operator runs `npm run auction` on a machine that holds the zcash-devtool wallet. Moving that to a server is deliberately left as a next step, because it changes the trust model rather than just the packaging:

- **Self-hosted (the natural path):** a container (Node, zcash-devtool, the wallet volume) behind a TLS reverse proxy with authentication, reachable from any browser. Custody stays with the seller. It needs a remote mode in `scripts/serve.ts`: an allowed origin instead of loopback only, mandatory authentication, and the page probing the server for operator features instead of assuming loopback.
- **Hosted by DarkZec for other sellers:** not planned. A relay that reads a seller's vault with its viewing key would see every reveal before clearing, and a service holding spend keys would be custodial. Either adds exactly the kind of trusted party this project tries to remove. If it is ever built, it should be view-only, per-auction, and say so on the page.

## Limits, honestly

- Testnet only. Mainnet stays disabled until custody is threshold-signed and the build is reviewed.
- The operator's signing key lives only in one tab. The encrypted key file is the recovery path: lose both the tab and the file (or the passphrase) and the auction cannot be resumed or settled by DarkZec, though its commits and reveals stay on the chain.
- The listing proves the operator signed these rules, not that the item exists or will be delivered.
- Bidders on the public site cannot run the on-chain audit checks themselves (no light client there); they see them as skipped, or checked against a recorded snapshot for the shipped runs. `npm run verify-chain` runs them live.
