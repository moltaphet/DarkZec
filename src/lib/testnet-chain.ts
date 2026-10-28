import { parseChainActivity } from './settlement';
import type { ChainActivity } from './settlement';

export interface LocalTestnetStatus {
  readonly connected: boolean;
  readonly network: 'testnet' | 'mainnet' | 'unknown';
  readonly synced: boolean;
  readonly blocks?: number;
  readonly headers?: number;
  readonly tipTime?: number;
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

export interface VaultCommitNote { readonly txid: string; readonly commitment: string; readonly confirmations: number; readonly height: number }
export interface VaultRevealNote { readonly txid: string; readonly memo: string; readonly confirmations: number; readonly height: number }
export type VaultMemoResult =
  | { readonly status: 'ok'; readonly tip: number; readonly minConfirmations: number; readonly commits: readonly VaultCommitNote[]; readonly reveals: readonly VaultRevealNote[] }
  | { readonly status: 'wrong-network' | 'syncing' | 'wallet-not-configured' | 'node-unavailable' | 'too-many-notes' };
const TXID = /^[a-f0-9]{64}$/;
const confirmed = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 1;

/** Commit and reveal memos the local wallet has received at the vault, oldest first. The reveal text is validated by the ledger. */
export async function fetchVaultMemos(address: string, auctionId: string, collateralZat: number): Promise<VaultMemoResult> {
  const value = await post<VaultMemoResult>('/api/chain/vault-memos', { address, auctionId, collateralZat });
  const invalid = (): never => { throw new Error('The local testnet checker returned invalid vault notes.'); };
  if (typeof value !== 'object' || value === null) return invalid();
  if (value.status !== 'ok') {
    if (!['wrong-network', 'syncing', 'wallet-not-configured', 'node-unavailable', 'too-many-notes'].includes(value.status)) invalid();
    return Object.freeze({ status: value.status });
  }
  if (!Array.isArray(value.commits) || !Array.isArray(value.reveals) || value.commits.length > 512 || value.reveals.length > 1024) return invalid();
  // Older local servers and fixtures omit heights; an unscheduled auction does not need them.
  const tip = Number.isSafeInteger(value.tip) ? value.tip : 0; const heightOf = (note: { height?: unknown; confirmations: number }): number => Number.isSafeInteger(note.height) ? note.height as number : tip > 0 ? tip - note.confirmations + 1 : 0;
  const commits = value.commits.map(note => {
    if (typeof note !== 'object' || note === null || !TXID.test(String(note.txid)) || !/^[a-f0-9]{64}$/.test(String(note.commitment)) || !confirmed(note.confirmations)) return invalid();
    return Object.freeze({ txid: note.txid, commitment: note.commitment, confirmations: note.confirmations, height: heightOf(note) });
  });
  const reveals = value.reveals.map(note => {
    if (typeof note !== 'object' || note === null || !TXID.test(String(note.txid)) || typeof note.memo !== 'string' || note.memo.length > 1024 || !confirmed(note.confirmations)) return invalid();
    return Object.freeze({ txid: note.txid, memo: note.memo, confirmations: note.confirmations, height: heightOf(note) });
  });
  const minConfirmations = Number.isSafeInteger(value.minConfirmations) && (value.minConfirmations as number) >= 1 && (value.minConfirmations as number) <= 100 ? value.minConfirmations : 1;
  return Object.freeze({ status: 'ok', tip, minConfirmations, commits: Object.freeze(commits), reveals: Object.freeze(reveals) });
}

/** What a published viewing key sees on testnet, read by the local server's view-only light wallet. */
export async function fetchViewKeyActivity(viewingKey: string, birthday: number): Promise<ChainActivity> {
  return parseChainActivity(await post<unknown>('/api/chain/view-activity', { viewingKey, birthday }));
}

/** A file of a real testnet run shipped with the site (same origin, static). */
export async function shipped(path: string): Promise<string> {
  if (!/^\/testnet\/DZ-TESTNET-\d+-(?:audit-bundle|chain-activity)\.json$/.test(path)) throw new Error('Unknown testnet run file.');
  const response = await fetch(new URL(path, location.origin), { cache: 'no-store' });
  if (!response.ok) throw new Error('The shipped testnet run could not be loaded.');
  return response.text();
}
