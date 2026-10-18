import { assertDistinctRefund, validateOrchardAddress } from '../protocol/address';
import type { Network } from '../protocol/address';
import { formatZec, parseZec } from '../protocol/amount';
import { commitment, freshSalt, hex, utf8 } from '../protocol/crypto';
import { encodeMemo, serializeBidMemo } from '../protocol/memo';
import { DEMO_BIDS, FIXTURE_ADDRESS, FIXTURE_REFUND_ADDRESS, SIMULATION_CONFIG } from '../fixtures';
import { DEMO_VIEWING_KEY, viewingKeyKind } from './viewing-key-session';
import { decodeHex, parseVaultMemo, VaultError } from './vault-memo';
import type { MemoTransport, ParsedVaultMemo, VaultErrorCode } from './vault-memo';
import { notifyAudit } from './security-events';
import type { AuditObserver, ScanAuditEvent } from './security-events';

export interface MockNote {
  readonly id: string;
  readonly network: Network;
  readonly vault: string;
  readonly auctionId: string;
  readonly commitment: string;
  readonly amount: string;
  readonly transport: MemoTransport;
  readonly ivHex: string;
  readonly encryptedMemoHex: string;
}
export interface ScanScope { readonly network: Network; readonly vault: string; readonly auctionId: string }
export const MOCK_SCAN_SCOPE: ScanScope = Object.freeze({ network: 'testnet', vault: FIXTURE_ADDRESS, auctionId: SIMULATION_CONFIG.auctionId });
export type ScannedNote =
  | { readonly status: 'accepted'; readonly id: string; readonly parsed: ParsedVaultMemo; readonly commitment: string; readonly memoHex: string }
  | { readonly status: 'empty'; readonly id: string }
  | { readonly status: 'rejected'; readonly id: string; readonly code: VaultErrorCode; readonly message: string };

export async function mockNoteKey(viewingKey: string): Promise<CryptoKey> {
  viewingKeyKind(viewingKey);
  const bytes = decodeHex(viewingKey.slice('mock:node07:'.length), 32);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('DARKZEC/mock-notes/v1'), info: utf8('memo-field-512') }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
function noteAAD(note: Omit<MockNote, 'ivHex' | 'encryptedMemoHex'>): Uint8Array<ArrayBuffer> {
  return utf8(JSON.stringify(['DARKZEC/mock-note/v1', note.id, note.network, note.vault, note.auctionId, note.commitment, note.amount, note.transport]));
}

export async function encryptMockNote(metadata: Omit<MockNote, 'ivHex' | 'encryptedMemoHex'>, field: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<MockNote> {
  if (field.length !== 512) throw new VaultError('format');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: noteAAD(metadata) }, key, field);
  return Object.freeze({ ...metadata, ivHex: hex(iv), encryptedMemoHex: hex(new Uint8Array(ciphertext)) });
}
export function paddedMockField(text: string): Uint8Array<ArrayBuffer> {
  const bytes = utf8(text);
  if (bytes.length > 512) throw new VaultError('format');
  const field = new Uint8Array(512); field.set(bytes); bytes.fill(0); return field;
}

