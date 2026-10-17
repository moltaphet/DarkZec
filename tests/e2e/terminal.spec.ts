import { test, expect } from '@playwright/test';
import { encodeOrchardAddress } from '../../src/protocol/address';
import { unhex } from '../../src/protocol/crypto';
import { FIXTURE_ADDRESS } from '../../src/fixtures';

// Another PUBLIC official receiver. Used only in intercepted browser tests; no wallet is opened.
const receiver = 'cc802699330bc4748e34dd598c7124e72299e6a6d5bcc32e90409c8024868b2705aadfab6068d458f69b0c';
const testAddress = encodeOrchardAddress(unhex(receiver), 'testnet');

test('complete local auction stays offline, reveals deliberately, audits and resets', async ({ page, context }) => {
  const external: string[] = []; const failures: string[] = []; const sockets: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url()); });
  page.on('pageerror', error => failures.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/') ? route.continue() : route.abort());
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.locator('#prepare')).toBeEnabled();
  await page.getByRole('button', { name: '+ Load 3 demo bids' }).click();
  await expect(page.locator('#bid-count')).toHaveText('03');
  await expect(page.locator('#seed')).toBeDisabled();
  await expect(page.locator('.book')).not.toContainText('0.74');
  await page.getByRole('button', { name: 'Prepare sealed bid' }).click();
  await expect(page.locator('#prepared-panel')).toBeVisible();
  await expect(page.locator('#prepared-amount')).toHaveText('2.88 ZEC');
  await expect(page.locator('#demo-uri')).toHaveValue('');
  await expect(page.locator('#prepared-bytes')).toContainText('/ 512 BYTES');
  await page.locator('#sensitive-details summary').click();
  await expect(page.locator('#demo-uri')).toHaveValue(/^zcash:utest1.+\?amount=2\.88&memo=[A-Za-z0-9_-]+$/);
  await page.locator('#sensitive-details summary').click();
  await expect(page.locator('#demo-uri')).toHaveValue('');
  await page.getByRole('button', { name: 'Commit to local vault' }).click();
  await expect(page.locator('#bid-count')).toHaveText('04');
  await expect(page.locator('#prepared-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Close auction' }).click();
  await expect(page.locator('#phase')).toHaveText('CLOSED / SEALED');
  await expect(page.locator('#prepare')).toBeDisabled();
  await expect(page.locator('#results-panel')).toBeHidden();
  await page.locator('#audit-index').fill('4');
  await page.getByRole('button', { name: 'Verify inclusion' }).click();
  await expect(page.locator('#audit-result')).toContainText('VERIFIED / Entry 4');
  await page.getByRole('button', { name: 'Unseal & clear' }).click();
  await expect(page.locator('#clearing-price')).toHaveText('0.68 ZEC');
  await expect(page.locator('#filled-lots')).toHaveText('10 / 10 LOTS');
  await expect(page.locator('#result-rows tr')).toHaveCount(4);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toHaveLength(0);
  expect(external).toEqual([]); expect(sockets).toEqual([]); expect(failures).toEqual([]);
  await page.getByRole('button', { name: 'Reset local session' }).click();
  await expect(page.locator('#bid-count')).toHaveText('00');
  await expect(page.locator('#results-panel')).toBeHidden();
  await expect(page.locator('#prepare')).toBeEnabled();
});

test('wallet builder rejects fixtures and gates explicit handoff, invalidating stale requests', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Wallet request' }).click();
  await page.locator('#wallet-vault').fill('t1transparent');
  await page.locator('#wallet-refund').fill(testAddress);
  await page.locator('#wallet-price').fill('0.72');
  await page.locator('#wallet-quantity').fill('4');
  await page.locator('#wallet-prepare').click();
  await expect(page.locator('#error')).toContainText('Invalid Unified Address');
  await page.locator('#wallet-vault').fill(FIXTURE_ADDRESS);
  await page.locator('#wallet-prepare').click();
  await expect(page.locator('#error')).toContainText('Public demo fixtures');
  await page.locator('#wallet-vault').fill(testAddress);
  await page.locator('#wallet-prepare').click();
  await expect(page.locator('#wallet-output')).toBeVisible();
  await expect(page.locator('#wallet-uri')).toHaveValue(/^zcash:utest1.+amount=2\.88&memo=/);
  await expect(page.locator('#open-wallet')).not.toHaveAttribute('href');
  await page.locator('#wallet-reviewed').check();
  await expect(page.locator('#open-wallet')).toHaveAttribute('href', /^zcash:utest1/);
  await page.locator('#wallet-price').fill('0.73');
  await expect(page.locator('#wallet-output')).toBeHidden();
  await expect(page.locator('#wallet-uri')).toHaveValue('');
  await expect(page.locator('#open-wallet')).not.toHaveAttribute('href');
  await page.locator('#wallet-prepare').click();
  await expect(page.locator('#wallet-output')).toBeVisible();
  await page.getByRole('button', { name: 'Erase request' }).click();
  await expect(page.locator('#wallet-output')).toBeHidden();
});

test('responsive terminal has no overflow, and reload discards the local book', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.locator('#prepare')).toBeEnabled();
  await page.screenshot({ path: 'test-results/terminal-desktop.png', fullPage: true });
  await page.locator('#bid-price').fill('0.000000001');
  await page.locator('#prepare').click();
  await expect(page.locator('#error')).toContainText('8 decimal places');
  await page.locator('#seed').click();
  await expect(page.locator('#bid-count')).toHaveText('03');
  await page.reload();
  await expect(page.locator('#bid-count')).toHaveText('00');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/terminal-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Prepare sealed bid' }).click();
  await expect(page.locator('#prepared-panel')).toBeVisible();
  await expect(page.locator('#commit')).toBeEnabled();
});

test('CSP blocks outbound fetch before a network request leaves the page', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://')) outbound.push(request.url()); });
  await page.goto('/');
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://example.invalid/privacy-probe'); return false; } catch { return true; }
  });
  expect(blocked).toBe(true); expect(outbound).toEqual([]);
});
