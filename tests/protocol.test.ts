import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bech32m } from '@scure/base';
import { decodeUnifiedAddress, encodeOrchardAddress, f4jumble, validateOrchardAddress } from '../src/protocol/address';
import { formatZec, MAX_MONEY, parseQuantity, parseZec } from '../src/protocol/amount';
import { canonicalPreimage, commitment, deriveSalt, freshSalt, unhex, utf8 } from '../src/protocol/crypto';
import { buildPaymentUri, encodeMemo, memoBytes, parseBidMemo, parseCommitMemo, prepareBid, serializeBidMemo } from '../src/protocol/memo';
import { merkleProof, merkleRoot, verifyProof } from '../src/protocol/merkle';
import { TEST_REFUND } from './fixtures';

// Published zcash/zcash-test-vectors unified_address.json, account 2, diversifier 0.
const official = 'u1ay3aawlldjrmxqnjf5medr5ma6p3acnet464ht8lmwplq5cd3ugytcmlf96rrmtgwldc75x94qn4n8pgen36y8tywlq6yjk7lkf3fa8wzjrav8z2xpxqnrnmjxh8tmz6jhfh425t7f3vy6p4pd3zmqayq49efl2c4xydc0gszg660q9p';
const orchardHex = '953f3c78d103c32b60559299462ebb27348964b892acad10482fe502c99f0d524959ba7be4f188e3a27138';
export const testAddress = encodeOrchardAddress(unhex(orchardHex), 'testnet');
const bid = { auctionId: 'NODE07-001', price: '0.72', quantity: 4, salt: 'a'.repeat(64), refund: TEST_REFUND };

describe('ZIP-316 validation', () => {
  it('decodes an official UA and reproduces its exact F4Jumble encoding', () => {
    const receivers = decodeUnifiedAddress(official, 'mainnet');
    expect(receivers.map(r => r.type)).toEqual([2, 3]);
    expect(receivers[1]?.bytes).toEqual(unhex(orchardHex));
    const padding = new Uint8Array(16); padding[0] = 117;
    const raw = new Uint8Array([...receivers.flatMap(r => [r.type, r.bytes.length, ...r.bytes]), ...padding]);
    expect(bech32m.encode('u', bech32m.toWords(f4jumble(raw)), 2048)).toBe(official);
  });
  it('requires a valid Orchard receiver and the right network', () => {
    expect(validateOrchardAddress(testAddress, 'testnet')).toBe(testAddress);
    expect(() => validateOrchardAddress(testAddress, 'mainnet')).toThrow('mainnet');
    expect(validateOrchardAddress(official, 'mainnet')).toBe(official);
    for (const invalid of ['t1abc', 'u1fake', testAddress.toUpperCase(), testAddress.slice(0, -1) + (testAddress.endsWith('q') ? 'p' : 'q')]) {
      expect(() => validateOrchardAddress(invalid, 'testnet')).toThrow();
    }
  });
  it('rejects padding, invalid points, duplicate receivers and noncanonical CompactSize', () => {
    const padding = new Uint8Array(16); padding.set(utf8('utest'));
    const wrap = (payload: number[], pad = padding): string => bech32m.encode('utest', bech32m.toWords(f4jumble(new Uint8Array([...payload, ...pad]))), 2048);
    const r = [...unhex(orchardHex)];
    expect(() => validateOrchardAddress(wrap([3, 43, ...r], new Uint8Array(16)), 'testnet')).toThrow('padding');
    expect(() => validateOrchardAddress(wrap([3, 43, ...new Uint8Array(43)]), 'testnet')).toThrow('payment point');
    expect(() => decodeUnifiedAddress(wrap([3, 43, ...r, 3, 43, ...r]), 'testnet')).toThrow('ordering');
    expect(() => decodeUnifiedAddress(wrap([253, 3, 0, 43, ...r]), 'testnet')).toThrow('CompactSize');
    expect(() => decodeUnifiedAddress(wrap([3, 43, ...r, 192, 1, 0]), 'testnet')).toThrow('Metadata items');
    expect(decodeUnifiedAddress(wrap([3, 43, ...r, 4, 1, 0]), 'testnet').map(receiver => receiver.type)).toEqual([3]);
    expect(validateOrchardAddress(wrap([0, 20, ...new Uint8Array(20), 3, 43, ...r]), 'testnet')).toMatch(/^utest1/);
    expect(() => validateOrchardAddress(wrap([2, 43, ...r]), 'testnet')).toThrow('Orchard receiver');
  });
});

