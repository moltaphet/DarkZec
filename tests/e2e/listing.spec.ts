import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { commitSubmission, prepareBid } from '../../src/protocol/memo';
import { receiptText } from '../../src/lib/receipt-file';
import { WALLET_REFUND, WALLET_VAULT } from '../fixtures';

const AUCTION = 'LIST-E2E';
const TIP = 4_551_000;
const txid = (n: number) => n.toString(16).padStart(64, '0');

async function mockChain(page: Page, state: { tip: number; commits: { commitment: string; height: number }[]; reveals: { memo: string; height: number }[] }): Promise<void> {
  await page.route('**/api/chain/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connected: true, network: 'testnet', synced: true, blocks: state.tip, headers: state.tip }) }));
  await page.route('**/api/chain/vault-memos', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    status: 'ok', tip: state.tip,
    commits: state.commits.map((note, index) => ({ txid: txid(index + 1), commitment: note.commitment, confirmations: state.tip - note.height + 1, height: note.height })),
    reveals: state.reveals.map((note, index) => ({ txid: txid(50 + index), memo: note.memo, confirmations: state.tip - note.height + 1, height: note.height })) }) }));
}

test('an operator signs a block-scheduled listing, bidders open it, and the audit covers listing, schedule and the result check', async ({ page, context }) => {
  const bids = await Promise.all([['0.9', 'a'], ['0.8', 'b'], ['0.6', 'c'], ['0.7', 'd']].map(([price]) =>
    prepareBid({ auctionId: AUCTION, price: String(price), quantity: 1, vault: WALLET_VAULT, refund: WALLET_REFUND, network: 'testnet', collateral: '1' })));
  const state = { tip: TIP, commits: [] as { commitment: string; height: number }[], reveals: [] as { memo: string; height: number }[] };
  await mockChain(page, state);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');

  // Seller: describe the auction and start it; the link carries a signed listing with block-height deadlines.
  await page.locator('#live-auction > .tool-content > details > summary').click();
  await page.locator('#live-title').fill('Two design review slots'); await page.locator('#live-description').fill('Sealed bids, second price.\nDelivered by video call.');
  await page.locator('#live-vault').fill(WALLET_VAULT); await page.locator('#live-auction-id').fill(AUCTION);
  await page.locator('#live-collateral').selectOption('1'); await page.locator('#live-mode').selectOption('vickrey');
  await page.locator('#live-commit-minutes').fill('1'); await page.locator('#live-minutes').fill('1');
  await page.locator('#live-start').click(); await expect(page.locator('#error')).toContainText('passphrase of at least 8 characters');
  await page.locator('#live-key-passphrase').fill('correct horse battery');
  const [keyDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#live-start').click()]);
  expect(keyDownload.suggestedFilename()).toBe(`darkzec-operator-key-${AUCTION}.json`);
  expect(await readFile(await keyDownload.path(), 'utf8')).not.toMatch(/"d"/);
  await expect(page.locator('#live-status')).toContainText(`bidding closes after block ${TIP + 3}`);
  const shared = await page.locator('#live-link').inputValue();
  expect(shared.startsWith('https://darkzec.xyz/#/a/')).toBe(true);
  const preview = await page.locator('#live-open-link').getAttribute('href') ?? '';
  expect(preview).toContain('/#/a/');

  // Bidder: the link opens the listing page with rules, deadlines and the vault.
  const bidder = await context.newPage(); await bidder.goto(preview);
  await expect(bidder.locator('#listing-title')).toHaveText('Two design review slots');
  await expect(bidder.locator('#listing-description')).toContainText('Delivered by video call.');
  await expect(bidder.locator('#listing-rules')).toContainText('Second-price (Vickrey) auction for 1 lot');
  await expect(bidder.locator('#listing-commit-until')).toContainText(`block ${TIP + 3}`); await expect(bidder.locator('#listing-reveal-until')).toContainText(`block ${TIP + 6}`);
  await expect(bidder.locator('#listing-phase')).toHaveAttribute('data-phase', 'BIDDING OPEN');
  await expect(bidder.locator('#listing-vault')).toHaveText(WALLET_VAULT);
  await bidder.locator('#listing-bid').click();
  await expect(bidder.locator('#wallet-view')).toBeVisible();
  await expect(bidder.locator('#wallet-vault')).toHaveValue(WALLET_VAULT); await expect(bidder.locator('#wallet-vault')).toHaveAttribute('readonly', '');
  await expect(bidder.locator('#wallet-auction')).toHaveValue(AUCTION); await expect(bidder.locator('#wallet-collateral')).toHaveValue('1'); await expect(bidder.locator('#wallet-collateral')).toBeDisabled();
  await expect(bidder.locator('#wallet-quantity')).toHaveValue('1'); await expect(bidder.locator('#wallet-listing-note')).toBeVisible();
  await bidder.locator('#wallet-refund').fill(WALLET_REFUND); await bidder.locator('#wallet-price').fill('0.5'); await bidder.locator('#wallet-prepare').click();
  await expect(bidder.locator('#wallet-uri')).toHaveValue(new RegExp(`^zcash:${WALLET_VAULT}\\?amount=1&memo=`));
  await Promise.all([bidder.waitForEvent('download'), bidder.locator('#download-wallet-receipt').click()]);
  await bidder.locator('#wallet-reviewed').check(); await expect(bidder.locator('#wallet-qr canvas')).toBeVisible();

  // Operator: closing waits for the commit deadline, late payments are refused, and clearing waits for the reveal deadline.
  await page.locator('#close').click(); await expect(page.locator('#error')).toContainText(`Bidding stays open until block ${TIP + 3}`);
  state.tip = TIP + 4; state.commits = [...bids.slice(0, 3).map((bid, index) => ({ commitment: commitSubmission(bid).commitment, height: TIP + 1 + index })), { commitment: commitSubmission(bids[3]!).commitment, height: TIP + 4 }];
  await page.locator('#live-sync').click();
  await expect(page.locator('#live-status')).toContainText('Synced 4 confirmed commit payments: 3 new, 1 refused.'); await expect(page.locator('#live-status')).toContainText('Bidding has closed on chain: close the auction now.');
  await page.locator('#close').click(); await expect(page.locator('#operator-bids-held')).toHaveText('None');
  state.tip = TIP + 8;
  state.reveals = [...bids.slice(0, 2).map((bid, index) => ({ memo: receiptText(bid.reveal, 'testnet'), height: TIP + 5 + index })), { memo: receiptText(bids[2]!.reveal, 'testnet'), height: TIP + 7 }];
  await page.locator('#live-sync').click();
  await expect(page.locator('#live-status')).toContainText('2 newly accepted and signed, 1 refused (late'); await expect(page.locator('#live-status')).toContainText('The reveal window has closed on chain');
  await page.locator('#clear').click();
  await expect(page.locator('#clearing-price')).toHaveText('0.8 ZEC'); await expect(page.locator('#filled-lots')).toHaveText('1 / 1 LOTS');
  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click();
  await expect(page.locator('#audit-verdict')).toHaveText(`VERIFIED / ${AUCTION}: all 10 checks passed.`);
  await expect(page.locator('[data-check="listing"]')).toContainText('The operator signed the listing “Two design review slots” before bidding');
  await expect(page.locator('[data-check="schedule"]')).toContainText(`Commits close after block ${TIP + 3} and reveals after block ${TIP + 6}`);
  const bundle = await page.locator('#audit-bundle-input').inputValue();

  // Bidder: checks the outcome with the published bundle and their own receipt.
  await bidder.locator('#listing-tab').click();
  await bidder.locator('#listing-bundle-file').setInputFiles({ name: 'bundle.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await expect(bidder.locator('#listing-result')).toContainText('AUDIT VERIFIED / 10 checks passed');
  await expect(bidder.locator('#listing-clearing')).toHaveText('0.8 ZEC');
  await bidder.locator('#listing-receipt-file').setInputFiles({ name: 'receipt.json', mimeType: 'application/json', buffer: Buffer.from(receiptText(bids[0]!.reveal, 'testnet')) });
  await expect(bidder.locator('#listing-mine')).toHaveText('WON 1 of 1 at 0.8 ZEC'); await expect(bidder.locator('#listing-refund')).toHaveText('0.2 ZEC');
  await bidder.locator('#listing-receipt-file').setInputFiles({ name: 'receipt.json', mimeType: 'application/json', buffer: Buffer.from(receiptText(bids[1]!.reveal, 'testnet')) });
  await expect(bidder.locator('#listing-mine')).toHaveText('did not win'); await expect(bidder.locator('#listing-refund')).toHaveText('1 ZEC');
  await bidder.locator('#listing-receipt-file').setInputFiles({ name: 'receipt.json', mimeType: 'application/json', buffer: Buffer.from(receiptText(bids[2]!.reveal, 'testnet')) });
  await expect(bidder.locator('#listing-mine')).toContainText('committed but not revealed in time'); await expect(bidder.locator('#listing-mine')).toContainText('burned');
  // A bundle of some other auction is refused.
  await bidder.locator('#listing-bundle-file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: await readFile('public/testnet/DZ-TESTNET-1-audit-bundle.json') });
  await expect(bidder.locator('#listing-result')).toContainText('This bundle is not for this auction');
});

test('a damaged or forged auction link is refused, and the wallet is not locked to it', async ({ page }) => {
  await page.goto('/#/a/eyJsIjp7fSwiayI6IjA0IiwicyI6IjAifQ');
  await expect(page.locator('#listing-tab')).toBeVisible();
  await expect(page.locator('#listing-error')).toContainText('damaged or was not issued by a DarkZec operator');
  await page.locator('#wallet-tab').click(); await expect(page.locator('#wallet-listing-note')).toBeHidden(); await expect(page.locator('#wallet-vault')).not.toHaveAttribute('readonly');
});

test('the shipped DZ-TESTNET-3 link opens its bidder page and one click shows the published result and the winner\'s outcome', async ({ page }) => {
  const readme = await readFile('docs/testnet-run/README.md', 'utf8');
  const hash = /https:\/\/darkzec\.xyz\/(#\/a\/[A-Za-z0-9_-]+)/.exec(readme)?.[1]; if (!hash) throw new Error('The DZ-TESTNET-3 link is missing from docs/testnet-run/README.md.');
  await page.route('**/api/chain/view-activity', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(`/${hash}`);
  await expect(page.locator('#listing-title')).toHaveText('One design review slot');
  await expect(page.locator('#listing-rules')).toContainText('Second-price (Vickrey) auction for 1 lot');
  await expect(page.locator('#listing-phase')).toHaveAttribute('data-phase', 'ENDED');
  await page.locator('#listing-load-published').click();
  await expect(page.locator('#listing-result')).toContainText('AUDIT VERIFIED / 12 checks passed (the on-chain checks used the chain snapshot recorded at height');
  await expect(page.locator('#listing-clearing')).toHaveText('0.05 ZEC');
  await expect(page.locator('#listing-mine')).toHaveText('WON 1 of 1 at 0.05 ZEC'); await expect(page.locator('#listing-refund')).toHaveText('0.05 ZEC');
});

test('a bidder can set calendar reminders for the deadlines, and the shipped link reads well on a phone', async ({ page }) => {
  const readme = await readFile('docs/testnet-run/README.md', 'utf8');
  const hash = /https:\/\/darkzec\.xyz\/(#\/a\/[A-Za-z0-9_-]+)/.exec(readme)?.[1]; if (!hash) throw new Error('The DZ-TESTNET-3 link is missing.');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/${hash}`);
  await expect(page.locator('#listing-title')).toHaveText('One design review slot');
  const [ics] = await Promise.all([page.waitForEvent('download'), page.locator('#listing-reminders').click()]);
  expect(ics.suggestedFilename()).toBe('darkzec-DZ-TESTNET-3-reminders.ics');
  const calendar = await readFile(await ics.path(), 'utf8');
  expect(calendar).toContain('BEGIN:VCALENDAR'); expect(calendar).toContain('REVEAL YOUR BID before it closes'); expect(calendar.match(/BEGIN:VALARM/g)).toHaveLength(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#listing-bid')).toBeVisible(); await page.locator('#listing-bid').click();
  await expect(page.locator('#wallet-vault')).toHaveAttribute('readonly', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
