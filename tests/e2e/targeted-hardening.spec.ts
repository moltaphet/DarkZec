import { revealLocalReceipts } from './auction-helpers';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEMO_UNLOCK_PASSPHRASE, VIEWING_SESSION_KEY } from '../../src/lib/viewing-key-session';

async function assertReadable(page: Page): Promise<void> {
  const undersized = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].flatMap(element => {
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility !== 'visible') return [];
    const hasText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!hasText && !element.matches('input, textarea, select')) return [];
    const primary = element.matches('input, textarea, select, output, .auction-strip strong, .receipt dd, .result-stats strong, .table-scroll td, .telemetry-counters dd, .stream-metrics dd, .memo-payload, .commitment-row code, .book-count > span, .clearing-anchor strong, .terminal-event');
    const minimum = primary ? 14 : 12;
    return Number.parseFloat(style.fontSize) < minimum ? [`${element.tagName}#${element.id}.${element.className}: ${style.fontSize} < ${minimum}px`] : [];
  }));
  expect(undersized).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('real and arbitrary vault keys cannot be persisted, unlocked or echoed into audit logs', async ({ page }) => {
  await page.goto('/'); await page.locator('#vault-tab').click();
  await expect(page.locator('#vault-viewing-key')).toHaveAttribute('placeholder', /mock:node07:/);
  for (const key of ['uview1' + 'q'.repeat(200), 'uviewtest1' + 'q'.repeat(200), 'arbitrary-private-key', 'mock:node07:*']) {
    await page.locator('#vault-viewing-key').fill(key);
    await page.locator('#vault-passphrase').fill(DEMO_UNLOCK_PASSPHRASE);
    await page.locator('#vault-save').click();
    await expect(page.locator('#vault-error')).toContainText('Mock keys only');
    await expect(page.locator('#vault-mode')).toHaveText('LOCKED');
    await expect(page.locator('#vault-load-notes')).toBeDisabled();
    await expect(page.locator('#vault-viewing-key')).toHaveValue('');
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect(await page.locator('#live-terminal-log').textContent()).not.toContain(key);
  }
  await page.locator('#vault-demo').click(); await page.locator('#vault-save').click();
  await expect(page.locator('#vault-mode')).toHaveText('MOCK / UNLOCKED');
  expect(await page.evaluate(key => sessionStorage.getItem(key), VIEWING_SESSION_KEY)).not.toBeNull();
});

test('mobile bid placeholders and scroll hints expose full auction and vault result tables', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  for (const prefix of ['bid', 'wallet']) {
    await expect(page.locator(`#${prefix}-price`)).toHaveAttribute('placeholder', '0.00 ZEC');
    await expect(page.locator(`#${prefix}-quantity`)).toHaveAttribute('placeholder', '0 Qty');
  }
  await page.locator('#seed').click(); await page.locator('#close').click(); await revealLocalReceipts(page); await page.locator('#clear').click();
  await expect(page.locator('#results-scroll-hint')).toBeVisible();
  const allocations = page.getByRole('region', { name: 'Auction clearing allocations' });
  await expect(allocations).toHaveClass(/overflow-x-auto/);
  expect(await allocations.evaluate(element => getComputedStyle(element).overflowX)).toBe('auto');
  expect(await allocations.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await allocations.focus(); await allocations.press('ArrowRight');
  await expect.poll(() => allocations.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await assertReadable(page);
  await page.locator('#vault-tab').click(); await page.locator('#vault-demo').click(); await page.locator('#vault-save').click();
  await page.locator('#vault-load-notes').click(); await expect(page.locator('#vault-accepted dd')).toHaveText('3');
  await expect(page.locator('#vault-scroll-hint')).toBeVisible();
  expect(await page.locator('#vault-table-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await assertReadable(page);
  await page.screenshot({ path: 'test-results/targeted-hardening-mobile-results.png', fullPage: true });
});

test('terminal, protocol manual, wallet, vault and telemetry retain twelve-pixel labels and fourteen-pixel readouts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto('/');
    await page.locator('#protocol-specs > details > summary').click();
    for (const summary of await page.locator('.protocol-entry > summary').all()) {
      if (!await summary.evaluate(element => element.parentElement?.hasAttribute('open'))) await summary.click();
    }
    await assertReadable(page);
    await page.locator('#wallet-tab').click(); await assertReadable(page);
    await page.locator('#vault-tab').click(); await assertReadable(page);
    await page.locator('#audit-tab').click(); await assertReadable(page);
    if (await page.locator('#telemetry-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#telemetry-toggle').click();
    await assertReadable(page);
    if (width === 1440) await page.screenshot({ path: 'test-results/targeted-hardening-desktop.png', fullPage: true });
  }
});
