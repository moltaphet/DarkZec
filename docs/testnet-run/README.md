# DZ-TESTNET-1: a full DarkZec auction on Zcash testnet

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
