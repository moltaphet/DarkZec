import { randomUUID } from 'node:crypto';
import { devtoolReceivedNotes, devtoolStatus, devtoolWalletDir } from './devtool-wallet.ts';

type JsonRecord = Record<string, unknown>;
interface RpcEnvelope { readonly result?: unknown; readonly error?: { readonly message?: unknown } | null; readonly id?: unknown }
export interface LocalChainStatus {
  readonly connected: boolean;
  readonly network: 'testnet' | 'mainnet' | 'unknown';
  readonly synced: boolean;
  readonly blocks?: number;
  readonly headers?: number;
  /** Unix time of the newest block the local wallet has scanned (devtool wallets only). */
  readonly tipTime?: number;
  readonly reason?: 'wallet-not-configured' | 'node-unavailable' | 'wrong-network' | 'syncing';
}
export type CommitPaymentResult =
  | { readonly status: 'confirmed'; readonly txid: string; readonly confirmations: number; readonly amountZat: number }
  | { readonly status: 'not-found' }
  | { readonly status: 'wrong-network' }
  | { readonly status: 'syncing' }
  | { readonly status: 'wallet-not-configured' }
  | { readonly status: 'node-unavailable' };

const RPC_ENDPOINT = 'http://127.0.0.1:18232/';
/** Collateral tiers (0.1, 1, 10 or 100 ZEC). Every bid in one auction posts the same tier, so the amount reveals nothing. */
export const COLLATERAL_TIERS_ZAT: readonly number[] = Object.freeze([10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000]);
const DEFAULT_COLLATERAL_ZAT = 1_000_000_000;
const intFromEnv = (name: string, fallback: number, min: number, max: number): number => {
  const value = Number(process.env[name]); return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
/**
 * Confirmations a payment needs before it counts (default 3). One block is not final: a testnet reorganisation can drop a payment the
 * ledger already accepted, so a deeper requirement trades a little latency for safety. Set DARKZEC_MIN_CONFIRMATIONS (1 to 100).
 */
export const minConfirmations = (): number => intFromEnv('DARKZEC_MIN_CONFIRMATIONS', 3, 1, 100);
/** A wallet whose newest block is older than this is behind the network (default 300 s, 12 blocks). Set DARKZEC_MAX_TIP_AGE_SECONDS. */
const maxTipAgeSeconds = (): number => intFromEnv('DARKZEC_MAX_TIP_AGE_SECONDS', 300, 30, 86_400);
/** Notes scanned, commits and reveals returned per auction: beyond these the answer is an explicit error, never a silent cut. */
const MAX_NOTES = 8192; const MAX_COMMITS = 512; const MAX_REVEALS = 1024;
/** Payments to an Orchard receiver settle in the Ironwood pool since NU6.3; older Orchard-pool notes still count. */
const isShieldedPool = (pool: unknown): boolean => pool === 'orchard' || pool === 'ironwood';
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

function configuredCredentials(): { readonly user: string; readonly password: string } | undefined {
  const user = process.env.DARKZEC_ZCASH_RPC_USER;
  const password = process.env.DARKZEC_ZCASH_RPC_PASSWORD;
  if (!user || !password) return undefined;
  return { user, password };
}

/** Only a read-only, fixed-method connection to a local testnet wallet is allowed. */
async function rpc(method: 'getblockchaininfo' | 'z_listreceivedbyaddress', params: readonly unknown[] = []): Promise<unknown> {
  const credentials = configuredCredentials();
  if (!credentials) throw new Error('wallet-not-configured');
  const abort = AbortSignal.timeout(5_000);
  const response = await fetch(RPC_ENDPOINT, {
    method: 'POST', signal: abort, redirect: 'error',
    headers: {
      authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: randomUUID(), method, params }),
  });
  if (!response.ok) throw new Error('node-unavailable');
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('node-unavailable');
  const envelope = body as RpcEnvelope;
  if (envelope.error) throw new Error('node-unavailable');
  return envelope.result;
}

function chainInfo(value: unknown): { readonly chain: string; readonly blocks: number; readonly headers: number; readonly synced: boolean } {
  if (!isRecord(value) || typeof value.chain !== 'string' || !Number.isSafeInteger(value.blocks) || !Number.isSafeInteger(value.headers) || typeof value.initialblockdownload !== 'boolean') {
    throw new Error('node-unavailable');
  }
  return { chain: value.chain, blocks: value.blocks as number, headers: value.headers as number, synced: !value.initialblockdownload && value.blocks === value.headers };
}

