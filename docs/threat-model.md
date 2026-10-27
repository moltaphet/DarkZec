# DarkZec threat model

Scope: the commit/reveal sealed-bid auction implemented in this repository, with the Zcash/Orchard settlement path it is designed for. This page separates what the **prototype enforces today**, what the **design intends in production**, and what is **explicitly not solved**. It is not an audit.

## Roles

| Role | Description |
| --- | --- |
| **Bidder** | Prepares a bid locally, pays fixed collateral to the vault with a commit memo, later reveals the private receipt. |
| **Vault operator** | Controls the vault Orchard address and its incoming viewing key, holds collateral, runs clearing and publishes the result and root. In the prototype this role lives in the same browser as the bidders. |
| **Public observer** | Anyone reading the Zcash chain or the published result. |
| **Other bidders** | Competing participants. |
| **Wallet / device** | The wallet that builds the shielded transaction, and the machine the browser runs on. |

## Who sees what

| Moment | Bidder | Vault operator | Public observer | Other bidders |
| --- | --- | --- | --- | --- |
| **Commit** (memo `{v:2,t:"commit",a,c}`, fixed 10 ZEC) | Own bid and receipt | Auction ID and commitment hash. **No price, quantity, salt or refund address.** The amount is the same for every bid, so it leaks nothing about the bid. | Shielded transaction only; timing and pool crossing remain visible. | Nothing |
| **Close** (root frozen) | Can verify own commitment is in the root | Full commitment list | Root, if published | Root, if published |
| **Reveal** (receipt `{a,p,q,s,r}`) | Own receipt | **Price, quantity, salt and refund address of every reveal.** | Nothing in the prototype; in production the reveal is a second shielded memo | Nothing |
| **Clear** | Own allocation | All revealed bids and the allocation | Clearing price, lots filled, root, forfeited total | Clearing price and own result |

The key property is the first row: during the commit phase the operator cannot read bids, because the memo carries only a salted hash. That removes front-running of **resting** orders. It does **not** hide bids from the operator after reveal (see limits).

## Why not a normal auction server?

| Property | Plain auction server | DarkZec design |
| --- | --- | --- |
| Operator can read bids while they are submitted | Yes | **No**, hash only until reveal |
| Link between bidder and bid on a public ledger | Account or IP, often public payment rails | Shielded payment to an Orchard receiver (Ironwood pool) with fixed amount and no bid data |
| Participant can prove they were included | No | **Yes**, SHA-256 Merkle proof against a root frozen at close |
| Cost of withholding a losing or unfavorable bid | None | **Full collateral is forfeited** if the reveal never verifies |
| Bid substitution after seeing others | Possible | **Prevented**, the commitment binds price, quantity, salt, refund and auction |
| Operator must be trusted to not leak revealed bids | Yes | **Still yes** (this is the main open trust assumption) |

DarkZec does not claim to remove the operator. It narrows what the operator can do and makes parts of its behavior checkable.

## Attacks and responses

