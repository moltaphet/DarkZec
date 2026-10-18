import { describe, expect, it } from 'vitest';
import { bech32m } from '@scure/base';
import { FIXTURE_ADDRESS, FIXTURE_REFUND_ADDRESS, SIMULATION_CONFIG } from '../src/fixtures';
import { f4jumble } from '../src/protocol/address';
import { commitment, hex, utf8 } from '../src/protocol/crypto';
import { encodeMemo, serializeBidMemo } from '../src/protocol/memo';
import { decodeBase64url, parseVaultMemo } from '../src/lib/vault-memo';
import { createDemoNotes, encryptMockNote, mockNoteKey, MOCK_SCAN_SCOPE, paddedMockField, scanMockNotes } from '../src/lib/mock-note-scanner';
import { DEMO_VIEWING_KEY, ViewingKeySession, VIEWING_SESSION_KEY, viewingKeyKind } from '../src/lib/viewing-key-session';
import type { SessionStore } from '../src/lib/viewing-key-session';

const bid = { auctionId: SIMULATION_CONFIG.auctionId, price: '0.74', quantity: 4, salt: 'a'.repeat(64), refund: FIXTURE_REFUND_ADDRESS };
const memo = serializeBidMemo(bid, 'testnet');

describe('authenticated memo field parsing', () => {
  it('accepts direct JSON and canonical Base64url after stripping only trailing zero bytes', () => {
    for (const transport of ['json', 'base64url'] as const) {
      const value = transport === 'json' ? memo : encodeMemo(memo);
      const result = parseVaultMemo(hex(paddedMockField(value)), transport, 'testnet', bid.auctionId);
      expect(result?.bid).toEqual(bid); expect(result?.transportBytes).toBe(utf8(value).length);
      expect(result?.jsonBytes).toBe(utf8(memo).length);
    }
  });
  it('enforces the 512-byte bound and canonical JSON even without padding', () => {
    // JSON whitespace is noncanonical and must be refused even though the field is exactly 512 bytes.
    expect(() => parseVaultMemo(hex(paddedMockField(memo.padEnd(512, ' '))), 'json', 'testnet', bid.auctionId)).toThrow('schema');
    expect(() => paddedMockField('a'.repeat(513))).toThrow('512-byte');
  });
  it('handles ZIP-302 empty markers and rejects reserved, malformed UTF-8 and interior NUL bytes', () => {
    expect(parseVaultMemo('00'.repeat(512), 'json', 'testnet', bid.auctionId)).toBeNull();
    expect(parseVaultMemo('f6' + '00'.repeat(511), 'json', 'testnet', bid.auctionId)).toBeNull();
    for (const value of ['f601' + '00'.repeat(510), 'ff' + '00'.repeat(511), 'c328' + '00'.repeat(510)]) {
      expect(() => parseVaultMemo(value, 'json', 'testnet', bid.auctionId)).toThrow('encoding');
    }
    expect(() => parseVaultMemo(hex(paddedMockField(memo.replace('0.74', '0\u0000.74'))), 'json', 'testnet', bid.auctionId)).toThrow();
  });
  it('rejects bad hex, noncanonical Base64url, schema, auction and transparent refunds', () => {
    for (const value of ['00'.repeat(511), '00'.repeat(513), 'gg'.repeat(512)]) expect(() => parseVaultMemo(value, 'json', 'testnet', bid.auctionId)).toThrow('512-byte');
    for (const value of ['Zg==', 'Zh', 'a', '+/8', 'a'.repeat(684)]) expect(() => decodeBase64url(value)).toThrow();
    expect(() => parseVaultMemo(hex(paddedMockField(memo)), 'json', 'testnet', 'OTHER')).toThrow('another auction');
    for (const value of [memo.replace('"v":1', '"v":2'), memo.replace('0.74', '0.740'), memo.replace('"q":4', '"q":1.5'), memo.replace('a'.repeat(64), 'bad'), memo.replace(FIXTURE_REFUND_ADDRESS, 't1bad'), memo.replace('{', '{"extra":1,')]) {
      expect(() => parseVaultMemo(hex(paddedMockField(value)), 'json', 'testnet', bid.auctionId)).toThrow('schema');
    }
  });
});

