import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WALLET_REFUND, WALLET_VAULT } from '../fixtures';
import { revealLocalReceipts } from './auction-helpers';

async function prepareWalletRequest(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pay with wallet' }).click();
  await page.locator('#wallet-vault').fill(WALLET_VAULT); await page.locator('#wallet-refund').fill(WALLET_REFUND);
  await page.locator('#wallet-price').fill('0.72'); await page.locator('#wallet-quantity').fill('4');
  await page.locator('#wallet-prepare').click(); await expect(page.locator('#wallet-output')).toBeVisible();
}
const memoOf = async (page: Page): Promise<string> => {
  const uri = await page.locator('#wallet-uri').inputValue(); const memo = new URL(uri.replace('zcash:', 'zcash://x/')).searchParams.get('memo');
  if (!memo) throw new Error('Missing memo parameter'); return Buffer.from(memo, 'base64url').toString('utf8');
};

test('memo copied from the receiving wallet round-trips against the prepared request', async ({ page }) => {
  await page.goto('/'); await prepareWalletRequest(page);
  const memo = await memoOf(page); const verify = page.locator('#memo-verify-result');
  for (const input of [memo, Buffer.from(memo).toString('base64url'), Buffer.concat([Buffer.from(memo), Buffer.alloc(512 - memo.length)]).toString('hex')]) {
    await page.locator('#memo-verify-input').fill(input); await page.locator('#memo-verify').click();
    await expect(verify).toContainText('VALID COMMIT MEMO'); await expect(verify).toContainText('MATCH / the memo your wallet received');
    await expect(verify).toHaveClass(/is-ok/);
  }
  // Change the first hash digit to a different digit; overwriting it with a fixed value is a no-op 1 time in 16.
  const altered = memo.replace(/"c":"(.)/, (_match, digit: string) => `"c":"${digit === '0' ? '1' : '0'}`);
  expect(altered).not.toBe(memo);
  await page.locator('#memo-verify-input').fill(altered); await page.locator('#memo-verify').click();
  await expect(verify).toHaveClass(/is-bad/);
  await page.locator('#memo-verify-input').fill(memo.replace('NODE07-001', 'OTHER-001')); await page.locator('#memo-verify').click();
  await expect(verify).toContainText('another auction'); await expect(verify).toHaveClass(/is-bad/);
  await page.locator('#memo-verify-input').fill('{"v":1,"a":"NODE07-001","p":"0.72","q":4,"s":"' + 'a'.repeat(64) + '","r":"x"}'); await page.locator('#memo-verify').click();
  await expect(verify).toContainText('REJECTED'); await expect(verify).toContainText('not a canonical DarkZec commit memo');
  await page.locator('#memo-verify-clear').click(); await expect(page.locator('#memo-verify-input')).toHaveValue(''); await expect(verify).toHaveText('');
});

test('without a prepared request a memo is validated but not compared, and the wallet receipt downloads', async ({ page }) => {
  await page.goto('/'); await prepareWalletRequest(page);
  const memo = await memoOf(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-wallet-receipt').click()]);
  expect(download.suggestedFilename()).toMatch(/^darkzec-receipt-NODE07-001-[a-f0-9]{8}\.json$/);
  const receipt: unknown = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(receipt).toMatchObject({ v: 1, a: 'NODE07-001', p: '0.72', q: 4 });
  await page.locator('#erase-wallet').click(); await expect(page.locator('#wallet-output')).toBeHidden();
  await page.locator('#memo-verify-input').fill(memo); await page.locator('#memo-verify').click();
  await expect(page.locator('#memo-verify-result')).toContainText('not compared');
});

test('a downloaded receipt can be imported and revealed, and unsaved receipts are flagged before closing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#prepare').click(); await page.locator('#commit').click(); await expect(page.locator('#bid-count')).toHaveText('01');
  await expect(page.locator('#reveal-status')).toContainText('1 receipt not downloaded yet');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#reveal-download').click()]);
  await expect(page.locator('#reveal-status')).not.toContainText('not downloaded yet');
  const file = await download.path();
  await page.locator('#close').click(); await expect(page.locator('#phase')).toHaveText('CLOSED / REVEAL WINDOW');
  await page.locator('#reveal-file').setInputFiles(file);
  await expect(page.locator('#reveal-status')).toContainText('Receipt file loaded and validated');
  await expect(page.locator('#reveal-receipt')).toHaveValue(/"p":"0.72"/);
  await page.locator('#reveal-own').click(); await expect(page.locator('#reveal-status')).toContainText('1/1 valid reveals');
  await page.locator('#clear').click();
  await expect(page.locator('#settlement-balance')).toHaveText(/^BALANCED \/ payments .* = 10 ZEC posted collateral$/);
  await expect(page.locator('#settlement-balance')).toHaveClass(/is-ok/);
});

test('invalid receipt files are rejected without touching the ledger', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#prepare').click(); await page.locator('#commit').click(); await page.locator('#close').click();
  await page.locator('#reveal-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"v":1}') });
  await expect(page.locator('#error')).toContainText('not a canonical DarkZec reveal receipt');
  await page.locator('#reveal-file').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(4000, 32) });
  await expect(page.locator('#error')).toContainText('at most 1 KB');
  await expect(page.locator('#reveal-status')).toContainText('0/1 valid reveals');
  await revealLocalReceipts(page); await expect(page.locator('#reveal-status')).toContainText('1/1 valid reveals');
});
