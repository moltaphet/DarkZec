import { describe, expect, it } from 'vitest';
import { clearUniformAuction } from '../src/lib/darkpool';
import type { VerifiedBid } from '../src/lib/darkpool';
import { parseZec } from '../src/protocol/amount';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const config = { auctionId: 'CLEAR-001', supply: 10, reserve: '0.5', vault: TEST_VAULT, network: 'testnet' as const };
const bid = (price: string, quantity: number, index: number): VerifiedBid => ({
  commitment: index.toString(16).padStart(64, '0'),
  bid: { auctionId: config.auctionId, price, quantity, salt: index.toString(16).padStart(64, '0'), refund: TEST_REFUND },
});

describe('uniform opportunity-price clearing', () => {
  it('uses reserve for empty, ineligible, exact-demand and solitary books', () => {
    for (const bids of [[], [bid('0.4', 100, 1)], [bid('1', 4, 1)], [bid('1', 10, 1)], [bid('1', 100, 1)], [bid('1', 4, 1), bid('0.7', 6, 2)], [bid('1', 10, 1), bid('0.49', 200, 2)]]) {
      expect(clearUniformAuction(config, bids).clearingPrice).toBe('0.5');
    }
  });
  it('uses the highest rejected eligible price when the marginal winner is completely filled', () => {
    const result = clearUniformAuction(config, [bid('0.9', 10, 1), bid('0.75', 5, 2), bid('0.6', 3, 3)]);
    expect(result.clearingPrice).toBe('0.75'); expect(result.filled).toBe(10);
    expect(result.allocations.map(row => row.filled)).toEqual([10, 0, 0]);
    expect(result.allocations[0]?.paid).toBe('7.5');
  });
  it('handles a partial marginal bid, below-reserve bids and sub-zec precision', () => {
    const result = clearUniformAuction(config, [bid('0.74', 4, 1), bid('0.72', 4, 2), bid('0.68', 6, 3), bid('0.4', 100, 4)]);
    expect(result.clearingPrice).toBe('0.68'); expect(result.allocations.map(row => row.filled)).toEqual([4, 4, 2, 0]);
    expect(result.allocations[3]?.refundAmount).toBe('40');
    expect(clearUniformAuction({ ...config, supply: 1, reserve: '0.00000001' }, [bid('0.00000003', 1, 1), bid('0.00000002', 1, 2)]).clearingPrice).toBe('0.00000002');
  });
  it('excludes a sole winner own excess demand from the competing margin', () => {
    for (const quantity of [10, 11, 100]) {
      const result = clearUniformAuction(config, [bid('0.9', quantity, 1), bid('0.75', 5, 2), bid('0.6', 3, 3)]);
      expect(result.clearingPrice).toBe('0.75'); expect(result.allocations.map(row => row.filled)).toEqual([10, 0, 0]);
      expect(result.allocations[0]?.paid).toBe('7.5');
    }
    expect(clearUniformAuction(config, [bid('0.9', 11, 1), bid('0.49', 100, 2)]).clearingPrice).toBe('0.5');
  });
  it('rejects coerced runtime supply values before numeric allocation', () => {
    for (const supply of ['10', ['10'], 10n]) {
      const malformed = { ...config, supply } as unknown as typeof config;
      expect(() => clearUniformAuction(malformed, [bid('0.9', 11, 1)])).toThrow('Supply must be a whole number');
    }
  });
  it('keeps tied allocations invariant under hash and salt changes', () => {
    const a = bid('1', 2, 99); const b = bid('1', 2, 1);
    const first = clearUniformAuction({ ...config, supply: 3 }, [a, b]);
    const second = clearUniformAuction({ ...config, supply: 3 }, [{ ...a, commitment: '0'.repeat(64), bid: { ...a.bid, salt: 'f'.repeat(64) } }, { ...b, commitment: 'f'.repeat(64) }]);
    expect(first.allocations.map(row => row.filled)).toEqual([2, 1]);
    expect(second.allocations.map(row => row.filled)).toEqual([2, 1]);
  });
  it('conserves escrow and never exceeds reserve/limit/supply boundaries across small books', () => {
    for (const supply of [1, 2, 3, 5, 9, 12]) {
      for (const quantity of [1, 2, 4, 10]) {
        const result = clearUniformAuction({ ...config, supply }, [bid('1', quantity, 1), bid('0.7', quantity, 2), bid('0.4', quantity, 3)]);
        expect(result.filled).toBeLessThanOrEqual(supply); expect(parseZec(result.clearingPrice)).toBeGreaterThanOrEqual(parseZec(config.reserve));
        for (const row of result.allocations) {
          expect(row.filled).toBeGreaterThanOrEqual(0); expect(row.filled).toBeLessThanOrEqual(row.requested);
          expect(parseZec(row.paid) + parseZec(row.refundAmount)).toBe(parseZec(row.price) * BigInt(row.requested));
          if (row.filled) expect(parseZec(result.clearingPrice)).toBeLessThanOrEqual(parseZec(row.price));
        }
        expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.allocations)).toBe(true);
      }
    }
  });
  it('rejects malformed configurations, duplicate commitments, wrong auctions, self-refunds and escrow overflow', () => {
    for (const supply of [0, -1, 1.5, NaN]) expect(() => clearUniformAuction({ ...config, supply }, [])).toThrow();
    for (const reserve of ['0', '-1', 'NaN', '0.000000001']) expect(() => clearUniformAuction({ ...config, reserve }, [])).toThrow();
    const item = bid('1', 1, 1);
    expect(() => clearUniformAuction(config, [item, item])).toThrow('duplicate');
    expect(() => clearUniformAuction(config, [{ ...item, bid: { ...item.bid, auctionId: 'OTHER' } }])).toThrow('auction');
    expect(() => clearUniformAuction(config, [{ ...item, bid: { ...item.bid, refund: TEST_VAULT } }])).toThrow('Security error');
    expect(() => clearUniformAuction(config, [bid('21000000', 2, 1)])).toThrow('monetary');
    expect(() => clearUniformAuction(config, Array.from({ length: 129 }, (_, index) => bid('1', 1, index)))).toThrow('128');
  });
});
