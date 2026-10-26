import { assertDistinctRefund, orchardPaymentAddress } from './protocol/address';
import { formatZec, parseQuantity, parseZec, validateAuctionId } from './protocol/amount';
import { clearUniformAuction } from './lib/darkpool';
import type { AuctionConfig, ClearingResult, VerifiedBid } from './lib/darkpool';
export type { AuctionConfig, Allocation, ClearingResult } from './lib/darkpool';
import { commitment } from './protocol/crypto';
import { DEFAULT_COLLATERAL, parseBidMemo, serializeBidMemo } from './protocol/memo';
import type { BidMemo, CommitSubmission } from './protocol/memo';
import { merkleProof, merkleRoot } from './protocol/merkle';
import type { InclusionProof } from './protocol/merkle';

export type Phase = 'open' | 'reveal' | 'cleared';
export interface PublicSnapshot {
  readonly phase: Phase; readonly commitments: readonly string[]; readonly revealed: readonly string[];
  readonly revealDeadline: number | null; readonly canClear: boolean;
  readonly revealOpen: boolean;
}
export interface Audit { readonly commitment: string; readonly root: string; readonly proof: InclusionProof }
export interface SettlementResult extends ClearingResult { readonly root: string; readonly excluded: number; readonly forfeitedCollateral: string; readonly postedCollateral: string }
export interface SettlementBalance { readonly paid: string; readonly refunded: string; readonly forfeited: string; readonly posted: string; readonly balanced: boolean }

/** Independent conservation check: payments + refunds + forfeited collateral must equal every posted collateral, to the zatoshi. */
export function settlementBalance(result: SettlementResult): SettlementBalance {
  const paid = result.allocations.reduce((total, row) => total + parseZec(row.paid), 0n);
  const refunded = result.allocations.reduce((total, row) => total + parseZec(row.refundAmount), 0n);
  const forfeited = parseZec(result.forfeitedCollateral); const posted = parseZec(result.postedCollateral);
  return Object.freeze({ paid: formatZec(paid), refunded: formatZec(refunded), forfeited: formatZec(forfeited), posted: formatZec(posted), balanced: paid + refunded + forfeited === posted });
}
interface RecordEntry { readonly commitment: string; readonly collateral: string; reveal?: BidMemo }

