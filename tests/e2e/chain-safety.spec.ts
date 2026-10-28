import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { commitSubmission, prepareBid } from '../../src/protocol/memo';
import { WALLET_REFUND, WALLET_VAULT } from '../fixtures';

const AUCTION = 'SAFE-E2E';
const TIP = 4_551_000;
const txid = (n: number) => n.toString(16).padStart(64, '0');
interface State { tip: number; tipTime?: number; minConfirmations: number; commits: { commitment: string; height: number }[]; fail?: string }

async function mock(page: Page, state: State): Promise<void> {
  await page.route('**/api/chain/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connected: true, network: 'testnet', synced: true, blocks: state.tip, headers: state.tip, ...(state.tipTime === undefined ? {} : { tipTime: state.tipTime }) }) }));
  await page.route('**/api/chain/vault-memos', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.fail ? { status: state.fail } : { status: 'ok', tip: state.tip, minConfirmations: state.minConfirmations, reveals: [],
    commits: state.commits.map((note, index) => ({ txid: txid(index + 1), commitment: note.commitment, confirmations: state.tip - note.height + 1, height: note.height })) }) }));
}
async function start(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('#live-auction > .tool-content > details > summary').click();
  await page.locator('#live-vault').fill(WALLET_VAULT); await page.locator('#live-auction-id').fill(AUCTION); await page.locator('#live-collateral').selectOption('1'); await page.locator('#live-mode').selectOption('vickrey');
  await page.locator('#live-commit-minutes').fill('1'); await page.locator('#live-minutes').fill('1'); await page.locator('#live-key-passphrase').fill('correct horse battery');
  await Promise.all([page.waitForEvent('download'), page.locator('#live-start').click()]);
}
const bids = () => Promise.all(['0.9', '0.8'].map(price => prepareBid({ auctionId: AUCTION, price, quantity: 1, vault: WALLET_VAULT, refund: WALLET_REFUND, network: 'testnet', collateral: '1' })));

test('deadlines include the wallet\'s lag, and the listing counts from the chain\'s real height', async ({ page }) => {
  const state: State = { tip: TIP, tipTime: Math.floor(Date.now() / 1000) - 110, minConfirmations: 1, commits: [] }; await mock(page, state); await start(page);
  // About 110 seconds is 5 blocks of lag: the 3-block commit window becomes 8 blocks, and the anchor is the wallet's own block time.
  await expect(page.locator('#live-status')).toContainText(`bidding closes after block ${TIP + 5 + 3}`); await expect(page.locator('#live-status')).toContainText('The wallet was 5 blocks behind');
});

test('closing waits until the last payments have the required confirmations', async ({ page }) => {
  const state: State = { tip: TIP, minConfirmations: 3, commits: [] }; await mock(page, state); await start(page);
  const [first] = await bids(); if (!first) throw new Error('no bid');
  state.tip = TIP + 4; state.commits = [{ commitment: commitSubmission(first).commitment, height: TIP + 3 }];
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText(`the last payments need 3 confirmations, so sync again from block ${TIP + 3 + 2}`);
  await page.locator('#close').click(); await expect(page.locator('#error')).toContainText(`need 3 confirmations to count: sync again from block ${TIP + 5}`);
  state.tip = TIP + 5; await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('close the auction now');
  await page.locator('#close').click(); await expect(page.locator('#operator-bids-held')).toHaveText('None');
});

test('a payment that disappears from the chain stops the auction from closing, with the way out', async ({ page }) => {
  const state: State = { tip: TIP, minConfirmations: 1, commits: [] }; await mock(page, state); await start(page);
  const [first, second] = await bids(); if (!first || !second) throw new Error('no bids');
  state.tip = TIP + 4; state.commits = [first, second].map((bid, index) => ({ commitment: commitSubmission(bid).commitment, height: TIP + 1 + index }));
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('Synced 2 confirmed commit payments: 2 new, 0 refused.');
  // A reorganisation drops one payment from the chain the wallet now sees.
  state.commits = state.commits.slice(0, 1);
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('WARNING: 1 payment already imported is no longer on the chain'); await expect(page.locator('#live-status')).toHaveClass(/is-bad/);
  await page.locator('#close').click(); await expect(page.locator('#error')).toContainText('Resume the auction from its link and key file');
});

test('a vault with too many notes is an explicit error, not a quiet cut', async ({ page }) => {
  const state: State = { tip: TIP, minConfirmations: 1, commits: [], fail: 'too-many-notes' }; await mock(page, state); await start(page);
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toHaveText('Sync failed: this vault account holds too many notes for one auction; use a fresh vault account.');
});
