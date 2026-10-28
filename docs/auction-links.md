# Auction links: running a real auction

DarkZec turns a sealed-bid auction into something a seller can run and a buyer can join without installing anything. The seller shares a link; bidders open it on the public site, read the rules, pay with their own shielded wallet and later check what happened to their bid.

## What each person does

| Who | Where | What |
| --- | --- | --- |
| **Seller / operator** | A local DarkZec server (`npm run dev`) with a zcash-devtool wallet | Describes the auction, starts it, shares the link, syncs from the vault, closes, clears, settles |
| **Bidder** | darkzec.xyz, any browser | Opens the link, prepares a bid, pays the collateral by QR, reveals, checks the result |
| **Anyone** | darkzec.xyz or `npm run verify-chain` | Audits the finished auction, including every payment on chain |

## The seller flow

1. Create a fresh account in the operator wallet for this auction (its viewing key will be published at the end, so never reuse it).
2. In the sandbox tab open **Run this auction against a real Zcash testnet vault** and fill in the title, a short description, the vault address, the clearing mode, the lots, the reserve (or ceiling), the collateral tier, how long bidding stays open and how long the reveal window lasts.
3. **Start live testnet auction.** The page reads the wallet's block height, turns the durations into **block heights**, signs the listing with this session's key and shows the **auction link**.
4. Share the link. Keep this tab open: the signing key exists only in this browser session and is never stored.
5. After the commit deadline block, **Sync from vault**, then **Close auction**. Sync again during the reveal window, and once the reveal deadline block has passed, sync one last time and **Finalize & clear**.
6. Publish the audit bundle and settle (`npm run settle`, see [settlement](settlement.md)).

## The bidder flow

1. Open the link. The page verifies the operator's signature and shows the title, description, the rules in plain words, the vault address, the deadlines and a countdown.
2. **Bid on this auction** opens the wallet tab already filled in and locked to the listing: vault, auction ID, collateral and, for unit-demand auctions, one lot. Enter a price and a refund address.
3. Download the receipt (it is the only way to reveal), tick the review box, and scan the QR code with a shielded Orchard-capable wallet to pay the collateral.
4. After the commit deadline, load the receipt under **Reveal on chain** and pay the small reveal memo before the reveal deadline.
5. When the operator publishes the bundle, import it on the same page (**Check your result**) with your receipt to see whether you won, what you paid and what was refunded.

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

## Limits, honestly

- Testnet only. Mainnet stays disabled until custody is threshold-signed and the build is reviewed.
- The operator's session key lives in one browser tab. Closing it before the audit bundle is exported ends the auction; there is no recovery. A shared, persistent operator service is future work.
- The listing proves the operator signed these rules, not that the item exists or will be delivered.
- Bidders on the public site cannot run the on-chain audit checks themselves (no light client there); they see them as skipped, or checked against a recorded snapshot for the shipped runs. `npm run verify-chain` runs them live.
