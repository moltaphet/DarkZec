import type { Network } from '../protocol/address';
import { assertDistinctRefund, orchardPaymentAddress } from '../protocol/address';
import { formatZec, MAX_MONEY, parseQuantity, parseZec, validateAuctionId } from '../protocol/amount';
import { canonicalPreimage } from '../protocol/crypto';
import type { BidMemo } from '../protocol/memo';

export interface AuctionConfig {
  readonly auctionId: string;
  readonly supply: number;
  readonly reserve: string;
  readonly vault: string;
  readonly network: Network;
  readonly collateral?: string;
  readonly revealWindowMs?: number;
}
export interface Allocation {
  readonly commitment: string;
  readonly price: string;
  readonly requested: number;
  readonly filled: number;
  readonly paid: string;
  readonly refundAmount: string;
  readonly refundAddress: string;
}
export interface ClearingResult { readonly clearingPrice: string; readonly filled: number; readonly allocations: readonly Allocation[] }
export interface VerifiedBid { readonly commitment: string; readonly bid: BidMemo; readonly collateral?: string }

/** Inputs are authenticated by the caller, in accepted submission order. No hash-based priority. */
export function clearUniformAuction(config: AuctionConfig, bids: readonly VerifiedBid[]): ClearingResult {
  config = Object.freeze({ ...config });
  if (!Number.isSafeInteger(config.supply)) throw new Error('Supply must be a whole number.');
  if (typeof config.auctionId !== 'string' || typeof config.reserve !== 'string') throw new Error('Auction ID and reserve must be strings.');
  validateAuctionId(config.auctionId); parseQuantity(String(config.supply));
  const reserve = parseZec(config.reserve); if (reserve === 0n) throw new Error('Reserve must be positive.');
  orchardPaymentAddress(config.vault, config.network);
  if (bids.length > 128) throw new Error('Local auction limit: 128 bids.');
  const seen = new Set<string>();
  const ordered = bids.map(({ bid, commitment, collateral }, sequence) => {
    bid = Object.freeze({ ...bid }); canonicalPreimage(bid);
    if (bid.auctionId !== config.auctionId) throw new Error('Wrong auction ID.');
    if (!/^[a-f0-9]{64}$/.test(commitment) || seen.has(commitment)) throw new Error('Invalid or duplicate commitment.');
    seen.add(commitment);
    assertDistinctRefund(bid.refund, config.vault, config.network);
    const price = parseZec(bid.price); const maximum = price * BigInt(bid.quantity);
    if (maximum > MAX_MONEY) throw new Error('Bid escrow exceeds the ZEC monetary limit.');
    const escrow = collateral === undefined ? maximum : parseZec(collateral);
    if (escrow < maximum) throw new Error('Insufficient collateral.');
    return { bid, commitment, sequence, price, escrow };
  });
  ordered.sort((a, b) => a.price === b.price ? a.sequence - b.sequence : a.price > b.price ? -1 : 1);
  const eligible = ordered.filter(item => item.price >= reserve);
  const demand = eligible.reduce((total, item) => total + BigInt(item.bid.quantity), 0n);
  let remaining = config.supply;
  const fills = ordered.map(item => {
    const filled = item.price >= reserve ? Math.min(remaining, item.bid.quantity) : 0;
    remaining -= filled; return filled;
  });
  let clearing = reserve;
  if (eligible.length > 1 && demand > BigInt(config.supply)) {
    const winners = ordered.filter((_, index) => (fills[index] ?? 0) > 0);
    const soleWinner = winners.length === 1 ? winners[0] : undefined;
    // A sole winner must price against another envelope, never its own excess quantity.
    // With multiple winners, an unfilled part of the marginal bid can set the uniform price.
    const margin = ordered.find((item, index) => item !== soleWinner && item.price >= reserve && (fills[index] ?? 0) < item.bid.quantity);
    if (margin && margin.price > clearing) clearing = margin.price;
  }
  const allocations = ordered.map((item, index): Allocation => {
    const filled = fills[index] ?? 0; const paid = clearing * BigInt(filled);
    if (filled > 0 && clearing > item.price) throw new Error('Clearing exceeds a filled bid limit.');
    return Object.freeze({ commitment: item.commitment, price: item.bid.price, requested: item.bid.quantity, filled,
      paid: formatZec(paid), refundAmount: formatZec(item.escrow - paid), refundAddress: orchardPaymentAddress(item.bid.refund, config.network) });
  });
  return Object.freeze({ clearingPrice: formatZec(clearing), filled: config.supply - remaining, allocations: Object.freeze(allocations) });
}