| Attack | Status | Response |
| --- | --- | --- |
| Operator reads bids to front-run during the commit phase | Mitigated | Commit memos carry only a hash; the scanner never parses a bid preimage. |
| Bidder changes price, quantity, salt or refund after committing | Prevented | Reveal must recompute to a recorded commitment; tests cover each substitution. |
| Attacker copies a victim's commitment hash | Prevented | Duplicate commitments are refused and the copier cannot produce the preimage. |
| Reveal on another auction | Prevented | The commitment is `["DARKZEC/bid/v2", auction_id, ...]`, so it is auction-bound. |
| Free option / griefing by never revealing | **Mitigated by forfeiture** | Unrevealed commitments forfeit the whole collateral, which is burned; they still appear in the frozen root. Not enforced on-chain in the prototype. |
| Operator ignores honest reveals to keep their collateral | **Incentive removed, censorship provable** | Forfeited collateral is burned, never credited to the operator, so rejecting a valid reveal earns it nothing. Every accepted reveal gets a signed acknowledgement; a published result that omits an acknowledged bid fails the audit-mode acknowledgement check. A reveal the operator never acknowledges is still deniable unless it was sent as an on-chain reveal memo the bidder can point to. |
| Operator places shill bids and withholds their reveal after seeing others | **Made costly** | A withheld shill reveal burns the operator's own collateral instead of returning it to the operator's vault. The operator still sees revealed bids before clearing. |
| Bidder inflates the price with lots it cannot win | Not solved in multi-lot mode; **prevented in unit-demand mode** | A partially filled marginal bid sets the uniform price, so extra requested quantity can raise what every winner pays (`0.8 x 1` vs `0.8 x 2` in the README example). Unit-demand auctions accept one lot per bid and charge the truthful (k+1)-th price (Vickrey for one lot). |
| Refund redirected to the vault | Prevented | Refund and vault must resolve to different Orchard receivers, even across different UA strings. |
| Transparent fallback leaks the payer | Mitigated | Every instruction is projected to an Orchard-only UA; bare transparent addresses are refused. |
| Operator drops a commitment | **Partly mitigated** | The operator signs the frozen root and commitment count at close, and a bidder can prove inclusion against it. In a live auction a dropped commitment is also an on-chain commit payment the bidder can point to. Without an external timestamp the close statement itself is not anchored. |
| Operator clears incorrectly | **Detectable** | The audit bundle publishes the reveal set; audit mode re-runs the deterministic clearing and checks the signed result digest, so an incorrect or edited result fails. There is still no zero-knowledge proof, and publishing reveals discloses bids. |
| Salt grinding or ordering games | Limited | Ties follow accepted commit order, never the hash. In a live auction commits are imported oldest first by confirmations, so order follows the chain; within one block it falls back to transaction ID. This is not Sybil resistance. |
| Wallet or browser compromise | Out of scope | A compromised device can read receipts. Secrets cannot be reliably zeroized in JavaScript. |
| Viewing-key leak | Out of scope | A viewing key shows incoming notes, so a leak exposes commit memos and, after reveal, revealed bids. It does not grant spending. |
| Timing, amount and network metadata | Not solved | Shielding does not hide submission timing or network-level correlation. |
| Lost receipt | By design costly | The receipt is the only way to reveal, and the operator cannot recover it; the UI offers a download and warns before closing. |

## Trust assumptions in this build

The vault operator is trusted to: not leak revealed bids, run the announced clearing rule, publish the true root, return refunds, accept every valid reveal and burn forfeited collateral honestly. The sandbox hosts bidder and operator in one browser, so it demonstrates the rules and data flow, not the separation.

## Roadmap to reduce operator trust

1. ~~Deliver reveals as a second shielded memo to the vault~~ **Done:** the Wallet request tab builds a reveal payment and the live auction imports reveal memos.
2. Encrypt reveals to a **threshold key**, or run the operator in a **TEE** with attestation, so no single party reads bids before clearing.
3. **Anchor the root** at close in an external timestamped record, so omission becomes provable.
4. ~~Publish the full reveal set after clearing so anyone can re-run the clearing~~ **Done** as the audit bundle and audit mode. Proving clearing in zero knowledge without publishing bids remains open.
5. Real Orchard scanning through an audited adapter in place of the mock vault, and on-chain handling of refunds and the forfeiture burn.
6. ~~Signed reveal acknowledgements~~ **Done:** close, every accepted reveal and the result are signed. Next: publish the operator key before the auction opens and anchor the close statement externally.
7. Replace the zcashd RPC adapter with Zallet or Zebra-based scanning, since zcashd reached end of support.

## What the prototype demonstrates

Real: ZIP-316 address validation with Orchard-only projection, ZIP-302 byte audit, ZIP-321 URIs, commit/reveal rules, uniform-price clearing, integer-zatoshi accounting with a visible balance check, forfeiture, a frozen Merkle root with proofs, and a round-trip check of a memo copied from a real wallet. Mock: the viewing-key vault and its notes, and every transaction path from the sandbox to a chain.
