import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createBase58check } from '@scure/base';
import type { Network } from '../protocol/address';
import { assertDistinctRefund, orchardPaymentAddress } from '../protocol/address';
import { formatZec, parseZec } from '../protocol/amount';
import { commitment } from '../protocol/crypto';
import { encodeMemo, memoBytes, parseCommitMemo, serializeCommitMemo } from '../protocol/memo';
import type { BidMemo } from '../protocol/memo';
import { parseReceiptText } from './receipt-file';
import { commitOnTime, revealOnTime } from './schedule';
import type { Schedule } from './schedule';

/**
 * On-chain settlement of a cleared auction, and its verification from the vault's published viewing key.
 * Zcash has no escrow contracts, so the operator still holds the collateral; what this adds is that every
 * deposit, refund, proceeds payment and burn is checkable on chain by anyone holding the published key.
 */

const base58check = createBase58check(sha256);
/** The redeem script is a lone OP_RETURN, which always fails, so no one can ever spend coins sent to its P2SH address. */
const BURN_SCRIPT = Uint8Array.of(0x6a);
const P2SH_PREFIX: Readonly<Record<Network, Uint8Array>> = { mainnet: Uint8Array.of(0x1c, 0xbd), testnet: Uint8Array.of(0x1c, 0xba) };

/** Provably unspendable transparent address: P2SH(OP_RETURN). Forfeited collateral goes here and nowhere else. */
export function burnAddress(network: Network): string {
  const hash = ripemd160(sha256(BURN_SCRIPT));
  const payload = new Uint8Array(22); payload.set(P2SH_PREFIX[network]); payload.set(hash, 2);
  return base58check.encode(payload);
}

export interface SettlementRecord {
  /** Unified full viewing key of this auction's own vault account, published after settlement. */
  readonly viewingKey: string;
  /** Height at or below the first deposit, where a view-only wallet starts scanning. */
  readonly birthday: number;
  /** Where the winners' payments go. */
  readonly seller: string;
  readonly txids: readonly string[];
}
export interface SettlementInput {
  readonly auctionId: string; readonly network: Network; readonly forfeitedCollateral: string;
  readonly allocations: readonly { readonly commitment: string; readonly paid: string; readonly refundAmount: string; readonly refundAddress: string }[];
}
export type PayoutKind = 'refund' | 'proceeds' | 'burn';
export interface Payout { readonly kind: PayoutKind; readonly address: string; readonly amount: string; readonly memo: string | null; readonly commitment: string | null }

export const refundMemo = (auctionId: string, commitment: string): string => JSON.stringify({ v: 1, t: 'refund', a: auctionId, c: commitment });
export const proceedsMemo = (auctionId: string): string => JSON.stringify({ v: 1, t: 'proceeds', a: auctionId });
/** Operator-funded fee top-ups are tagged so a verifier can tell them apart from bidder deposits. */
export const feeMemo = (auctionId: string): string => JSON.stringify({ v: 1, t: 'fee', a: auctionId });

/** Exact payouts implied by a cleared result: each refund to its bidder, all payments to the seller, all forfeits burned. */
export function settlementPayouts(input: SettlementInput, seller: string): readonly Payout[] {
  const payouts: Payout[] = [];
  for (const row of input.allocations) {
    if (parseZec(row.refundAmount) > 0n) payouts.push(Object.freeze({ kind: 'refund', address: orchardPaymentAddress(row.refundAddress, input.network),
      amount: formatZec(parseZec(row.refundAmount)), memo: refundMemo(input.auctionId, row.commitment), commitment: row.commitment }));
  }
  const paid = input.allocations.reduce((total, row) => total + parseZec(row.paid), 0n);
  if (paid > 0n) payouts.push(Object.freeze({ kind: 'proceeds', address: orchardPaymentAddress(seller, input.network), amount: formatZec(paid), memo: proceedsMemo(input.auctionId), commitment: null }));
  const forfeited = parseZec(input.forfeitedCollateral);
  if (forfeited > 0n) payouts.push(Object.freeze({ kind: 'burn', address: burnAddress(input.network), amount: formatZec(forfeited), memo: null, commitment: null }));
  return Object.freeze(payouts);
}

