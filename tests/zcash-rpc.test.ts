import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSameLocalOrigin, listVaultMemos, localChainStatus, verifyLocalCommitPayment } from '../scripts/zcash-rpc';

const address = `utest1${'a'.repeat(40)}`;
const auctionId = 'NODE07-001';
const commitment = 'a'.repeat(64);
const txid = 'b'.repeat(64);
const memo = JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: commitment });
const memoHex = Buffer.concat([Buffer.from(memo), Buffer.alloc(512 - Buffer.byteLength(memo))]).toString('hex');
const padTo512 = (text: string) => Buffer.concat([Buffer.from(text), Buffer.alloc(512 - Buffer.byteLength(text))]).toString('hex');
const nodeInfo = { chain: 'test', blocks: 100, headers: 100, initialblockdownload: false };
const receivedNote = (overrides: Record<string, unknown> = {}) => ({
  pool: 'orchard', txid, confirmations: 2, amountZat: 1_000_000_000, memo: memoHex, ...overrides,
});

function mockRpc(notes: unknown[] = [receivedNote()]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    return new Response(JSON.stringify({
      result: request.method === 'getblockchaininfo' ? nodeInfo : notes,
      error: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('local Zcash testnet RPC', () => {
  // The suite's fixtures are one or two blocks deep; the default of three is exercised in its own tests below.
  beforeEach(() => { process.env.DARKZEC_MIN_CONFIRMATIONS = '1'; });
  afterEach(() => {
    delete process.env.DARKZEC_MIN_CONFIRMATIONS;
    vi.restoreAllMocks();
    delete process.env.DARKZEC_ZCASH_RPC_USER;
    delete process.env.DARKZEC_ZCASH_RPC_PASSWORD;
  });

  it('does not connect without local wallet RPC credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(localChainStatus()).resolves.toMatchObject({ connected: false, reason: 'wallet-not-configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('confirms one exact, confirmed Orchard payment and uses only the allow-listed RPC methods', async () => {
    process.env.DARKZEC_ZCASH_RPC_USER = 'local-user';
    process.env.DARKZEC_ZCASH_RPC_PASSWORD = 'local-password';
    const fetch = mockRpc();
    await expect(verifyLocalCommitPayment(address, auctionId, commitment)).resolves.toEqual({
      status: 'confirmed', txid, confirmations: 2, amountZat: 1_000_000_000,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { method: string; params: unknown[] });
    expect(calls.map(call => call.method)).toEqual(['getblockchaininfo', 'z_listreceivedbyaddress']);
    expect(calls[1]?.params).toEqual([address, 1]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:18232/');
    expect(fetch.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('rejects wrong amounts, memos, pools and unconfirmed notes', async () => {
    process.env.DARKZEC_ZCASH_RPC_USER = 'local-user';
    process.env.DARKZEC_ZCASH_RPC_PASSWORD = 'local-password';
    mockRpc([
      receivedNote({ amountZat: 999_999_999 }),
      receivedNote({ memo: '00'.repeat(512) }),
      receivedNote({ pool: 'sapling' }),
      receivedNote({ confirmations: 0 }),
    ]);
    await expect(verifyLocalCommitPayment(address, auctionId, commitment)).resolves.toEqual({ status: 'not-found' });
  });

  it('lists commit and reveal memos oldest first and ignores other auctions, tiers, pools and unconfirmed notes', async () => {
    process.env.DARKZEC_ZCASH_RPC_USER = 'local-user';
    process.env.DARKZEC_ZCASH_RPC_PASSWORD = 'local-password';
    const padded = (text: string) => Buffer.concat([Buffer.from(text), Buffer.alloc(512 - Buffer.byteLength(text))]).toString('hex');
    const commitOf = (hash: string, auction = auctionId) => padded(JSON.stringify({ v: 2, t: 'commit', a: auction, c: hash }));
    const reveal = JSON.stringify({ v: 1, a: auctionId, p: '0.72', q: 4, s: 'c'.repeat(64), r: address });
    mockRpc([
      receivedNote({ txid: '1'.repeat(64), confirmations: 3, memo: commitOf('d'.repeat(64)) }),
      receivedNote({ txid: '2'.repeat(64), confirmations: 9, memo: commitOf('e'.repeat(64)) }),
      receivedNote({ txid: '3'.repeat(64), confirmations: 1, amountZat: 10_000, memo: padded(reveal) }),
      receivedNote({ txid: '4'.repeat(64), memo: commitOf('f'.repeat(64), 'OTHER-001') }),
      receivedNote({ txid: '5'.repeat(64), amountZat: 100_000_000, memo: commitOf('9'.repeat(64)) }),
      receivedNote({ txid: '6'.repeat(64), pool: 'sapling', memo: commitOf('8'.repeat(64)) }),
      receivedNote({ txid: '7'.repeat(64), confirmations: 0, memo: commitOf('7'.repeat(64)) }),
      receivedNote({ txid: '8'.repeat(64), memo: padded(JSON.stringify({ v: 2, t: 'commit', c: 'a'.repeat(64), a: auctionId })) }),
    ]);
    await expect(listVaultMemos(address, auctionId, 1_000_000_000)).resolves.toEqual({
      status: 'ok', tip: 100, minConfirmations: 1,
      commits: [{ txid: '2'.repeat(64), commitment: 'e'.repeat(64), confirmations: 9, height: 92 }, { txid: '1'.repeat(64), commitment: 'd'.repeat(64), confirmations: 3, height: 98 }],
      reveals: [{ txid: '3'.repeat(64), memo: reveal, confirmations: 1, height: 100 }],
    });
    await expect(listVaultMemos(address, auctionId, 5)).rejects.toThrow('Invalid vault memo request.');
    await expect(verifyLocalCommitPayment(address, auctionId, commitment, 7)).rejects.toThrow('Invalid testnet commit verification request.');
  });

  it('rejects malformed requests and cross-origin browser calls', async () => {
    await expect(verifyLocalCommitPayment('u1bad', auctionId, commitment)).rejects.toThrow('Invalid testnet commit verification request.');
    const request = (origin: string, host = '127.0.0.1:4173') => ({ headers: { origin, host } }) as never;
    expect(checkSameLocalOrigin(request('http://127.0.0.1:4173'), 4173)).toBe(true);
    expect(checkSameLocalOrigin(request('http://attacker.test:4173'), 4173)).toBe(false);
    expect(checkSameLocalOrigin(request('http://localhost:4173'), 4173)).toBe(false);
    expect(checkSameLocalOrigin(request('http://127.0.0.1:4174'), 4173)).toBe(false);
  });

  it('requires three confirmations by default, and the requirement is configurable and reported', async () => {
    process.env.DARKZEC_ZCASH_RPC_USER = 'local-user'; process.env.DARKZEC_ZCASH_RPC_PASSWORD = 'local-password';
    delete process.env.DARKZEC_MIN_CONFIRMATIONS;
    const commitOf = (hash: string) => padTo512(JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: hash }));
    mockRpc([receivedNote({ txid: '1'.repeat(64), confirmations: 2, memo: commitOf('d'.repeat(64)) }), receivedNote({ txid: '2'.repeat(64), confirmations: 3, memo: commitOf('e'.repeat(64)) })]);
    const shallow = await listVaultMemos(address, auctionId, 1_000_000_000);
    expect(shallow).toMatchObject({ status: 'ok', minConfirmations: 3 }); if (shallow.status === 'ok') expect(shallow.commits.map(note => note.commitment)).toEqual(['e'.repeat(64)]);
    await expect(verifyLocalCommitPayment(address, auctionId, commitment, 1_000_000_000)).resolves.toEqual({ status: 'not-found' });
    process.env.DARKZEC_MIN_CONFIRMATIONS = '2';
    const deeper = await listVaultMemos(address, auctionId, 1_000_000_000); if (deeper.status === 'ok') expect(deeper).toMatchObject({ minConfirmations: 2 }), expect(deeper.commits).toHaveLength(2);
    process.env.DARKZEC_MIN_CONFIRMATIONS = 'banana'; expect(await listVaultMemos(address, auctionId, 1_000_000_000)).toMatchObject({ minConfirmations: 3 });
  });

  it('never cuts the list silently: hundreds of commits all come back, and too many is an explicit error', async () => {
    process.env.DARKZEC_ZCASH_RPC_USER = 'local-user'; process.env.DARKZEC_ZCASH_RPC_PASSWORD = 'local-password';
    const commitOf = (index: number) => padTo512(JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: index.toString(16).padStart(64, '0') }));
    const notes = (count: number) => Array.from({ length: count }, (_, index) => receivedNote({ txid: (index + 1).toString(16).padStart(64, '0'), confirmations: 5000 - index, memo: commitOf(index + 1) }));
    mockRpc(notes(300)); const many = await listVaultMemos(address, auctionId, 1_000_000_000);
    expect(many.status).toBe('ok'); if (many.status === 'ok') { expect(many.commits).toHaveLength(300); expect(many.commits[0]?.commitment).toBe((1).toString(16).padStart(64, '0')); expect(many.commits.at(-1)?.commitment).toBe((300).toString(16).padStart(64, '0')); }
    vi.restoreAllMocks(); mockRpc(notes(600)); await expect(listVaultMemos(address, auctionId, 1_000_000_000)).resolves.toEqual({ status: 'too-many-notes' });
  });
});