describe('exact amounts and commitments', () => {
  it('round-trips the monetary bounds without float rounding', () => {
    expect(parseZec('0.00000001')).toBe(1n);
    expect(parseZec('21000000')).toBe(MAX_MONEY);
    expect(formatZec(parseZec('12.34567890'))).toBe('12.3456789');
    for (const bad of ['NaN', '1e3', '-1', '01', '.5', '1.', '1:2', '0.000000001', '21000000.00000001']) expect(() => parseZec(bad)).toThrow();
    for (const bad of ['0', '1.5', '-1', '1000000']) expect(() => parseQuantity(bad)).toThrow();
  });
  it('matches independent SHA-256 and HMAC known answers', async () => {
    const preimage = JSON.stringify(['DARKZEC/bid/v2', bid.auctionId, bid.refund, bid.salt, bid.price, bid.quantity]);
    expect(canonicalPreimage(bid)).toBe(preimage);
    expect(await commitment(bid)).toBe(createHash('sha256').update(preimage).digest('hex'));
    const entropy = new Uint8Array(32).fill(42); const nonce = '0'.repeat(32);
    const expected = createHmac('sha256', entropy).update(`DARKZEC/salt/v1:NODE07-001:${nonce}`).digest('hex');
    expect(await deriveSalt(entropy, bid.auctionId, nonce)).toBe(expected);
    expect(await deriveSalt(entropy, bid.auctionId, nonce)).toBe(expected);
    expect(await deriveSalt(entropy, 'OTHER', nonce)).not.toBe(expected);
    expect(await freshSalt(bid.auctionId)).not.toBe(await freshSalt(bid.auctionId));
  });
  it('rejects ambiguous preimages and insufficient entropy', async () => {
    expect(() => canonicalPreimage({ ...bid, auctionId: 'a:b' })).toThrow();
    expect(() => canonicalPreimage({ ...bid, price: '0.720' })).toThrow('canonical');
    expect(() => canonicalPreimage({ ...bid, quantity: 1.2 })).toThrow();
    await expect(deriveSalt(new Uint8Array(2), 'A', '0'.repeat(32))).rejects.toThrow('32 bytes');
  });
});

describe('ZIP-302 / ZIP-321', () => {
  it('audits UTF-8 before encoding at the exact 512-byte boundary', () => {
    expect(memoBytes('a'.repeat(512))).toHaveLength(512);
    expect(memoBytes('🚀'.repeat(128))).toHaveLength(512);
    expect(encodeMemo('🚀'.repeat(128))).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => encodeMemo('a'.repeat(513))).toThrow('513 bytes');
    expect(() => encodeMemo('🚀'.repeat(129))).toThrow('516 bytes');
    expect(() => encodeMemo('\ud800')).toThrow('Unicode');
    expect(encodeMemo('???>>>')).toBe('Pz8_Pj4-');
  });
  it('builds a shielded URI with exact decimal escrow and canonical JSON', async () => {
    const prepared = await prepareBid({ ...bid, price: '0.7200', vault: testAddress, network: 'testnet' });
    expect(prepared.amount).toBe('10');
    const [base, query = ''] = prepared.uri.split('?');
    expect(base).toBe(`zcash:${testAddress}`);
    const params = new URLSearchParams(query);
    expect(params.get('amount')).toBe('10');
    const encoded = params.get('memo') ?? '';
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(decoded).toBe(prepared.memo);
    expect(parseCommitMemo(decoded)).toEqual({ auctionId: bid.auctionId, commitment: prepared.commitment });
    expect(await commitment(prepared.reveal)).toBe(prepared.commitment);
    for (const field of ['p', 'q', 's', 'r']) expect(JSON.parse(decoded)).not.toHaveProperty(field);
    expect(prepared.byteLength).toBe(Buffer.byteLength(decoded, 'utf8'));
  });
  it('rejects invalid refund, schema, destination, empty payments and overflow', async () => {
    expect(() => serializeBidMemo({ ...bid, refund: 't1abc' }, 'testnet')).toThrow();
    expect(() => parseBidMemo('{"v":1,"q":1}', 'testnet')).toThrow('schema');
    expect(() => parseBidMemo('null', 'testnet')).toThrow();
    expect(() => parseBidMemo(serializeBidMemo(bid, 'testnet').replace('{', '{"extra":1,'), 'testnet')).toThrow('schema');
    expect(() => buildPaymentUri({ address: testAddress, amount: '0', memo: '{}', network: 'testnet' })).toThrow('positive');
    expect(() => buildPaymentUri({ address: 't1fake', amount: '1', memo: '{}', network: 'testnet' })).toThrow();
    await expect(prepareBid({ ...bid, price: '21000000', vault: testAddress, network: 'testnet' })).rejects.toThrow('monetary');
  });
});

describe('public Merkle inclusion', () => {
  it('proves every leaf for odd/even/single trees and detects tampering', async () => {
    for (const count of [1, 2, 3, 5, 8]) {
      const leaves = Array.from({ length: count }, (_, i) => createHash('sha256').update(String(i)).digest('hex'));
      const root = await merkleRoot(leaves);
      for (let i = 0; i < leaves.length; i++) {
        const value = leaves[i]; if (!value) throw new Error('Missing leaf');
        const proof = await merkleProof(leaves, i);
        expect(await verifyProof(value, proof, root)).toBe(true);
        expect(await verifyProof('f'.repeat(64), proof, root)).toBe(false);
        expect(await verifyProof(value, { ...proof, index: -1 }, root)).toBe(false);
        expect(await verifyProof(value, { ...proof, count: proof.count + 1 }, root)).toBe(false);
        if (proof.steps.length) expect(await verifyProof(value, { ...proof, steps: proof.steps.slice(1) }, root)).toBe(false);
      }
    }
    expect(await merkleRoot([])).toHaveLength(64);
    await expect(merkleProof([], 0)).rejects.toThrow('index');
  });
});
