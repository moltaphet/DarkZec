import type { Network } from '../protocol/address';
import { orchardPaymentAddress } from '../protocol/address';
import { formatZec, parseQuantity, parseZec, validateAuctionId } from '../protocol/amount';
import { commitment } from '../protocol/crypto';
import { merkleRoot } from '../protocol/merkle';
import type { BidMemo } from '../protocol/memo';
import { clearUniformAuction } from './darkpool';
import type { AuctionConfig, Allocation, VerifiedBid } from './darkpool';
import { canonicalResult, parseStatement, resultDigest, verifyStatement } from './operator-journal';
import type { ParsedStatement, ResultSummary, SignedStatement } from './operator-journal';
import { parseReceiptText, receiptText } from './receipt-file';

/**
 * Everything needed to re-run an auction without trusting the operator: the frozen commitment list, every accepted
 * reveal, the published result and the operator's signed statements. Reveals include each bidder's price, quantity,
 * salt and refund address, so a bundle is published only when the auction's rules say revealed bids become public.
 */
export interface AuditBundle {
  readonly v: 1;
  readonly kind: 'darkzec-audit-bundle';
  readonly auction: { readonly auctionId: string; readonly network: Network; readonly vault: string; readonly supply: number; readonly reserve: string; readonly collateral: string; readonly unitDemand: boolean };
  readonly commitments: readonly string[];
  readonly root: string;
  readonly reveals: readonly string[];
  readonly result: ResultSummary;
  readonly operator: { readonly publicKey: string; readonly statements: readonly SignedStatement[] };
}
export interface AuditCheck { readonly id: string; readonly label: string; readonly ok: boolean; readonly detail: string }
export interface AuditReport { readonly ok: boolean; readonly auctionId: string | null; readonly checks: readonly AuditCheck[] }

export const AUDIT_BUNDLE_MAX_BYTES = 262_144;
const HASH = /^[a-f0-9]{64}$/;
const keysAre = (value: object, expected: string): boolean => Object.keys(value).sort().join(',') === expected;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildAuditBundle(input: {
  readonly config: AuctionConfig; readonly commitments: readonly string[]; readonly root: string; readonly reveals: readonly BidMemo[];
  readonly result: ResultSummary; readonly publicKey: string; readonly statements: readonly SignedStatement[];
}): AuditBundle {
  const { config } = input;
  return Object.freeze({
    v: 1, kind: 'darkzec-audit-bundle',
    auction: Object.freeze({ auctionId: config.auctionId, network: config.network, vault: config.vault, supply: config.supply, reserve: config.reserve,
      collateral: config.collateral ?? '', unitDemand: config.unitDemand === true }),
    commitments: Object.freeze([...input.commitments]), root: input.root,
    reveals: Object.freeze(input.reveals.map(bid => receiptText(bid, config.network))),
    result: Object.freeze({ clearingPrice: input.result.clearingPrice, filled: input.result.filled, excluded: input.result.excluded,
      forfeitedCollateral: input.result.forfeitedCollateral, postedCollateral: input.result.postedCollateral, allocations: Object.freeze(input.result.allocations.map(row => Object.freeze({ ...row }))) }),
    operator: Object.freeze({ publicKey: input.publicKey, statements: Object.freeze(input.statements.map(item => Object.freeze({ statement: item.statement, signature: item.signature }))) }),
  });
}
export const serializeAuditBundle = (bundle: AuditBundle): string => `${JSON.stringify(bundle, null, 2)}\n`;

function parseAllocation(value: unknown): Allocation {
  if (!isRecord(value) || !keysAre(value, 'commitment,filled,paid,price,refundAddress,refundAmount,requested')) throw new Error('allocation');
  const { commitment: hash, price, requested, filled, paid, refundAmount, refundAddress } = value;
  if (typeof hash !== 'string' || typeof price !== 'string' || typeof requested !== 'number' || typeof filled !== 'number' ||
    typeof paid !== 'string' || typeof refundAmount !== 'string' || typeof refundAddress !== 'string') throw new Error('allocation');
  return Object.freeze({ commitment: hash, price, requested, filled, paid, refundAmount, refundAddress });
}

