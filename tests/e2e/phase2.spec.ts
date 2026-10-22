import { test, expect } from '@playwright/test';

test('unselected ArrowLeft chooses the final node and wraps in both directions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('#seed').click();
  const canvas = page.locator('#blind-mesh'); await canvas.focus(); await canvas.press('Escape'); await canvas.press('ArrowLeft');
  await expect(canvas).toHaveAttribute('data-active-node', '2');
  await canvas.press('ArrowRight'); await expect(canvas).toHaveAttribute('data-active-node', '0');
  await canvas.press('ArrowLeft'); await expect(canvas).toHaveAttribute('data-active-node', '2');
  await canvas.press('Escape'); await canvas.press('ArrowRight'); await expect(canvas).toHaveAttribute('data-active-node', '0');
  await page.locator('#reset').click(); await page.locator('#prepare').click(); await page.locator('#commit').click();
  await canvas.focus(); await canvas.press('Escape'); await canvas.press('ArrowLeft'); await expect(canvas).toHaveAttribute('data-active-node', '0');
});

test('closed auction locks inputs and ignores late draft events while preserving independent workspaces', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('#seed').click();
  await page.locator('#bid-price').fill('0.81'); await page.locator('#close').click();
  await expect(page.locator('#phase')).toHaveText('CLOSED / REVEAL WINDOW');
  await expect(page.locator('#bid-price')).toBeDisabled(); await expect(page.locator('#bid-quantity')).toBeDisabled();
  await expect(page.locator('#memo-scramble')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#stream-bytes')).toHaveText('0/512');
  await page.locator('#live-terminal-log').scrollIntoViewIfNeeded();
  await expect(page.locator('#live-terminal-log')).toContainText('Merkle leaf generated');
  await page.locator('#stream-clear').click();
  await page.evaluate(() => {
    const price = document.getElementById('bid-price');
    if (!(price instanceof HTMLInputElement)) throw new Error('Missing price input');
    price.value = '0.91'; price.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 350)));
  await expect(page.locator('#live-terminal-log .terminal-event')).toHaveCount(0);
  await expect(page.locator('#memo-payload')).toHaveText('NO ACTIVE MEMO DRAFT'); await expect(page.locator('#stream-bytes')).toHaveText('0/512');
  await page.locator('#wallet-tab').click(); await expect(page.locator('#wallet-price')).toBeEnabled();
  await page.locator('#sandbox-tab').click(); await expect(page.locator('#bid-price')).toBeDisabled();
});

test('reset restores valid defaults, restarts one preview and makes repeated seeding safe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#wallet-tab').click(); await page.locator('#wallet-price').fill('1.2'); await page.locator('#wallet-quantity').fill('9');
  await page.locator('#wallet-auction').fill('CHANGED'); await page.locator('#wallet-network').selectOption('mainnet');
  await page.locator('#wallet-vault').fill('u1edited-input'); await page.locator('#sandbox-tab').click();
  await page.locator('#bid-price').fill('0'); await page.locator('#bid-quantity').fill('0');
  await page.locator('#prepare').click(); await expect(page.locator('#error')).toBeVisible();
  await page.locator('#seed').click(); await page.locator('#close').click(); await page.locator('#reset').click();
  await expect(page.locator('#bid-price')).toHaveValue('0.72'); await expect(page.locator('#bid-quantity')).toHaveValue('4');
  await expect(page.locator('#audit-index')).toHaveValue('1'); await expect(page.locator('#bid-count')).toHaveText('00');
  await expect(page.locator('#wallet-price')).toHaveValue(''); await expect(page.locator('#wallet-quantity')).toHaveValue('');
  await expect(page.locator('#wallet-vault')).toHaveValue(''); await expect(page.locator('#wallet-refund')).toHaveValue('');
  await expect(page.locator('#wallet-auction')).toHaveValue('NODE07-001'); await expect(page.locator('#wallet-network')).toHaveValue('testnet');
  await expect(page.locator('#wallet-reviewed')).not.toBeChecked(); await expect(page.locator('#wallet-uri')).toHaveValue('');
  await expect(page.locator('#audit-panel')).toBeHidden(); await expect(page.locator('#results-panel')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
  await page.locator('#memo-scramble').scrollIntoViewIfNeeded(); await expect(page.locator('#memo-scramble')).toHaveAttribute('data-state', 'ready');
  const encoded = await page.locator('#memo-payload').innerText(); const memo: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  expect(memo).toMatchObject({ p: '0.72', q: 4 });
  await page.locator('#live-terminal-log').scrollIntoViewIfNeeded();
  await expect(page.locator('#live-terminal-log .terminal-event').filter({ hasText: 'Payment URI generated locally' })).toHaveCount(1);
  await page.locator('#seed').click(); await expect(page.locator('#bid-count')).toHaveText('03'); await expect(page.locator('#seed')).toBeDisabled();
  await page.locator('#reset').click(); await expect(page.locator('#seed')).toBeEnabled();
  await page.locator('#seed').click(); await expect(page.locator('#bid-count')).toHaveText('03');
});

