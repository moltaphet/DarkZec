import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Read-only adapter for a zcash-devtool light wallet (https://github.com/zcash/zcash-devtool) that views the vault.
 * The operator keeps it current with `zcash-devtool wallet -w <dir> sync` followed by `enhance`: compact-block sync
 * records received notes without their memos, and `enhance` downloads the full transactions that carry them.
 * This server only reads the wallet's SQLite data.
 * No key material is read: keys.toml is consulted for the network name only, and the seed stays age-encrypted.
 */
/** `tipTime` is the Unix time of the newest scanned block: a wallet that is behind the network shows an old one. */
export interface DevtoolStatus { readonly network: 'testnet' | 'mainnet' | 'unknown'; readonly tip: number | undefined; readonly tipTime: number | undefined }
/** Same shape as a z_listreceivedbyaddress entry, so both sources share one matching path. */
export interface ReceivedNote { readonly pool: 'orchard' | 'ironwood'; readonly txid: string; readonly confirmations: number; readonly amountZat: number; readonly memo: string }

export const devtoolWalletDir = (): string | undefined => process.env.DARKZEC_DEVTOOL_WALLET || undefined;

export async function openReadOnly(dir: string): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(join(dir, 'data.sqlite'), { readOnly: true });
}

export async function devtoolStatus(dir: string): Promise<DevtoolStatus> {
  const keys = await readFile(join(dir, 'keys.toml'), 'utf8');
  const name = /^\s*network\s*=\s*"([a-z]+)"/m.exec(keys)?.[1];
  const network = name === 'test' ? 'testnet' : name === 'main' ? 'mainnet' : 'unknown';
  const db = await openReadOnly(dir);
  try {
    const row = db.prepare('SELECT height AS tip, time AS tipTime FROM blocks ORDER BY height DESC LIMIT 1').get() as { tip: number | null; tipTime: number | null } | undefined;
    return { network, tip: typeof row?.tip === 'number' ? row.tip : undefined, tipTime: typeof row?.tipTime === 'number' ? row.tipTime : undefined };
  } finally { db.close(); }
}

/**
 * Confirmed notes from other wallets, received at the vault's Orchard receiver, with their 512-byte memo field.
 * Since NU6.3 new payments to an Orchard receiver settle in the Ironwood pool (pool code 4); legacy Orchard-pool
 * notes (pool code 3) are still read.
 */
export async function devtoolReceivedNotes(dir: string, address: string): Promise<readonly ReceivedNote[]> {
  // Loaded lazily so the default zcashd path never touches the browser protocol module.
  const { orchardPaymentAddress } = await import('../src/protocol/address.ts');
  const vault = orchardPaymentAddress(address, 'testnet');
  const db = await openReadOnly(dir);
  try {
    const tip = (db.prepare('SELECT MAX(height) AS tip FROM blocks').get() as { tip: number | null } | undefined)?.tip;
    if (typeof tip !== 'number') return [];
    const rows = db.prepare(`SELECT txid, tx_mined_height AS mined_height, output_pool, value, memo, to_address FROM v_tx_outputs
      WHERE output_pool IN (3, 4) AND to_account_uuid IS NOT NULL AND from_account_uuid IS NULL AND is_change = 0
        AND tx_mined_height IS NOT NULL AND memo IS NOT NULL`).all() as { txid: Uint8Array; mined_height: number; output_pool: number; value: number; memo: Uint8Array; to_address: string | null }[];
    const notes: ReceivedNote[] = [];
    for (const row of rows) {
      let destination: string;
      try { destination = orchardPaymentAddress(String(row.to_address), 'testnet'); } catch { continue; }
      if (destination !== vault || row.memo.length > 512 || row.txid.length !== 32) continue;
      const field = Buffer.alloc(512); field.set(row.memo);
      // The wallet stores txids in internal byte order; explorers and RPCs display them reversed.
      notes.push({ pool: row.output_pool === 4 ? 'ironwood' : 'orchard', txid: Buffer.from(row.txid).reverse().toString('hex'), confirmations: tip - row.mined_height + 1,
        amountZat: row.value, memo: field.toString('hex') });
    }
    return notes;
  } finally { db.close(); }
}
