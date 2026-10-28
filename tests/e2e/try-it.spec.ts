import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('.skip-intro').click(); await expect(page.locator('#judge-bar')).toBeVisible(); };

test('one click runs a whole sandbox auction and the result can be audited', async ({ page }) => {
  await open(page);
  await page.locator('#judge-sandbox').click();
  await expect(page.locator('#clearing-price')).toHaveText('0.68 ZEC', { timeout: 20_000 }); await expect(page.locator('#filled-lots')).toHaveText('10 / 10 LOTS');
  await expect(page.locator('#settlement-balance')).toContainText('BALANCED');
  await page.locator('#audit-tab').click(); await page.locator('#audit-session').click(); await expect(page.locator('#audit-verdict')).toHaveText('VERIFIED / NODE07-001: all 8 checks passed.');
  // Running it again starts from a clean demo auction instead of failing on the finished one.
  await page.locator('#sandbox-tab').click(); await page.locator('#judge-sandbox').click(); await expect(page.locator('#clearing-price')).toHaveText('0.68 ZEC', { timeout: 20_000 }); await expect(page.locator('#error')).toBeHidden();
});

test('one click audits a real testnet auction, scans its vault and opens its bidder page', async ({ page }) => {
  await page.route('**/api/chain/view-activity', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await open(page);
  await page.locator('#judge-audit').click(); await expect(page.locator('#audit-view')).toBeVisible(); await expect(page.locator('#audit-verdict')).toContainText('VERIFIED / DZ-TESTNET-3');
  await page.locator('#judge-scan').click(); await expect(page.locator('#real-scan-view')).toBeVisible(); await expect(page.locator('#real-scan-status')).toContainText('notes received');
  await page.locator('#judge-bidder').click(); await expect(page.locator('#listing-title')).toHaveText('One design review slot'); await expect(page.locator('#listing-phase')).toHaveAttribute('data-phase', 'ENDED');
  // Pressing it again with the link already open still works.
  await page.locator('#judge-bidder').click(); await expect(page.locator('#listing-view')).toBeVisible();
  await page.locator('#listing-load-published').click(); await expect(page.locator('#listing-mine')).toHaveText('WON 1 of 1 at 0.05 ZEC');
});

test('one click starts a practice auction as a seller, and leaving the demo auction first keeps it from failing', async ({ page }) => {
  await open(page);
  await page.locator('#judge-seller').click();
  await expect(page.locator('#practice-hint')).toHaveText('Step 1: Simulate 3 bidder payments.'); await expect(page.locator('#live-link')).toHaveValue(/#\/a\//);
  await page.locator('#judge-seller').click(); await expect(page.locator('#practice-hint')).toHaveText('Step 1: Simulate 3 bidder payments.');
});

test('the wallet tab previews a request from example addresses, then the memo check and the reveal reuse it', async ({ page }) => {
  await open(page);
  await page.locator('#wallet-tab').click(); await expect(page.locator('#wallet-reveal-use')).toBeDisabled(); await expect(page.locator('#memo-verify-fill')).toBeDisabled();
  await page.locator('#judge-wallet').click();
  await expect(page.locator('#wallet-uri')).toHaveValue(/^zcash:utest1.+amount=1&memo=/); await expect(page.locator('#wallet-output')).toBeVisible();
  await page.locator('#memo-verify-fill').click(); await page.locator('#memo-verify').click();
  await expect(page.locator('#memo-verify-result')).toContainText('VALID COMMIT MEMO'); await expect(page.locator('#memo-verify-result')).toHaveClass(/is-ok/);
  await page.locator('#wallet-reveal-use').click(); await expect(page.locator('#wallet-reveal-output')).toBeVisible();
  expect(await page.locator('#wallet-reveal-uri').inputValue()).toMatch(/^zcash:utest1.+amount=0\.0001&memo=/);
  // Manual path: the example button only fills the form.
  await page.locator('#wallet-example').click(); await expect(page.locator('#wallet-vault')).not.toHaveValue(''); await expect(page.locator('#wallet-uri')).toHaveValue('');
});

test('one click unlocks the training vault with demo credentials and loads its simulated notes', async ({ page }) => {
  await open(page);
  await page.locator('#judge-training').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED', { timeout: 20_000 }); await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  await expect(page.locator('#real-scan-view')).toBeVisible();
});
