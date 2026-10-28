import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { commitSubmission, prepareBid } from '../../src/protocol/memo';
import { receiptText } from '../../src/lib/receipt-file';
import { WALLET_REFUND, WALLET_VAULT } from '../fixtures';

const AUCTION = 'RESUME-E2E';
const TIP = 4_551_000;
const txid = (n: number) => n.toString(16).padStart(64, '0');
interface ChainState { tip: number; commits: { commitment: string; height: number }[]; reveals: { memo: string; height: number }[] }

async function mockChain(page: Page, state: ChainState): Promise<void> {
  await page.route('**/api/chain/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connected: true, network: 'testnet', synced: true, blocks: state.tip, headers: state.tip }) }));
  await page.route('**/api/chain/vault-memos', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', tip: state.tip,
    commits: state.commits.map((note, index) => ({ txid: txid(index + 1), commitment: note.commitment, confirmations: state.tip - note.height + 1, height: note.height })),
    reveals: state.reveals.map((note, index) => ({ txid: txid(50 + index), memo: note.memo, confirmations: state.tip - note.height + 1, height: note.height })) }) }));
}

test('an auction survives a lost tab: resume from the link and the encrypted key file, replay the chain and audit with the original signature', async ({ page }) => {
  const bids = await Promise.all(['0.9', '0.8', '0.6'].map(price => prepareBid({ auctionId: AUCTION, price, quantity: 1, vault: WALLET_VAULT, refund: WALLET_REFUND, network: 'testnet', collateral: '1' })));
  const state: ChainState = { tip: TIP, commits: [], reveals: [] }; await mockChain(page, state);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#live-auction > .tool-content > details > summary').click();
  await page.locator('#live-vault').fill(WALLET_VAULT); await page.locator('#live-auction-id').fill(AUCTION); await page.locator('#live-title').fill('Resumable');
  await page.locator('#live-collateral').selectOption('1'); await page.locator('#live-mode').selectOption('vickrey');
  await page.locator('#live-commit-minutes').fill('1'); await page.locator('#live-minutes').fill('1'); await page.locator('#live-key-passphrase').fill('correct horse battery');
  const [keyFile] = await Promise.all([page.waitForEvent('download'), page.locator('#live-start').click()]);
  const keyPath = await keyFile.path(); const link = await page.locator('#live-link').inputValue();
  expect(await readFile(keyPath, 'utf8')).toContain('darkzec-operator-key');

  // The tab is lost: a reload erases every in-memory ledger and the signing key.
  state.tip = TIP + 4; state.commits = bids.map((bid, index) => ({ commitment: commitSubmission(bid).commitment, height: TIP + 1 + index }));
  await page.goto('/'); await expect(page.locator('#live-link')).toBeHidden();
  await page.locator('#live-auction > .tool-content > details > summary').click(); await page.locator('#resume-details summary').click();
  await page.locator('#resume-link').fill(link);
  await page.locator('#resume-start').click(); await expect(page.locator('#error')).toContainText('Choose the operator key file');
  await page.locator('#resume-key-file').setInputFiles(keyPath);
  await page.locator('#resume-passphrase').fill('not the passphrase'); await page.locator('#resume-start').click(); await expect(page.locator('#error')).toContainText('Wrong passphrase');
  await page.locator('#resume-passphrase').fill('correct horse battery'); await page.locator('#resume-start').click();
  await expect(page.locator('#live-status')).toContainText(`Resumed auction ${AUCTION} with its original signed listing`);
  await expect(page.locator('#live-link')).toHaveValue(link);

  // Replay from the chain: commits, close, reveals, clear.
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('Synced 3 confirmed commit payments: 3 new, 0 refused.');
  await page.locator('#close').click(); await expect(page.locator('#operator-bids-held')).toHaveText('None');
  state.tip = TIP + 8; state.reveals = bids.slice(0, 2).map((bid, index) => ({ memo: receiptText(bid.reveal, 'testnet'), height: TIP + 5 + index }));
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('2 newly accepted and signed');
  await page.locator('#clear').click(); await expect(page.locator('#clearing-price')).toHaveText('0.8 ZEC');
  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click();
  await expect(page.locator('#audit-verdict')).toHaveText(`VERIFIED / ${AUCTION}: all 10 checks passed.`);
  await expect(page.locator('[data-check="listing"] .state')).toHaveText('PASS');
  const bundle = JSON.parse(await page.locator('#audit-bundle-input').inputValue()) as { operator: { statements: { statement: string; signature: string }[] } };
  expect(bundle.operator.statements[0]?.statement).toContain('DARKZEC/listing/v1');
});

test('practice mode runs the whole seller flow on a simulated chain, and the listing it produces cannot be paid', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#live-auction > .tool-content > details > summary').click(); await page.locator('#live-title').fill('Rehearsal'); await page.locator('#live-auction-id').fill('PRACTICE-1'); await page.locator('#live-mode').selectOption('vickrey');
  await page.locator('#live-practice').click();
  await expect(page.locator('#live-status')).toContainText('Practice auction PRACTICE-1 on a simulated chain'); await expect(page.locator('#practice-hint')).toHaveText('Step 1: Simulate 3 bidder payments.');
  await expect(page.locator('#strip-auction')).toHaveText('PRACTICE-1');
  const preview = await page.locator('#live-open-link').getAttribute('href') ?? '';
  await page.locator('#practice-pay-commits').click(); await expect(page.locator('#practice-hint')).toHaveText('Step 2: Advance the chain past the commit deadline.');
  await page.locator('#practice-advance').click(); await expect(page.locator('#practice-hint')).toHaveText('Step 3: Sync from vault, then Close auction.');
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('Synced 3 confirmed commit payments: 3 new, 0 refused.');
  await page.locator('#close').click();
  await expect(page.locator('#practice-hint')).toHaveText('Step 4: Simulate 2 reveals, then Sync from vault.');
  await page.locator('#practice-pay-reveals').click(); await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('2 newly accepted and signed');
  await expect(page.locator('#practice-hint')).toHaveText('Step 5: Advance the chain past the reveal deadline, then Sync from vault.');
  await page.locator('#practice-advance').click(); await page.locator('#live-sync').click();
  await expect(page.locator('#practice-hint')).toContainText('Step 6'); await page.locator('#clear').click();
  await expect(page.locator('#clearing-price')).toHaveText('0.7 ZEC'); await expect(page.locator('#practice-hint')).toContainText('Done.');
  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click(); await expect(page.locator('#audit-verdict')).toHaveText('VERIFIED / PRACTICE-1: all 10 checks passed.');
  const bidder = await context.newPage(); await bidder.goto(preview);
  await expect(bidder.locator('#listing-title')).toHaveText('Rehearsal'); await expect(bidder.locator('#listing-practice')).toBeVisible();
  await expect(bidder.locator('#listing-bid')).toBeDisabled(); await expect(bidder.locator('#listing-reminders')).toBeDisabled();
  // Leaving practice returns to the real chain and erases the practice controls.
  await page.locator('#sandbox-tab').click(); await page.locator('#live-leave').click(); await expect(page.locator('#practice-hint')).toBeHidden();
});
