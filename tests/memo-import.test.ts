import { describe, expect, it } from 'vitest';
import { compareWithRequest, memoFingerprint, parseReceivedCommitMemo } from '../src/lib/memo-import';
import { receiptFilename, parseReceiptText, receiptText } from '../src/lib/receipt-file';
import { encodeMemo, prepareBid, serializeCommitMemo } from '../src/protocol/memo';
import { hex, utf8 } from '../src/protocol/crypto';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const hash = 'ab'.repeat(32);
const memo = serializeCommitMemo('NODE07-001', hash);

describe('wallet-received commit memo verification', () => {
  it('reads the same commit memo as text, unpadded Base64url and zero-padded hex', () => {
    const padded = new Uint8Array(512); padded.set(utf8(memo));
    for (const [input, transport] of [[memo, 'json'], [encodeMemo(memo), 'base64url'], [hex(padded), 'hex'], [hex(padded).toUpperCase(), 'hex'], [`0x${hex(padded)}`, 'hex'], [`0X${hex(utf8(memo)).toUpperCase()}`, 'hex'], [`${memo}\u0000\u0000`, 'json'], [`  ${memo}\n`, 'json']] as const) {
      expect(parseReceivedCommitMemo(input)).toEqual({ auctionId: 'NODE07-001', commitment: hash, bytes: utf8(memo).length, transport });
    }
  });
  it('rejects bid preimages, wrong shapes, bad encodings and oversize input', () => {
    const preimage = JSON.stringify({ v: 1, a: 'NODE07-001', p: '0.72', q: 4, s: 'a'.repeat(64), r: TEST_REFUND });
    const bad = ['', '   ', preimage, '{"v":2}', `${memo} `.replace('}', ',"x":1}'), 'not a memo!', 'zz', encodeMemo(preimage), '7b' + 'zz', 'ab'.repeat(300), 'A'.repeat(1200),
      memo.replace('"commit"', '"reveal"'), memo.replace(hash, 'AB'.repeat(32)), '00'.repeat(512), '0x', '0x7', `0x${'ab'.repeat(600)}`, encodeMemo(`﻿${memo}`)];
    for (const input of bad) expect(() => parseReceivedCommitMemo(input), input.slice(0, 40)).toThrow();
  });
  it('compares an imported memo with the commitment of the prepared request', async () => {
    const prepared = await prepareBid({ auctionId: 'NODE07-001', price: '0.72', quantity: 4, refund: TEST_REFUND, vault: TEST_VAULT, network: 'testnet' });
    const imported = parseReceivedCommitMemo(prepared.memo);
    expect(compareWithRequest(imported, { auctionId: 'NODE07-001', commitment: prepared.commitment }).matches).toBe(true);
    expect(compareWithRequest(imported, { auctionId: 'NODE07-001', commitment: hash })).toMatchObject({ matches: false, detail: expect.stringContaining('differs') });
    expect(compareWithRequest(imported, { auctionId: 'OTHER-001', commitment: prepared.commitment })).toMatchObject({ matches: false, detail: expect.stringContaining('another auction') });
    expect(compareWithRequest(imported)).toMatchObject({ matches: false, detail: expect.stringContaining('not compared') });
    expect(memoFingerprint(hash)).toBe('abababab…abababab');
  });
});

describe('reveal receipt files', () => {
  it('round-trips the canonical receipt and rejects anything else', async () => {
    const prepared = await prepareBid({ auctionId: 'NODE07-001', price: '0.72', quantity: 4, refund: TEST_REFUND, vault: TEST_VAULT, network: 'testnet' });
    const text = receiptText(prepared.reveal, 'testnet');
    expect(parseReceiptText(text, 'testnet')).toEqual(prepared.reveal);
    expect(parseReceiptText(`\n${text}\n`, 'testnet')).toEqual(prepared.reveal);
    expect(receiptFilename(prepared.reveal, prepared.commitment)).toBe(`darkzec-receipt-NODE07-001-${prepared.commitment.slice(0, 8)}.json`);
    for (const bad of ['', '{}', text.replace('0.72', '0.720'), text.replace('"v":1', '"v":2'), JSON.stringify(JSON.parse(text), null, 2), prepared.memo]) {
      expect(() => parseReceiptText(bad, 'testnet')).toThrow();
    }
  });
});