describe('mock note scan isolation', () => {
  it('scans authenticated 528-byte envelopes into 512-byte fields, accepts three bids and quarantines malformed schema', async () => {
    const notes = await createDemoNotes(); const key = await mockNoteKey(DEMO_VIEWING_KEY);
    expect(notes.every(note => note.encryptedMemoHex.length === 1056)).toBe(true);
    const progress: number[] = [];
    const result = await scanMockNotes(notes, key, MOCK_SCAN_SCOPE, undefined, count => progress.push(count));
    expect(result.map(row => row.status)).toEqual(['accepted', 'accepted', 'accepted', 'rejected', 'empty']);
    expect(result[3]).toMatchObject({ code: 'schema' }); expect(progress).toEqual([1, 2, 3, 4, 5]);
    const accepted = result[0]; if (accepted?.status !== 'accepted') throw new Error('Expected bid');
    expect(accepted.memoHex).toHaveLength(1024); expect(accepted.commitment).toBe(await commitment(accepted.parsed.bid));
    expect(await scanMockNotes(notes, key, MOCK_SCAN_SCOPE)).toEqual(result);
  });
  it('rejects wrong keys, modified ciphertext, modified AAD and duplicate IDs without accepting them', async () => {
    const notes = await createDemoNotes(); const note = notes[0]; if (!note) throw new Error('Missing note');
    const wrong = await mockNoteKey(`mock:node07:${'08'.repeat(32)}`); const key = await mockNoteKey(DEMO_VIEWING_KEY);
    expect((await scanMockNotes([note], wrong, MOCK_SCAN_SCOPE))[0]).toMatchObject({ status: 'rejected', code: 'authentication' });
    const corrupted = { ...note, encryptedMemoHex: (note.encryptedMemoHex.startsWith('00') ? 'ff' : '00') + note.encryptedMemoHex.slice(2) };
    const scanned = await scanMockNotes([corrupted, { ...note, id: 'NOTE-0010' }, note], key, MOCK_SCAN_SCOPE);
    expect(scanned.map(row => row.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(scanned[2]).toMatchObject({ code: 'duplicate' });
  });
  it('rejects commitment/escrow mismatches inside authentic envelopes and wrong destinations/auctions', async () => {
    const key = await mockNoteKey(DEMO_VIEWING_KEY); const field = paddedMockField(memo);
    const metadata = { ...MOCK_SCAN_SCOPE, id: 'NOTE-0001', commitment: await commitment(bid), amount: '2.96', transport: 'json' as const };
    for (const [changes, code] of [[{ commitment: 'f'.repeat(64) }, 'commitment'], [{ amount: '1' }, 'escrow'], [{ auctionId: 'OTHER' }, 'auction'], [{ network: 'mainnet' as const }, 'destination']] as const) {
      const note = await encryptMockNote({ ...metadata, ...changes }, field, key);
      expect((await scanMockNotes([note], key, MOCK_SCAN_SCOPE))[0]).toMatchObject({ status: 'rejected', code });
    }
    const duplicate = await encryptMockNote({ ...metadata, id: 'NOTE-0002' }, field, key);
    const original = await encryptMockNote(metadata, field, key);
    expect((await scanMockNotes([original, duplicate], key, MOCK_SCAN_SCOPE))[1]).toMatchObject({ code: 'duplicate' });
  });
  it('supports cancellation and bounded batches', async () => {
    const key = await mockNoteKey(DEMO_VIEWING_KEY); const notes = await createDemoNotes(); const abort = new AbortController();
    await expect(scanMockNotes(notes, key, MOCK_SCAN_SCOPE, abort.signal, () => abort.abort())).rejects.toMatchObject({ code: 'cancelled' });
    const note = notes[0]; if (!note) throw new Error('Missing note');
    await expect(scanMockNotes(Array.from({ length: 129 }, () => note), key, MOCK_SCAN_SCOPE)).rejects.toThrow('128');
  });
  it('quarantines an authentic memo that refunds to the receiving vault', async () => {
    const self = { ...bid, refund: FIXTURE_ADDRESS }; const field = paddedMockField(serializeBidMemo(self, 'testnet'));
    const key = await mockNoteKey(DEMO_VIEWING_KEY);
    const note = await encryptMockNote({ ...MOCK_SCAN_SCOPE, id: 'NOTE-0001', commitment: await commitment(self), amount: '2.96', transport: 'json' }, field, key);
    expect((await scanMockNotes([note], key, MOCK_SCAN_SCOPE))[0]).toMatchObject({ status: 'rejected', code: 'refund' });
  });
});

class MemoryStore implements SessionStore {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
describe('passphrase-encrypted viewing-key session', () => {
  it('stores ciphertext only and restores after recreating the session adapter', async () => {
    const store = new MemoryStore(); const session = new ViewingKeySession(store); const passphrase = 'correct-local-passphrase';
    expect(session.status()).toBe('empty'); await session.save(DEMO_VIEWING_KEY, passphrase);
    const record = store.getItem(VIEWING_SESSION_KEY) ?? '';
    expect(record).not.toContain(DEMO_VIEWING_KEY); expect(record).not.toContain(passphrase); expect(session.status()).toBe('saved');
    expect(await new ViewingKeySession(store).unlock(passphrase)).toBe(DEMO_VIEWING_KEY);
    await expect(session.unlock('incorrect-local-passphrase')).rejects.toMatchObject({ code: 'session' });
    session.forget(); expect(session.status()).toBe('empty');
  });
  it('randomizes wrapping and authenticates stored records against tampering/corruption', async () => {
    const store = new MemoryStore(); const session = new ViewingKeySession(store); const passphrase = 'correct-local-passphrase';
    await session.save(DEMO_VIEWING_KEY, passphrase); const first = store.getItem(VIEWING_SESSION_KEY);
    await session.save(DEMO_VIEWING_KEY, passphrase); expect(store.getItem(VIEWING_SESSION_KEY)).not.toBe(first);
    const intact = store.getItem(VIEWING_SESSION_KEY) ?? '';
    store.setItem(VIEWING_SESSION_KEY, intact.replace(/"ciphertext":"../, match => match.slice(0, -2) + (match.endsWith('00') ? 'ff' : '00')));
    await expect(session.unlock(passphrase)).rejects.toMatchObject({ code: 'session' });
    store.setItem(VIEWING_SESSION_KEY, intact);
    store.setItem(VIEWING_SESSION_KEY, (store.getItem(VIEWING_SESSION_KEY) ?? '').replace('"iterations":600000', '"iterations":1'));
    expect(session.status()).toBe('corrupt'); await expect(session.unlock(passphrase)).rejects.toMatchObject({ code: 'session' });
    store.setItem(VIEWING_SESSION_KEY, 'not JSON'); expect(session.status()).toBe('corrupt');
  });
  it('refuses insufficient passphrases, unsupported key inputs and unavailable/denied storage', async () => {
    const session = new ViewingKeySession(new MemoryStore());
    await expect(session.save(DEMO_VIEWING_KEY, 'short')).rejects.toThrow('12–128');
    await expect(session.save('seed phrase', 'long-enough-passphrase')).rejects.toThrow('Viewing Key');
    expect(new ViewingKeySession(null).status()).toBe('unavailable');
    expect(new ViewingKeySession({ getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined }).status()).toBe('unavailable');
    await expect(new ViewingKeySession(null).save(DEMO_VIEWING_KEY, 'long-enough-passphrase')).rejects.toThrow('unavailable');
    const denied = new ViewingKeySession({ getItem: () => null, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } });
    await expect(denied.save(DEMO_VIEWING_KEY, 'long-enough-passphrase')).rejects.toThrow('could not be saved');
  });
  it('checks Unified Viewing Key envelope format without pretending to decrypt Orchard notes', async () => {
    const padding = new Uint8Array(16); padding.set(utf8('uview'));
    const unified = bech32m.encode('uview', bech32m.toWords(f4jumble(new Uint8Array([3, 96, ...new Uint8Array(96), ...padding]))), 2048);
    expect(viewingKeyKind(unified)).toBe('unified'); await expect(mockNoteKey(unified)).rejects.toMatchObject({ code: 'unsupported' });
    expect(() => viewingKeyKind('uview1not-a-key')).toThrow();
    const session = new ViewingKeySession(new MemoryStore()); await session.save(unified, 'correct-local-passphrase');
    expect(await session.unlock('correct-local-passphrase')).toBe(unified);
  });
  it('cancels a pending save before it can repopulate a forgotten session', async () => {
    const store = new MemoryStore(); const session = new ViewingKeySession(store);
    const pending = session.save(DEMO_VIEWING_KEY, 'correct-local-passphrase'); session.forget();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' }); expect(session.status()).toBe('empty');
  });
});
