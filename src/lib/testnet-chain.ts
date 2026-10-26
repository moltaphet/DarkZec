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

export async function verifyTestnetCommit(address: string, auctionId: string, commitment: string): Promise<CommitPaymentResult> {
  const value = await post<CommitPaymentResult>('/api/chain/verify', { address, auctionId, commitment });
  if (!['confirmed', 'not-found', 'wrong-network', 'syncing', 'wallet-not-configured', 'node-unavailable'].includes(value.status)) {
    throw new Error('The local testnet checker returned an invalid result.');
  }
  if (value.status === 'confirmed' && (!/^[a-f0-9]{64}$/.test(value.txid) || !Number.isSafeInteger(value.confirmations) || value.confirmations < 1 || value.amountZat !== 1_000_000_000)) {
    throw new Error('The local testnet checker returned invalid transaction details.');
  }
  return Object.freeze(value);
}
