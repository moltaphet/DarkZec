import { describe, expect, it } from 'vitest';
import { base64urlnopad } from '@scure/base';
import { AuctionSession } from '../src/lib/auction-session';
import { serializeAuditBundle, verifyAuditBundle } from '../src/lib/audit-bundle';
import { encodeListingLink, isListingLink, openListingLink, parseListing } from '../src/lib/listing';
import type { Listing } from '../src/lib/listing';
import { receiptText } from '../src/lib/receipt-file';
import { BLOCK_MS, chainTime, closeTime, describeBlocks, estimateHeight, revealEndTime, validateSchedule } from '../src/lib/schedule';
import { settlementPayouts, verifyChainDeposits } from '../src/lib/settlement';
import type { ChainActivity, ChainOutput } from '../src/lib/settlement';
import { clearUniformAuction } from '../src/lib/darkpool';
import { parseZec } from '../src/protocol/amount';
import { utf8 } from '../src/protocol/crypto';
import { commitSubmission, prepareBid, serializeCommitMemo } from '../src/protocol/memo';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const schedule = { commitUntil: 4_551_000, revealUntil: 4_551_100 };
const listing = (overrides: Partial<Listing['auction']> = {}): Listing => ({
  v: 1, title: 'Two design review slots', description: 'Sealed bids, second price. Pay with a shielded wallet.',
  auction: { auctionId: 'LIST-1', network: 'testnet', vault: TEST_VAULT, supply: 1, reserve: '0.01', collateral: '0.1', unitDemand: true, procurement: false, ...overrides },
  schedule: { ...schedule, anchorHeight: 4_550_900, anchorTime: 1_793_200_000 },
});
const config = (extra = {}) => ({ auctionId: 'LIST-1', supply: 1, reserve: '0.01', vault: TEST_VAULT, network: 'testnet' as const, collateral: '0.1', unitDemand: true,
  revealWindowMs: (schedule.revealUntil - schedule.commitUntil) * BLOCK_MS, schedule, ...extra });
const output = (amountZat: number, memo: string | null, height: number, address: string | null = TEST_VAULT, txid = 'a'.repeat(64)): ChainOutput => ({ txid, height, amountZat, address, memo });
const prepare = (price: string, auctionId = 'LIST-1', collateral = '0.1', procurement = false) => prepareBid({ auctionId, price, quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral, procurement });

describe('block schedule', () => {
  it('validates deadlines and maps heights to chain time', () => {
    expect(validateSchedule(schedule)).toEqual(schedule);
    for (const bad of [{ commitUntil: 5, revealUntil: 9 }, { commitUntil: 4_551_000, revealUntil: 4_551_000 }, { commitUntil: 4_551_000.5, revealUntil: 4_552_000 }, { commitUntil: 4_551_000 }]) expect(() => validateSchedule(bad)).toThrow();
    expect(closeTime(schedule)).toBe(chainTime(4_551_001)); expect(revealEndTime(schedule)).toBe(chainTime(4_551_101));
  });
  it('estimates the tip from the listing anchor and words durations', () => {
    expect(estimateHeight({ height: 100_000_000 - 1000, time: 1000 }, 1000 * 1000 + 250_000)).toBe(100_000_000 - 1000 + 10);
    expect(describeBlocks(2)).toBe('50 seconds'); expect(describeBlocks(120)).toBe('50 minutes'); expect(describeBlocks(576)).toBe('4 hours');
  });
});

