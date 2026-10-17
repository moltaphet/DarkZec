import { test, expect } from '@playwright/test';
import { DEMO_UNLOCK_PASSPHRASE, DEMO_VIEWING_KEY, VIEWING_SESSION_KEY } from '../../src/lib/viewing-key-session';

async function openVault(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/'); await page.getByRole('button', { name: 'Vault scanner' }).click();
}
async function unlockDemo(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#vault-demo').click(); await page.locator('#vault-save').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED');
}

test('saves encrypted credentials, scans notes privately, rescans and locks without outbound requests', async ({ page, context }) => {
  const external: string[] = []; const failures: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url()); });
  page.on('pageerror', error => failures.push(error.message));
  await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/') ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1440, height: 1100 }); await openVault(page);
  await expect(page.locator('#vault-load-notes')).toBeDisabled();
  await unlockDemo(page);
  await expect(page.locator('#vault-viewing-key')).toHaveValue(''); await expect(page.locator('#vault-passphrase')).toHaveValue('');
  const saved = await page.evaluate(key => sessionStorage.getItem(key), VIEWING_SESSION_KEY);
  expect(saved).not.toBeNull(); expect(saved).not.toContain(DEMO_VIEWING_KEY); expect(saved).not.toContain(DEMO_UNLOCK_PASSPHRASE);
  await page.locator('#vault-load-notes').click();
  await expect(page.locator('#vault-accepted dd')).toHaveText('3'); await expect(page.locator('#vault-received dd')).toHaveText('5');
  await expect(page.locator('#vault-rejected dd')).toHaveText('1');
  await expect(page.locator('#vault-result-rows tr[data-status="empty"]')).toHaveCount(1);
  await expect(page.locator('#vault-result-rows')).toContainText('base64url');
  await page.locator('#vault-scan').click(); await expect(page.locator('#vault-result-rows tr')).toHaveCount(5);
  await page.locator('#vault-incoming').click(); await expect(page.locator('#vault-accepted dd')).toHaveText('4');
  await expect(page.locator('#vault-result-rows tr')).toHaveCount(6);
  await expect(page.locator('#bid-count')).toHaveText('00');
  const log = await page.locator('#telemetry-log').textContent();
  expect(log).not.toContain(DEMO_VIEWING_KEY); expect(log).not.toContain('0.74');
  await expect(page.locator('#telemetry-leaks')).toHaveText('0');
  await page.locator('#vault-result-rows tr[data-status="accepted"] details summary').first().click();
  await expect(page.locator('#vault-result-rows')).toContainText('PRIVATE SALT');
  await page.screenshot({ path: 'test-results/viewing-vault-desktop.png', fullPage: true });
  await page.locator('#vault-lock').click();
  await expect(page.locator('#vault-result-rows')).toContainText('Vault locked');
  await expect(page.locator('#vault-result-rows')).not.toContainText('PRIVATE SALT');
  await expect(page.locator('#vault-accepted dd')).toHaveText('0');
  expect(external).toEqual([]); expect(failures).toEqual([]);
});

test('reload requires passphrase, wrong passphrases cannot unlock, and forget removes only the saved record', async ({ page }) => {
  await openVault(page); await unlockDemo(page); await page.reload();
  await page.getByRole('button', { name: 'Vault scanner' }).click();
  await expect(page.locator('#vault-mode')).toHaveText('LOCKED');
  await expect(page.locator('#vault-saved-state')).toHaveText('ENCRYPTED SESSION / SAVED');
  await page.locator('#vault-passphrase').fill('wrong-local-passphrase'); await page.locator('#vault-unlock').click();
  await expect(page.locator('#vault-error')).toContainText('incorrect');
  await expect(page.locator('#vault-load-notes')).toBeDisabled();
  await page.locator('#vault-passphrase').fill(DEMO_UNLOCK_PASSPHRASE); await page.locator('#vault-unlock').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED');
  await page.locator('#vault-load-notes').click(); await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  await page.getByRole('button', { name: 'Wallet request' }).click();
  await page.getByRole('button', { name: 'Vault scanner' }).click();
  await expect(page.locator('#vault-mode')).toHaveText('LOCKED');
  await expect(page.locator('#vault-result-rows tr[data-status="accepted"]')).toHaveCount(0);
  await page.locator('#vault-forget').click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), VIEWING_SESSION_KEY)).toBeNull();
  await expect(page.locator('#vault-saved-state')).toHaveText('NO SAVED KEY');
  await expect(page.locator('#vault-unlock')).toBeDisabled();
});

test('wrong mock keys quarantine all notes and switching away during save leaves the vault locked', async ({ page }) => {
  await openVault(page);
  await page.locator('#vault-viewing-key').fill(`mock:node07:${'08'.repeat(32)}`);
  await page.locator('#vault-passphrase').fill('private-wrong-key-passphrase'); await page.locator('#vault-save').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED'); await page.locator('#vault-load-notes').click();
  await expect(page.locator('#vault-accepted dd')).toHaveText('0'); await expect(page.locator('#vault-rejected dd')).toHaveText('5');
  await expect(page.locator('#vault-result-rows')).toContainText('authentication failed');
  await page.locator('#vault-forget').click(); await page.locator('#vault-demo').click();
  await page.locator('#vault-save').click(); await page.getByRole('button', { name: 'Auction sandbox' }).click();
  await page.getByRole('button', { name: 'Vault scanner' }).click(); await expect(page.locator('#vault-mode')).toHaveText('LOCKED');
  await expect(page.locator('#vault-load-notes')).toBeDisabled();
});

test('mobile scanner and encrypted-session storage failures remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openVault(page); await unlockDemo(page);
  await page.locator('#vault-load-notes').click(); await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/viewing-vault-mobile.png', fullPage: true });
  await page.locator('#vault-forget').click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('denied', 'QuotaExceededError'); }; });
  await page.locator('#vault-demo').click(); await page.locator('#vault-save').click();
  await expect(page.locator('#vault-error')).toContainText('could not be saved'); await expect(page.locator('#vault-mode')).toHaveText('LOCKED');
  await expect(page.locator('#vault-load-notes')).toBeDisabled();
});
