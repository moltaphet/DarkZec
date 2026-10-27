import { revealLocalReceipts } from './auction-helpers';
import { expect, test } from '@playwright/test';
import { WALLET_REFUND, WALLET_REFUND_RECEIVER, WALLET_VAULT, WALLET_VAULT_RECEIVER, walletAddress } from '../fixtures';

for (const quantity of [10, 11]) {
  test(`single bid with demand ${quantity} clears at reserve rather than its maximum`, async ({ page }) => {
    const external: string[] = []; const sockets: string[] = [];
    page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${process.env.PORT ?? 4173}/`)) external.push(request.url()); });
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.goto('/'); await page.locator('#bid-price').fill('0.9'); await page.locator('#bid-quantity').fill(String(quantity));
    await page.locator('#prepare').click(); await expect(page.locator('#prepared-panel')).toBeVisible();
    await page.locator('#commit').click(); await page.locator('#close').click(); await revealLocalReceipts(page); await page.locator('#clear').click();
    await expect(page.locator('#clearing-price')).toHaveText('0.5 ZEC'); await expect(page.locator('#filled-lots')).toHaveText('10 / 10 LOTS');
    await expect(page.locator('#result-rows tr')).toHaveCount(1);
    expect(external).toEqual([]); expect(sockets).toEqual([]);
  });
}

test('a winning bid larger than the whole supply pays the competing margin rather than its own limit', async ({ page }) => {
  const external: string[] = []; page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${process.env.PORT ?? 4173}/`)) external.push(request.url()); });
  await page.goto('/'); await page.locator('#seed').click();
  await page.locator('#bid-price').fill('0.9'); await page.locator('#bid-quantity').fill('11');
  await page.locator('#prepare').click(); await page.locator('#commit').click();
  await page.locator('#close').click(); await revealLocalReceipts(page); await page.locator('#clear').click();
  await expect(page.locator('#clearing-price')).toHaveText('0.74 ZEC');
  await expect(page.locator('#filled-lots')).toHaveText('10 / 10 LOTS');
  const winner = page.locator('#result-rows tr').first();
  await expect(winner.locator('td').nth(2)).toHaveText('10 / 11');
  await expect(winner.locator('td').nth(3)).toHaveText('7.4');
  await expect(winner.locator('td').nth(4)).toHaveText('2.6');
  expect(external).toEqual([]);
});

test('wallet accepts mixed UAs, projects Orchard payments, and rejects equivalent vault/refund receivers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#wallet-tab').click();
  const vault = walletAddress(WALLET_VAULT_RECEIVER, true);
  await page.locator('#wallet-vault').fill(vault);
  await page.locator('#wallet-refund').fill(walletAddress(WALLET_VAULT_RECEIVER));
  await page.locator('#wallet-price').fill('0.72'); await page.locator('#wallet-quantity').fill('4');
  await page.locator('#wallet-prepare').click();
  await expect(page.locator('#error')).toContainText('Security error: refund address must differ');
  await expect(page.locator('#wallet-output')).toBeHidden(); await expect(page.locator('#open-wallet')).not.toHaveAttribute('href');
  await page.locator('#wallet-refund').fill(walletAddress(WALLET_REFUND_RECEIVER, true)); await page.locator('#wallet-prepare').click();
  await expect(page.locator('#wallet-output')).toBeVisible();
  const uri = await page.locator('#wallet-uri').inputValue(); expect(uri.startsWith(`zcash:${WALLET_VAULT}?`)).toBe(true);
  const encoded = new URLSearchParams(uri.split('?')[1]).get('memo'); if (!encoded) throw new Error('Missing memo');
  const memo: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); expect(memo).toMatchObject({ v: 2, t: 'commit' }); expect(memo).not.toHaveProperty('r');
  await page.locator('#wallet-reviewed').check(); await expect(page.locator('#open-wallet')).not.toHaveAttribute('href');
  await Promise.all([page.waitForEvent('download'), page.locator('#download-wallet-receipt').click()]);
  await expect(page.locator('#open-wallet')).toHaveAttribute('href', uri);
  await page.locator('#wallet-refund').fill(vault); await page.locator('#wallet-prepare').click();
  await expect(page.locator('#error')).toContainText('Security error: refund');
  await expect(page.locator('#wallet-uri')).toHaveValue(''); await expect(page.locator('#open-wallet')).not.toHaveAttribute('href');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('#live-terminal-log').scrollIntoViewIfNeeded();
  const log = await page.locator('#live-terminal-log').innerText(); expect(log).not.toContain(vault); expect(log).not.toContain(WALLET_REFUND);
  expect(errors).toEqual([]);
});