/** Hash-only local ledger. No preimage, ciphertext or bidder decryption key enters commit storage. */
export class Sandbox {
  readonly #config: AuctionConfig;
  readonly #clock: () => number;
  readonly #records: RecordEntry[] = [];
  #phase: Phase = 'open';
  #busy = false;
  #deadline: number | null = null;
  private constructor(config: AuctionConfig, clock: () => number) { this.#config = config; this.#clock = clock; }
  static async create(input: AuctionConfig, clock: () => number = Date.now): Promise<Sandbox> {
    const config = { ...input };
    validateAuctionId(config.auctionId); parseQuantity(String(config.supply));
    if (parseZec(config.reserve) === 0n) throw new Error('Reserve must be positive.');
    if (config.network !== 'testnet') throw new Error('The simulation supports testnet fixtures only.');
    const collateral = formatZec(parseZec(config.collateral ?? DEFAULT_COLLATERAL));
    if (parseZec(collateral) === 0n) throw new Error('Posted collateral must be positive.');
    const revealWindowMs = config.revealWindowMs ?? 60_000;
    if (!Number.isSafeInteger(revealWindowMs) || revealWindowMs < 1 || revealWindowMs > 86_400_000) throw new Error('Invalid reveal window.');
    return new Sandbox(Object.freeze({ ...config, collateral, revealWindowMs, vault: orchardPaymentAddress(config.vault, config.network) }), clock);
  }
  #now(): number { const now = this.#clock(); if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid auction clock.'); return now; }
  #canClear(): boolean { return this.#phase === 'reveal' && (this.#records.every(record => record.reveal !== undefined) || this.#now() >= (this.#deadline ?? Infinity)); }
  publicSnapshot(): PublicSnapshot {
    return Object.freeze({ phase: this.#phase, commitments: Object.freeze(this.#records.map(item => item.commitment)),
      revealed: Object.freeze(this.#records.filter(item => item.reveal).map(item => item.commitment)), revealDeadline: this.#deadline, canClear: this.#canClear(),
      revealOpen: this.#phase === 'reveal' && this.#now() < (this.#deadline ?? 0) });
  }
  async submit(input: CommitSubmission): Promise<void> {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase !== 'open') throw new Error('The commit phase is closed.');
    if (this.#records.length >= 128) throw new Error('Local simulation limit: 128 bids.');
    // Reject rich prepared objects at this boundary, including accidental receipt/preimage fields.
    if (Object.keys(input).sort().join(',') !== 'auctionId,collateral,commitment') throw new Error('Commit accepts only auction ID, commitment hash and posted collateral.');
    const { auctionId, commitment: hash, collateral } = input;
    if (auctionId !== this.#config.auctionId) throw new Error('Wrong auction ID.');
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid commitment hash.');
    if (collateral !== this.#config.collateral) throw new Error('Posted collateral mismatch.');
    if (this.#records.some(record => record.commitment === hash)) throw new Error('Duplicate commitment.');
    this.#busy = true;
    try {
      // Preserve atomic asynchronous adapter semantics without accepting a bid preimage.
      await Promise.resolve();
      this.#records.push({ commitment: hash, collateral });
    } finally { this.#busy = false; }
  }
  close(): void {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase !== 'open') throw new Error('Auction is already closed.');
    this.#deadline = this.#now() + (this.#config.revealWindowMs ?? 60_000); this.#phase = 'reveal';
  }
  async reveal(input: BidMemo): Promise<void> {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase !== 'reveal') throw new Error('Reveal is allowed only in the closed reveal window.');
    if (this.#now() >= (this.#deadline ?? 0)) throw new Error('Reveal window has expired.');
    this.#busy = true;
    try {
      if (Object.keys(input).sort().join(',') !== 'auctionId,price,quantity,refund,salt') throw new Error('Invalid reveal schema.');
      const bid = Object.freeze(parseBidMemo(serializeBidMemo({ ...input }, this.#config.network), this.#config.network));
      if (bid.auctionId !== this.#config.auctionId) throw new Error('Wrong auction ID.');
      assertDistinctRefund(bid.refund, this.#config.vault, this.#config.network);
      const hash = await commitment(bid);
      if (this.#now() >= (this.#deadline ?? 0)) throw new Error('Reveal window has expired.');
      const record = this.#records.find(item => item.commitment === hash);
      if (!record) throw new Error('Reveal does not match a recorded commitment.');
      if (record.reveal) throw new Error('Commitment has already been revealed.');
      if (parseZec(bid.price) * BigInt(bid.quantity) > parseZec(record.collateral)) throw new Error('Insufficient collateral for reveal.');
      record.reveal = bid;
    } finally { this.#busy = false; }
  }
  async clear(): Promise<SettlementResult> {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase === 'open') throw new Error('Close the auction before revealing and clearing.');
    if (this.#phase === 'cleared') throw new Error('Auction has already cleared.');
    if (!this.#canClear()) throw new Error('Reveal window is still open. Wait for its deadline or all valid reveals.');
    this.#busy = true;
    try {
      const bids: VerifiedBid[] = [];
      for (const record of this.#records) if (record.reveal) {
        if (await commitment(record.reveal) !== record.commitment) throw new Error('Verified reveal integrity failed.');
        bids.push({ commitment: record.commitment, bid: record.reveal, collateral: record.collateral });
      }
      const result = clearUniformAuction(this.#config, bids);
      // The root covers every accepted commitment, so it equals the value a bidder verified after close.
      const root = await merkleRoot(this.#records.map(record => record.commitment));
      const excluded = this.#records.length - bids.length;
      // Non-reveal penalty: the full collateral of every unrevealed commitment is forfeited to the vault.
      const forfeited = this.#records.filter(record => !record.reveal).reduce((total, record) => total + parseZec(record.collateral), 0n);
      const posted = this.#records.reduce((total, record) => total + parseZec(record.collateral), 0n);
      const settlement = Object.freeze({ ...result, root, excluded, forfeitedCollateral: formatZec(forfeited), postedCollateral: formatZec(posted) });
      // Build every bounded monetary result before committing the state transition.
      // If aggregate formatting fails, callers can correct the configuration and retry.
      this.#phase = 'cleared';
      return settlement;
    } finally { this.#busy = false; }
  }
  /** Inclusion proof over the full commitment set, frozen when the commit phase closes. */
  async audit(index: number): Promise<Audit> {
    if (this.#phase === 'open') throw new Error('Close the auction to freeze its audit root.');
    const hashes = this.#records.map(record => record.commitment);
    const hash = hashes[index]; if (!hash) throw new Error('No commitment at this index.');
    return Object.freeze({ commitment: hash, root: await merkleRoot(hashes), proof: await merkleProof(hashes, index) });
  }
}
