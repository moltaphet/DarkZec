import { assertDistinctRefund, orchardPaymentAddress, validateOrchardAddress } from './address';
import type { Network } from './address';
import { formatZec, MAX_MONEY, parseZec, validateAuctionId } from './amount';
import { canonicalPreimage, commitment, freshSalt, utf8 } from './crypto';
import type { BidPreimage } from './crypto';
import { notifyAudit } from '../lib/security-events';
import type { AuditObserver, ProtocolAuditEvent } from '../lib/security-events';

export const MEMO_LIMIT = 512;
export const DEFAULT_COLLATERAL = '10';
export function memoBytes(text: string): Uint8Array<ArrayBuffer> {
  // Reject unpaired UTF-16 surrogates instead of silently replacing them during UTF-8 encoding.
  if (/([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(text)) throw new Error('Memo contains invalid Unicode.');
  const bytes = utf8(text);
  if (bytes.length > MEMO_LIMIT) throw new Error(`Memo is ${bytes.length} bytes; maximum is 512 bytes.`);
  return bytes;
}
export function encodeMemo(text: string): string {
  const bytes = memoBytes(text); // Audit BEFORE encoding, including for callers outside the UI.
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type BidMemo = BidPreimage;
export function serializeBidMemo(bid: BidMemo, network: Network): string {
  canonicalPreimage(bid);
  validateOrchardAddress(bid.refund, network);
  const text = JSON.stringify({ v: 1, a: bid.auctionId, p: bid.price, q: bid.quantity, s: bid.salt, r: bid.refund });
  memoBytes(text);
  return text;
}

export function parseBidMemo(text: string, network: Network): BidMemo {
  memoBytes(text);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid bid memo JSON.'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid bid memo.');
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(record).sort().join(',') !== 'a,p,q,r,s,v' || record.v !== 1 || typeof record.a !== 'string' || typeof record.p !== 'string' || typeof record.q !== 'number' || typeof record.s !== 'string' || typeof record.r !== 'string') throw new Error('Invalid bid memo schema.');
  const bid: BidMemo = { auctionId: record.a, price: record.p, quantity: record.q, salt: record.s, refund: record.r };
  if (serializeBidMemo(bid, network) !== text) throw new Error('Bid memo must use canonical JSON.');
  return bid;
}

export interface PaymentRequest {
  readonly address: string;
  readonly amount: string;
  readonly memo: string;
  readonly network: Network;
}
/** A URI is a sensitive plaintext payment instruction. The wallet encrypts its on-chain memo. */
export function buildPaymentUri(request: PaymentRequest): string {
  const address = orchardPaymentAddress(request.address, request.network);
  const amount = parseZec(request.amount);
  if (amount === 0n) throw new Error('Payment amount must be positive.');
  return `zcash:${address}?amount=${formatZec(amount)}&memo=${encodeMemo(request.memo)}`;
}

export interface PreparedBid {
  readonly commitment: string;
  readonly memo: string;
  readonly byteLength: number;
  readonly uri: string;
  readonly amount: string;
  /** Bidder-only receipt. Never send this object to the commitment ledger. */
  readonly reveal: BidMemo;
}
export interface CommitSubmission { readonly auctionId: string; readonly commitment: string; readonly collateral: string }
export function serializeCommitMemo(auctionId: string, hash: string): string {
  // Reuse the auction grammar without accepting arbitrary metadata in a commit.
  validateAuctionId(auctionId);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid commitment memo.');
  const text = JSON.stringify({ v: 2, t: 'commit', a: auctionId, c: hash }); memoBytes(text); return text;
}
export function parseCommitMemo(text: string): { readonly auctionId: string; readonly commitment: string } {
  memoBytes(text); let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid commitment memo schema.'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid commitment memo schema.');
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(record).sort().join(',') !== 'a,c,t,v' || record.v !== 2 || record.t !== 'commit' || typeof record.a !== 'string' || typeof record.c !== 'string' ||
    serializeCommitMemo(record.a, record.c) !== text) throw new Error('Invalid commitment memo schema.');
  return Object.freeze({ auctionId: record.a, commitment: record.c });
}
export function commitSubmission(prepared: PreparedBid): CommitSubmission {
  const memo = parseCommitMemo(prepared.memo);
  if (memo.commitment !== prepared.commitment) throw new Error('Commitment memo mismatch.');
  return Object.freeze({ ...memo, collateral: prepared.amount });
}
export interface PrepareBidInput {
  readonly auctionId: string;
  readonly price: string;
  readonly quantity: number;
  readonly refund: string;
  readonly vault: string;
  readonly network: Network;
  readonly collateral?: string;
}
export async function prepareBid(input: PrepareBidInput, audit?: AuditObserver<ProtocolAuditEvent>): Promise<PreparedBid> {
  let phase: 'input' | 'memo' | 'commitment' | 'uri' = 'input';
  try {
    input = Object.freeze({ ...input });
    const vault = orchardPaymentAddress(input.vault, input.network); const refund = orchardPaymentAddress(input.refund, input.network);
    assertDistinctRefund(refund, vault, input.network);
    const price = formatZec(parseZec(input.price));
    const salt = await freshSalt(input.auctionId);
    const bid: BidMemo = { auctionId: input.auctionId, price, quantity: input.quantity, refund, salt };
    serializeBidMemo(bid, input.network);
    const total = parseZec(bid.price) * BigInt(bid.quantity);
    if (total > MAX_MONEY) throw new Error('Bid escrow exceeds the ZEC monetary limit.');
    const amount = formatZec(parseZec(input.collateral ?? DEFAULT_COLLATERAL));
    if (parseZec(amount) === 0n || total > parseZec(amount)) throw new Error('Bid maximum exceeds the posted collateral.');
    phase = 'commitment'; const hash = await commitment(bid);
    phase = 'memo'; const memo = serializeCommitMemo(bid.auctionId, hash); const byteLength = memoBytes(memo).length;
    notifyAudit(audit, { type: 'memo-validated', bytes: byteLength });
    notifyAudit(audit, { type: 'commitment-created' });
    phase = 'uri'; const uri = buildPaymentUri({ address: vault, amount, memo, network: input.network });
    notifyAudit(audit, { type: 'uri-generated' });
    return Object.freeze({ commitment: hash, memo, byteLength, amount, uri, reveal: Object.freeze(bid) });
  } catch (error: unknown) { notifyAudit(audit, { type: 'preparation-rejected', phase }); throw error; }
}
