import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { commitSubmission, prepareBid } from '../../src/protocol/memo';
import { receiptText } from '../../src/lib/receipt-file';
import { WALLET_REFUND, WALLET_VAULT } from '../fixtures';

const LIVE_AUCTION = 'LIVE-E2E';
const txid = (n: number) => n.toString(16).padStart(64, '0');

async function routeVault(page: Page, notes: () => unknown): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/api/chain/vault-memos', async route => {
    requests.push(route.request().postData() ?? ''); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes()) });
  });
  return requests;
}

test('the operator holds only hashes until reveal, and the session audit bundle verifies all eight checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#seed').click(); await expect(page.locator('#bid-count')).toHaveText('03');
  await expect(page.locator('#operator-commitments')).toHaveText('3 hashes');
  await expect(page.locator('#operator-bids-held')).toHaveText('None');
  await expect(page.locator('#operator-bids')).toBeHidden();
  await expect(page.locator('#operator-note')).toContainText('No price, quantity, salt or refund address has reached it');
  await page.locator('#close').click(); await expect(page.locator('#operator-statements')).toHaveText('1');
  await page.locator('#reveal-all').click(); await expect(page.locator('#operator-bids-held')).toHaveText('3 revealed bids');
  await expect(page.locator('#operator-statements')).toHaveText('4');
  await expect(page.locator('#session-status')).toContainText('operator signed an acknowledgement');
  await expect(page.locator('#audit-download')).toBeDisabled();
  await page.locator('#clear').click(); await expect(page.locator('#operator-statements')).toHaveText('5');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#audit-download').click()]);
  expect(download.suggestedFilename()).toBe('darkzec-audit-NODE07-001.json');
  const bundle = await readFile(await download.path(), 'utf8');
  expect(JSON.parse(bundle)).toMatchObject({ v: 1, kind: 'darkzec-audit-bundle', auction: { auctionId: 'NODE07-001', collateral: '10' } });

  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click();
  await expect(page.locator('#audit-verdict')).toHaveText('VERIFIED / NODE07-001: all 8 checks passed.');
  await expect(page.locator('#audit-check-rows tr.is-ok')).toHaveCount(8);
  // An operator that republishes a lower price is caught by the clearing re-run and the result signature.
  await page.locator('#audit-bundle-input').fill(bundle.replace(/"clearingPrice": "[0-9.]+"/, '"clearingPrice": "0.5"'));
  await page.locator('#audit-verify').click();
  await expect(page.locator('#audit-verdict')).toContainText('NOT VERIFIED');
  await expect(page.locator('#audit-check-rows tr[data-check="clearing"]')).toHaveClass('is-bad');
  await expect(page.locator('#audit-check-rows tr[data-check="result"]')).toHaveClass('is-bad');
  await page.locator('#audit-bundle-file').setInputFiles({ name: 'bundle.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await expect(page.locator('#audit-verdict')).toHaveText('VERIFIED / NODE07-001: all 8 checks passed.');
});

