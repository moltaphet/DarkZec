import { describe, expect, it, vi } from 'vitest';
import { Sandbox, settlementBalance } from '../src/simulation';
import { commitSubmission, DEFAULT_COLLATERAL, prepareBid } from '../src/protocol/memo';
import type { CommitSubmission, PreparedBid } from '../src/protocol/memo';
import { commitment } from '../src/protocol/crypto';
import { parseZec } from '../src/protocol/amount';
import { merkleRoot, verifyProof } from '../src/protocol/merkle';
import { TEST_REFUND, TEST_VAULT, WALLET_REFUND } from './fixtures';

const config = { auctionId: 'NODE07-001', supply: 10, reserve: '0.5', vault: TEST_VAULT, network: 'testnet' as const, collateral: DEFAULT_COLLATERAL, revealWindowMs: 1000 };
const prepare = (price: string, quantity: number, auctionId = config.auctionId) => prepareBid({ auctionId, price, quantity, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet' });
async function commitAll(sandbox: Sandbox, bids: readonly PreparedBid[]): Promise<void> { for (const bid of bids) await sandbox.submit(commitSubmission(bid)); }
async function revealAll(sandbox: Sandbox, bids: readonly PreparedBid[]): Promise<void> { for (const bid of bids) await sandbox.reveal(bid.reveal); }

describe('strict commit/reveal auction ledger', () => {
  it('accepts only hashes at commit and clears verified reveals with immutable proofs and exact collateral accounting', async () => {
    const sandbox = await Sandbox.create(config); const bids = await Promise.all([prepare('0.74', 4), prepare('0.72', 4), prepare('0.68', 6)]);
    await commitAll(sandbox, bids);
    const state = JSON.stringify(sandbox.publicSnapshot());
    for (const bid of bids) for (const secret of [bid.reveal.salt, bid.reveal.refund, bid.reveal.price, 'quantity', 'refund', 'salt', bid.uri]) expect(state).not.toContain(secret);
    expect(bids.every(bid => bid.amount === DEFAULT_COLLATERAL)).toBe(true);
    expect(sandbox.publicSnapshot().revealed).toEqual([]);
    await expect(sandbox.clear()).rejects.toThrow('Close');
    await expect(sandbox.reveal(bids[0]!.reveal)).rejects.toThrow('reveal window');
    await expect(sandbox.audit(0)).rejects.toThrow('Close');
    sandbox.close(); const frozen = await sandbox.audit(0);
    expect(frozen.root).toBe(await merkleRoot(bids.map(bid => bid.commitment)));
    await expect(sandbox.submit(commitSubmission(bids[0]!))).rejects.toThrow('closed');
    await revealAll(sandbox, bids);
    const result = await sandbox.clear();
    expect(result).toMatchObject({ clearingPrice: '0.68', filled: 10, excluded: 0, forfeitedCollateral: '0' });
    expect(result.allocations.find(row => row.price === '0.68')?.filled).toBe(2);
    expect(result.allocations.reduce((sum, row) => sum + parseZec(row.paid) + parseZec(row.refundAmount), 0n)).toBe(3n * parseZec(DEFAULT_COLLATERAL));
    const audit = await sandbox.audit(1); expect(await verifyProof(bids[1]!.commitment, audit.proof, audit.root)).toBe(true);
    expect(settlementBalance(result)).toMatchObject({ forfeited: '0', posted: '30', balanced: true });
    expect(audit.root).toBe(frozen.root); expect(result.root).toBe(frozen.root); await expect(sandbox.clear()).rejects.toThrow('already');
    await expect(sandbox.reveal(bids[0]!.reveal)).rejects.toThrow('reveal window');
  });
  it('discards price, quantity, salt, refund and auction substitutions without poisoning a later valid reveal', async () => {
    const sandbox = await Sandbox.create(config); const bid = await prepare('0.7', 4); await commitAll(sandbox, [bid]); sandbox.close();
    for (const changes of [{ price: '0.8' }, { quantity: 5 }, { salt: 'b'.repeat(64) }, { refund: WALLET_REFUND }, { auctionId: 'OTHER' }, { refund: TEST_VAULT }]) {
      await expect(sandbox.reveal({ ...bid.reveal, ...changes })).rejects.toThrow();
      expect(sandbox.publicSnapshot().revealed).toEqual([]);
    }
    await sandbox.reveal(bid.reveal); await expect(sandbox.reveal(bid.reveal)).rejects.toThrow('already');
    expect((await sandbox.clear()).allocations).toHaveLength(1);
  });
  it('excludes an unrevealed highest bid from price discovery but keeps it in the frozen commitment root', async () => {
    let now = 100; const sandbox = await Sandbox.create({ ...config, supply: 1 }, () => now);
    const missing = await prepare('9', 1); const bids = await Promise.all([prepare('0.8', 1), prepare('0.6', 1)]);
    await commitAll(sandbox, [missing, ...bids]); sandbox.close(); await revealAll(sandbox, bids);
    await expect(sandbox.clear()).rejects.toThrow('still open'); now = 1100;
    await expect(sandbox.reveal(missing.reveal)).rejects.toThrow('expired');
    const result = await sandbox.clear(); expect(result).toMatchObject({ clearingPrice: '0.6', excluded: 1, forfeitedCollateral: '10' });
    // Conservation: payments + refunds + forfeited collateral equal every posted collateral, revealed or not.
    expect(result.allocations.reduce((sum, row) => sum + parseZec(row.paid) + parseZec(row.refundAmount), 0n) + parseZec(result.forfeitedCollateral)).toBe(3n * parseZec(DEFAULT_COLLATERAL));
    expect(result.allocations.map(row => row.commitment)).not.toContain(missing.commitment);
    const audit = await sandbox.audit(0); expect(audit.proof.count).toBe(3);
    expect(await verifyProof(missing.commitment, audit.proof, audit.root)).toBe(true);
    expect(result.root).toBe(await merkleRoot([missing, ...bids].map(bid => bid.commitment)));
  });
  it('settles no unrevealed bids and forfeits their collateral rather than inventing refunds', async () => {
    let now = 0; const sandbox = await Sandbox.create(config, () => now);
    const only = await prepare('1', 1); await commitAll(sandbox, [only]); sandbox.close(); now = 1000;
    const result = await sandbox.clear(); expect(result).toMatchObject({ filled: 0, allocations: [], excluded: 1, forfeitedCollateral: '10' });
    expect(settlementBalance(result)).toEqual({ paid: '0', refunded: '0', forfeited: '10', posted: '10', balanced: true });
    expect(result.root).toBe(await merkleRoot([only.commitment])); await expect(sandbox.audit(1)).rejects.toThrow('No commitment');
    const empty = await Sandbox.create(config); empty.close(); await expect(empty.audit(0)).rejects.toThrow('No commitment');
    const emptyResult = await empty.clear(); expect(emptyResult.filled).toBe(0); expect(emptyResult.root).toBe(await merkleRoot([]));
  });
  it('rejects rich commit payloads, wrong collateral, wrong auctions, duplicates and malformed hashes', async () => {
    const sandbox = await Sandbox.create(config); const bid = await prepare('0.7', 4); const packet = commitSubmission(bid);
    await expect(sandbox.submit(bid as unknown as CommitSubmission)).rejects.toThrow('only');
    for (const bad of [{ ...packet, collateral: '2.8' }, { ...packet, auctionId: 'OTHER' }, { ...packet, commitment: 'NOT-HEX' }]) await expect(sandbox.submit(bad)).rejects.toThrow();
    const extra = { ...packet, reveal: bid.reveal }; await expect(sandbox.submit(extra)).rejects.toThrow('only');
    expect(sandbox.publicSnapshot().commitments).toHaveLength(0); await sandbox.submit(packet);
    await expect(sandbox.submit(packet)).rejects.toThrow('Duplicate');
  });
  it('requires funded reveals even when an attacker records a valid hash with insufficient collateral', async () => {
    const sandbox = await Sandbox.create(config); const honest = await prepare('1', 1); const bid = { ...honest.reveal, price: '11' };
    await sandbox.submit({ auctionId: config.auctionId, commitment: await commitment(bid), collateral: '10' }); sandbox.close();
    await expect(sandbox.reveal(bid)).rejects.toThrow('Insufficient'); expect(sandbox.publicSnapshot().revealed).toEqual([]);
    await expect(prepare('11', 1)).rejects.toThrow('posted collateral');
  });
  it('preserves commit order for ties even when participants reveal in reverse order', async () => {
    const sandbox = await Sandbox.create({ ...config, supply: 3 }); const bids = [await prepare('1', 2), await prepare('1', 2)];
    await commitAll(sandbox, bids); sandbox.close(); await revealAll(sandbox, [...bids].reverse());
    const result = await sandbox.clear(); expect(result.allocations.find(row => row.commitment === bids[0]!.commitment)?.filled).toBe(2);
    expect((await sandbox.audit(0)).commitment).toBe(bids[0]!.commitment);
  });
  it('rejects concurrent commit, close and clear operations and snapshots caller-owned data', async () => {
    const mutable = { ...config }; const sandbox = await Sandbox.create(mutable); mutable.supply = 99;
    const bid = await prepare('1', 1); const packet = { ...commitSubmission(bid) }; const pending = sandbox.submit(packet); packet.commitment = 'f'.repeat(64);
    expect(() => sandbox.close()).toThrow('progress'); await expect(sandbox.submit(commitSubmission(bid))).rejects.toThrow('progress'); await pending;
    expect(sandbox.publicSnapshot().commitments).toEqual([bid.commitment]); expect(Object.isFrozen(sandbox.publicSnapshot().commitments)).toBe(true);
    sandbox.close(); const reveal = { ...bid.reveal }; const running = sandbox.reveal(reveal); reveal.price = '2';
    await expect(sandbox.clear()).rejects.toThrow('progress'); await running;
    expect((await sandbox.clear()).allocations[0]?.price).toBe('1');
  });
  it('rejects a reveal when its deadline passes during asynchronous commitment verification', async () => {
    let now = 0; const sandbox = await Sandbox.create(config, () => now); const bid = await prepare('1', 1);
    await commitAll(sandbox, [bid]); sandbox.close(); const pending = sandbox.reveal(bid.reveal); now = 1000;
    await expect(pending).rejects.toThrow('expired'); expect(sandbox.publicSnapshot().revealed).toEqual([]);
  });
  it('keeps finalization atomic when Merkle hashing fails and allows a safe retry', async () => {
    const sandbox = await Sandbox.create(config); const bid = await prepare('1', 1); await commitAll(sandbox, [bid]); sandbox.close(); await revealAll(sandbox, [bid]);
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const mock = vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, bytes) => {
      if (bytes instanceof Uint8Array && bytes[0] === 0) return Promise.reject(new Error('Merkle unavailable'));
      return original(algorithm, bytes);
    });
    try { await expect(sandbox.clear()).rejects.toThrow('Merkle'); } finally { mock.mockRestore(); }
    expect(sandbox.publicSnapshot().phase).toBe('reveal');
    expect((await sandbox.clear()).allocations).toHaveLength(1);
  });
  it('bounds ledger size and rejects invalid collateral/window configuration', async () => {
    const sandbox = await Sandbox.create(config);
    for (let i = 0; i < 128; i++) await sandbox.submit({ auctionId: config.auctionId, collateral: '10', commitment: i.toString(16).padStart(64, '0') });
    await expect(sandbox.submit({ auctionId: config.auctionId, collateral: '10', commitment: 'f'.repeat(64) })).rejects.toThrow('128');
    for (const changes of [{ collateral: '0' }, { revealWindowMs: 0 }, { revealWindowMs: NaN }, { revealWindowMs: 1.5 }]) await expect(Sandbox.create({ ...config, ...changes })).rejects.toThrow();
  });
});
