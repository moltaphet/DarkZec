import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateOrchardAddress } from '../src/protocol/address';
import { canonicalPreimage, commitment } from '../src/protocol/crypto';
import type { BidPreimage } from '../src/protocol/crypto';
import { buildPaymentUri, commitSubmission, prepareBid } from '../src/protocol/memo';
import { Sandbox } from '../src/simulation';
import { REFUND_RECEIVER, TEST_REFUND, TEST_VAULT, VAULT_RECEIVER, WALLET_REFUND, walletAddress } from './fixtures';

const request = { auctionId: 'SECURITY-001', price: '1', quantity: 2, refund: TEST_REFUND, vault: TEST_VAULT, network: 'testnet' as const };
const config = { auctionId: request.auctionId, supply: 2, reserve: '0.5', vault: TEST_VAULT, network: 'testnet' as const };

describe('Phase 1 protocol security boundaries', () => {
  it('accepts wallet UAs containing Sapling/Orchard and strips fallback receivers from payment instructions', async () => {
    for (const transparent of [false, true]) {
      const vault = walletAddress(VAULT_RECEIVER, transparent); const refund = walletAddress(REFUND_RECEIVER, transparent);
      expect(validateOrchardAddress(vault, 'testnet')).toBe(vault);
      const prepared = await prepareBid({ ...request, vault, refund });
      expect(prepared.uri.startsWith(`zcash:${TEST_VAULT}?`)).toBe(true);
      expect(prepared.reveal.refund).toBe(TEST_REFUND);
      expect(buildPaymentUri({ address: vault, amount: '1', memo: '{}', network: 'testnet' }).startsWith(`zcash:${TEST_VAULT}?`)).toBe(true);
    }
  });
  it('binds canonical colon-delimited bid fields and refund instructions in the commitment', async () => {
    const bid = { ...request, salt: 'a'.repeat(64) };
    const preimage = `${bid.price}:${bid.quantity}:${bid.salt}:${bid.refund}`;
    expect(canonicalPreimage(bid)).toBe(preimage);
    expect(await commitment(bid)).toBe(createHash('sha256').update(preimage).digest('hex'));
    expect(await commitment({ ...bid, refund: TEST_VAULT })).not.toBe(await commitment(bid));
    // Hash omits auction scope by specification; the ledger checks the receipt auction.
    expect(await commitment({ ...bid, auctionId: 'OTHER' })).toBe(await commitment(bid));
    expect(await commitment({ ...bid, price: '1', quantity: 23 })).not.toBe(await commitment({ ...bid, price: '12', quantity: 3 }));
  });
  it('rejects refund-to-vault including equivalent Orchard receivers in different UAs', async () => {
    for (const refund of [TEST_VAULT, walletAddress(VAULT_RECEIVER), walletAddress(VAULT_RECEIVER, true)]) {
      await expect(prepareBid({ ...request, refund })).rejects.toThrow('Security error: refund');
    }
    await expect(prepareBid({ ...request, vault: walletAddress(REFUND_RECEIVER) })).rejects.toThrow('Security error: refund');
  });
  it('rejects coerced commitment fields instead of hashing a noncanonical runtime tuple', () => {
    const bid = { ...request, salt: 'a'.repeat(64) };
    for (const changes of [{ quantity: '2' }, { quantity: 2n }, { auctionId: 123 }, { price: 1 }, { salt: ['a'.repeat(64)] }]) {
      const malformed = { ...bid, ...changes } as unknown as BidPreimage;
      expect(() => canonicalPreimage(malformed)).toThrow();
    }
  });
  it('rejects self-refund and refund substitution at reveal without accepting a preimage during commit', async () => {
    const sandbox = await Sandbox.create(config); const prepared = await prepareBid(request);
    await sandbox.submit(commitSubmission(prepared)); sandbox.close();
    for (const refund of [TEST_VAULT, WALLET_REFUND]) await expect(sandbox.reveal({ ...prepared.reveal, refund })).rejects.toThrow();
    expect(sandbox.publicSnapshot().revealed).toHaveLength(0);
  });
  it('snapshots mutable preparation input before asynchronous salt/hash work', async () => {
    const mutable = { ...request }; const pending = prepareBid(mutable);
    mutable.refund = TEST_VAULT; mutable.price = '99'; mutable.quantity = 99; mutable.auctionId = 'MUTATED';
    const prepared = await pending;
    expect(prepared.reveal).toMatchObject({ refund: TEST_REFUND, price: '1', quantity: 2, auctionId: request.auctionId });
    expect(prepared.amount).toBe('10');
  });
  it('prices exact eligible demand and solitary oversubscription at reserve', async () => {
    for (const quantity of [1, 2, 9]) {
      const sandbox = await Sandbox.create(config);
      const bid = await prepareBid({ ...request, quantity }); await sandbox.submit(commitSubmission(bid));
      sandbox.close(); await sandbox.reveal(bid.reveal); const result = await sandbox.clear();
      expect(result.clearingPrice).toBe('0.5'); expect(result.filled).toBe(Math.min(quantity, config.supply));
    }
    const sandbox = await Sandbox.create(config);
    const bids = await Promise.all(['1', '0.8'].map(price => prepareBid({ ...request, price, quantity: 1 })));
    for (const bid of bids) await sandbox.submit(commitSubmission(bid));
    sandbox.close(); for (const bid of bids) await sandbox.reveal(bid.reveal); expect((await sandbox.clear()).clearingPrice).toBe('0.5');
  });
  it('uses competing unfilled demand for a single-lot second-price result', async () => {
    const sandbox = await Sandbox.create({ ...config, supply: 1 });
    const bids = await Promise.all(['0.9', '0.75', '0.6'].map(price => prepareBid({ ...request, price, quantity: 1 })));
    for (const bid of bids) await sandbox.submit(commitSubmission(bid));
    sandbox.close(); for (const bid of bids) await sandbox.reveal(bid.reveal); const result = await sandbox.clear();
    expect(result.clearingPrice).toBe('0.75'); expect(result.allocations[0]?.paid).toBe('0.75');
  });
  it('uses accepted submission order rather than the bidder-selected hash for tied priority', async () => {
    const sandbox = await Sandbox.create({ ...config, supply: 3 });
    const prepared = await Promise.all([prepareBid(request), prepareBid(request)]);
    prepared.sort((a, b) => a.commitment > b.commitment ? -1 : 1);
    const first = prepared[0]; const second = prepared[1]; if (!first || !second) throw new Error('Missing bids');
    await sandbox.submit(commitSubmission(first)); await sandbox.submit(commitSubmission(second)); sandbox.close();
    await sandbox.reveal(second.reveal); await sandbox.reveal(first.reveal);
    const result = await sandbox.clear();
    expect(result.allocations.find(row => row.commitment === first.commitment)?.filled).toBe(2);
    expect(result.allocations.find(row => row.commitment === second.commitment)?.filled).toBe(1);
  });
});
