import { describe, expect, it } from 'vitest';
import { AuctionSession } from '../src/lib/auction-session';
import { serializeAuditBundle, withSettlement } from '../src/lib/audit-bundle';
import { checkSettlementRequest, parseSettlementRequest } from '../src/lib/cosigner';
import { burnAddress, settlementPayouts, settlementUri } from '../src/lib/settlement';
import { encodeMemo, commitSubmission, prepareBid } from '../src/protocol/memo';
import { TEST_REFUND, TEST_VAULT, walletAddress, WALLET_REFUND_RECEIVER } from './fixtures';

const SELLER = walletAddress(WALLET_REFUND_RECEIVER);
const config = { auctionId: 'COSIGN-1', supply: 1, reserve: '0.01', vault: TEST_VAULT, network: 'testnet' as const, collateral: '0.1', revealWindowMs: 1000, unitDemand: true };

async function cleared() {
  let now = 1_000; const session = await AuctionSession.create(config, () => now);
  const bids = await Promise.all(['0.08', '0.05', '0.07'].map(price => prepareBid({ auctionId: config.auctionId, price, quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '0.1' })));
  for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
  await session.close(); now += 10; for (const bid of bids.slice(0, 2)) await session.reveal(bid.reveal); now += 2_000; await session.clear();
  const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
  const payouts = settlementPayouts({ auctionId: config.auctionId, network: 'testnet', forfeitedCollateral: bundle.result.forfeitedCollateral, allocations: bundle.result.allocations }, SELLER);
  return { bundle, text: serializeAuditBundle(bundle), payouts };
}
/** A request built by hand from a payout list, so tests can tamper with single fields. */
const request = (rows: readonly { address: string; amount: string; memo?: string | null }[]): string =>
  `zcash:${rows[0]?.address}?${rows.map((row, index) => `${index ? `address.${index}=${row.address}&` : ''}amount${index ? `.${index}` : ''}=${row.amount}${row.memo ? `&memo${index ? `.${index}` : ''}=${encodeMemo(row.memo)}` : ''}`).join('&')}`;

describe('settlement request parsing', () => {
  it('reads every payment of a multi-payment ZIP-321 request, with decoded memos', async () => {
    const { payouts } = await cleared(); const parsed = parseSettlementRequest(settlementUri(payouts));
    expect(parsed.map(row => [row.amount, row.memo === null ? null : JSON.parse(row.memo).t ?? 'x'])).toEqual([['0.05', 'refund'], ['0.1', 'refund'], ['0.05', 'proceeds'], ['0.1', null]]);
    expect(parsed[3]?.address).toBe(burnAddress('testnet'));
  });
  it('refuses malformed, repeated, gapped or non-zcash requests', () => {
    for (const bad of ['', 'bitcoin:abc?amount=1', 'zcash:abc', 'zcash:abc?amount=1&amount=2', 'zcash:abc?amount=1&address.2=x&amount.2=1', 'zcash:abc?foo=1', 'zcash:abc?amount=not', 'zcash:abc?amount=1&memo=%%%', 'zcash:abc?memo=AAAA', `zcash:${'a'.repeat(30_000)}?amount=1`]) {
      expect(() => parseSettlementRequest(bad), bad.slice(0, 40)).toThrow('valid ZIP-321');
    }
  });
});

describe('co-signer policy', () => {
  it('approves exactly the settlement the verified bundle implies', async () => {
    const { text, payouts } = await cleared(); const verdict = await checkSettlementRequest(text, settlementUri(payouts), SELLER);
    expect(verdict).toMatchObject({ approve: true, payments: 4, problems: [] });
  });
  it('approves the same request in a different payment order', async () => {
    const { text, payouts } = await cleared();
    expect((await checkSettlementRequest(text, settlementUri([...payouts].reverse()), SELLER)).approve).toBe(true);
  });
  it('rejects every way a dishonest operator could change it', async () => {
    const { text, payouts } = await cleared(); const rows = payouts.map(payout => ({ address: payout.address, amount: payout.amount, memo: payout.memo }));
    const reject = async (changed: typeof rows, seller = SELLER) => checkSettlementRequest(text, request(changed), seller);
    const cases: [string, typeof rows, RegExp][] = [
      ['short refund', rows.map((row, index) => index === 0 ? { ...row, amount: '0.04' } : row), /Missing or different payment: 0.05/],
      ['diverted burn', rows.map(row => row.address === burnAddress('testnet') ? { ...row, address: SELLER } : row), /Missing or different payment: 0.1 ZEC to t2/],
      ['extra payout to the operator', [...rows, { address: SELLER, amount: '0.0001', memo: null }], /not part of the verified settlement/],
      ['dropped refund', rows.slice(1), /Missing or different payment/],
      ['wrong memo', rows.map((row, index) => index === 0 ? { ...row, memo: '{"v":1,"t":"refund","a":"COSIGN-1","c":"00"}' } : row), /Missing or different payment/],
      ['refund redirected', rows.map((row, index) => index === 0 ? { ...row, address: SELLER } : row), /Missing or different payment/],
    ];
    for (const [label, changed, pattern] of cases) { const verdict = await reject(changed); expect(verdict.approve, label).toBe(false); expect(verdict.problems.join(' '), label).toMatch(pattern); }
    expect((await reject(rows, TEST_REFUND)).approve).toBe(false);
  });
  it('rejects a bundle that does not verify, an already settled auction and a malformed request', async () => {
    const { bundle, text, payouts } = await cleared(); const uri = settlementUri(payouts);
    const tampered = JSON.parse(text) as Record<string, any>; tampered.result.clearingPrice = '0.01';
    expect((await checkSettlementRequest(JSON.stringify(tampered), uri, SELLER)).problems.join(' ')).toMatch(/does not verify/);
    const settled = serializeAuditBundle(withSettlement(bundle, { viewingKey: `uviewtest1${'q'.repeat(300)}`, birthday: 4_550_000, seller: SELLER, txids: ['b'.repeat(64)] }));
    expect((await checkSettlementRequest(settled, uri, SELLER)).problems.join(' ')).toMatch(/already settled/);
    expect((await checkSettlementRequest(text, 'zcash:nonsense', SELLER)).approve).toBe(false);
    expect((await checkSettlementRequest('{}', uri, SELLER)).problems).toEqual(['The audit bundle is not valid.']);
  });
});
