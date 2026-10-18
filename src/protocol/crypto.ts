import { formatZec, parseQuantity, parseZec, validateAuctionId } from './amount';
import { validateOrchardAddress } from './address';

export interface BidPreimage {
  readonly auctionId: string;
  readonly price: string;
  readonly quantity: number;
  readonly salt: string;
  readonly refund: string;
}
export const utf8 = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);
export const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error('Invalid lowercase hex.');
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** Reproducible only with the same secret entropy and context, never from public bid data. */
export async function deriveSalt(entropy: Uint8Array<ArrayBuffer>, auctionId: string, nonce: string): Promise<string> {
  if (entropy.length !== 32) throw new Error('Salt derivation requires 32 bytes of secret entropy.');
  validateAuctionId(auctionId);
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('A 128-bit bid nonce is required.');
  const key = await crypto.subtle.importKey('raw', entropy, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(`DARKZEC/salt/v1:${auctionId}:${nonce}`))));
}

export async function freshSalt(auctionId: string): Promise<string> {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  try { return await deriveSalt(entropy, auctionId, hex(crypto.getRandomValues(new Uint8Array(16)))); }
  finally { entropy.fill(0); }
}

export function canonicalPreimage(bid: BidPreimage): string {
  if (typeof bid.auctionId !== 'string' || typeof bid.price !== 'string') throw new Error('Auction ID and bid price must be strings.');
  if (!Number.isSafeInteger(bid.quantity)) throw new Error('Bid quantity must be a whole number.');
  validateAuctionId(bid.auctionId);
  parseQuantity(String(bid.quantity));
  if (parseZec(bid.price) === 0n || formatZec(parseZec(bid.price)) !== bid.price) throw new Error('Bid price must be positive and canonical.');
  if (typeof bid.salt !== 'string' || !/^[a-f0-9]{64}$/.test(bid.salt)) throw new Error('A 256-bit salt is required.');
  if (typeof bid.refund !== 'string') throw new Error('An Orchard refund Unified Address is required.');
  validateOrchardAddress(bid.refund, bid.refund.startsWith('utest1') ? 'testnet' : 'mainnet');
  // Typed tuple prevents field-boundary ambiguity and retains auction replay separation.
  return JSON.stringify(['DARKZEC/bid/v2', bid.auctionId, bid.refund, bid.salt, bid.price, bid.quantity]);
}
export async function computeBidCommitment(bid: BidPreimage): Promise<string> {
  return sha256(utf8(canonicalPreimage(bid)));
}
export const commitment = computeBidCommitment;
