import { base64urlnopad } from '@scure/base';
import { orchardPaymentAddress } from '../protocol/address';
import { formatZec, parseZec } from '../protocol/amount';
import { parseAuditBundle, verifyAuditBundle } from './audit-bundle';
import { settlementPayouts } from './settlement';

/**
 * The policy a co-signer enforces before adding its signature to a settlement.
 *
 * Zcash has no escrow contract, so the operator holds the collateral. The fix is threshold custody (FROST, 2-of-3): the vault's
 * spend key is split so that no single party can move the funds. This module is the part such a co-signer needs and that does
 * not depend on the signing ceremony: it recomputes, from the published audit bundle alone, exactly which payments a settlement
 * may contain, and approves a proposed payment request only if it matches to the zatoshi, the recipient and the memo.
 * The threshold-signing layer itself is not implemented in this prototype.
 */
export interface RequestedPayment { readonly address: string; readonly amount: string; readonly memo: string | null }
export interface CosignVerdict { readonly approve: boolean; readonly problems: readonly string[]; readonly payments: number }

const fail = (): never => { throw new Error('This is not a valid ZIP-321 settlement request.'); };
const PARAMETER = /^(address|amount|memo)(?:\.([1-9][0-9]{0,2}))?$/;

/** Parses a multi-payment ZIP-321 `zcash:` request into its payments, strictly: unknown or repeated parameters are refused. */
export function parseSettlementRequest(uri: string): readonly RequestedPayment[] {
  if (typeof uri !== 'string' || uri.length > 20_000 || !uri.startsWith('zcash:')) return fail();
  const question = uri.indexOf('?'); if (question < 0) return fail();
  const first = uri.slice('zcash:'.length, question); const rows = new Map<number, { address?: string; amount?: string; memo?: string }>();
  rows.set(0, { address: first });
  for (const pair of uri.slice(question + 1).split('&')) {
    const equals = pair.indexOf('='); if (equals < 1) return fail();
    const match = PARAMETER.exec(pair.slice(0, equals)); if (!match) return fail();
    const index = match[2] === undefined ? 0 : Number(match[2]); const row = rows.get(index) ?? {}; const key = match[1] as 'address' | 'amount' | 'memo'; const value = pair.slice(equals + 1);
    if (row[key] !== undefined || (index === 0 && key === 'address')) return fail();
    row[key] = value; rows.set(index, row);
  }
  const indexes = [...rows.keys()].sort((a, b) => a - b);
  if (indexes.some((index, position) => index !== position)) return fail();
  return Object.freeze(indexes.map(index => {
    const row = rows.get(index) ?? {};
    if (!row.address || row.amount === undefined) return fail();
    let amount: string; try { amount = formatZec(parseZec(row.amount)); } catch { return fail(); }
    let memo: string | null = null;
    if (row.memo !== undefined) { try { memo = new TextDecoder('utf-8', { fatal: true }).decode(base64urlnopad.decode(row.memo)); } catch { return fail(); } }
    return Object.freeze({ address: row.address, amount, memo });
  }));
}

/** Shielded recipients compare by their Orchard-only form (a wallet may hand back a fuller unified address); transparent ones exactly. */
function canonicalAddress(address: string): string {
  if (address.startsWith('utest1')) { try { return orchardPaymentAddress(address, 'testnet'); } catch { return address; } }
  return address;
}
const keyOf = (payment: RequestedPayment): string => JSON.stringify([canonicalAddress(payment.address), payment.amount, payment.memo]);

/**
 * Approves a settlement request only if the audit bundle verifies and the request pays exactly the refunds, the seller proceeds and
 * the burn the verified result implies, with their memos, and nothing else.
 */
export async function checkSettlementRequest(bundleText: string, uri: string, seller: string): Promise<CosignVerdict> {
  const problems: string[] = [];
  let bundle: ReturnType<typeof parseAuditBundle>;
  try { bundle = parseAuditBundle(bundleText); } catch { return Object.freeze({ approve: false, problems: Object.freeze(['The audit bundle is not valid.']), payments: 0 }); }
  const report = await verifyAuditBundle(bundleText);
  if (!report.ok) problems.push(`The audit bundle does not verify (${report.checks.filter(check => !check.ok && check.skipped !== true).map(check => check.label).join(', ')}).`);
  if (bundle.settlement) problems.push('This auction is already settled; a second settlement would pay out twice.');
  if (bundle.auction.network !== 'testnet') problems.push('Settlement is enabled on testnet only.');
  let requested: readonly RequestedPayment[] = [];
  try { requested = parseSettlementRequest(uri); } catch (error: unknown) { problems.push(error instanceof Error ? error.message : 'The request cannot be read.'); }
  let expected: readonly RequestedPayment[] = [];
  try {
    expected = settlementPayouts({ auctionId: bundle.auction.auctionId, network: 'testnet', forfeitedCollateral: bundle.result.forfeitedCollateral, allocations: bundle.result.allocations }, seller)
      .map(payout => ({ address: payout.address, amount: payout.amount, memo: payout.memo }));
  } catch { problems.push('The seller address is not a valid Orchard-capable testnet address.'); }
  if (requested.length > 0 && expected.length > 0) {
    const remaining = new Map<string, number>(); for (const payment of requested) remaining.set(keyOf(payment), (remaining.get(keyOf(payment)) ?? 0) + 1);
    for (const payment of expected) {
      const count = remaining.get(keyOf(payment)) ?? 0;
      if (count === 0) problems.push(`Missing or different payment: ${payment.amount} ZEC to ${payment.address.slice(0, 18)}…${payment.memo ? ` with memo ${payment.memo.slice(0, 40)}…` : ''}.`); else remaining.set(keyOf(payment), count - 1);
    }
    const extra = [...remaining.values()].reduce((total, count) => total + count, 0);
    if (extra > 0) problems.push(`${extra} payment${extra === 1 ? '' : 's'} in the request ${extra === 1 ? 'is' : 'are'} not part of the verified settlement.`);
  }
  return Object.freeze({ approve: problems.length === 0, problems: Object.freeze(problems), payments: requested.length });
}
