import { validateOrchardAddress } from './address';
import type { Network } from './address';
import { formatZec, MAX_MONEY, parseZec } from './amount';
import { canonicalPreimage, commitment, freshSalt, utf8 } from './crypto';
import type { BidPreimage } from './crypto';

export const MEMO_LIMIT = 512;
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

export interface BidMemo extends BidPreimage { readonly refund: string }
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
  validateOrchardAddress(request.address, request.network);
  const amount = parseZec(request.amount);
  if (amount === 0n) throw new Error('Payment amount must be positive.');
  return `zcash:${request.address}?amount=${formatZec(amount)}&memo=${encodeMemo(request.memo)}`;
}

export interface PreparedBid {
  readonly commitment: string;
  readonly memo: string;
  readonly byteLength: number;
  readonly uri: string;
  readonly amount: string;
}
export interface PrepareBidInput {
  readonly auctionId: string;
  readonly price: string;
  readonly quantity: number;
  readonly refund: string;
  readonly vault: string;
  readonly network: Network;
}
export async function prepareBid(input: PrepareBidInput): Promise<PreparedBid> {
  const bid: BidMemo = { ...input, price: formatZec(parseZec(input.price)), salt: await freshSalt(input.auctionId) };
  const memo = serializeBidMemo(bid, input.network);
  const total = parseZec(bid.price) * BigInt(bid.quantity);
  if (total > MAX_MONEY) throw new Error('Bid escrow exceeds the ZEC monetary limit.');
  const amount = formatZec(total);
  return Object.freeze({ commitment: await commitment(bid), memo, byteLength: memoBytes(memo).length, amount,
    uri: buildPaymentUri({ address: input.vault, amount, memo, network: input.network }) });
}
