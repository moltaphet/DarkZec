import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import { AuctionSession } from '../src/lib/auction-session';
import { parseAuditBundle, serializeAuditBundle, verifyAuditBundle, withSettlement } from '../src/lib/audit-bundle';
import { burnAddress, refundMemo, proceedsMemo, settlementPayouts, settlementUri, verifyChainDeposits, verifyChainPayouts } from '../src/lib/settlement';
import type { ChainActivity, ChainOutput } from '../src/lib/settlement';
import { parseZec } from '../src/protocol/amount';
import { commitSubmission, prepareBid, serializeCommitMemo } from '../src/protocol/memo';
import { receiptText } from '../src/lib/receipt-file';
import { TEST_REFUND, TEST_VAULT, walletAddress, WALLET_REFUND_RECEIVER } from './fixtures';

const SELLER = walletAddress(WALLET_REFUND_RECEIVER);
const config = { auctionId: 'SETTLE-1', supply: 1, reserve: '0.01', vault: TEST_VAULT, network: 'testnet' as const, collateral: '0.1', revealWindowMs: 1000, unitDemand: true };
const output = (amountZat: number, address: string | null, memo: string | null, txid = 'a'.repeat(64)): ChainOutput => ({ txid, height: 100, amountZat, address, memo });

/** Three bids: the 0.08 bid wins at the 0.05 second price, the 0.05 bid is refunded in full, the third never reveals. */
async function settledAuction() {
  let now = 1_000; const session = await AuctionSession.create(config, () => now);
  const bids = await Promise.all(['0.08', '0.05', '0.07'].map(price => prepareBid({ auctionId: config.auctionId, price, quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '0.1' })));
  for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
  await session.close(); now += 10;
  for (const bid of bids.slice(0, 2)) await session.reveal(bid.reveal);
  now += 2_000; await session.clear();
  const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
  const payouts = settlementPayouts({ auctionId: config.auctionId, network: 'testnet', forfeitedCollateral: bundle.result.forfeitedCollateral, allocations: bundle.result.allocations }, SELLER);
  const activity: ChainActivity = {
    tip: 200,
    received: [...bundle.commitments.map(hash => output(10_000_000, TEST_VAULT, serializeCommitMemo(config.auctionId, hash))), ...bids.slice(0, 2).map(bid => output(10_000, TEST_VAULT, receiptText(bid.reveal, 'testnet')))],
    sent: payouts.map(payout => output(Number(parseZec(payout.amount)), payout.address, payout.memo)),
  };
  const settled = withSettlement(bundle, { viewingKey: `uviewtest1${'q'.repeat(300)}`, birthday: 4_550_000, seller: SELLER, txids: ['b'.repeat(64)] });
  return { bundle, settled, payouts, activity };
}

describe('burn address', () => {
  it('is P2SH of a lone OP_RETURN, recomputed independently', () => {
    const hash = createHash('ripemd160').update(createHash('sha256').update(Buffer.of(0x6a)).digest()).digest();
    for (const [network, prefix] of [['testnet', [0x1c, 0xba]], ['mainnet', [0x1c, 0xbd]]] as const) {
      const payload = Buffer.concat([Buffer.from(prefix), hash]);
      const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
      expect(burnAddress(network)).toBe(base58.encode(Buffer.concat([payload, checksum])));
    }
    expect(burnAddress('testnet')).toBe('t2CYfLDri6rrH4WSuXtHiu1WMWus6kFY2Ea');
  });
});

