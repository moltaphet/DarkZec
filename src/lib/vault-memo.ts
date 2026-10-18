import type { Network } from '../protocol/address';
import { utf8 } from '../protocol/crypto';
import { parseBidMemo } from '../protocol/memo';
import type { BidMemo } from '../protocol/memo';

export type MemoTransport = 'json' | 'base64url';
export type VaultErrorCode = 'format' | 'encoding' | 'schema' | 'auction' | 'authentication' | 'commitment' | 'escrow' | 'destination' | 'duplicate' | 'refund' | 'unsupported' | 'session' | 'cancelled';
const ERRORS: Readonly<Record<VaultErrorCode, string>> = {
  format: 'Invalid note or 512-byte memo field.', encoding: 'Invalid memo encoding or noncanonical Base64url.',
  schema: 'Bid schema or Orchard refund validation failed.', auction: 'Note belongs to another auction.',
  authentication: 'Note authentication failed. Check the mock viewing key.', commitment: 'Bid commitment does not match the note.',
  escrow: 'Bid escrow does not match the note.', destination: 'Note network or vault destination does not match.',
  duplicate: 'Duplicate note identifier or commitment.', unsupported: 'Real Orchard scanning requires an audited adapter. Use the mock key for this local scanner.',
  refund: 'Security error: refund address must differ from the auction vault.',
  session: 'Saved session is invalid or the unlock passphrase is incorrect.', cancelled: 'Vault operation cancelled.',
};
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode) { super(ERRORS[code]); this.name = 'VaultError'; this.code = code; }
}

export function decodeHex(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (value.length !== length * 2 || !/^[a-fA-F0-9]+$/.test(value)) throw new VaultError('format');
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

export function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || value.length > 683 || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new VaultError('encoding');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch { throw new VaultError('encoding'); }
  const canonical = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (bytes.length > 512 || canonical !== value) throw new VaultError('encoding');
  return bytes;
}

export interface ParsedVaultMemo {
  readonly bid: BidMemo;
  readonly transport: MemoTransport;
  readonly transportBytes: number;
  readonly jsonBytes: number;
}

/** Input is the authenticated, decrypted field. Ciphertext is never stripped or decoded here. */
export function parseVaultMemo(memoHex: string, transport: MemoTransport, network: Network, auctionId: string): ParsedVaultMemo | null {
  if (transport !== 'json' && transport !== 'base64url') throw new VaultError('encoding');
  const bytes = decodeHex(memoHex, 512);
  try {
    if (bytes[0] === 0xf6 && bytes.slice(1).every(byte => byte === 0)) return null;
    if ((bytes[0] ?? 255) >= 0xf5) throw new VaultError('encoding');
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    if (end === 0) return null;
    const payload = bytes.slice(0, end);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload); }
    catch { throw new VaultError('encoding'); }
    let decoded: Uint8Array<ArrayBuffer> | undefined;
    try {
      if (transport === 'base64url') {
        decoded = decodeBase64url(text);
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded); }
        catch { throw new VaultError('encoding'); }
      }
      let bid: BidMemo;
      try { bid = parseBidMemo(text, network); } catch { throw new VaultError('schema'); }
      if (bid.auctionId !== auctionId) throw new VaultError('auction');
      return Object.freeze({ bid: Object.freeze(bid), transport, transportBytes: end, jsonBytes: utf8(text).length });
    } finally { payload.fill(0); decoded?.fill(0); }
  } finally { bytes.fill(0); }
}
