import { describe, expect, it } from 'vitest';
import { Sandbox } from '../src/simulation';
import { prepareBid } from '../src/protocol/memo';
import { encodeOrchardAddress } from '../src/protocol/address';
import { unhex } from '../src/protocol/crypto';
import { parseZec } from '../src/protocol/amount';
import { verifyProof } from '../src/protocol/merkle';

const address = encodeOrchardAddress(unhex('953f3c78d103c32b60559299462ebb27348964b892acad10482fe502c99f0d524959ba7be4f188e3a27138'), 'testnet');
const config = { auctionId: 'NODE07-001', supply: 10, reserve: '0.5', vault: address, network: 'testnet' as const };
const prepare = (price: string, quantity: number, auctionId = config.auctionId) => prepareBid({ auctionId, price, quantity, vault: address, refund: address, network: 'testnet' });

describe('local sealed auction', () => {
  it('enforces close -> clear, hides bids, freezes the root and conserves every zatoshi', async () => {
    const sandbox = await Sandbox.create(config);
    const high = await prepare('0.74', 4); const mid = await prepare('0.72', 4); const low = await prepare('0.68', 6);
    await sandbox.submit(high); await sandbox.submit(mid); await sandbox.submit(low);
    const publicState = JSON.stringify(sandbox.publicSnapshot());
    for (const secret of ['0.74', high.memo, high.uri, address, 'refund', 'salt']) expect(publicState).not.toContain(secret);
    expect(sandbox.publicSnapshot().commitments).toHaveLength(3);
    await expect(sandbox.clear()).rejects.toThrow('Close');
    sandbox.close();
    const audit = await sandbox.audit(1);
    expect(await verifyProof(mid.commitment, audit.proof, audit.root)).toBe(true);
    await expect(sandbox.submit(await prepare('1', 1))).rejects.toThrow('closed');
    const result = await sandbox.clear();
    expect(result.clearingPrice).toBe('0.68');
    expect(result.filled).toBe(10);
    expect(result.allocations.find(a => a.commitment === low.commitment)?.filled).toBe(2);
    expect(result.allocations.reduce((sum, a) => sum + parseZec(a.paid) + parseZec(a.refundAmount), 0n)).toBe(parseZec(high.amount) + parseZec(mid.amount) + parseZec(low.amount));
    expect((await sandbox.audit(1)).root).toBe(audit.root);
    await expect(sandbox.clear()).rejects.toThrow('already');
  });
  it('rejects duplicates, tampering, wrong auctions and racing actions atomically', async () => {
    const sandbox = await Sandbox.create(config); const bid = await prepare('0.7', 4);
    await expect(sandbox.submit({ ...bid, commitment: 'a'.repeat(64) })).rejects.toThrow('commitment');
    await expect(sandbox.submit({ ...bid, amount: '0.1' })).rejects.toThrow('escrow');
    await expect(sandbox.submit({ ...bid, uri: 'zcash:t1bad' })).rejects.toThrow('URI');
    await expect(sandbox.submit(await prepare('1', 1, 'OTHER'))).rejects.toThrow('auction');
    expect(sandbox.publicSnapshot().commitments).toHaveLength(0);
    const first = sandbox.submit(bid);
    expect(() => sandbox.close()).toThrow('progress');
    await expect(sandbox.submit(bid)).rejects.toThrow('progress');
    await first;
    await expect(sandbox.submit(bid)).rejects.toThrow('Duplicate');
    expect(sandbox.publicSnapshot().commitments).toHaveLength(1);
  });
  it('handles no bids, reserve rejection and unsold supply', async () => {
    const empty = await Sandbox.create(config); empty.close();
    expect((await empty.clear()).filled).toBe(0);
    const sandbox = await Sandbox.create(config);
    await sandbox.submit(await prepare('0.4', 5)); await sandbox.submit(await prepare('0.9', 2));
    sandbox.close(); const result = await sandbox.clear();
    expect(result.filled).toBe(2); expect(result.clearingPrice).toBe('0.5');
    expect(result.allocations.find(a => a.price === '0.4')?.refundAmount).toBe('2');
  });
  it('breaks ties by commitment and protects config/snapshot ownership', async () => {
    const mutable = { ...config, supply: 3 };
    const sandbox = await Sandbox.create(mutable); mutable.supply = 99;
    const a = await prepare('1', 2); const b = await prepare('1', 2);
    await sandbox.submit(a); await sandbox.submit(b);
    const snapshot = sandbox.publicSnapshot(); expect(Object.isFrozen(snapshot.commitments)).toBe(true);
    sandbox.close(); const result = await sandbox.clear();
    expect(result.filled).toBe(3);
    expect(result.allocations.find(row => row.commitment === [a.commitment, b.commitment].sort()[0])?.filled).toBe(2);
  });
});