function decodeMemoHex(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length !== 1024 || !/^[a-fA-F0-9]{1024}$/.test(value)) return undefined;
  const bytes = Buffer.from(value, 'hex');
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); }
  catch { return undefined; }
}

function matchesCommitMemo(value: unknown, auctionId: string, commitment: string): boolean {
  const memo = decodeMemoHex(isRecord(value) ? value.memo : undefined);
  return memo === JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: commitment });
}

/** A zcash-devtool vault wallet takes precedence when configured; otherwise the zcashd wallet RPC is used. */
export async function localChainStatus(): Promise<LocalChainStatus> {
  const devtool = devtoolWalletDir();
  if (devtool) {
    try {
      const { network, tip, tipTime } = await devtoolStatus(devtool);
      if (network !== 'testnet') return { connected: true, network, synced: false, reason: 'wrong-network' };
      if (tip === undefined) return { connected: true, network, synced: false, reason: 'syncing' };
      const time = tipTime === undefined ? {} : { tipTime };
      // The wallet only knows its own height, so freshness is judged by the age of its newest block: an old one means it is behind.
      if (tipTime !== undefined && Date.now() / 1000 - tipTime > maxTipAgeSeconds()) return { connected: true, network, synced: false, blocks: tip, headers: tip, ...time, reason: 'syncing' };
      return { connected: true, network, synced: true, blocks: tip, headers: tip, ...time };
    } catch { return { connected: false, network: 'unknown', synced: false, reason: 'node-unavailable' }; }
  }
  if (!configuredCredentials()) return { connected: false, network: 'unknown', synced: false, reason: 'wallet-not-configured' };
  try {
    const info = chainInfo(await rpc('getblockchaininfo'));
    const network = info.chain === 'test' ? 'testnet' : info.chain === 'main' ? 'mainnet' : 'unknown';
    if (network !== 'testnet') return { connected: true, network, synced: false, blocks: info.blocks, headers: info.headers, reason: 'wrong-network' };
    return {
      connected: true, network, synced: info.synced, blocks: info.blocks, headers: info.headers,
      ...(info.synced ? {} : { reason: 'syncing' as const }),
    };
  } catch {
    return { connected: false, network: 'unknown', synced: false, reason: 'node-unavailable' };
  }
}

/** Notes received at the vault in z_listreceivedbyaddress shape, from whichever local wallet is configured. */
async function receivedNotes(address: string): Promise<unknown> {
  const devtool = devtoolWalletDir();
  return devtool ? devtoolReceivedNotes(devtool, address) : rpc('z_listreceivedbyaddress', [address, 1]);
}

export async function verifyLocalCommitPayment(address: string, auctionId: string, commitment: string, collateralZat = DEFAULT_COLLATERAL_ZAT): Promise<CommitPaymentResult> {
  if (!/^utest1[023456789acdefghjklmnpqrstuvwxyz]{40,250}$/.test(address) ||
    !/^[A-Za-z0-9_-]{1,48}$/.test(auctionId) || !/^[a-f0-9]{64}$/.test(commitment) || !COLLATERAL_TIERS_ZAT.includes(collateralZat)) {
    throw new Error('Invalid testnet commit verification request.');
  }
  const status = await localChainStatus();
  if (status.reason === 'wallet-not-configured') return { status: 'wallet-not-configured' };
  if (status.reason === 'node-unavailable') return { status: 'node-unavailable' };
  if (status.network !== 'testnet') return { status: 'wrong-network' };
  if (!status.synced) return { status: 'syncing' };

  try {
    // The local wallet scans with viewing authority it already holds.
    // No viewing key, wallet credentials, or RPC URL enters the browser request.
    const notes: unknown = await receivedNotes(address);
    if (!Array.isArray(notes)) throw new Error('node-unavailable');
    const matches = notes.filter((note: unknown) => isRecord(note) && isShieldedPool(note.pool) &&
      note.txid && /^[a-f0-9]{64}$/.test(String(note.txid)) &&
      Number.isSafeInteger(note.confirmations) && Number(note.confirmations) >= minConfirmations() &&
      Number.isSafeInteger(note.amountZat) && Number(note.amountZat) === collateralZat &&
      matchesCommitMemo(note, auctionId, commitment));
    if (matches.length === 0) return { status: 'not-found' };
    if (matches.length !== 1) return { status: 'not-found' };
    const match = matches[0];
    if (!isRecord(match)) return { status: 'not-found' };
    return {
      status: 'confirmed', txid: String(match.txid),
      confirmations: Number(match.confirmations), amountZat: collateralZat,
    };
  } catch {
    return { status: 'node-unavailable' };
  }
}

