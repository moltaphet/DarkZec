import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Regenerates the README screenshots and the walkthrough frames from a running build:
 *   npm run build && PORT=4175 npm run preview   (in another terminal)
 *   node scripts/capture-media.ts
 * Screenshots go to docs/media/; numbered GIF frames go to test-results/media-frames/.
 */
const base = `http://127.0.0.1:${process.env.PORT ?? 4175}`;
const media = 'docs/media'; const frames = 'test-results/media-frames';
await mkdir(media, { recursive: true }); await mkdir(frames, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
let frame = 0;
const settle = (): Promise<void> => page.waitForTimeout(500);
/** Fixed chrome (header, status pill, telemetry dock) would overlap a section shot, so it is hidden while one is taken. */
const chrome = (visible: boolean): Promise<void> => page.evaluate(show => {
  for (const node of document.querySelectorAll<HTMLElement>('.masthead, .navigation, .network-status, .telemetry-rail, .hud')) node.style.visibility = show ? '' : 'hidden';
}, visible);
async function snap(name: string, target?: Locator): Promise<void> {
  await settle();
  if (!target) { await page.screenshot({ path: `${media}/${name}.png` }); return; }
  await chrome(false); await target.scrollIntoViewIfNeeded(); await settle();
  await target.screenshot({ path: `${media}/${name}.png` }); await chrome(true);
}
async function still(target?: Locator): Promise<void> {
  if (target) { await target.scrollIntoViewIfNeeded(); }
  await settle();
  await page.screenshot({ path: `${frames}/${String(++frame).padStart(2, '0')}.png` });
}
const click = async (selector: string, p: Page = page): Promise<void> => { await p.locator(selector).click(); await settle(); };

await page.goto(base); await page.waitForTimeout(1500);
await snap('hero'); await still();

await click('.skip-intro'); await still(page.locator('#sandbox-view .auction-strip'));
await click('#seed'); await click('#prepare'); await click('#commit');
await still(page.locator('.workspace'));
await snap('sealed-book', page.locator('.workspace'));
await still(page.locator('#operator-view'));
await click('#close'); await click('#reveal-all');
await still(page.locator('#operator-view'));
await snap('operator-view', page.locator('#operator-view'));
await click('#clear');
await still(page.locator('#results-panel'));
await snap('clearing-result', page.locator('#results-panel'));

// Audit mode on the bundle recorded from the real Zcash testnet auction DZ-TESTNET-1.
await click('#audit-tab');
await page.locator('#audit-bundle-file').setInputFiles('docs/testnet-run/DZ-TESTNET-1-audit-bundle.json');
await page.locator('#audit-verdict').filter({ hasText: 'VERIFIED' }).waitFor();
await still(page.locator('#audit-view'));
await snap('audit-mode-testnet', page.locator('#audit-view'));

await browser.close();
console.log(`Saved screenshots to ${media}/ and ${frame} frames to ${frames}/`);
