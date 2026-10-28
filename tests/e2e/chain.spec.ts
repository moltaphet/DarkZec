import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const BUNDLE = 'public/testnet/DZ-TESTNET-1-audit-bundle.json';
const SNAPSHOT = 'public/testnet/DZ-TESTNET-1-chain-activity.json';

test('a shipped testnet run verifies all ten checks against its recorded chain snapshot when no light client answers', async ({ page }) => {
  let asked = 0;
  await page.route('**/api/chain/view-activity', route => { asked++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"invalid-request"}' }); });
  await page.goto('/'); await page.getByRole('button', { name: 'Audit mode' }).click();
  await page.locator('#audit-run-DZ-TESTNET-1').click();
  await expect(page.locator('#audit-verdict')).toContainText('VERIFIED / DZ-TESTNET-1: 8 checks verified in this browser; the 2 on-chain checks replay a chain snapshot recorded at height');
  await expect(page.locator('#audit-verdict')).toContainText('a recording, not an independent live read');
  await expect(page.locator('[data-check="chain-payouts"] .state')).toHaveText('PASS (RECORDED)');
  expect(asked).toBe(1);
  await expect(page.locator('#audit-check-rows tr')).toHaveCount(10);
  await expect(page.locator('[data-check="chain-payouts"]')).toContainText('2 refunds, the proceeds and no burn paid exactly on chain');
});

test('on a local server the on-chain checks read live, and a tampered snapshot fails them', async ({ page }) => {
  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as { sent: { amountZat: number }[] };
  let body = JSON.stringify(snapshot);
  await page.route('**/api/chain/view-activity', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto('/'); await page.getByRole('button', { name: 'Audit mode' }).click();
  await page.locator('#audit-run-DZ-TESTNET-1').click();
  await expect(page.locator('#audit-verdict')).toContainText('all 10 checks passed, the on-chain ones read live from testnet');
  const short = structuredClone(snapshot); const first = short.sent[0]; if (first) first.amountZat -= 1; body = JSON.stringify(short);
  await page.locator('#audit-verify').click();
  await expect(page.locator('#audit-verdict')).toContainText('NOT VERIFIED / 1 of 10 checks failed.');
  await expect(page.locator('[data-check="chain-payouts"]')).toHaveClass(/is-bad/);
});

test('a pasted settled bundle reports its on-chain checks as skipped without a chain source', async ({ page }) => {
  await page.route('**/api/chain/view-activity', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/'); await page.getByRole('button', { name: 'Audit mode' }).click();
  await page.locator('#audit-bundle-input').fill(await readFile(BUNDLE, 'utf8')); await page.locator('#audit-verify').click();
  await expect(page.locator('#audit-verdict')).toHaveText('VERIFIED / DZ-TESTNET-1: 8 checks passed; 2 on-chain checks need a Zcash light client (run scripts/verify-chain.ts).');
  await expect(page.locator('[data-check="chain-deposits"] .state')).toHaveText('SKIP');
});

test('the real vault scan lists what the published key saw, labelled as a recording when not read live', async ({ page }) => {
  await page.route('**/api/chain/view-activity', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/'); await page.getByRole('button', { name: 'Vault scanner' }).click();
  await expect(page.locator('#real-scan-view')).toBeVisible();
  await page.locator('#real-scan-run').click();
  await expect(page.locator('#real-scan-status')).toHaveText('Paste a testnet unified full viewing key (uviewtest1…).');
  await page.locator('#real-scan-DZ-TESTNET-1').click();
  await expect(page.locator('#real-scan-status')).toContainText('4 notes received (0.2002 ZEC) and 3 payments made (0.2 ZEC), from the chain snapshot recorded at height');
  await expect(page.locator('#real-scan-key')).toHaveValue(/^uviewtest1/);
  await expect(page.locator('#real-scan-rows tr')).toHaveCount(7);
  await expect(page.locator('#real-scan-rows tr[data-direction="OUT"]')).toHaveCount(3);
  await expect(page.locator('#real-scan-rows')).toContainText('PROCEEDS');
});
