export interface LocalTestnetStatus {
  readonly connected: boolean;
  readonly network: 'testnet' | 'mainnet' | 'unknown';
  readonly synced: boolean;
  readonly blocks?: number;
  readonly headers?: number;
  readonly reason?: 'wallet-not-configured' | 'node-unavailable' | 'wrong-network' | 'syncing';
}
export type CommitPaymentResult =
  | { readonly status: 'confirmed'; readonly txid: string; readonly confirmations: number; readonly amountZat: number }
  | { readonly status: 'not-found' | 'wrong-network' | 'syncing' | 'wallet-not-configured' | 'node-unavailable' };

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, location.origin), {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('The local testnet checker could not answer.');
  return await response.json() as T;
}

export async function localTestnetStatus(): Promise<LocalTestnetStatus> {
  const value = await post<LocalTestnetStatus>('/api/chain/status', {});
  if (typeof value.connected !== 'boolean' || typeof value.synced !== 'boolean' || !['testnet', 'mainnet', 'unknown'].includes(value.network)) {
    throw new Error('The local testnet checker returned an invalid status.');
  }
  return Object.freeze(value);
}

export async function verifyTestnetCommit(address: string, auctionId: string, commitment: string, collateralZat = 1_000_000_000): Promise<CommitPaymentResult> {
  const value = await post<CommitPaymentResult>('/api/chain/verify', { address, auctionId, commitment, collateralZat });
  if (!['confirmed', 'not-found', 'wrong-network', 'syncing', 'wallet-not-configured', 'node-unavailable'].includes(value.status)) {
    throw new Error('The local testnet checker returned an invalid result.');
  }
  if (value.status === 'confirmed' && (!/^[a-f0-9]{64}$/.test(value.txid) || !Number.isSafeInteger(value.confirmations) || value.confirmations < 1 || value.amountZat !== collateralZat)) {
    throw new Error('The local testnet checker returned invalid transaction details.');
  }
  return Object.freeze(value);
}

export interface VaultCommitNote { readonly txid: string; readonly commitment: string; readonly confirmations: number }
export interface VaultRevealNote { readonly txid: string; readonly memo: string; readonly confirmations: number }
export type VaultMemoResult =
  | { readonly status: 'ok'; readonly commits: readonly VaultCommitNote[]; readonly reveals: readonly VaultRevealNote[] }
  | { readonly status: 'wrong-network' | 'syncing' | 'wallet-not-configured' | 'node-unavailable' };
const TXID = /^[a-f0-9]{64}$/;
const confirmed = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 1;

/** Commit and reveal memos the local wallet has received at the vault, oldest first. The reveal text is validated by the ledger. */
export async function fetchVaultMemos(address: string, auctionId: string, collateralZat: number): Promise<VaultMemoResult> {
  const value = await post<VaultMemoResult>('/api/chain/vault-memos', { address, auctionId, collateralZat });
  const invalid = (): never => { throw new Error('The local testnet checker returned invalid vault notes.'); };
  if (typeof value !== 'object' || value === null) return invalid();
  if (value.status !== 'ok') {
    if (!['wrong-network', 'syncing', 'wallet-not-configured', 'node-unavailable'].includes(value.status)) invalid();
    return Object.freeze({ status: value.status });
  }
  if (!Array.isArray(value.commits) || !Array.isArray(value.reveals) || value.commits.length > 128 || value.reveals.length > 128) return invalid();
  const commits = value.commits.map(note => {
    if (typeof note !== 'object' || note === null || !TXID.test(String(note.txid)) || !/^[a-f0-9]{64}$/.test(String(note.commitment)) || !confirmed(note.confirmations)) return invalid();
    return Object.freeze({ txid: note.txid, commitment: note.commitment, confirmations: note.confirmations });
  });
  const reveals = value.reveals.map(note => {
    if (typeof note !== 'object' || note === null || !TXID.test(String(note.txid)) || typeof note.memo !== 'string' || note.memo.length > 1024 || !confirmed(note.confirmations)) return invalid();
    return Object.freeze({ txid: note.txid, memo: note.memo, confirmations: note.confirmations });
  });
  return Object.freeze({ status: 'ok', commits: Object.freeze(commits), reveals: Object.freeze(reveals) });
}