describe('settlement payouts', () => {
  it('refund every bidder, pay the seller and burn every forfeit, to the zatoshi', async () => {
    const { bundle, payouts } = await settledAuction();
    expect(payouts.map(payout => [payout.kind, payout.amount])).toEqual([['refund', '0.05'], ['refund', '0.1'], ['proceeds', '0.05'], ['burn', '0.1']]);
    const total = payouts.reduce((sum, payout) => sum + parseZec(payout.amount), 0n);
    expect(total).toBe(parseZec(bundle.result.postedCollateral));
    expect(payouts[0]?.memo).toBe(refundMemo('SETTLE-1', payouts[0]?.commitment ?? '')); expect(payouts[2]?.memo).toBe(proceedsMemo('SETTLE-1'));
    expect(payouts[3]).toMatchObject({ address: burnAddress('testnet'), memo: null });
  });
  it('become one multi-payment ZIP-321 request with memos only on shielded outputs', async () => {
    const { payouts } = await settledAuction();
    const uri = settlementUri(payouts); const query = new URLSearchParams(uri.slice(uri.indexOf('?') + 1));
    expect(uri.startsWith(`zcash:${payouts[0]?.address}?`)).toBe(true);
    expect([query.get('amount'), query.get('amount.1'), query.get('amount.2'), query.get('amount.3')]).toEqual(['0.05', '0.1', '0.05', '0.1']);
    expect(query.get('address.3')).toBe(burnAddress('testnet')); expect(query.has('memo.3')).toBe(false);
    expect(Buffer.from(query.get('memo.2') ?? '', 'base64url').toString('utf8')).toBe(proceedsMemo('SETTLE-1'));
    expect(() => settlementUri([])).toThrow('Nothing to settle');
  });
});

describe('on-chain checks', () => {
  it('pass when every deposit arrived and every payout left exactly once', async () => {
    const { settled, activity } = await settledAuction();
    const report = await verifyAuditBundle(serializeAuditBundle(settled), activity);
    expect(report.checks.map(check => [check.id, check.ok])).toEqual([['rules', true], ['root', true], ['reveals', true], ['clearing', true], ['conservation', true],
      ['close', true], ['acks', true], ['result', true], ['chain-deposits', true], ['chain-payouts', true]]);
  });
  it('are reported as skipped, never passed, without a light client', async () => {
    const { settled } = await settledAuction();
    const report = await verifyAuditBundle(serializeAuditBundle(settled));
    expect(report.ok).toBe(true);
    expect(report.checks.filter(check => check.skipped).map(check => [check.id, check.ok])).toEqual([['chain-deposits', false], ['chain-payouts', false]]);
  });
  it('catch a missing deposit, a short refund, a diverted payment and a foreign viewing key', async () => {
    const { settled, activity } = await settledAuction();
    const input = { auctionId: 'SETTLE-1', network: 'testnet' as const, vault: TEST_VAULT, collateral: '0.1', commitments: settled.commitments, reveals: settled.reveals };
    expect((await verifyChainDeposits(input, { ...activity, received: activity.received.slice(1) })).detail).toContain('entry 1 has 0 commit payments');
    expect((await verifyChainDeposits(input, { ...activity, received: activity.received.filter(note => note.amountZat !== 10_000) })).detail).toContain('2 reveals were not received');
    expect((await verifyChainDeposits(input, { ...activity, received: [] })).detail).toContain('not the vault');
    const payoutInput = { auctionId: 'SETTLE-1', network: 'testnet' as const, forfeitedCollateral: settled.result.forfeitedCollateral, allocations: settled.result.allocations, settlement: settled.settlement ?? { viewingKey: '', birthday: 0, seller: SELLER, txids: [] } };
    const short = activity.sent.map((item, index) => index === 0 ? { ...item, amountZat: item.amountZat - 1 } : item);
    expect(verifyChainPayouts(payoutInput, { ...activity, sent: short }).detail).toContain('refund for');
    expect(verifyChainPayouts(payoutInput, { ...activity, sent: [...activity.sent, output(1, SELLER, null)] }).detail).toContain('1 other payment left the vault');
    expect(verifyChainPayouts(payoutInput, { ...activity, sent: activity.sent.filter(item => item.address !== burnAddress('testnet')) }).detail).toContain('burn of 0.1 ZEC was not paid');
    expect(verifyChainPayouts(payoutInput, activity).ok).toBe(true);
  });
  it('round-trip the settlement record and reject a malformed one', async () => {
    const { settled } = await settledAuction();
    const text = serializeAuditBundle(settled);
    expect(parseAuditBundle(text).settlement).toEqual(settled.settlement);
    for (const change of [{ txids: ['nothex'] }, { birthday: 1.5 }, { extra: true }]) {
      const value = JSON.parse(text) as Record<string, any>; value.settlement = { ...value.settlement, ...change };
      expect((await verifyAuditBundle(JSON.stringify(value))).checks[0]?.id).toBe('schema');
    }
  });
});
