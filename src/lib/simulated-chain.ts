import { parseCommitMemo } from '../protocol/memo';
import type { LocalTestnetStatus, VaultMemoResult } from './testnet-chain';

/** What the operator panel needs from a chain: the tip, and the shielded memos received at the vault. */
export interface ChainApi {
  status(): Promise<LocalTestnetStatus>;
  memos(address: string, auctionId: string, collateralZat: number): Promise<VaultMemoResult>;
}

interface SimulatedNote { readonly kind: 'commit' | 'reveal'; readonly auctionId: string; readonly commitment: string; readonly memo: string; readonly amountZat: number; readonly height: number; readonly txid: string }

/**
 * A chain that lives in memory, for practising the whole seller flow on the public site, where there is no wallet and no node.
 * It answers the same two questions the real chain does (the tip, and the memos at a vault), and the practice controls play the
 * bidders by "mining" their payments. Nothing about it touches the network, and its auctions are marked as practice.
 */
export class SimulatedChain implements ChainApi {
  #tip: number;
  readonly #notes: SimulatedNote[] = [];
  constructor(startTip = 4_600_000) { this.#tip = startTip; }
  get tip(): number { return this.#tip; }
  advance(blocks: number): void { if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 100_000) throw new Error('Advance by 1 to 100000 blocks.'); this.#tip += blocks; }
  async status(): Promise<LocalTestnetStatus> { return Object.freeze({ connected: true, network: 'testnet', synced: true, blocks: this.#tip, headers: this.#tip }); }
  #mine(note: Omit<SimulatedNote, 'height' | 'txid'>): void {
    this.#tip += 1; // a payment is mined in the next block
    this.#notes.push(Object.freeze({ ...note, height: this.#tip, txid: (this.#notes.length + 1).toString(16).padStart(64, '0') }));
  }
  /** A bidder's collateral payment with its commit memo. */
  payCommit(memo: string, collateralZat: number): void {
    const parsed = parseCommitMemo(memo); this.#mine({ kind: 'commit', auctionId: parsed.auctionId, commitment: parsed.commitment, memo, amountZat: collateralZat });
  }
  /** A bidder's reveal: the receipt text as the memo of a tiny payment. */
  payReveal(auctionId: string, receipt: string): void { this.#mine({ kind: 'reveal', auctionId, commitment: '', memo: receipt, amountZat: 10_000 }); }
  async memos(_address: string, auctionId: string, collateralZat: number): Promise<VaultMemoResult> {
    const mine = this.#notes.filter(note => note.auctionId === auctionId);
    const confirmations = (note: SimulatedNote): number => this.#tip - note.height + 1;
    return Object.freeze({ status: 'ok', tip: this.#tip,
      commits: Object.freeze(mine.filter(note => note.kind === 'commit' && note.amountZat === collateralZat).sort((a, b) => a.height - b.height).map(note => Object.freeze({ txid: note.txid, commitment: note.commitment, confirmations: confirmations(note), height: note.height }))),
      reveals: Object.freeze(mine.filter(note => note.kind === 'reveal').sort((a, b) => a.height - b.height).map(note => Object.freeze({ txid: note.txid, memo: note.memo, confirmations: confirmations(note), height: note.height }))) });
  }
}