test('a live testnet auction imports confirmed commit and reveal memos, signs them and audits cleanly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const bids = await Promise.all([['0.9', 1], ['0.8', 1], ['0.6', 1]].map(([price, quantity]) =>
    prepareBid({ auctionId: LIVE_AUCTION, price: String(price), quantity: Number(quantity), vault: WALLET_VAULT, refund: WALLET_REFUND, network: 'testnet', collateral: '1' })));
  let phase: 'commit' | 'reveal' = 'commit';
  const requests = await routeVault(page, () => ({
    status: 'ok',
    commits: bids.map((bid, index) => ({ txid: txid(index + 1), commitment: commitSubmission(bid).commitment, confirmations: 9 - index })),
    // Before close the vault already holds a reveal memo; it must not be read until the reveal window.
    reveals: phase === 'reveal' ? [...bids.slice(0, 2).map((bid, index) => ({ txid: txid(10 + index), memo: receiptText(bid.reveal, 'testnet'), confirmations: 1 })),
      { txid: txid(20), memo: '{"v":1,"a":"LIVE-E2E","p":"9"}', confirmations: 1 }] : [{ txid: txid(10), memo: receiptText(bids[0]!.reveal, 'testnet'), confirmations: 1 }],
  }));

  await page.locator('#live-auction summary').click();
  await page.locator('#live-vault').fill(WALLET_VAULT); await page.locator('#live-auction-id').fill(LIVE_AUCTION);
  await page.locator('#live-collateral').selectOption('1'); await page.locator('#live-mode').selectOption('vickrey');
  await page.locator('#live-start').click();
  await expect(page.locator('#strip-auction')).toHaveText(LIVE_AUCTION); await expect(page.locator('#strip-rule')).toHaveText('VICKREY / 1 LOT');
  await expect(page.locator('#prepare')).toBeDisabled(); await expect(page.locator('#seed')).toBeDisabled();
  await expect(page.locator('#operator-source')).toContainText('Live testnet vault');

  await page.locator('#live-sync').click();
  await expect(page.locator('#live-status')).toContainText('Synced 3 confirmed commit payments: 3 new, 0 refused.');
  await expect(page.locator('#bid-count')).toHaveText('03'); await expect(page.locator('#operator-bids-held')).toHaveText('None');
  expect(JSON.parse(requests[0] ?? '{}')).toEqual({ address: WALLET_VAULT, auctionId: LIVE_AUCTION, collateralZat: 100_000_000 });
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('0 new');

  await page.locator('#close').click(); phase = 'reveal';
  await page.locator('#live-sync').click();
  await expect(page.locator('#live-status')).toContainText('2 newly accepted and signed, 1 refused');
  await expect(page.locator('#operator-bids-held')).toHaveText('2 revealed bids');
  await page.locator('#live-sync').click(); await expect(page.locator('#live-status')).toContainText('0 newly accepted');
  await page.locator('#reveal-expire').click(); await page.locator('#clear').click();
  await expect(page.locator('#clearing-price')).toHaveText('0.8 ZEC'); await expect(page.locator('#filled-lots')).toHaveText('1 / 1 LOTS');
  await expect(page.locator('#excluded-bids')).toHaveText('1 unrevealed / 1 ZEC collateral forfeited and burned');
  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click();
  await expect(page.locator('#audit-verdict')).toHaveText(`VERIFIED / ${LIVE_AUCTION}: all 8 checks passed.`);

  await page.locator('#sandbox-tab').click(); await page.locator('#live-leave').click();
  await expect(page.locator('#strip-auction')).toHaveText('NODE07-001'); await expect(page.locator('#prepare')).toBeEnabled();
});

test('a live auction reports an unavailable wallet and refuses demo fixtures as its vault', async ({ page }) => {
  await page.goto('/');
  await routeVault(page, () => ({ status: 'wallet-not-configured' }));
  await page.locator('#live-auction summary').click();
  await page.locator('#live-vault').fill((await import('../../src/fixtures')).FIXTURE_ADDRESS); await page.locator('#live-start').click();
  await expect(page.locator('#error')).toContainText('Public demo fixtures cannot be used as a real vault');
  await page.locator('#live-vault').fill(WALLET_VAULT); await page.locator('#live-start').click();
  await page.locator('#live-sync').click();
  await expect(page.locator('#live-status')).toHaveText('Sync failed: no local wallet RPC is configured.');
  await expect(page.locator('#live-status')).toHaveClass(/is-bad/);
});

test('the wallet builds tiered commit requests and an on-chain reveal request from a saved receipt', async ({ page }) => {
  await page.goto('/'); await page.locator('#wallet-tab').click();
  await page.locator('#wallet-vault').fill(WALLET_VAULT); await page.locator('#wallet-refund').fill(WALLET_REFUND);
  await page.locator('#wallet-collateral').selectOption('1');
  await page.locator('#wallet-price').fill('0.72'); await page.locator('#wallet-quantity').fill('4'); await page.locator('#wallet-prepare').click();
  await expect(page.locator('#error')).toContainText('exceeds the posted collateral');
  // The form sits far below the banner; the error must still be on screen where the user is working.
  await expect(page.locator('#error')).toBeInViewport();
  await page.locator('#wallet-price').fill('0.2'); await page.locator('#wallet-prepare').click();
  await expect(page.locator('#wallet-uri')).toHaveValue(/amount=1&memo=/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-wallet-receipt').click()]);
  const receipt = await readFile(await download.path(), 'utf8');

  await expect(page.locator('#wallet-reveal-open')).not.toHaveAttribute('href');
  await page.locator('#wallet-reveal-file').setInputFiles(await download.path());
  await expect(page.locator('#wallet-reveal-output')).toBeVisible();
  const uri = await page.locator('#wallet-reveal-uri').inputValue();
  expect(uri.startsWith(`zcash:${WALLET_VAULT}?amount=0.0001&memo=`)).toBe(true);
  expect(Buffer.from(new URLSearchParams(uri.split('?')[1]).get('memo') ?? '', 'base64url').toString('utf8')).toBe(receipt);
  await expect(page.locator('#wallet-reveal-open')).toHaveAttribute('href', uri);
  await page.locator('#wallet-vault').fill(WALLET_REFUND); await page.locator('#wallet-reveal-file').setInputFiles(await download.path());
  await expect(page.locator('#error')).toContainText('refund address must differ');
  await expect(page.locator('#wallet-reveal-output')).toBeHidden();
});