export async function scanMockNotes(notes: readonly MockNote[], key: CryptoKey, scope: ScanScope,
  signal?: AbortSignal, progress?: (processed: number, total: number) => void, audit?: AuditObserver<ScanAuditEvent>): Promise<readonly ScannedNote[]> {
  if (notes.length > 128) throw new Error('Local scanner limit: 128 notes.');
  if (signal?.aborted) throw new VaultError('cancelled');
  scope = Object.freeze({ ...scope });
  const ids = new Set<string>(); const hashes = new Set<string>(); const results: ScannedNote[] = [];
  const snapshot = notes.map(note => ({ ...note }));
  notifyAudit(audit, { type: 'scan-started', total: snapshot.length });
  for (const note of snapshot) {
    if (signal?.aborted) throw new VaultError('cancelled');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      if (!/^NOTE-[0-9]{4}$/.test(note.id) || !/^[a-f0-9]{64}$/.test(note.commitment)) throw new VaultError('format');
      if (ids.has(note.id)) throw new VaultError('duplicate'); ids.add(note.id);
      if (note.network !== scope.network || note.vault !== scope.vault) throw new VaultError('destination');
      validateOrchardAddress(note.vault, scope.network);
      if (note.auctionId !== scope.auctionId) throw new VaultError('auction');
      const iv = decodeHex(note.ivHex, 12); const ciphertext = decodeHex(note.encryptedMemoHex, 528);
      notifyAudit(audit, { type: 'decryption-attempt' });
      try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: noteAAD(note) }, key, ciphertext)); }
      catch { throw new VaultError('authentication'); }
      if (signal?.aborted) throw new VaultError('cancelled');
      notifyAudit(audit, { type: 'decryption-succeeded' });
      const memoHex = hex(bytes);
      const parsed = parseVaultMemo(memoHex, note.transport, scope.network, scope.auctionId);
      if (!parsed) results.push(Object.freeze({ status: 'empty', id: note.id }));
      else {
        try { assertDistinctRefund(parsed.bid.refund, scope.vault, scope.network); } catch { throw new VaultError('refund'); }
        const hash = await commitment(parsed.bid);
        if (signal?.aborted) throw new VaultError('cancelled');
        if (hash !== note.commitment) throw new VaultError('commitment');
        if (hashes.has(hash)) throw new VaultError('duplicate');
        if (note.amount !== formatZec(parseZec(parsed.bid.price) * BigInt(parsed.bid.quantity))) throw new VaultError('escrow');
        hashes.add(hash); results.push(Object.freeze({ status: 'accepted', id: note.id, parsed, commitment: hash, memoHex }));
        notifyAudit(audit, { type: 'scan-memo-validated', bytes: parsed.jsonBytes });
      }
    } catch (error: unknown) {
      if (error instanceof VaultError && error.code === 'cancelled') throw error;
      const issue = error instanceof VaultError ? error : new VaultError('format');
      notifyAudit(audit, { type: 'note-rejected', authentication: issue.code === 'authentication' });
      results.push(Object.freeze({ status: 'rejected', id: /^NOTE-[0-9]{4}$/.test(note.id) ? note.id : 'INVALID NOTE', code: issue.code, message: issue.message }));
    } finally { bytes?.fill(0); }
    progress?.(results.length, snapshot.length);
  }
  if (signal?.aborted) throw new VaultError('cancelled');
  notifyAudit(audit, { type: 'scan-completed', accepted: results.filter(row => row.status === 'accepted').length,
    rejected: results.filter(row => row.status === 'rejected').length, empty: results.filter(row => row.status === 'empty').length });
  return Object.freeze(results);
}

export async function incomingDemoNote(index: number, key: CryptoKey): Promise<MockNote> {
  if (!Number.isInteger(index) || index < 1 || index > 128) throw new VaultError('format');
  const fixture = DEMO_BIDS[(index - 1) % DEMO_BIDS.length]; if (!fixture) throw new VaultError('format');
  const bid = { ...fixture, auctionId: SIMULATION_CONFIG.auctionId, salt: await freshSalt(SIMULATION_CONFIG.auctionId), refund: FIXTURE_REFUND_ADDRESS };
  const transport: MemoTransport = index % 2 === 0 ? 'base64url' : 'json';
  const memo = serializeBidMemo(bid, 'testnet'); const field = paddedMockField(transport === 'json' ? memo : encodeMemo(memo));
  try { return await encryptMockNote({ ...MOCK_SCAN_SCOPE, id: `NOTE-${String(index).padStart(4, '0')}`, commitment: await commitment(bid), amount: formatZec(parseZec(bid.price) * BigInt(bid.quantity)), transport }, field, key); }
  finally { field.fill(0); }
}
export async function createDemoNotes(): Promise<readonly MockNote[]> {
  const key = await mockNoteKey(DEMO_VIEWING_KEY);
  const notes = await Promise.all([1, 2, 3].map(index => incomingDemoNote(index, key)));
  const invalid = paddedMockField('{"v":2}'); const empty = new Uint8Array(512); empty[0] = 0xf6;
  try {
    notes.push(await encryptMockNote({ ...MOCK_SCAN_SCOPE, id: 'NOTE-0004', commitment: '4'.repeat(64), amount: '1', transport: 'json' }, invalid, key));
    notes.push(await encryptMockNote({ ...MOCK_SCAN_SCOPE, id: 'NOTE-0005', commitment: '5'.repeat(64), amount: '1', transport: 'json' }, empty, key));
  } finally { invalid.fill(0); empty.fill(0); }
  return Object.freeze(notes);
}
