import { randomUUID } from 'node:crypto';

type JsonRecord = Record<string, unknown>;
interface RpcEnvelope { readonly result?: unknown; readonly error?: { readonly message?: unknown } | null; readonly id?: unknown }
export interface LocalChainStatus {
  readonly connected: boolean;
  readonly network: 'testnet' | 'mainnet' | 'unknown';
  readonly synced: boolean;
  readonly blocks?: number;
  readonly headers?: number;
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
const MINIMUM_COLLATERAL_ZAT = 1_000_000_000;
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

export async function localChainStatus(): Promise<LocalChainStatus> {
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

export async function verifyLocalCommitPayment(address: string, auctionId: string, commitment: string): Promise<CommitPaymentResult> {
  if (!/^utest1[023456789acdefghjklmnpqrstuvwxyz]{40,250}$/.test(address) ||
    !/^[A-Za-z0-9_-]{1,48}$/.test(auctionId) || !/^[a-f0-9]{64}$/.test(commitment)) {
    throw new Error('Invalid testnet commit verification request.');
  }
  const status = await localChainStatus();
  if (status.reason === 'wallet-not-configured') return { status: 'wallet-not-configured' };
  if (status.reason === 'node-unavailable') return { status: 'node-unavailable' };
  if (status.network !== 'testnet') return { status: 'wrong-network' };
  if (!status.synced) return { status: 'syncing' };

  try {
    // z_listreceivedbyaddress scans with viewing authority already held by the local wallet.
    // No viewing key, wallet credentials, or RPC URL enters the browser request.
    const notes: unknown = await rpc('z_listreceivedbyaddress', [address, 1]);
    if (!Array.isArray(notes)) throw new Error('node-unavailable');
    const matches = notes.filter((note: unknown) => isRecord(note) && note.pool === 'orchard' &&
      note.txid && /^[a-f0-9]{64}$/.test(String(note.txid)) &&
      Number.isSafeInteger(note.confirmations) && Number(note.confirmations) >= 1 &&
      Number.isSafeInteger(note.amountZat) && Number(note.amountZat) === MINIMUM_COLLATERAL_ZAT &&
      matchesCommitMemo(note, auctionId, commitment));
    if (matches.length === 0) return { status: 'not-found' };
    if (matches.length !== 1) return { status: 'not-found' };
    const match = matches[0];
    if (!isRecord(match)) return { status: 'not-found' };
    return {
      status: 'confirmed', txid: String(match.txid),
      confirmations: Number(match.confirmations), amountZat: MINIMUM_COLLATERAL_ZAT,
    };
  } catch {
    return { status: 'node-unavailable' };
  }
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
