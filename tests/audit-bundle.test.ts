import { describe, expect, it } from 'vitest';
import { AuctionSession } from '../src/lib/auction-session';
import { parseAuditBundle, serializeAuditBundle, verifyAuditBundle } from '../src/lib/audit-bundle';
import type { AuditBundle } from '../src/lib/audit-bundle';
import { closeStatement, createOperatorSigner, OperatorJournal, parseStatement, revealAckStatement, verifyStatement } from '../src/lib/operator-journal';
import { commitSubmission, DEFAULT_COLLATERAL, prepareBid } from '../src/protocol/memo';
import type { PreparedBid } from '../src/protocol/memo';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const config = { auctionId: 'AUDIT-001', supply: 10, reserve: '0.5', vault: TEST_VAULT, network: 'testnet' as const, collateral: DEFAULT_COLLATERAL, revealWindowMs: 1000 };
const prepare = (price: string, quantity: number) => prepareBid({ auctionId: config.auctionId, price, quantity, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet' });
const ok = (bundle: AuditBundle) => verifyAuditBundle(serializeAuditBundle(bundle));
const failed = async (text: string) => (await verifyAuditBundle(text)).checks.filter(check => !check.ok).map(check => check.id);
const edit = (bundle: AuditBundle, change: (value: Record<string, any>) => void): string => {
  const value = JSON.parse(serializeAuditBundle(bundle)) as Record<string, any>; change(value); return JSON.stringify(value);
};

async function runAuction(prices: readonly (readonly [string, number])[], reveal: (bid: PreparedBid, index: number) => boolean = () => true, overrides = {}) {
  let now = 1_000; const session = await AuctionSession.create({ ...config, ...overrides }, () => now);
  const bids = await Promise.all(prices.map(([price, quantity]) => prepare(price, quantity)));
  for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
  await session.close(); now += 10;
  const acks = [];
  for (const [index, bid] of bids.entries()) if (reveal(bid, index)) acks.push(await session.reveal(bid.reveal));
  now += 2_000; const result = await session.clear();
  const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
  return { session, bids, acks, result, bundle };
}

describe('operator statements', () => {
  it('signs canonical statements with a non-extractable key and rejects any change', async () => {
    const signer = await createOperatorSigner(); const journal = await OperatorJournal.create('AUDIT-001', signer);
    expect(journal.publicKey).toMatch(/^04[a-f0-9]{128}$/);
    const close = await journal.recordClose('a'.repeat(64), 2, 10, 20);
    expect(parseStatement(close.statement)).toEqual({ type: 'close', auctionId: 'AUDIT-001', root: 'a'.repeat(64), count: 2, closedAt: 10, revealDeadline: 20 });
    expect(await verifyStatement(journal.publicKey, close)).toBe(true);
    expect(await verifyStatement(journal.publicKey, { ...close, statement: close.statement.replace('2,', '3,') })).toBe(false);
    expect(await verifyStatement((await createOperatorSigner()).publicKey, close)).toBe(false);
    for (const bad of ['04zz', '']) expect(await verifyStatement(bad, close)).toBe(false);
    await expect(journal.recordClose('a'.repeat(64), 2, 10, 20)).rejects.toThrow('already');
    for (const text of [closeStatement('A', 'a'.repeat(64), 1, 1, 2).replace('[', '[ '), '["DARKZEC/close/v1"]', 'null', JSON.stringify(['DARKZEC/reveal-ack/v1', 'A', 'a'.repeat(64), 'b'.repeat(64), 128, 1])]) {
      expect(() => parseStatement(text), text).toThrow();
    }
    expect(() => revealAckStatement('A', 'a'.repeat(64), 'b'.repeat(64), 0, -1)).toThrow();
  });
  it('only acknowledges reveals between close and result', async () => {
    const journal = await OperatorJournal.create('AUDIT-001');
    await expect(journal.acknowledgeReveal('b'.repeat(64), 0, 1)).rejects.toThrow('between close and result');
  });
});

describe('audit bundle verification', () => {
  it('re-derives root, openings, clearing, conservation and every signature for an honest auction', async () => {
    const { bundle, result, acks } = await runAuction([['0.74', 4], ['0.72', 4], ['0.68', 6], ['0.6', 2]], (_bid, index) => index !== 3);
    expect(acks).toHaveLength(3); expect(result).toMatchObject({ clearingPrice: '0.68', excluded: 1, forfeitedCollateral: '10' });
    const report = await ok(bundle);
    expect(report.checks.map(check => [check.id, check.ok])).toEqual([['rules', true], ['root', true], ['reveals', true], ['clearing', true], ['conservation', true], ['close', true], ['acks', true], ['result', true]]);
    expect(report.ok).toBe(true);
    expect(parseAuditBundle(serializeAuditBundle(bundle))).toEqual(bundle);
  });
  it('exposes a censored reveal: the operator acknowledged it but the published result omits it', async () => {
    const { bundle } = await runAuction([['0.9', 2], ['0.8', 2]]);
    // A dishonest operator drops the second reveal and republishes a result that ignores it.
    const forged = edit(bundle, value => { value.reveals = value.reveals.slice(0, 1); });
    expect(await failed(forged)).toEqual(expect.arrayContaining(['acks', 'clearing']));
    expect((await verifyAuditBundle(forged)).checks.find(check => check.id === 'acks')?.detail).toContain('the result omits it');
  });
  it('detects edited results, commitments, statements and foreign keys', async () => {
    const { bundle } = await runAuction([['0.9', 6], ['0.8', 6]]);
    expect(await failed(edit(bundle, value => { value.result.clearingPrice = '0.5'; }))).toEqual(expect.arrayContaining(['clearing', 'result']));
    expect(await failed(edit(bundle, value => { value.result.allocations[0].paid = '0'; }))).toEqual(expect.arrayContaining(['clearing', 'conservation']));
    expect(await failed(edit(bundle, value => { value.commitments.push('f'.repeat(64)); }))).toEqual(expect.arrayContaining(['root', 'close']));
    expect(await failed(edit(bundle, value => { value.operator.statements[0].signature = '0'.repeat(128); }))).toEqual(expect.arrayContaining(['close']));
    expect(await failed(edit(bundle, value => { value.operator.publicKey = `04${'1'.repeat(128)}`; }))).toEqual(expect.arrayContaining(['close', 'acks', 'result']));
    expect(await failed(edit(bundle, value => { value.reveals[0] = value.reveals[0].replace('"p":"0.9"', '"p":"0.91"'); }))).toEqual(expect.arrayContaining(['reveals']));
    expect(await failed(edit(bundle, value => { value.operator.statements = value.operator.statements.filter((item: { statement: string }) => !item.statement.includes('reveal-ack')); }))).toEqual(['acks']);
  });
  it('refuses malformed and oversized bundles without throwing', async () => {
    for (const text of ['', 'null', '{}', '[]', JSON.stringify({ v: 2 }), 'x'.repeat(300_000)]) {
      const report = await verifyAuditBundle(text); expect(report.ok).toBe(false); expect(report.checks[0]?.id).toBe('schema');
    }
  });
});

describe('unit-demand mode', () => {
  it('clears a single lot at the second price (Vickrey) and refuses multi-lot reveals', async () => {
    const { result, bundle } = await runAuction([['0.9', 1], ['0.8', 1], ['0.6', 1]], () => true, { supply: 1, unitDemand: true });
    expect(result.clearingPrice).toBe('0.8'); expect(result.allocations.map(row => row.filled)).toEqual([1, 0, 0]);
    expect((await ok(bundle)).ok).toBe(true);
    const session = await AuctionSession.create({ ...config, supply: 1, unitDemand: true });
    const multi = await prepare('0.9', 2); await session.sandbox.submit(commitSubmission(multi)); await session.close();
    await expect(session.reveal(multi.reveal)).rejects.toThrow('exactly one lot');
  });
  it('makes padding quantity impossible: with k lots every winner pays the (k+1)-th price', async () => {
    const { result } = await runAuction([['0.9', 1], ['0.8', 1], ['0.7', 1], ['0.6', 1]], () => true, { supply: 2, unitDemand: true });
    expect(result.clearingPrice).toBe('0.7'); expect(result.allocations.map(row => row.filled)).toEqual([1, 1, 0, 0]);
  });
});
