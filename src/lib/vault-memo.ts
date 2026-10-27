import { utf8 } from '../protocol/crypto';
import { parseCommitMemo } from '../protocol/memo';

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

export interface ParsedCommitMemo {
  readonly commit: { readonly auctionId: string; readonly commitment: string };
  readonly transport: MemoTransport;
  readonly transportBytes: number;
  readonly jsonBytes: number;
}
// Fatal decoding refuses malformed UTF-8; ignoreBOM keeps a leading BOM so the canonical JSON check rejects it.
const decodeUtf8 = (bytes: Uint8Array): string => {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new VaultError('encoding'); }
};

/** Decodes an authenticated, decrypted 512-byte ZIP-302 field to its JSON text, or null for an empty memo. */
function decodeMemoField(memoHex: string, transport: MemoTransport): { readonly text: string; readonly transportBytes: number } | null {
  if (transport !== 'json' && transport !== 'base64url') throw new VaultError('encoding');
  const bytes = decodeHex(memoHex, 512); let payload: Uint8Array<ArrayBuffer> | undefined; let decoded: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (bytes[0] === 0xf6 && bytes.slice(1).every(byte => byte === 0)) return null;
    if ((bytes[0] ?? 255) >= 0xf5) throw new VaultError('encoding');
    let end = bytes.length; while (end > 0 && bytes[end - 1] === 0) end--;
    if (end === 0) return null;
    payload = bytes.slice(0, end); let text = decodeUtf8(payload);
    if (transport === 'base64url') { decoded = decodeBase64url(text); text = decodeUtf8(decoded); }
    return { text, transportBytes: end };
  } finally { bytes.fill(0); payload?.fill(0); decoded?.fill(0); }
}

/** Commit scanners never parse a bid preimage, even when the envelope is authenticated. */
export function parseVaultCommitMemo(memoHex: string, transport: MemoTransport, auctionId: string): ParsedCommitMemo | null {
  const field = decodeMemoField(memoHex, transport); if (!field) return null;
  let commit: ParsedCommitMemo['commit'];
  try { commit = parseCommitMemo(field.text); } catch { throw new VaultError('schema'); }
  if (commit.auctionId !== auctionId) throw new VaultError('auction');
  return Object.freeze({ commit, transport, transportBytes: field.transportBytes, jsonBytes: utf8(field.text).length });
}
