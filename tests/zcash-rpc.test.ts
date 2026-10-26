import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSameLocalOrigin, localChainStatus, verifyLocalCommitPayment } from '../scripts/zcash-rpc';

const address = `utest1${'a'.repeat(40)}`;
const auctionId = 'NODE07-001';
const commitment = 'a'.repeat(64);
const txid = 'b'.repeat(64);
const memo = JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: commitment });
const memoHex = Buffer.concat([Buffer.from(memo), Buffer.alloc(512 - Buffer.byteLength(memo))]).toString('hex');
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
  afterEach(() => {
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

  it('rejects malformed requests and cross-origin browser calls', async () => {
    await expect(verifyLocalCommitPayment('u1bad', auctionId, commitment)).rejects.toThrow('Invalid testnet commit verification request.');
    const request = (origin: string, host = '127.0.0.1:4173') => ({ headers: { origin, host } }) as never;
    expect(checkSameLocalOrigin(request('http://127.0.0.1:4173'), 4173)).toBe(true);
    expect(checkSameLocalOrigin(request('http://attacker.test:4173'), 4173)).toBe(false);
    expect(checkSameLocalOrigin(request('http://localhost:4173'), 4173)).toBe(false);
    expect(checkSameLocalOrigin(request('http://127.0.0.1:4174'), 4173)).toBe(false);
  });
});