export interface VaultCommitNote { readonly txid: string; readonly commitment: string; readonly confirmations: number; readonly height: number }
export interface VaultRevealNote { readonly txid: string; readonly memo: string; readonly confirmations: number; readonly height: number }
export type VaultMemoResult =
  | { readonly status: 'ok'; readonly tip: number; readonly minConfirmations: number; readonly commits: readonly VaultCommitNote[]; readonly reveals: readonly VaultRevealNote[] }
  | { readonly status: 'wrong-network' | 'syncing' | 'wallet-not-configured' | 'node-unavailable' | 'too-many-notes' };

/**
 * Reads every confirmed Orchard note the local wallet can view at the vault and classifies its memo:
 * exact commit memos carrying the auction's collateral tier, and reveal receipts for the same auction.
 * Notes are returned oldest first, so the ledger's tie priority follows chain order rather than operator choice.
 * Reveal receipts are only shape-checked here; the browser ledger validates them completely.
 */
export async function listVaultMemos(address: string, auctionId: string, collateralZat: number): Promise<VaultMemoResult> {
  if (!/^utest1[023456789acdefghjklmnpqrstuvwxyz]{40,250}$/.test(address) || !/^[A-Za-z0-9_-]{1,48}$/.test(auctionId) || !COLLATERAL_TIERS_ZAT.includes(collateralZat)) {
    throw new Error('Invalid vault memo request.');
  }
  const status = await localChainStatus();
  if (status.reason === 'wallet-not-configured') return { status: 'wallet-not-configured' };
  if (status.reason === 'node-unavailable') return { status: 'node-unavailable' };
  if (status.network !== 'testnet') return { status: 'wrong-network' };
  if (!status.synced) return { status: 'syncing' };
  let notes: unknown;
  try { notes = await receivedNotes(address); } catch { return { status: 'node-unavailable' }; }
  if (!Array.isArray(notes)) return { status: 'node-unavailable' };
  const confirmed = notes.filter((note: unknown): note is JsonRecord => isRecord(note) && isShieldedPool(note.pool) && /^[a-f0-9]{64}$/.test(String(note.txid)) &&
    Number.isSafeInteger(note.confirmations) && Number(note.confirmations) >= minConfirmations() && Number.isSafeInteger(note.amountZat) && Number(note.amountZat) > 0)
    .sort((a, b) => Number(b.confirmations) - Number(a.confirmations) || String(a.txid).localeCompare(String(b.txid)));
  const tip = status.blocks; if (!Number.isSafeInteger(tip)) return { status: 'node-unavailable' };
  // Every note at the vault is read: a silent cut would hide the newest payments (the list is oldest first), so too many is an explicit error.
  if (confirmed.length > MAX_NOTES) return { status: 'too-many-notes' };
  const commits: VaultCommitNote[] = []; const reveals: VaultRevealNote[] = []; const seen = new Set<string>();
  for (const note of confirmed) {
    const memo = decodeMemoHex(note.memo); if (!memo || seen.has(memo)) continue;
    let value: unknown;
    try { value = JSON.parse(memo); } catch { continue; }
    if (!isRecord(value) || value.a !== auctionId) continue;
    const txid = String(note.txid); const confirmations = Number(note.confirmations); const height = (tip as number) - confirmations + 1;
    if (value.v === 2 && value.t === 'commit' && typeof value.c === 'string' && /^[a-f0-9]{64}$/.test(value.c) && matchesCommitMemo(note, auctionId, value.c)) {
      if (Number(note.amountZat) !== collateralZat) continue;
      seen.add(memo); commits.push({ txid, commitment: value.c, confirmations, height });
    } else if (value.v === 1 && Buffer.byteLength(memo) <= 512) {
      seen.add(memo); reveals.push({ txid, memo, confirmations, height });
    }
  }
  if (commits.length > MAX_COMMITS || reveals.length > MAX_REVEALS) return { status: 'too-many-notes' };
  return { status: 'ok', tip: tip as number, minConfirmations: minConfirmations(), commits, reveals };
}

export function checkSameLocalOrigin(request: import('node:http').IncomingMessage, port: number): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host === host &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === String(port);
  } catch { return false; }
}

export async function readJsonBody(request: import('node:http').IncomingMessage, maximumBytes = 4096): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('invalid-body');
    size += chunk.length;
    if (size > maximumBytes) throw new Error('invalid-body');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('invalid-body'); }
}
