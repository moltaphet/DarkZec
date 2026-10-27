import { merkleRoot } from '../protocol/merkle';
import type { BidMemo } from '../protocol/memo';
import { Sandbox } from '../simulation';
import type { AuctionConfig, SettlementResult } from '../simulation';
import { buildAuditBundle } from './audit-bundle';
import type { AuditBundle } from './audit-bundle';
import { OperatorJournal } from './operator-journal';
import type { OperatorSigner, SignedStatement } from './operator-journal';

/**
 * The operator side of one auction: the hash-only ledger plus a signed journal of every state transition it commits
 * to. Close, accepted reveals and the result each produce a statement that bidders and auditors can check later.
 */
export class AuctionSession {
  readonly sandbox: Sandbox;
  readonly journal: OperatorJournal;
  #result: SettlementResult | undefined;
  private constructor(sandbox: Sandbox, journal: OperatorJournal) { this.sandbox = sandbox; this.journal = journal; }
  static async create(config: AuctionConfig, clock?: () => number, signer?: OperatorSigner): Promise<AuctionSession> {
    const sandbox = await Sandbox.create(config, clock);
    return new AuctionSession(sandbox, await OperatorJournal.create(sandbox.config.auctionId, signer));
  }
  /** Freezes the commitment set and signs its root, count and reveal window. */
  async close(): Promise<string> {
    this.sandbox.close();
    const view = this.sandbox.operatorView();
    const root = await merkleRoot(view.commitments);
    await this.journal.recordClose(root, view.commitments.length, view.closedAt ?? 0, view.revealDeadline ?? 0);
    return root;
  }
  /** Accepts a reveal and returns the operator's signed acknowledgement for the bidder to keep. */
  async reveal(bid: BidMemo): Promise<SignedStatement> {
    const accepted = await this.sandbox.reveal(bid);
    return this.journal.acknowledgeReveal(accepted.commitment, accepted.index, accepted.acceptedAt);
  }
  async clear(): Promise<SettlementResult> {
    const result = await this.sandbox.clear();
    await this.journal.recordResult(result); this.#result = result;
    return result;
  }
  /** Available after clearing: the full public record needed to re-run this auction independently. */
  bundle(): AuditBundle | undefined {
    const result = this.#result; if (!result) return undefined;
    const view = this.sandbox.operatorView();
    return buildAuditBundle({ config: this.sandbox.config, commitments: view.commitments, root: result.root, reveals: view.reveals.map(item => item.bid),
      result, publicKey: this.journal.publicKey, statements: this.journal.statements() });
  }
}
