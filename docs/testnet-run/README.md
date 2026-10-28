# Real DarkZec auctions on Zcash testnet

Two complete auctions ran on the public Zcash testnet with real shielded payments and were settled on chain. Each is a shipped, re-verified test fixture (`public/testnet/`), and the site's Audit mode loads them with one click.

| Run | What it shows |
| --- | --- |
| [DZ-TESTNET-1](#dz-testnet-1-a-full-darkzec-auction-on-zcash-testnet) | Real commits and reveals, cleared at the Vickrey price, then **settled on chain** (two refunds and the proceeds) |
| [DZ-TESTNET-2](#dz-testnet-2-settlement-with-a-burned-forfeit) | The same, plus a bid that never revealed: its collateral **burned** to a provably unspendable address |

## DZ-TESTNET-1: a full DarkZec auction on Zcash testnet

On 27 October 2026 a complete sealed-bid auction ran end to end on the public Zcash testnet: two bids were committed as shielded payments, revealed as shielded memos, imported by the operator from the chain, cleared, and audited. Every step used the real chain through the `testnet.zec.rocks` light wallet server; nothing was simulated.

## Setup

| Item | Value |
| --- | --- |
| Auction | `DZ-TESTNET-1`, single-lot Vickrey (unit demand, 1 lot), reserve 0.01 TAZ, collateral tier 0.1 TAZ, 60-minute reveal window |
| Vault (Orchard-only projection) | `utest1ysqmec2u7n23ep887tsz2l3vetc0c8dhx2wvkjash26mcrlxsfrdgdh59rkyjtx6wkjrz3rutvk70gdrpds25nd9hcm3hrlef5vle6dc` |
| Wallets | Two throwaway testnet wallets created with [zcash-devtool](https://github.com/zcash/zcash-devtool): the operator's vault wallet and one bidder wallet that placed both bids |
| Operator server | `DARKZEC_DEVTOOL_WALLET=<vault wallet> PORT=4176 node scripts/serve.ts`, with the vault kept current by `zcash-devtool wallet -w <vault> sync` and `enhance` |
| Funding | 1 TAZ from the [fauzec.com](https://fauzec.com) faucet |

## Transactions

All payments to the vault's Orchard receiver settled in the Ironwood pool, as NU6.3 requires ([ZIP 318](https://zips.z.cash/zip-0318)).

| Step | Txid | Height | Value | Memo |
| --- | --- | --- | --- | --- |
| Faucet drip to bidder | `798c5ce641cbf648b0020d205545bb22310c8ae24d323c5ac3c7ca75c48cf18a` | 4,548,342 | 1 TAZ | faucet receipt |
| Commit A | `ecd6643703c15fa91b8389150f4c7ebf8ca9ba34a9a4c1aa63beeef9d1ac9973` | 4,548,356 | 0.1 TAZ | `{"v":2,"t":"commit","a":"DZ-TESTNET-1","c":"0e99e19b…f26d"}` |
| Commit B | `7901ed9ec116abe0f10a017653958b33a3a1da787440209cd3121ca02a193014` | 4,548,406 | 0.1 TAZ | `{"v":2,"t":"commit","a":"DZ-TESTNET-1","c":"c95e32c8…dcec"}` |
| Reveal A | `ffa5983155e304e03df12dcdea57bac52ebbaf41c806a939d707525540ce1422` | 4,548,409 | 0.0001 TAZ | receipt for the 0.08 bid |
| Reveal B | `887c7b54c76320162dec3172b8b38ccb42534cf8db9dcbae7732042cea063c69` | 4,548,414 | 0.0001 TAZ | receipt for the 0.05 bid |

A first attempt at commit B (`65fcc6c4…6fad`) was built but never reached the network because the light wallet server connection dropped; it expired unmined at height 4,548,399 and was replaced by the commit above, so no duplicate payment exists.

## Result

| Check | Outcome |
| --- | --- |
| Commit import | 2 confirmed commit payments imported, oldest first; the operator held hashes only |
| Close | Operator signed root `705c36cf0708d4b309a16fc3b0e8c2cf19dd2ec37696c680234bb17be32f8844` over 2 commitments |
| Reveal import | 2 reveal memos accepted, each with a signed acknowledgement |
| Clearing | The 0.08 bid won the lot and paid **0.05 TAZ**, the second price (Vickrey) |
| Accounting | payments 0.05 + refunds 0.15 + burned 0 = 0.2 TAZ posted |
| Audit | All 8 checks pass on [DZ-TESTNET-1-audit-bundle.json](DZ-TESTNET-1-audit-bundle.json); the test suite re-verifies this file on every run |

**Reproducibility.** The browser session was then discarded and a fresh operator session, given only the vault wallet, rebuilt the same root and the same result from the chain. The bundle in this folder comes from that rebuild, so its operator key and timestamps belong to the second session.

## What this run surfaced

- **Orchard receivers now settle in Ironwood.** Under NU6.3 a payment to an Orchard receiver lands in the Ironwood pool. The checker initially read only Orchard-pool notes and missed the first commit; it now reads both pools and still refuses Sapling and transparent notes.
- **Light-client memos need `enhance`.** Compact-block sync records notes without memos; `zcash-devtool wallet enhance` downloads the full transactions that carry them.
- **Public explorer lag.** At the time of the run `testnet.zcashexplorer.app` reported a chain at height 4,495,654 while the light wallet servers were at 4,548,414, so it could not show these transactions. They can be checked against any NU7-aware testnet node or light wallet server.
- **Spending policy.** zcash-devtool waits for 10 confirmations on received notes and 3 on its own change by default; the run kept those defaults.

### Settlement on chain

After the audit passed, the operator settled this auction in one transaction from the vault wallet: `96e8acf6…0a60` (block 4,550,426) paid the two refunds (0.05 and 0.1 TAZ, each with a `refund` memo naming the commitment) and the proceeds (0.05 TAZ to the seller, `proceeds` memo). The bundle now carries the vault account's viewing key, so anyone can run `npm run verify-chain -- public/testnet/DZ-TESTNET-1-audit-bundle.json` and see **10 of 10 checks pass**, the last two reading the deposits and payouts straight from the chain. Full txid: `96e8acf603418f2a9fc9e4177e5526aeb75cc69d334437ce47bc35d089b50a60`.

## DZ-TESTNET-2: settlement with a burned forfeit

Three bidders committed 0.1 TAZ each into a dedicated vault account; two revealed (0.08 and 0.05), the third (0.07) never did. The operator drove the real terminal against a live vault: sync, close, reveal import, clear. Result: the 0.08 bid won the single lot at the second price, **0.05 TAZ**; the 0.05 bid was refunded in full; the unrevealed 0.07 bid's 0.1 TAZ was forfeited.

| Step | Txid | Block | Value |
| --- | --- | --- | --- |
| Commit A (0.08 bid) | `93bbda52b9c57a5e899a1cc22ae87a32b6acad7875eadcf3d8b7c826b91f3d9a` | 4,550,438 | 0.1 TAZ |
| Commit B (0.05 bid) | `69fb5c02dae93d198d8cb9127d93a87e420c0f5444de111aad43f7e01a4b233d` | 4,550,438 | 0.1 TAZ |
| Commit C (0.07 bid, never revealed) | `69bc71ca0fe0985da88655f96414d1d778ac5a8fe4ca3e6f6a8b12f892e6ac08` | 4,550,439 | 0.1 TAZ |
| Reveal A | `750217f36388af4fc1a21823df4778770b77e23de62e0160da0407d5cd4203be` | 4,550,446 | 0.0001 TAZ |
| Reveal B | `d0251e2c82ab77c707de878aca47cbc0d9f796c3ad2f77a620b0fcb0886cbb9b` | 4,550,446 | 0.0001 TAZ |
| Fee top-up (operator, `fee` memo) | `a8c274a7ea857cebbf3dafdbc901e2f8df52f5d46f282f8b481a1f0228763c92` | 4,550,494 | 0.0005 TAZ |
| **Settlement** | `34a2b4879a76b7f6a02d1271f485605d6b91d8861d26a4b18b29ccf5aed7069f` | 4,550,523 | 0.3 TAZ out |

The settlement paid four outputs in one transaction: refund 0.05 and refund 0.1 (shielded, with memos), proceeds 0.05 (shielded) and **0.1 to `t2CYfLDri6rrH4WSuXtHiu1WMWus6kFY2Ea`**, the P2SH address of the one-byte script `OP_RETURN`, which no one can ever spend. The two reveals paid only 0.0002 TAZ, not enough for the larger transaction's fee, so the operator topped the vault up with a tagged payment; the verifier ignores it because it is neither a commit nor a reveal. All 10 audit checks pass on chain; `tests/audit-bundle.test.ts` re-verifies the bundle and its recorded snapshot on every run, and checks that diverting the burn to another address fails the audit.

## A lesson from an attempted third run: testnet inclusion is slow

An attempt to run a third auction entirely through an auction link (6-minute commit window, 14 blocks) was abandoned: the three commit payments were broadcast at once but mined only after the signed commit deadline. The operator's sync did exactly what the rules require, **refusing all three as late** ("0 new, 3 refused"), and the auction could not proceed. This is the schedule working, not a bug, but it shows what a seller must plan for: on this testnet a payment can take many blocks to confirm, so give bidders **at least 15–30 minutes** (the panel defaults to 30). The block-height flow is covered end to end by `tests/e2e/listing.spec.ts` with a mocked chain, and the real chain is covered by the two runs above; a real link-driven run with generous windows is the next demonstration to record.