/** One ZIP-321 request paying every payout in a single transaction. Transparent outputs carry no memo. */
export function settlementUri(payouts: readonly Payout[]): string {
  if (payouts.length === 0) throw new Error('Nothing to settle.');
  const parameters = payouts.map((payout, index) => {
    const suffix = index === 0 ? '' : `.${index}`;
    const memo = payout.memo === null ? '' : `&memo${suffix}=${encodeMemo(payout.memo)}`;
    return `${index === 0 ? '' : `address${suffix}=${payout.address}&`}amount${suffix}=${payout.amount}${memo}`;
  });
  return `zcash:${payouts[0]?.address ?? ''}?${parameters.join('&')}`;
}

/** What a view-only wallet holding the published key sees: notes received by the vault and outputs it paid out. */
export interface ChainOutput { readonly txid: string; readonly height: number; readonly amountZat: number; readonly address: string | null; readonly memo: string | null }
export interface ChainActivity { readonly tip: number; readonly received: readonly ChainOutput[]; readonly sent: readonly ChainOutput[] }
export interface ChainCheck { readonly ok: boolean; readonly detail: string }

const zat = (amount: string): number => Number(parseZec(amount));
const sameRecipient = (address: string | null, expected: string, network: Network): boolean => {
  if (address === null) return false;
  if (address === expected) return true;
  try { return orchardPaymentAddress(address, network) === orchardPaymentAddress(expected, network); } catch { return false; }
};

export interface DepositCheckInput {
  readonly auctionId: string; readonly network: Network; readonly vault: string; readonly collateral: string;
  readonly commitments: readonly string[]; readonly reveals: readonly string[];
  readonly unitDemand?: boolean; readonly procurement?: boolean; readonly schedule?: Schedule;
}

/** The same acceptance rules the ledger applies to a reveal, so a reveal the operator rightly refused is not reported as censored. */
function revealAcceptable(bid: BidMemo, input: DepositCheckInput): boolean {
  if (bid.auctionId !== input.auctionId) return false;
  if ((input.unitDemand || input.procurement) && bid.quantity !== 1) return false;
  if (!input.procurement && parseZec(bid.price) * BigInt(bid.quantity) > parseZec(input.collateral)) return false;
  try { assertDistinctRefund(bid.refund, input.vault, input.network); } catch { return false; }
  return true;
}
function commitHash(memo: string | null, auctionId: string): string | undefined {
  if (memo === null) return undefined;
  try { const parsed = parseCommitMemo(memo); return parsed.auctionId === auctionId ? parsed.commitment : undefined; } catch { return undefined; }
}

/**
 * Every commitment arrived as exactly one confirmed payment of the collateral with its commit memo, and every reveal
 * arrived as a memo. With a block-height schedule it also proves the operator neither admitted a late payment nor left out
 * an on-time one: every commit mined by `commitUntil` is in the frozen root and every acceptable reveal mined inside the
 * window is in the result.
 */
export async function verifyChainDeposits(input: DepositCheckInput, activity: ChainActivity): Promise<ChainCheck> {
  memoBytes(input.auctionId);
  const atVault = activity.received.filter(note => sameRecipient(note.address, input.vault, input.network));
  if (atVault.length === 0) return { ok: false, detail: 'The published key sees no payment to this vault, so it is not the vault\'s viewing key.' };
  const problems: string[] = []; const schedule = input.schedule;
  for (const [index, hash] of input.commitments.entries()) {
    const memo = serializeCommitMemo(input.auctionId, hash);
    const deposits = atVault.filter(note => note.memo === memo);
    if (deposits.length !== 1) problems.push(`entry ${index + 1} has ${deposits.length} commit payments`);
    else if (deposits[0]?.amountZat !== zat(input.collateral)) problems.push(`entry ${index + 1} paid ${formatZec(BigInt(deposits[0]?.amountZat ?? 0))} instead of ${input.collateral} ZEC`);
    else if (schedule && !commitOnTime(schedule, deposits[0]?.height ?? 0)) problems.push(`entry ${index + 1} was paid in block ${deposits[0]?.height}, after the commit deadline (block ${schedule.commitUntil})`);
  }
  const missing = input.reveals.filter(receipt => !atVault.some(note => note.memo === receipt)).length;
  if (missing > 0) problems.push(`${missing} reveal${missing === 1 ? ' was' : 's were'} not received on chain`);
  let completeness = '';
  if (schedule) {
    const known = new Set(input.commitments); const dropped = new Set<string>();
    for (const note of atVault) {
      const hash = commitHash(note.memo, input.auctionId);
      if (hash && note.amountZat === zat(input.collateral) && commitOnTime(schedule, note.height) && !known.has(hash)) dropped.add(hash);
    }
    if (dropped.size) problems.push(`${dropped.size} on-time commit payment${dropped.size === 1 ? ' is' : 's are'} missing from the frozen root`);
    const late = input.reveals.filter(receipt => { const note = atVault.find(item => item.memo === receipt); return note !== undefined && !revealOnTime(schedule, note.height); }).length;
    if (late) problems.push(`${late} reveal${late === 1 ? ' was' : 's were'} mined outside the reveal window`);
    const revealed = new Set<string>();
    for (const receipt of input.reveals) { try { revealed.add(await commitment(parseReceiptText(receipt, input.network))); } catch { /* reported by the openings check */ } }
    let omitted = 0;
    for (const note of atVault) {
      if (note.memo === null || !revealOnTime(schedule, note.height) || !note.memo.startsWith('{"v":1,')) continue;
      let bid: BidMemo; try { bid = parseReceiptText(note.memo, input.network); } catch { continue; }
      const hash = await commitment(bid);
      if (known.has(hash) && !revealed.has(hash) && revealAcceptable(bid, input)) { omitted++; revealed.add(hash); }
    }
    if (omitted) problems.push(`${omitted} acceptable on-time reveal${omitted === 1 ? ' is' : 's are'} missing from the result`);
    completeness = ` Every on-time payment is accounted for; deadlines are blocks ${schedule.commitUntil} and ${schedule.revealUntil}.`;
  }
  return problems.length ? { ok: false, detail: `${problems.join('; ')}.` } :
    { ok: true, detail: `All ${input.commitments.length} commit payments of ${input.collateral} ZEC and ${input.reveals.length} reveal memos found at the vault on chain.${completeness}` };
}