/** Strict structural parse. Semantic checks (hashes, amounts, signatures) are reported separately by the verifier. */
export function parseAuditBundle(text: string): AuditBundle {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > AUDIT_BUNDLE_MAX_BYTES) throw new Error('An audit bundle is at most 256 KB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('The audit bundle is not valid JSON.'); }
  const fail = (): never => { throw new Error('This is not a DarkZec audit bundle (v1).'); };
  if (!isRecord(value) || !keysAre(value, 'auction,commitments,kind,operator,result,reveals,root,v') || value.v !== 1 || value.kind !== 'darkzec-audit-bundle') fail();
  const record = value as Record<string, unknown>;
  const { auction, commitments, root, reveals, result, operator } = record;
  if (!isRecord(auction) || !keysAre(auction, 'auctionId,collateral,network,reserve,supply,unitDemand,vault')) return fail();
  if (typeof auction.auctionId !== 'string' || (auction.network !== 'testnet' && auction.network !== 'mainnet') || typeof auction.vault !== 'string' ||
    typeof auction.supply !== 'number' || typeof auction.reserve !== 'string' || typeof auction.collateral !== 'string' || typeof auction.unitDemand !== 'boolean') return fail();
  if (!Array.isArray(commitments) || commitments.length > 128 || !commitments.every(item => typeof item === 'string')) return fail();
  if (typeof root !== 'string' || !Array.isArray(reveals) || reveals.length > 128 || !reveals.every(item => typeof item === 'string')) return fail();
  if (!isRecord(result) || !keysAre(result, 'allocations,clearingPrice,excluded,filled,forfeitedCollateral,postedCollateral') || !Array.isArray(result.allocations) || result.allocations.length > 128) return fail();
  if (typeof result.clearingPrice !== 'string' || typeof result.filled !== 'number' || typeof result.excluded !== 'number' ||
    typeof result.forfeitedCollateral !== 'string' || typeof result.postedCollateral !== 'string') return fail();
  if (!isRecord(operator) || !keysAre(operator, 'publicKey,statements') || typeof operator.publicKey !== 'string' || !Array.isArray(operator.statements) || operator.statements.length > 260) return fail();
  const statements = operator.statements.map(item => {
    if (!isRecord(item) || !keysAre(item, 'signature,statement') || typeof item.statement !== 'string' || typeof item.signature !== 'string') return fail();
    return Object.freeze({ statement: item.statement, signature: item.signature });
  });
  let allocations: Allocation[];
  try { allocations = result.allocations.map(parseAllocation); } catch { return fail(); }
  return Object.freeze({
    v: 1, kind: 'darkzec-audit-bundle',
    auction: Object.freeze({ auctionId: auction.auctionId, network: auction.network, vault: auction.vault, supply: auction.supply, reserve: auction.reserve, collateral: auction.collateral, unitDemand: auction.unitDemand }),
    commitments: Object.freeze([...commitments as string[]]), root, reveals: Object.freeze([...reveals as string[]]),
    result: Object.freeze({ clearingPrice: result.clearingPrice, filled: result.filled, excluded: result.excluded, forfeitedCollateral: result.forfeitedCollateral,
      postedCollateral: result.postedCollateral, allocations: Object.freeze(allocations) }),
    operator: Object.freeze({ publicKey: operator.publicKey, statements: Object.freeze(statements) }),
  });
}

/**
 * Re-derives an auction from its bundle using only public rules: Merkle root, commitment openings, clearing,
 * conservation and the operator's signatures. Every check runs and is reported, so one failure never hides another.
 */
