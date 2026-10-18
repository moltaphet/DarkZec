import { test, expect } from '@playwright/test';
import { DEMO_UNLOCK_PASSPHRASE, DEMO_VIEWING_KEY } from '../../src/lib/viewing-key-session';

test('stream observes URI/memo/auction operations, pauses, clears and shares counters', async ({ page }) => {
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const log = page.locator('#live-terminal-log'); await log.scrollIntoViewIfNeeded();
  await expect(log).toContainText('[SYS_INIT]:'); await expect(log).toContainText('[ZIP-302]: UTF-8 memo validated:');
  await expect(log).toContainText('[ZIP-321]: Payment URI generated locally');
  await expect(log.locator('.terminal-event').first()).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}Z /);
  await expect(page.locator('#stream-shield')).toHaveText('IDLE');
  await page.locator('#stream-pause').click(); const frozen = await log.textContent();
  await page.locator('#bid-price').fill('0.937142'); await page.locator('#bid-quantity').fill('7'); await page.locator('#prepare').click();
  await expect(page.locator('#prepared-panel')).toBeVisible();
  await expect(page.locator('#stream-bytes')).toHaveText(await page.locator('#telemetry-bytes').innerText());
  expect(await log.textContent()).toBe(frozen);
  await page.locator('#stream-pause').click(); await log.scrollIntoViewIfNeeded();
  await expect(log).toContainText('Private payment request ready for review');
  const payload = await page.locator('#memo-payload').textContent();
  expect(await log.innerText()).not.toContain(payload ?? 'MISSING PAYLOAD'); expect(await log.innerText()).not.toContain('0.937142');
  await page.locator('#commit').click(); await page.locator('#seed').click(); await page.locator('#close').click(); await page.locator('#clear').click();
  await log.scrollIntoViewIfNeeded(); await expect(log).toContainText('SIM / Local uniform-price clearing completed');
  await expect(log).toContainText('SIM / Merkle leaf generated for frozen commitment set');
  await page.locator('#stream-pause').click(); await page.locator('#stream-clear').click();
  await expect(log.locator('.terminal-event')).toHaveCount(0); await expect(page.locator('#telemetry-log .telemetry-line')).toHaveCount(0);
  await expect(page.locator('#stream-shield')).toHaveText('IDLE'); await expect(page.locator('#stream-leaks')).toHaveText('0');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('vault attempts, authentication, quarantine and lock are audited without private data', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await page.locator('#vault-tab').click();
  await page.locator('#vault-demo').click(); await page.locator('#vault-save').click(); await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED');
  await page.locator('#vault-lock').click(); await page.locator('#vault-passphrase').fill('wrong-private-passphrase'); await page.locator('#vault-unlock').click();
  await expect(page.locator('#vault-error')).toBeVisible();
  await page.locator('#vault-passphrase').fill(DEMO_UNLOCK_PASSPHRASE); await page.locator('#vault-unlock').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED'); await page.locator('#vault-load-notes').click();
  await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  await expect(page.locator('#stream-shield')).toHaveText('ACTIVE');
  const log = page.locator('#live-terminal-log'); await log.scrollIntoViewIfNeeded();
  await expect(log).toContainText('Attempt refused: local session unlock'); await expect(log).toContainText('authenticated mock decryption');
  await expect(log).toContainText('3 accepted / 1 quarantined / 1 empty');
  await expect(page.locator('#stream-memo-state')).toHaveText('VAULT / READY');
  await expect(page.locator('#stream-bytes')).toHaveText(await page.locator('#telemetry-bytes').innerText());
  const text = await log.innerText();
  for (const secret of [DEMO_VIEWING_KEY, DEMO_UNLOCK_PASSPHRASE, 'wrong-private-passphrase', '0.74', 'NOTE-0001']) expect(text).not.toContain(secret);
  await page.screenshot({ path: 'test-results/live-terminal-desktop.png', fullPage: true });
  await page.locator('#vault-lock').click(); await expect(page.locator('#stream-bytes')).toHaveText('0/512');
  await expect(page.locator('#stream-shield')).toHaveText('IDLE');
});

test('observed CSP violations count once across both views and clear preserves the count', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.evaluate(async () => { try { await fetch('https://example.invalid/private-destination'); } catch { /* expected CSP refusal */ } });
  await expect(page.locator('#stream-leaks')).toHaveText('1'); await expect(page.locator('#telemetry-leaks')).toHaveText('1');
  const log = page.locator('#live-terminal-log'); await log.scrollIntoViewIfNeeded();
  await expect(log).toContainText('External request blocked by CSP'); expect(await log.innerText()).not.toContain('example.invalid');
  await page.locator('#stream-clear').click(); await expect(log.locator('.terminal-event')).toHaveCount(0);
  await expect(page.locator('#stream-leaks')).toHaveText('1'); await expect(page.locator('#telemetry-leaks')).toHaveText('1');
});

test('mobile history remains bounded during repeated scans and normal motion types visible lines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await page.locator('#vault-tab').click();
  await page.locator('#vault-demo').click(); await page.locator('#vault-save').click(); await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED');
  await page.locator('#vault-load-notes').click(); await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  for (let i = 0; i < 8; i++) { await page.locator('#vault-scan').click(); await expect(page.locator('#vault-scan')).toBeEnabled(); }
  const log = page.locator('#live-terminal-log'); await log.scrollIntoViewIfNeeded();
  await expect(log.locator('.terminal-event')).toHaveCount(128); await expect(log).toContainText('Mock scan complete:');
  await expect(page.locator('#stream-retention')).not.toContainText('0 EVICTED');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(log.locator('.terminal-event').last()).toContainText('3 accepted / 1 quarantined / 1 empty');
  await page.screenshot({ path: 'test-results/live-terminal-mobile.png', fullPage: true });
  await page.locator('.live-terminal').screenshot({ path: 'test-results/live-terminal-mobile-detail.png' });
});