/** Every refund, the proceeds and the burn were paid exactly, and nothing else left the vault. */
export function verifyChainPayouts(input: SettlementInput & { readonly settlement: SettlementRecord }, activity: ChainActivity): ChainCheck {
  let expected: readonly Payout[];
  try { expected = settlementPayouts(input, input.settlement.seller); } catch { return { ok: false, detail: 'The settlement names an invalid seller or refund address.' }; }
  const remaining = [...activity.sent]; const problems: string[] = [];
  for (const payout of expected) {
    const index = remaining.findIndex(output => output.amountZat === zat(payout.amount) && sameRecipient(output.address, payout.address, input.network) &&
      (payout.memo === null || output.memo === payout.memo));
    if (index < 0) { problems.push(`${payout.kind === 'refund' ? `refund for ${payout.commitment?.slice(0, 12)}…` : payout.kind} of ${payout.amount} ZEC was not paid`); continue; }
    remaining.splice(index, 1);
  }
  if (remaining.length) problems.push(`${remaining.length} other payment${remaining.length === 1 ? '' : 's'} left the vault (${formatZec(BigInt(remaining.reduce((total, output) => total + output.amountZat, 0)))} ZEC)`);
  const counts = (kind: PayoutKind): number => expected.filter(payout => payout.kind === kind).length;
  return problems.length ? { ok: false, detail: `${problems.join('; ')}.` } :
    { ok: true, detail: `${counts('refund')} refund${counts('refund') === 1 ? '' : 's'}, ${counts('proceeds') ? 'the proceeds' : 'no proceeds'} and ${counts('burn') ? 'the burn' : 'no burn'} paid exactly on chain; nothing else left the vault.` };
}

const TXID = /^[a-f0-9]{64}$/;
/** Strict shape check for activity from the local server or a recorded snapshot; amounts stay below the money cap. */
export function parseChainActivity(value: unknown): ChainActivity {
  const invalid = (): never => { throw new Error('The chain activity is malformed.'); };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  const outputs = (list: unknown): readonly ChainOutput[] => {
    if (!Array.isArray(list) || list.length > 1024) return invalid();
    return Object.freeze(list.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return invalid();
      const { txid, height, amountZat, address, memo } = item as Record<string, unknown>;
      if (typeof txid !== 'string' || !TXID.test(txid) || !Number.isSafeInteger(height) || !Number.isSafeInteger(amountZat) || (amountZat as number) < 0 || (amountZat as number) > 2_100_000_000_000_000 ||
        (address !== null && (typeof address !== 'string' || address.length > 2048)) || (memo !== null && (typeof memo !== 'string' || memo.length > 1024))) return invalid();
      return Object.freeze({ txid, height: height as number, amountZat: amountZat as number, address: address as string | null, memo: memo as string | null });
    }));
  };
  if (!Number.isSafeInteger(record.tip)) return invalid();
  return Object.freeze({ tip: record.tip as number, received: outputs(record.received), sent: outputs(record.sent) });
}