test('shield and Merkle events reflect encryption and close-time compilation rather than startup', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('#stream-shield')).toHaveText('IDLE'); await expect(page.locator('#telemetry-shield')).toHaveText('IDLE');
  await page.locator('#prepare').click(); await expect(page.locator('#stream-shield')).toHaveText('IDLE');
  await page.locator('#commit').click(); await expect(page.locator('#stream-shield')).toHaveText('ACTIVE');
  const log = page.locator('#live-terminal-log'); await log.scrollIntoViewIfNeeded(); await expect(log).toContainText('Commitment hash and posted collateral');
  await expect(log).not.toContainText('Merkle leaf generated');
  await page.locator('#close').click(); await expect(page.locator('#merkle-root')).toHaveText(/^[a-f0-9]{64}$/);
  await log.scrollIntoViewIfNeeded(); await expect(log).toContainText('Merkle leaf generated');
  await expect(page.locator('#stream-shield')).toHaveText('ACTIVE');
  await page.locator('#clear').click(); await expect(page.locator('#stream-shield')).toHaveText('IDLE');
  await page.locator('#reset').click(); await expect(page.locator('#stream-shield')).toHaveText('IDLE');
  await page.locator('#close').click(); await log.scrollIntoViewIfNeeded(); await expect(log).not.toContainText('Merkle leaf generated');
});

test('failed close-time Merkle compilation never logs successful leaf generation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('#seed').click();
  await page.locator('#memo-scramble').scrollIntoViewIfNeeded(); await expect(page.locator('#memo-scramble')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const digest = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = function(this: SubtleCrypto, ..._args: Parameters<SubtleCrypto['digest']>): Promise<ArrayBuffer> {
      SubtleCrypto.prototype.digest = digest;
      return Promise.reject(new DOMException('Simulated Merkle compilation failure', 'OperationError'));
    };
  });
  await page.locator('#close').click(); await expect(page.locator('#error')).toContainText('Simulated Merkle compilation failure');
  await expect(page.locator('#audit-panel')).toBeHidden(); await expect(page.locator('#bid-price')).toBeDisabled();
  await page.locator('#live-terminal-log').scrollIntoViewIfNeeded(); await expect(page.locator('#live-terminal-log')).not.toContainText('Merkle leaf generated');
});

test('a retry after partial fixture encryption failure does not duplicate accepted seed bids', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#seed')).toBeEnabled();
  await page.evaluate(() => {
    const encrypt = SubtleCrypto.prototype.encrypt; let calls = 0;
    SubtleCrypto.prototype.encrypt = function(this: SubtleCrypto, ...args: Parameters<SubtleCrypto['encrypt']>): Promise<ArrayBuffer> {
      if (++calls === 2) return Promise.reject(new DOMException('Simulated local encryption failure', 'OperationError'));
      return encrypt.apply(this, args);
    };
  });
  await page.locator('#seed').click(); await expect(page.locator('#error')).toContainText('Simulated local encryption failure');
  await expect(page.locator('#bid-count')).toHaveText('01'); await expect(page.locator('#seed')).toBeEnabled();
  await page.locator('#seed').click(); await expect(page.locator('#bid-count')).toHaveText('03'); await expect(page.locator('#seed')).toBeDisabled();
  await page.locator('#reset').click(); await page.locator('#seed').click(); await expect(page.locator('#bid-count')).toHaveText('03');
});
