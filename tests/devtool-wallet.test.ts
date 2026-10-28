import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { devtoolReceivedNotes, devtoolStatus } from '../scripts/devtool-wallet';
import { listVaultMemos, localChainStatus } from '../scripts/zcash-rpc';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const commit = (hash: string) => JSON.stringify({ v: 2, t: 'commit', a: 'LIVE-001', c: hash });
const internalTxid = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const displayTxid = (n: number) => Buffer.from(internalTxid(n)).reverse().toString('hex');

/** A wallet directory with the zcash-devtool file layout and the v_tx_outputs columns the adapter reads. */
async function wallet(network: string, rows: readonly Record<string, unknown>[], tip: number | null = 100, tipAgeSeconds = 5): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'darkzec-devtool-'));
  await writeFile(join(dir, 'keys.toml'), `network = "${network}"\n`);
  const db = new DatabaseSync(join(dir, 'data.sqlite'));
  db.exec(`CREATE TABLE blocks (height INTEGER PRIMARY KEY, time INTEGER NOT NULL);
    CREATE TABLE v_tx_outputs (txid BLOB, tx_mined_height INTEGER, output_pool INTEGER, value INTEGER, memo BLOB, to_address TEXT,
      to_account_uuid TEXT, from_account_uuid TEXT, is_change INTEGER);`);
  if (tip !== null) db.prepare('INSERT INTO blocks (height, time) VALUES (?, ?)').run(tip, Math.floor(Date.now() / 1000) - tipAgeSeconds);
  const insert = db.prepare(`INSERT INTO v_tx_outputs VALUES (:txid, :mined, :pool, :value, :memo, :to, :toAccount, :fromAccount, :change)`);
  for (const row of rows) insert.run({ txid: internalTxid(1), mined: 95, pool: 4, value: 10_000_000, memo: Buffer.from(commit('a'.repeat(64))), to: TEST_VAULT,
    toAccount: 'vault', fromAccount: null, change: 0, ...row } as Record<string, null | number | string | Uint8Array>);
  db.close();
  return dir;
}

const dirs: string[] = [];
afterEach(async () => { delete process.env.DARKZEC_DEVTOOL_WALLET; for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('zcash-devtool vault wallet adapter', () => {
  it('reads only confirmed external notes at the vault receiver, in either shielded pool', async () => {
    const dir = await wallet('test', [
      { txid: internalTxid(1), pool: 4 },
      { txid: internalTxid(2), pool: 3, mined: 100 },
      { txid: internalTxid(3), pool: 2 },
      { txid: internalTxid(4), change: 1 },
      { txid: internalTxid(5), fromAccount: 'vault' },
      { txid: internalTxid(6), mined: null },
      { txid: internalTxid(7), to: TEST_REFUND },
      { txid: internalTxid(8), memo: null },
    ]);
    dirs.push(dir);
    expect(await devtoolStatus(dir)).toEqual({ network: 'testnet', tip: 100, tipTime: expect.any(Number) });
    const notes = await devtoolReceivedNotes(dir, TEST_VAULT);
    expect(notes.map(note => [note.txid, note.pool, note.confirmations])).toEqual([[displayTxid(1), 'ironwood', 6], [displayTxid(2), 'orchard', 1]]);
    expect(notes[0]?.memo).toHaveLength(1024);
    expect(Buffer.from(notes[0]?.memo ?? '', 'hex').subarray(0, commit('a'.repeat(64)).length).toString()).toBe(commit('a'.repeat(64)));
  });

  it('drives the chain status and vault memo listing when DARKZEC_DEVTOOL_WALLET is set', async () => {
    const dir = await wallet('test', [{ txid: internalTxid(1), memo: Buffer.from(commit('b'.repeat(64))) }]);
    dirs.push(dir); process.env.DARKZEC_DEVTOOL_WALLET = dir;
    await expect(localChainStatus()).resolves.toEqual({ connected: true, network: 'testnet', synced: true, blocks: 100, headers: 100, tipTime: expect.any(Number) });
    await expect(listVaultMemos(TEST_VAULT, 'LIVE-001', 10_000_000)).resolves.toEqual({
      status: 'ok', tip: 100, minConfirmations: 3, commits: [{ txid: displayTxid(1), commitment: 'b'.repeat(64), confirmations: 6, height: 95 }], reveals: [] });
  });

  it('reports a mainnet wallet, an unsynced wallet and a missing wallet without throwing', async () => {
    const main = await wallet('main', []); const empty = await wallet('test', [], null); dirs.push(main, empty);
    process.env.DARKZEC_DEVTOOL_WALLET = main;
    await expect(localChainStatus()).resolves.toMatchObject({ connected: true, network: 'mainnet', reason: 'wrong-network' });
    process.env.DARKZEC_DEVTOOL_WALLET = empty;
    await expect(localChainStatus()).resolves.toMatchObject({ connected: true, synced: false, reason: 'syncing' });
    process.env.DARKZEC_DEVTOOL_WALLET = join(tmpdir(), 'darkzec-no-such-wallet');
    await expect(localChainStatus()).resolves.toMatchObject({ connected: false, reason: 'node-unavailable' });
  });

  it('reports a wallet whose newest block is old as behind the network, not synced', async () => {
    const stale = await wallet('test', [], 100, 1_000); dirs.push(stale); process.env.DARKZEC_DEVTOOL_WALLET = stale;
    await expect(localChainStatus()).resolves.toMatchObject({ connected: true, synced: false, reason: 'syncing', blocks: 100 });
    process.env.DARKZEC_MAX_TIP_AGE_SECONDS = '5000';
    try { await expect(localChainStatus()).resolves.toMatchObject({ synced: true }); } finally { delete process.env.DARKZEC_MAX_TIP_AGE_SECONDS; }
    const fresh = await wallet('test', [], 100, 20); dirs.push(fresh); process.env.DARKZEC_DEVTOOL_WALLET = fresh;
    await expect(localChainStatus()).resolves.toMatchObject({ synced: true });
    const empty = await wallet('test', [], null); dirs.push(empty); process.env.DARKZEC_DEVTOOL_WALLET = empty;
    await expect(localChainStatus()).resolves.toMatchObject({ synced: false, reason: 'syncing' });
  });
});
