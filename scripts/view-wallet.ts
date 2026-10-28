import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openReadOnly } from './devtool-wallet.ts';
import type { ChainActivity, ChainOutput } from '../src/lib/settlement.ts';

/**
 * View-only light wallet built from a published unified full viewing key with zcash-devtool
 * (`init-fvk`, then `sync` and `enhance`). It can see what the key's account received and paid out, never spend.
 * Each key gets its own cache directory, so repeated checks only scan new blocks.
 */
const run = promisify(execFile);
const VIEWING_KEY = /^uviewtest1[023456789acdefghjklmnpqrstuvwxyz]{100,1200}$/;
const devtool = (): string => process.env.DARKZEC_DEVTOOL_BIN || 'zcash-devtool';
const cacheRoot = (): string => process.env.DARKZEC_VIEW_CACHE || join(tmpdir(), 'darkzec-view');
const pending = new Map<string, Promise<ChainActivity>>();

export const isTestnetViewingKey = (value: unknown): value is string => typeof value === 'string' && VIEWING_KEY.test(value);

async function devtoolRun(args: readonly string[]): Promise<void> {
  // Arguments go straight to the binary, never through a shell; the key never reaches a log.
  await run(devtool(), [...args], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
}

/** Trailing zero padding is dropped; 0xF6 marks "no memo"; non-UTF-8 memos are kept as hex. */
function memoText(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0 || bytes[0] === 0xf6) return null;
  let end = bytes.length; while (end > 0 && bytes[end - 1] === 0) end--;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); } catch { return Buffer.from(bytes.subarray(0, end)).toString('hex'); }
}

async function readActivity(dir: string): Promise<ChainActivity> {
  const db = await openReadOnly(dir);
  try {
    const tip = (db.prepare('SELECT MAX(height) AS tip FROM blocks').get() as { tip: number | null } | undefined)?.tip;
    if (typeof tip !== 'number') throw new Error('node-unavailable');
    const rows = db.prepare(`SELECT txid, tx_mined_height AS height, value, to_address, memo, from_account_uuid IS NOT NULL AS outgoing, to_account_uuid IS NOT NULL AS incoming
      FROM v_tx_outputs WHERE tx_mined_height IS NOT NULL AND is_change = 0 ORDER BY tx_mined_height, output_index`).all() as
      { txid: Uint8Array; height: number; value: number; to_address: string | null; memo: Uint8Array | null; outgoing: number; incoming: number }[];
    const received: ChainOutput[] = []; const sent: ChainOutput[] = [];
    for (const row of rows) {
      // Stored in internal byte order; explorers and RPCs display txids reversed.
      const output = Object.freeze({ txid: Buffer.from(row.txid).reverse().toString('hex'), height: row.height, amountZat: row.value, address: row.to_address, memo: memoText(row.memo) });
      if (row.outgoing) sent.push(output); else if (row.incoming) received.push(output);
    }
    return Object.freeze({ tip, received: Object.freeze(received), sent: Object.freeze(sent) });
  } finally { db.close(); }
}

async function scan(viewingKey: string, birthday: number): Promise<ChainActivity> {
  const dir = join(cacheRoot(), createHash('sha256').update(viewingKey).digest('hex').slice(0, 24));
  let fresh = false;
  try { await access(join(dir, 'keys.toml')); } catch { fresh = true; }
  try {
    if (fresh) {
      await rm(dir, { recursive: true, force: true }); await mkdir(cacheRoot(), { recursive: true });
      await devtoolRun(['wallet', '-w', dir, 'init-fvk', '--name', 'darkzec-view', '--fvk', viewingKey, '--birthday', String(birthday)]);
    }
    await devtoolRun(['wallet', '-w', dir, 'sync']);
    // Compact blocks carry no memos; enhance fetches the full transactions, which also reveals outgoing outputs.
    await devtoolRun(['wallet', '-w', dir, 'enhance']);
  } catch {
    if (fresh) await rm(dir, { recursive: true, force: true });
    throw new Error('node-unavailable');
  }
  return readActivity(dir);
}

/** Everything the published key's account received and paid out, read from the public testnet. */
export async function viewKeyActivity(viewingKey: string, birthday: number): Promise<ChainActivity> {
  if (!isTestnetViewingKey(viewingKey) || !Number.isSafeInteger(birthday) || birthday < 280_000 || birthday > 100_000_000) throw new Error('Invalid testnet viewing key request.');
  const key = `${viewingKey}:${birthday}`;
  const running = pending.get(key); if (running) return running;
  const task = scan(viewingKey, birthday).finally(() => pending.delete(key));
  pending.set(key, task); return task;
}
