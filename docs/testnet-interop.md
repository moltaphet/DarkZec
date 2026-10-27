# Testnet round trip with a real wallet

This checks that the payment request DarkZec builds really survives a trip through a shielded transaction: the commit memo you send is the memo the vault wallet receives. It needs no keys in DarkZec. DarkZec never asks for, stores or sees a seed phrase or spending key; those stay in your wallets.

**Use testnet only.** Do not use mainnet funds for this check.

## What you need

- Two **testnet** wallets that support Orchard Unified Addresses and shielded memos: one acts as the **vault**, one as the **bidder**. Any wallet or tool with testnet support works. Whether a particular wallet app (including Zodl) offers testnet and URI handling depends on its current build, so confirm in the wallet itself.
- A small amount of testnet ZEC in the bidder wallet, from a testnet faucet, at least the collateral (`10 ZEC` in the sandbox configuration) plus fee. If you cannot get that much, use the Wallet request form to set the auction price and quantity, but note the collateral amount is fixed at 10 ZEC in this build.
- Two **different** Orchard-capable testnet Unified Addresses (`utest1…`): the vault's receiving address and the bidder's refund address.

## Steps

1. Run DarkZec (`npm run dev`), open **Wallet request**, keep **Testnet** and the auction ID `NODE07-001`.
2. Paste the vault address and your refund address. Enter a limit price and quantity. DarkZec refuses its public demo fixtures, identical refund and vault receivers, transparent addresses and non-Orchard UAs.
3. Choose **Prepare private payment request**. Check the memo audit (`N / 512 BYTES`).
4. **Download the receipt (.json) now.** It holds your private price, quantity, salt and refund address, and it is needed to reveal later.
5. Tick the review box and choose **Open wallet**, or **Copy sensitive URI** into your wallet. Both stay locked until the receipt from step 4 is downloaded. In the wallet confirm the **network, the full vault address, the amount and the memo** before sending.
6. In the vault wallet, wait for the incoming shielded note and open its memo. Copy the memo text exactly as the wallet shows it. Unpadded Base64url and hex are also accepted.
7. Back in DarkZec, under **Verify the memo your wallet received**, paste it and choose **Verify received memo**.

Expected result:

```text
VALID COMMIT MEMO / auction NODE07-001 / hash xxxxxxxx…xxxxxxxx / 108 of 512 bytes / read as json.
MATCH / the memo your wallet received is exactly the commitment of your prepared request.
```

A `MISMATCH` means the memo that arrived differs from the request (another auction or another hash). `REJECTED` means it is not a canonical commit memo, for example a wallet that altered the text or a bid preimage pasted by mistake.

## Notes for the demo video

- Show the prepared request, the wallet confirmation screen with the memo, the incoming memo in the vault wallet, and the green `MATCH` line.
- A transaction identifier is not secret on its own, but do not show addresses, receipts or memo text you do not want public. Blur the refund address and never show the receipt file.
- Say plainly what is real (ZIP-316/302/321 data crossing a real shielded transaction) and what is still a sandbox (the clearing vault and mock viewing key).

## Run a full live auction on testnet

1. In **Auction sandbox**, open **Live testnet auction**, paste the vault address your local wallet views, choose the auction ID, collateral tier and clearing mode, then **Start live testnet auction**.
2. Each bidder prepares a request in **Wallet request** with the same auction ID and tier, downloads the receipt and pays it.
3. When the commits are confirmed, choose **Sync from vault**. Only confirmed Orchard notes with the exact tier and an exact commit memo enter the book, oldest first.
4. **Close auction**. Each bidder loads their receipt under **Reveal on chain** and pays the `0.0001` ZEC reveal request before the deadline.
5. **Sync from vault** again: each valid reveal is accepted and acknowledged with an operator signature. Then **Finalize & clear**.
6. In **Operator view**, download the audit bundle and verify it in **Audit mode**.

The adapter uses zcashd's `z_listreceivedbyaddress`. zcashd reached end of support in 2026; check the Zallet/Zebra RPC compatibility table before relying on this path.