describe('signed listing links', () => {
  async function signed() {
    const session = await AuctionSession.create(config(), () => 0);
    return { session, signed: await session.publish(listing()) };
  }
  it('open back into the exact listing and verify the operator signature', async () => {
    const { signed: link } = await signed(); const hash = encodeListingLink(link);
    expect(isListingLink(hash)).toBe(true); expect(hash).not.toContain('+');
    const opened = await openListingLink(hash);
    expect(opened.listing).toEqual(link.listing); expect(opened.publicKey).toBe(link.publicKey);
  });
  it('refuse a link whose text, rules or signature were changed', async () => {
    const { signed: link } = await signed();
    const edit = (change: (value: Record<string, any>) => void): string => {
      const value = { l: structuredClone(link.listing), k: link.publicKey, s: link.signature } as Record<string, any>; change(value);
      return `#/a/${base64urlnopad.encode(utf8(JSON.stringify(value)))}`;
    };
    for (const hash of [edit(value => { value.l.title = 'Free money'; }), edit(value => { value.l.auction.vault = TEST_REFUND; }), edit(value => { value.l.schedule.revealUntil += 1; }),
      edit(value => { value.s = '0'.repeat(128); }), edit(value => { value.k = `04${'1'.repeat(128)}`; }), '#/a/', '#/a/not-base64!', `#/a/${'A'.repeat(9000)}`, '#/b/abc']) {
      await expect(openListingLink(hash)).rejects.toThrow('damaged or was not issued');
    }
  });
  it('are only signed for the rules of the session that issues them', async () => {
    const session = await AuctionSession.create(config(), () => 0);
    await expect(session.publish(listing({ reserve: '0.02' }))).rejects.toThrow('does not match');
    await expect(session.publish(listing({ auctionId: 'OTHER-1' }))).rejects.toThrow('does not match');
    await session.publish(listing()); await expect(session.publish(listing())).rejects.toThrow('once');
  });
  it('reject malformed listings', () => {
    const good = listing();
    for (const bad of [{ ...good, title: '' }, { ...good, title: 'x'.repeat(81) }, { ...good, title: 'two\nlines' }, { ...good, description: 'x'.repeat(601) }, { ...good, extra: 1 },
      { ...good, auction: { ...good.auction, collateral: '3' } }, { ...good, auction: { ...good.auction, network: 'mainnet' } }, { ...good, auction: { ...good.auction, procurement: true, unitDemand: false } },
      { ...good, auction: { ...good.auction, vault: 'utest1abc' } }, { ...good, schedule: { ...good.schedule, anchorHeight: 4_551_001 } }]) expect(() => parseListing(bad)).toThrow();
  });
});

describe('a scheduled auction audited from its listing', () => {
  async function run() {
    let now = chainTime(4_550_950);
    const session = await AuctionSession.create(config(), () => now);
    const link = await session.publish(listing());
    const bids = await Promise.all([prepare('0.08'), prepare('0.05'), prepare('0.07')]);
    for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
    now = closeTime(schedule); await session.close();
    const heights = [4_551_010, 4_551_020];
    for (const [index, bid] of bids.slice(0, 2).entries()) { now = chainTime(heights[index] ?? 0); await session.reveal(bid.reveal); }
    now = revealEndTime(schedule); await session.clear();
    const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
    return { session, link, bids, bundle };
  }
  const chain = (bundle: Awaited<ReturnType<typeof run>>['bundle'], bids: Awaited<ReturnType<typeof run>>['bids'], extra: ChainOutput[] = []): ChainActivity => ({ tip: 4_551_200, sent: [],
    received: [...bundle.commitments.map((hash, index) => output(10_000_000, serializeCommitMemo('LIST-1', hash), 4_550_960 + index)),
      ...bids.slice(0, 2).map((bid, index) => output(10_000, receiptText(bid.reveal, 'testnet'), 4_551_010 + index * 10)), ...extra] });
  const verify = async (text: string, settledActivity?: ChainActivity) => verifyAuditBundle(text, settledActivity);

  it('carries the signed listing and block deadlines through every off-chain check', async () => {
    const { bundle } = await run(); const report = await verify(serializeAuditBundle(bundle));
    expect(report.checks.map(check => [check.id, check.ok])).toEqual([['rules', true], ['root', true], ['reveals', true], ['clearing', true], ['conservation', true], ['close', true], ['acks', true], ['result', true], ['listing', true], ['schedule', true]]);
    expect(report.ok).toBe(true); expect(bundle.auction.schedule).toEqual(schedule);
  });
  it('fail when the audited rules differ from what the listing promised, or the close ignores the schedule', async () => {
    const { bundle } = await run(); const text = serializeAuditBundle(bundle);
    const edited = (change: (value: Record<string, any>) => void) => { const value = JSON.parse(text) as Record<string, any>; change(value); return JSON.stringify(value); };
    expect((await verify(edited(value => { value.listing.title = 'Changed after the fact'; }))).checks.find(check => check.id === 'listing')?.ok).toBe(false);
    expect((await verify(edited(value => { value.auction.reserve = '0.02'; }))).checks.find(check => check.id === 'listing')?.ok).toBe(false);
    expect((await verify(edited(value => { value.auction.schedule.commitUntil += 5; }))).checks.find(check => check.id === 'schedule')?.ok).toBe(false);
  });
  it('prove no on-time payment was dropped and every deadline was kept, on chain', async () => {
    const { bundle, bids } = await run();
    const input = { auctionId: 'LIST-1', network: 'testnet' as const, vault: TEST_VAULT, collateral: '0.1', commitments: bundle.commitments, reveals: bundle.reveals, unitDemand: true, schedule };
    expect((await verifyChainDeposits(input, chain(bundle, bids))).ok).toBe(true);
    // A commit mined before the deadline that the operator left out of the frozen root.
    const dropped = await prepareBid({ auctionId: 'LIST-1', price: '0.09', quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '0.1' });
    expect((await verifyChainDeposits(input, chain(bundle, bids, [output(10_000_000, serializeCommitMemo('LIST-1', dropped.commitment), 4_550_999)]))).detail).toContain('1 on-time commit payment is missing from the frozen root');
    // The same payment after the deadline is rightly ignored; a commit included but paid too late is flagged.
    expect((await verifyChainDeposits(input, chain(bundle, bids, [output(10_000_000, serializeCommitMemo('LIST-1', dropped.commitment), 4_551_001)]))).ok).toBe(true);
    const late = chain(bundle, bids).received.map(note => note.memo === serializeCommitMemo('LIST-1', bundle.commitments[0] ?? '') ? { ...note, height: 4_551_001 } : note);
    expect((await verifyChainDeposits(input, { ...chain(bundle, bids), received: late })).detail).toContain('after the commit deadline');
    // An acceptable on-time reveal that the result omits (bundle drops bid 2's reveal), and one mined outside the window.
    const omitted = { ...input, reveals: bundle.reveals.slice(0, 1) };
    expect((await verifyChainDeposits(omitted, chain(bundle, bids))).detail).toContain('1 acceptable on-time reveal is missing from the result');
    const outside = chain(bundle, bids).received.map(note => note.memo === bundle.reveals[0] ? { ...note, height: 4_551_101 } : note);
    expect((await verifyChainDeposits(input, { ...chain(bundle, bids), received: outside })).detail).toContain('outside the reveal window');
    // A reveal the ledger rightly refuses (wrong collateral class) is not reported as censorship.
    const refused = { auctionId: 'LIST-1', price: '0.5', quantity: 1, refund: TEST_REFUND, salt: 'f'.repeat(64) };
    expect((await verifyChainDeposits(input, chain(bundle, bids, [output(10_000, receiptText(refused, 'testnet'), 4_551_030)]))).ok).toBe(true);
    // The same reveal with a price the 0.1 collateral covers would have been acceptable, but it opens no recorded commitment either.
  });
});

