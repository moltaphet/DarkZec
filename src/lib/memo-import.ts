import { unhex, utf8 } from '../protocol/crypto';
import { parseCommitMemo } from '../protocol/memo';
import { decodeBase64url } from './vault-memo';

export type ImportTransport = 'json' | 'hex' | 'base64url';
export interface ImportedCommitMemo {
  readonly auctionId: string;
  readonly commitment: string;
  readonly bytes: number;
  readonly transport: ImportTransport;
}
export interface MemoComparison { readonly matches: boolean; readonly detail: string }

// ignoreBOM keeps a leading BOM, so the canonical commit-memo check rejects it instead of it being stripped silently.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function decodeText(bytes: Uint8Array): string {
  try { return STRICT_UTF8.decode(bytes); } catch { throw new Error('The memo is not valid UTF-8.'); }
}

/**
 * Parses a commit memo copied out of a wallet. Wallets show the 512-byte field as text, as unpadded Base64url
 * (the ZIP-321 transport) or as hex with trailing zero padding (zcash-cli style). Only the public commit shape is accepted:
 * an auction ID and a hash, never a bid preimage.
 */
export function parseReceivedCommitMemo(input: string): ImportedCommitMemo {
  if (typeof input !== 'string') throw new Error('Paste the memo text from your wallet.');
  const value = input.replace(/\u0000+$/, '').trim();
  if (!value) throw new Error('Paste the memo text from your wallet.');
  if (value.length > 1100) throw new Error('A memo field is at most 512 bytes; this input is too long.');
  let transport: ImportTransport; let text: string;
  // Wallets and CLIs print hex in either case, sometimes with a 0x prefix.
  const hexDigits = /^0x/i.test(value) ? value.slice(2) : value;
  if (value.startsWith('{')) { transport = 'json'; text = value; }
  else if (/^(?:[a-fA-F0-9]{2})+$/.test(hexDigits)) {
    const bytes = unhex(hexDigits.toLowerCase());
    if (bytes.length > 512) throw new Error('A memo field is at most 512 bytes; this input is too long.');
    let end = bytes.length; while (end > 0 && bytes[end - 1] === 0) end--;
    if (bytes[0] !== 0x7b) throw new Error('The hex memo is not a JSON commit memo.');
    transport = 'hex'; text = decodeText(bytes.slice(0, end));
  } else {
    transport = 'base64url';
    let decoded: Uint8Array;
    try { decoded = decodeBase64url(value); } catch { throw new Error('The memo is not valid JSON, hex or unpadded Base64url.'); }
    text = decodeText(decoded);
  }
  let commit: ReturnType<typeof parseCommitMemo>;
  try { commit = parseCommitMemo(text); } catch { throw new Error('This is not a canonical DarkZec commit memo (v2, auction ID and commitment hash only).'); }
  return Object.freeze({ auctionId: commit.auctionId, commitment: commit.commitment, bytes: utf8(text).length, transport });
}

/** Compares an imported memo with the commitment of the request the user built, when there is one. */
export function compareWithRequest(imported: ImportedCommitMemo, expected?: { readonly auctionId: string; readonly commitment: string }): MemoComparison {
  if (!expected) return Object.freeze({ matches: false, detail: 'No request prepared in this view, so the commitment was validated but not compared.' });
  if (imported.auctionId !== expected.auctionId) return Object.freeze({ matches: false, detail: 'MISMATCH / the memo belongs to another auction.' });
  if (imported.commitment !== expected.commitment) return Object.freeze({ matches: false, detail: 'MISMATCH / the commitment differs from the request you prepared.' });
  return Object.freeze({ matches: true, detail: 'MATCH / the memo your wallet received is exactly the commitment of your prepared request.' });
}

export const memoFingerprint = (commitment: string): string => `${commitment.slice(0, 8)}…${commitment.slice(-8)}`;