export async function verifyAuditBundle(text: string): Promise<AuditReport> {
  const checks: AuditCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string): void => { checks.push(Object.freeze({ id, label, ok, detail })); };
  let bundle: AuditBundle;
  try { bundle = parseAuditBundle(text); } catch (error: unknown) {
    add('schema', 'Bundle format', false, error instanceof Error ? error.message : 'Unreadable bundle.');
    return Object.freeze({ ok: false, auctionId: null, checks: Object.freeze(checks) });
  }
  const { auction, commitments, result, operator } = bundle;

  // 1. Auction rules.
  let config: AuctionConfig | undefined;
  try {
    validateAuctionId(auction.auctionId); parseQuantity(String(auction.supply));
    if (parseZec(auction.reserve) === 0n || parseZec(auction.collateral) === 0n || formatZec(parseZec(auction.collateral)) !== auction.collateral) throw new Error('Reserve and collateral must be positive canonical ZEC amounts.');
    if (orchardPaymentAddress(auction.vault, auction.network) !== auction.vault) throw new Error('The vault must be an Orchard-only Unified Address.');
    config = Object.freeze({ auctionId: auction.auctionId, supply: auction.supply, reserve: auction.reserve, vault: auction.vault, network: auction.network, collateral: auction.collateral, unitDemand: auction.unitDemand });
    add('rules', 'Auction rules', true, `${auction.auctionId} / ${auction.supply} lots / reserve ${auction.reserve} ZEC / ${auction.collateral} ZEC collateral${auction.unitDemand ? ' / unit demand' : ''}.`);
  } catch (error: unknown) { add('rules', 'Auction rules', false, error instanceof Error ? error.message : 'Invalid auction rules.'); }

  // 2. Frozen Merkle root over every commitment, revealed or not.
  const uniqueCommitments = new Set(commitments);
  let rootOk = false;
  if (!commitments.every(item => HASH.test(item)) || uniqueCommitments.size !== commitments.length) add('root', 'Frozen Merkle root', false, 'Commitments must be distinct 64-hex hashes.');
  else {
    const recomputed = await merkleRoot(commitments); rootOk = recomputed === bundle.root;
    add('root', 'Frozen Merkle root', rootOk, rootOk ? `Recomputed over all ${commitments.length} commitments.` : 'The recomputed root differs from the published root.');
  }

  // 3. Every reveal opens a recorded commitment.
  const opened = new Map<number, BidMemo>(); const revealProblems: string[] = [];
  for (const [position, receipt] of bundle.reveals.entries()) {
    try {
      const bid = parseReceiptText(receipt, auction.network);
      if (bid.auctionId !== auction.auctionId) throw new Error('belongs to another auction');
      const index = commitments.indexOf(await commitment(bid));
      if (index < 0) throw new Error('does not open a recorded commitment');
      if (opened.has(index)) throw new Error('opens a commitment twice');
      if (config && parseZec(bid.price) * BigInt(bid.quantity) > parseZec(auction.collateral)) throw new Error('exceeds the posted collateral');
      if (auction.unitDemand && bid.quantity !== 1) throw new Error('asks for more than one lot in a unit-demand auction');
      opened.set(index, bid);
    } catch (error: unknown) { revealProblems.push(`reveal ${position + 1} ${error instanceof Error ? error.message : 'is invalid'}`); }
  }
  add('reveals', 'Reveal openings', revealProblems.length === 0, revealProblems.length === 0 ? `${opened.size} reveals each recompute to a recorded commitment.` : `${revealProblems.join('; ')}.`);

  // 4. Deterministic clearing re-run over verified reveals in accepted commit order.
  let recomputed: ResultSummary | undefined;
  if (config && revealProblems.length === 0) {
    try {
      const bids: VerifiedBid[] = [...opened.entries()].sort(([a], [b]) => a - b).map(([index, bid]) => ({ commitment: commitments[index] ?? '', bid, collateral: auction.collateral }));
      const cleared = clearUniformAuction(config, bids);
      const collateral = parseZec(auction.collateral); const unrevealed = BigInt(commitments.length - opened.size);
      recomputed = Object.freeze({ ...cleared, excluded: commitments.length - opened.size, forfeitedCollateral: formatZec(collateral * unrevealed), postedCollateral: formatZec(collateral * BigInt(commitments.length)) });
      const same = canonicalResult(recomputed) === canonicalResult(result);
      add('clearing', 'Clearing re-run', same, same ? `Recomputed ${recomputed.clearingPrice} ZEC for ${recomputed.filled} lots; every allocation matches.` : `The published result differs from the recomputed one (${recomputed.clearingPrice} ZEC, ${recomputed.filled} lots).`);
    } catch (error: unknown) { add('clearing', 'Clearing re-run', false, error instanceof Error ? error.message : 'Clearing could not be recomputed.'); }
  } else add('clearing', 'Clearing re-run', false, 'Skipped: the rules or reveals above are invalid.');

  // 5. Conservation, independent of the clearing code.
  try {
    const paid = result.allocations.reduce((total, row) => total + parseZec(row.paid), 0n);
    const refunded = result.allocations.reduce((total, row) => total + parseZec(row.refundAmount), 0n);
    const posted = parseZec(result.postedCollateral); const forfeited = parseZec(result.forfeitedCollateral);
    const ok = paid + refunded + forfeited === posted && config !== undefined && posted === parseZec(auction.collateral) * BigInt(commitments.length);
    add('conservation', 'Collateral conservation', ok, `payments ${formatZec(paid)} + refunds ${formatZec(refunded)} + burned ${formatZec(forfeited)} = ${formatZec(paid + refunded + forfeited)} of ${result.postedCollateral} ZEC posted.`);
  } catch { add('conservation', 'Collateral conservation', false, 'Result amounts are not valid ZEC amounts.'); }

  // 6–8. Operator signatures: close, one acknowledgement per accepted reveal, result.
  const verified: ParsedStatement[] = []; let badSignatures = 0;
  for (const signed of operator.statements) {
    let parsed: ParsedStatement;
    try { parsed = parseStatement(signed.statement); } catch { badSignatures++; continue; }
    if (parsed.auctionId !== auction.auctionId || !await verifyStatement(operator.publicKey, signed)) { badSignatures++; continue; }
    verified.push(parsed);
  }
  const closes = verified.filter(item => item.type === 'close');
  const close = closes.length === 1 ? closes[0] : undefined;
  const closeOk = close?.type === 'close' && close.root === bundle.root && close.count === commitments.length && rootOk && badSignatures === 0;
  add('close', 'Signed close statement', closeOk,
    badSignatures > 0 ? `${badSignatures} statement${badSignatures === 1 ? '' : 's'} failed signature or format verification.` :
      close?.type === 'close' ? closeOk ? `Operator signed root ${bundle.root.slice(0, 16)}… over ${close.count} commitments at close.` : 'The signed close statement does not match the published root or commitment count.' :
        `Expected one signed close statement, found ${closes.length}.`);

  const acks = verified.filter(item => item.type === 'reveal-ack');
  const ackProblems: string[] = [];
  for (const [index] of opened) {
    const matching = acks.filter(ack => ack.type === 'reveal-ack' && ack.index === index && ack.commitment === commitments[index]);
    if (matching.length !== 1) ackProblems.push(`entry ${index + 1} has ${matching.length} acknowledgements`);
  }
  for (const ack of acks) {
    if (ack.type !== 'reveal-ack') continue;
    // An acknowledged reveal missing from the published set is exactly the censorship the acknowledgement exposes.
    if (commitments[ack.index] !== ack.commitment || !opened.has(ack.index)) ackProblems.push(`the operator acknowledged entry ${ack.index + 1} but the result omits it`);
    if (ack.root !== bundle.root) ackProblems.push(`acknowledgement for entry ${ack.index + 1} names another root`);
    if (close?.type === 'close' && (ack.acceptedAt < close.closedAt || ack.acceptedAt >= close.revealDeadline)) ackProblems.push(`entry ${ack.index + 1} was accepted outside the reveal window`);
  }
  add('acks', 'Signed reveal acknowledgements', ackProblems.length === 0 && badSignatures === 0,
    ackProblems.length === 0 ? `${acks.length} acknowledgements, one for each accepted reveal, all inside the reveal window.` : `${ackProblems.join('; ')}.`);

  const results = verified.filter(item => item.type === 'result');
  const signedResult = results.length === 1 ? results[0] : undefined;
  // The signature must cover both the published result and the independently recomputed one.
  let publishedDigest: string | undefined;
  try { publishedDigest = await resultDigest(result); } catch { publishedDigest = undefined; }
  const recomputedDigest = recomputed ? await resultDigest(recomputed) : undefined;
  const resultOk = signedResult?.type === 'result' && signedResult.root === bundle.root && signedResult.digest === publishedDigest && signedResult.digest === recomputedDigest;
  add('result', 'Signed result', resultOk, resultOk ? 'The operator signed exactly the published result, and it equals the recomputed one.' :
    results.length !== 1 ? `Expected one signed result, found ${results.length}.` :
      signedResult?.type === 'result' && signedResult.digest !== publishedDigest ? 'The published result is not the result the operator signed.' : 'The signed result does not match the recomputed result.');

  return Object.freeze({ ok: checks.every(check => check.ok), auctionId: auction.auctionId, checks: Object.freeze(checks) });
}