describe('procurement (reverse) auctions', () => {
  const base = { auctionId: 'BUY-1', supply: 1, reserve: '1', vault: TEST_VAULT, network: 'testnet' as const, collateral: '0.1', unitDemand: true, procurement: true };
  const offer = async (price: string, id = 'BUY-1') => { const bid = await prepare(price, id, '0.1', true); return { commitment: bid.commitment, bid: bid.reveal, collateral: '0.1' }; };
  it('award the lowest offers at the next-lowest price and return every bond whole', async () => {
    const result = clearUniformAuction(base, [await offer('0.9'), await offer('0.6'), await offer('0.75')]);
    expect(result.clearingPrice).toBe('0.75'); expect(result.allocations.map(row => [row.price, row.filled, row.paid, row.refundAmount])).toEqual([['0.6', 1, '0', '0.1'], ['0.75', 0, '0', '0.1'], ['0.9', 0, '0', '0.1']]);
  });
  it('pay the ceiling when demand does not exceed supply, and refuse offers above it', async () => {
    expect(clearUniformAuction({ ...base, supply: 2 }, [await offer('0.9'), await offer('0.6')]).clearingPrice).toBe('1');
    const above = clearUniformAuction(base, [await offer('1.5')]); expect(above.filled).toBe(0); expect(above.allocations[0]?.filled).toBe(0);
    expect(() => clearUniformAuction({ ...base, unitDemand: false }, [])).toThrow('always unit demand');
  });
  it('run end to end and audit with conservation and an on-chain settlement of bonds only', async () => {
    let now = 1000; const session = await AuctionSession.create({ ...base, revealWindowMs: 1000 }, () => now);
    const bids = await Promise.all([prepare('0.9', 'BUY-1', '0.1', true), prepare('0.6', 'BUY-1', '0.1', true)]);
    for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
    await session.close(); now += 10; for (const bid of bids) await session.reveal(bid.reveal); now += 2000;
    const result = await session.clear(); const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
    expect(result.clearingPrice).toBe('0.9'); expect(bundle.auction.procurement).toBe(true);
    expect((await verifyAuditBundle(serializeAuditBundle(bundle))).ok).toBe(true);
    const payouts = settlementPayouts({ auctionId: 'BUY-1', network: 'testnet', forfeitedCollateral: result.forfeitedCollateral, allocations: result.allocations }, TEST_REFUND);
    expect(payouts.map(payout => [payout.kind, payout.amount])).toEqual([['refund', '0.1'], ['refund', '0.1']]);
    expect(payouts.reduce((sum, payout) => sum + parseZec(payout.amount), 0n)).toBe(parseZec(result.postedCollateral));
    const tampered = JSON.parse(serializeAuditBundle(bundle)) as Record<string, any>; tampered.auction.procurement = false;
    expect((await verifyAuditBundle(JSON.stringify(tampered))).ok).toBe(false);
  });
});
