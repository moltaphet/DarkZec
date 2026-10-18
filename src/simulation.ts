import { assertDistinctRefund, orchardPaymentAddress } from './protocol/address';
import { formatZec, parseQuantity, parseZec, validateAuctionId } from './protocol/amount';
import { clearUniformAuction } from './lib/darkpool';
import type { AuctionConfig, ClearingResult, VerifiedBid } from './lib/darkpool';
export type { AuctionConfig, Allocation, ClearingResult } from './lib/darkpool';
import { commitment, utf8 } from './protocol/crypto';
import { buildPaymentUri, memoBytes, parseBidMemo } from './protocol/memo';
import type { PreparedBid } from './protocol/memo';
import { merkleProof, merkleRoot } from './protocol/merkle';
import type { InclusionProof } from './protocol/merkle';

export type Phase = 'open' | 'closed' | 'cleared';
export interface PublicSnapshot { readonly phase: Phase; readonly commitments: readonly string[] }
interface Envelope { readonly commitment: string; readonly iv: Uint8Array<ArrayBuffer>; readonly ciphertext: ArrayBuffer }
export interface Audit { readonly commitment: string; readonly root: string; readonly proof: InclusionProof }

/** Local demonstration of a trusted vault, not Orchard encryption or IVK scanning. */
export class Sandbox {
  readonly #config: AuctionConfig;
  readonly #key: CryptoKey;
  readonly #envelopes: Envelope[] = [];
  #phase: Phase = 'open';
  #busy = false;
  private constructor(config: AuctionConfig, key: CryptoKey) { this.#config = Object.freeze({ ...config }); this.#key = key; }

  static async create(config: AuctionConfig): Promise<Sandbox> {
    config = Object.freeze({ ...config });
    validateAuctionId(config.auctionId); parseQuantity(String(config.supply));
    if (parseZec(config.reserve) === 0n) throw new Error('Reserve must be positive.');
    if (config.network !== 'testnet') throw new Error('The simulation supports testnet fixtures only.');
    config = Object.freeze({ ...config, vault: orchardPaymentAddress(config.vault, config.network) });
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return new Sandbox(config, key);
  }

  publicSnapshot(): PublicSnapshot {
    return Object.freeze({ phase: this.#phase, commitments: Object.freeze(this.#envelopes.map(item => item.commitment)) });
  }

  async submit(prepared: PreparedBid): Promise<void> {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase !== 'open') throw new Error('The auction is closed.');
    if (this.#envelopes.length >= 128) throw new Error('Local simulation limit: 128 bids.');
    this.#busy = true;
    try {
      // Snapshot caller-owned data before the first await.
      const { memo, amount, uri, byteLength, commitment: hash } = prepared;
      const bid = parseBidMemo(memo, this.#config.network);
      assertDistinctRefund(bid.refund, this.#config.vault, this.#config.network);
      if (bid.auctionId !== this.#config.auctionId) throw new Error('Wrong auction ID.');
      if (await commitment(bid) !== hash) throw new Error('Bid commitment mismatch.');
      if (this.#envelopes.some(item => item.commitment === hash)) throw new Error('Duplicate commitment.');
      const expectedAmount = formatZec(parseZec(bid.price) * BigInt(bid.quantity));
      if (amount !== expectedAmount) throw new Error('Bid escrow mismatch.');
      if (uri !== buildPaymentUri({ address: this.#config.vault, amount, memo, network: this.#config.network })) throw new Error('Payment URI mismatch.');
      if (memoBytes(memo).length !== byteLength) throw new Error('Memo byte audit mismatch.');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = memoBytes(memo);
      try {
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(hash) }, this.#key, bytes);
        this.#envelopes.push({ commitment: hash, iv, ciphertext });
      } finally { bytes.fill(0); }
    } finally { this.#busy = false; }
  }

  close(): void {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase !== 'open') throw new Error('Auction is already closed.');
    this.#phase = 'closed';
  }

  async audit(index: number): Promise<Audit> {
    if (this.#phase === 'open') throw new Error('Close the auction to freeze its audit root.');
    const hashes = this.#envelopes.map(item => item.commitment);
    const hash = hashes[index]; if (!hash) throw new Error('No commitment at this index.');
    return { commitment: hash, root: await merkleRoot(hashes), proof: await merkleProof(hashes, index) };
  }

  async clear(): Promise<ClearingResult> {
    if (this.#busy) throw new Error('A vault operation is in progress.');
    if (this.#phase === 'open') throw new Error('Close the auction before unsealing.');
    if (this.#phase === 'cleared') throw new Error('Auction has already cleared.');
    this.#busy = true;
    try {
      const bids: VerifiedBid[] = [];
      for (const envelope of this.#envelopes) {
        const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv, additionalData: utf8(envelope.commitment) }, this.#key, envelope.ciphertext));
        try {
          const bid = parseBidMemo(new TextDecoder('utf-8', { fatal: true }).decode(bytes), this.#config.network);
          assertDistinctRefund(bid.refund, this.#config.vault, this.#config.network);
          if (await commitment(bid) !== envelope.commitment) throw new Error('Unsealed commitment mismatch.');
          bids.push({ commitment: envelope.commitment, bid });
        } finally { bytes.fill(0); }
      }
      const result = clearUniformAuction(this.#config, bids);
      this.#phase = 'cleared';
      return result;
    } finally { this.#busy = false; }
  }
}
