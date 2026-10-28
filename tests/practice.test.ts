import { describe, expect, it } from 'vitest';
import { SimulatedChain } from '../src/lib/simulated-chain';
import { buildReminders, estimatedTime } from '../src/lib/reminder';
import type { Listing } from '../src/lib/listing';
import { commitSubmission, prepareBid } from '../src/protocol/memo';
import { receiptText } from '../src/lib/receipt-file';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

describe('simulated chain', () => {
  it('mines payments into the next block and serves them like the real vault memo listing', async () => {
    const chain = new SimulatedChain(1000);
    const bids = await Promise.all(['0.5', '0.4'].map(price => prepareBid({ auctionId: 'SIM-1', price, quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '1' })));
    for (const bid of bids) chain.payCommit(bid.memo, 100_000_000);
    chain.payCommit(commitSubmission(await prepareBid({ auctionId: 'OTHER', price: '0.1', quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '1' })).commitment ? (await prepareBid({ auctionId: 'OTHER', price: '0.1', quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '1' })).memo : '', 100_000_000);
    chain.payReveal('SIM-1', receiptText(bids[0]!.reveal, 'testnet')); chain.advance(5);
    expect(chain.tip).toBe(1000 + 4 + 5);
    expect(await chain.status()).toMatchObject({ connected: true, network: 'testnet', synced: true, blocks: chain.tip });
    const result = await chain.memos(TEST_VAULT, 'SIM-1', 100_000_000);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.commits.map(note => note.height)).toEqual([1001, 1002]); expect(result.reveals).toHaveLength(1);
    expect(result.commits[0]?.confirmations).toBe(chain.tip - 1001 + 1);
    expect(result.reveals[0]?.height).toBe(1004); expect(result.tip).toBe(chain.tip);
    const wrongTier = await chain.memos(TEST_VAULT, 'SIM-1', 10_000_000); if (wrongTier.status === 'ok') expect(wrongTier.commits).toHaveLength(0);
    expect(() => chain.advance(0)).toThrow(); expect(() => chain.payCommit('not a memo', 1)).toThrow();
  });
});

describe('calendar reminders', () => {
  const listing: Listing = { v: 1, title: 'Slots, "two"; today', description: '', schedule: { commitUntil: 4_551_000, revealUntil: 4_551_100, anchorHeight: 4_550_900, anchorTime: 1_793_200_000 },
    auction: { auctionId: 'ICS-1', network: 'testnet', vault: TEST_VAULT, supply: 1, reserve: '0.01', collateral: '1', unitDemand: true, procurement: false } };
  it('estimates each deadline from the listing anchor at 25 seconds per block', () => {
    expect(estimatedTime(listing, 4_551_000)).toBe(1_793_200_000 + 100 * 25); expect(estimatedTime(listing, 4_551_100)).toBe(1_793_200_000 + 200 * 25);
  });
  it('produces a valid iCalendar file with both deadlines, alarms, escaped text and CRLF lines', () => {
    const text = buildReminders(listing, 1_793_199_000);
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true); expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2); expect(text.match(/BEGIN:VALARM/g)).toHaveLength(5);
    expect(text).toContain('UID:ICS-1-reveal@darkzec'); expect(text).toMatch(/DTSTART:20261028T\d{6}Z/); expect(text).toContain('Slots\\, "two"\; today');
    expect(text).toContain('A bid that is not revealed loses its 1 ZEC collateral'.slice(0, 30));
    expect(text.split('\r\n').every(line => line.length <= 75)).toBe(true); expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});
